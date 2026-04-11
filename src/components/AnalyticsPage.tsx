import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { Download, Printer } from "lucide-react";
import { fetchOrders } from "../lib/api";
import { useExcelExport } from "../hooks/useExcelExport";
import type { Order, Priority, OrderStatus } from "../types";

const SIZE_COLUMNS = ["XS", "XS/S", "S", "M", "M/L", "L", "XL", "XL/2XL", "2XL", "3XL"];

const SIZE_NORMALIZE: Record<string, string> = {
  "XS": "XS", "XS/S": "XS/S", "S": "S",
  "M": "M", "M/L": "M/L", "L": "L",
  "XL": "XL", "XL/XXL": "XL/2XL", "XL/2XL": "XL/2XL",
  "XXL": "2XL", "2XL": "2XL", "3XL": "3XL", "4XL": "4XL",
};

const PRIORITY_RANK: Record<Priority, number> = {
  "Критично": 0, "Терміново": 1, "Дефіцит": 2, "Низький": 3,
};

const PRIORITY_COLOR: Record<Priority, string> = {
  "Критично": "#e63946",
  "Терміново": "#f7c948",
  "Дефіцит": "#8b5cf6",
  "Низький": "#12a454",
};

const PRIORITY_BG: Record<Priority, string> = {
  "Критично": "#fde8ea",
  "Терміново": "#fef9e7",
  "Дефіцит": "#f3eefa",
  "Низький": "#e6f7ed",
};

const STATUS_LABEL: Record<string, string> = {
  incoming: "Пошив",
  cutting: "Крій",
  "in-progress": "В роботі",
};

const STATUS_ICON: Record<string, string> = {
  incoming: "🔥",
  cutting: "✂️",
  "in-progress": "🧵",
};

const PRODUCT_COLORS = ["#1f7aec", "#e63946", "#f7c948", "#12a454", "#8b5cf6", "#f97316", "#ec4899", "#06b6d4"];

function higherPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

interface StatusBreakdown {
  incoming: number;
  cutting: number;
  "in-progress": number;
}

interface SizeCell {
  total: number;
  priority: Priority;
  byStatus: StatusBreakdown;
}

interface MatrixRow {
  label: string;
  sizes: Record<string, SizeCell>;
  totalQty: number;
}

function useAnalyticsData(orders: Order[]) {
  return useMemo(() => {
    const active = orders.filter((o) => o.status === "incoming");

    // --- Matrix data ---
    const groupMap = new Map<string, MatrixRow>();
    for (const o of active) {
      const key = `${o.productType}::${o.color}`;
      const col = SIZE_NORMALIZE[o.size] || SIZE_NORMALIZE[o.size?.toUpperCase()] || o.size;
      let row = groupMap.get(key);
      if (!row) {
        const label = `${o.productType} — ${o.color}`.replace(/[⬛⬜🩷🩶🟩🟫]/g, "").trim();
        row = { label, sizes: {}, totalQty: 0 };
        groupMap.set(key, row);
      }
      const existing = row.sizes[col];
      if (existing) {
        existing.total += o.quantity;
        existing.priority = higherPriority(existing.priority, o.priority);
        existing.byStatus[o.status as keyof StatusBreakdown] += o.quantity;
      } else {
        const byStatus: StatusBreakdown = { incoming: 0, cutting: 0, "in-progress": 0 };
        byStatus[o.status as keyof StatusBreakdown] = o.quantity;
        row.sizes[col] = { total: o.quantity, priority: o.priority, byStatus };
      }
    }

    const matrixRows = Array.from(groupMap.values())
      .map((row) => {
        row.totalQty = Object.values(row.sizes).reduce((s, c) => s + c.total, 0);
        return row;
      })
      .sort((a, b) => b.totalQty - a.totalQty);

    // --- Bar chart: qty by product type ---
    const productMap = new Map<string, number>();
    for (const o of active) {
      const name = o.productType.replace(/Kufaika\s*(Unisex)?/gi, "").trim();
      productMap.set(name, (productMap.get(name) || 0) + o.quantity);
    }
    const barData = Array.from(productMap.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);

    // --- Pie chart: qty by priority ---
    const prioMap = new Map<Priority, number>();
    for (const o of active) {
      prioMap.set(o.priority, (prioMap.get(o.priority) || 0) + o.quantity);
    }
    const pieData = (["Критично", "Терміново", "Дефіцит", "Низький"] as Priority[])
      .filter((p) => prioMap.has(p))
      .map((p) => ({ name: p, value: prioMap.get(p)!, color: PRIORITY_COLOR[p] }));

    // --- Summary numbers ---
    const totalUnits = active.reduce((s, o) => s + o.quantity, 0);
    const totalOrders = active.length;
    const criticalCount = matrixRows.reduce((sum, row) =>
      sum + Object.values(row.sizes).filter((c) => c.priority !== "Низький").length, 0,
    );

    return { matrixRows, barData, pieData, totalUnits, totalOrders, criticalCount };
  }, [orders]);
}

const MatrixCell = ({ cell }: { cell: SizeCell | undefined }) => {
  const [hover, setHover] = useState(false);

  if (!cell || cell.total === 0) return <td className="matrix-cell matrix-cell--empty" />;

  const statuses = (["incoming", "cutting", "in-progress"] as const).filter((s) => cell.byStatus[s] > 0);

  return (
    <td
      className="matrix-cell"
      style={{ backgroundColor: PRIORITY_BG[cell.priority], borderLeft: `3px solid ${PRIORITY_COLOR[cell.priority]}` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="matrix-priority-label">{cell.priority}</span>
      <span className="matrix-total">{cell.total}</span>
      {statuses.length === 1 && statuses[0] === "incoming" ? null : (
        <span className="matrix-breakdown">
          {statuses.length === 1 ? (
            <span className="matrix-status" title={STATUS_LABEL[statuses[0]]}>
              {STATUS_ICON[statuses[0]]} {STATUS_LABEL[statuses[0]]}
            </span>
          ) : (
            statuses.map((s) => (
              <span key={s} className="matrix-status" title={STATUS_LABEL[s]}>
                {STATUS_ICON[s]}{cell.byStatus[s]}
              </span>
            ))
          )}
        </span>
      )}
      {hover && (
        <div className="matrix-tooltip">
          <div className="matrix-tooltip-priority" style={{ color: PRIORITY_COLOR[cell.priority] }}>
            {cell.priority}
          </div>
          {statuses.map((s) => (
            <div key={s}>{STATUS_LABEL[s]}: {cell.byStatus[s]} шт.</div>
          ))}
        </div>
      )}
    </td>
  );
};

export const AnalyticsPage = () => {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    staleTime: 2 * 60_000,
  });

  const { matrixRows, barData, pieData, totalUnits, totalOrders, criticalCount } =
    useAnalyticsData(orders);
  const { exportToExcel, exporting } = useExcelExport();

  if (isLoading) return <div className="muted">Завантажую...</div>;

  return (
    <div className="analytics-page">
      <div className="analytics-summary">
        <div className="summary-card">
          <span className="summary-value">{totalOrders}</span>
          <span className="summary-label">Замовлень</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{totalUnits.toLocaleString()}</span>
          <span className="summary-label">Одиниць</span>
        </div>
        <div className="summary-card summary-card--warn">
          <span className="summary-value">{criticalCount}</span>
          <span className="summary-label">Термінових</span>
        </div>
      </div>

      <div className="analytics-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="analytics-title">Матриця виробництва</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn mini ghost" onClick={() => window.print()}>
              <Printer size={14} />
              <span className="btn-label">Друк</span>
            </button>
            <button className="btn mini ghost" onClick={exportToExcel} disabled={exporting}>
              <Download size={14} />
              <span className="btn-label">{exporting ? "Експортую..." : "Експорт Excel"}</span>
            </button>
          </div>
        </div>
        <p className="analytics-subtitle">Виріб × Розмір — колір за пріоритетом</p>
        <div className="matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th className="matrix-header matrix-header--label">Виріб</th>
                <th className="matrix-header matrix-header--total">Всього</th>
                {SIZE_COLUMNS.map((s) => (
                  <th key={s} className="matrix-header">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={row.label}>
                  <td className="matrix-label">{row.label}</td>
                  <td className="matrix-total-col">{row.totalQty}</td>
                  {SIZE_COLUMNS.map((s) => (
                    <MatrixCell key={s} cell={row.sizes[s]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="analytics-charts">
        <div className="analytics-section analytics-section--half">
          <h2 className="analytics-title">По виробах</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7ec" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                  formatter={(v: number) => [`${v.toLocaleString()} шт.`, "Кількість"]}
                />
                <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
                  {barData.map((_, i) => (
                    <Cell key={i} fill={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="analytics-section analytics-section--half">
          <h2 className="analytics-title">По пріоритетах</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={50}
                  paddingAngle={3}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v.toLocaleString()} шт.`, "Кількість"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
