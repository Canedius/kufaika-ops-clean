import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";
import { OrderCard } from "./OrderCard";
import { fetchOrders, updateOrderStatus } from "../lib/api";
import type { Order, OrderStatus, Priority } from "../types";
import { priorityTone, statusLabel, statusTone } from "../theme";
import { getPhotoUrl } from "../lib/photos";
import { Info, Shirt, Palette, Ruler, Package, Boxes, BarChart3, Target, RotateCcw } from "lucide-react";

type Props = {
  filterBy: OrderStatus[];
  emptyText: string;
  actions: {
    take?: boolean;
    complete?: boolean;
    backToIncoming?: boolean;
  };
};

export const OrdersPage = ({ filterBy, emptyText, actions }: Props) => {
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [localOrders, setLocalOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (data) setLocalOrders(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: ({ order, status }: { order: Order; status: OrderStatus }) =>
      updateOrderStatus({ order, status }),
    onMutate: (vars) => {
      setLocalOrders((prev) => prev.map((o) => (o.id === vars.order.id ? { ...o, status: vars.status } : o)));
      qc.setQueryData<Order[]>(["orders"], (prev) =>
        (prev || []).map((o) => (o.id === vars.order.id ? { ...o, status: vars.status } : o)),
      );
    },
  });

  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sort, setSort] = useState<"priority" | "date" | "sku">("priority");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBulkSelected(new Set());
    setSelectedId(null);
  }, [filterBy.join(",")]);

  const filtered = useMemo(() => {
    const base = localOrders.filter((o) => filterBy.includes(o.status));
    const byTerm = base.filter((o) =>
      `${o.sku} ${o.color} ${o.productType}`.toLowerCase().includes(search.toLowerCase()),
    );
    const byPr = priority === "all" ? byTerm : byTerm.filter((o) => o.priority === priority);
    const sorted = [...byPr].sort((a, b) => {
      if (sort === "priority") return priorityWeight(b.priority) - priorityWeight(a.priority);
      if (sort === "date") return new Date(b.launchDate).getTime() - new Date(a.launchDate).getTime();
      return a.sku.localeCompare(b.sku);
    });
    return sorted;
  }, [localOrders, filterBy, priority, search, sort]);

  const selected =
    filtered.find((o) => o.id === selectedId) ||
    (filtered.length ? filtered[0] : null);

  const toggleBulk = (order: Order, checked: boolean) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(order.id);
      else next.delete(order.id);
      return next;
    });
  };

  const bulkHandle = (status: OrderStatus) => {
    const ids = Array.from(bulkSelected);
    const allowedStatuses =
      status === "in-progress" ? ["incoming"] : status === "done" ? ["in-progress"] : ["incoming", "in-progress", "done"];
    ids
      .map((id) => filtered.find((o) => o.id === id))
      .filter((o): o is Order => !!o && allowedStatuses.includes(o.status))
      .forEach((o) => handleUpdate(o, status));
    setBulkSelected(new Set());
  };

  const handleUpdate = (order: Order, status: OrderStatus) => {
    if (status === "in-progress") {
      setPulseId(order.id);
      setTimeout(() => setPulseId(null), 800);
    }
    mutation.mutate({ order, status });
  };

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <FilterBar onSearch={setSearch} onPriority={setPriority} onSort={setSort} />
        <button className="btn mini ghost refresh-btn" onClick={() => refetch()} disabled={isFetching}>
          <RotateCcw size={14} />
          <span className="btn-label">{isFetching ? "Оновлюю..." : "Оновити"}</span>
        </button>
      </div>

      {isLoading && <div className="muted">Завантажую...</div>}
      {!isLoading && filtered.length === 0 && <div className="muted">{emptyText}</div>}

      <div className="board">
        <div className="cards-list">
          {bulkSelected.size > 0 && (
            <div className="bulk-bar">
              <span>Виділено: {bulkSelected.size}</span>
              <div className="bulk-actions">
                {actions.take && (
                  <button className="btn mini primary" onClick={() => bulkHandle("in-progress")}>
                    Взяти в роботу
                  </button>
                )}
                {actions.backToIncoming && (
                  <button className="btn mini ghost" onClick={() => bulkHandle("incoming")}>
                    Повернути в чергу
                  </button>
                )}
                {actions.complete && (
                  <button className="btn mini success" onClick={() => bulkHandle("done")}>
                    Виконано
                  </button>
                )}
                <button className="btn mini ghost" onClick={() => setBulkSelected(new Set())}>
                  Очистити
                </button>
              </div>
            </div>
          )}

          {filtered.map((order) => (
            <OrderCard
              key={`${order.id}-${order.sku}`}
              order={order}
              selected={order.id === selected?.id}
              pulse={order.id === pulseId}
              onSelect={(o) => setSelectedId(o.id)}
              selectable
              checked={bulkSelected.has(order.id)}
              onToggleSelect={toggleBulk}
              onTake={actions.take ? (o) => handleUpdate(o, "in-progress") : undefined}
              onBack={actions.backToIncoming ? (o) => handleUpdate(o, "incoming") : undefined}
              onDone={actions.complete ? (o) => handleUpdate(o, "done") : undefined}
            />
          ))}
        </div>

        <div className="detail-pane">
          {!selected && <div className="muted">Оберіть замовлення, щоб побачити деталі</div>}
          {selected && (
            <>
              <div className="detail-head">
                <div>
                  <div className="detail-sku">{selected.sku}</div>
                  <div className="detail-title">{selected.productType}</div>
                </div>
                <div className={`pill ${priorityTone[selected.priority]}`}>{selected.priority}</div>
              </div>

              {getPhotoUrl(selected.sku) && (
                <div className="detail-photo">
                  <img src={getPhotoUrl(selected.sku)!} alt={selected.sku} />
                </div>
              )}

              <div className="detail-grid two-col">
                <div className="detail-col">
                  <Detail icon={<Info size={14} />} label="Статус" value={statusLabel[selected.status]} tone={statusTone[selected.status]} />
                  <Detail icon={<Shirt size={14} />} label="Тканина" value={selected.fabric || "н/д"} />
                  <Detail icon={<Palette size={14} />} label="Колір" value={selected.color} />
                  <Detail icon={<Ruler size={14} />} label="Розмір" value={selected.size} />
                </div>
                <div className="detail-col">
                  <Detail icon={<Package size={14} />} label="Кількість у пошив" value={`${selected.quantity} шт`} />
                  <Detail icon={<Boxes size={14} />} label="Ящики" value={`${selected.boxes ?? "н/д"}`} />
                  {selected.currentAvailable !== undefined && (
                    <Detail
                      icon={<BarChart3 size={14} />}
                      label="Поточний запас"
                      value={selected.currentAvailable.toString()}
                      tone={selected.currentAvailable < 0 ? "tone-red-text" : undefined}
                    />
                  )}
                  {selected.targetQty !== undefined && (
                    <Detail icon={<Target size={14} />} label="Цільовий запас" value={selected.targetQty.toString()} />
                  )}
                </div>
              </div>

              {selected.comment && <p className="comment">{selected.comment}</p>}

              <div className="actions">
                {actions.take && selected.status === "incoming" && (
                  <button className="btn primary" onClick={() => handleUpdate(selected, "in-progress")}>
                    Взяти в роботу
                  </button>
                )}
                {actions.backToIncoming && selected.status === "in-progress" && (
                  <button className="btn ghost" onClick={() => handleUpdate(selected, "incoming")}>
                    Повернути в чергу
                  </button>
                )}
                {actions.complete && selected.status !== "done" && (
                  <button className="btn success" onClick={() => handleUpdate(selected, "done")}>
                    Виконано
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const priorityWeight = (p: Priority) =>
  ({
    Дефіцит: 4,
    Критично: 3,
    Терміново: 2,
    Низький: 1,
  }[p]);

const Detail = ({ icon, label, value, tone }: { icon?: ReactNode; label: string; value: string; tone?: string }) => (
  <div className="detail">
    <span className="detail-label">
      {icon && <span className="detail-icon">{icon}</span>}
      {label}
    </span>
    <span className={tone ? `detail-value ${tone}` : "detail-value"}>{value}</span>
  </div>
);
