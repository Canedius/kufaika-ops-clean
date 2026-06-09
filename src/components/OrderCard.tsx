import type { Order } from "../types";
import { priorityTone, statusLabel, statusTone } from "../theme";
import { AlertTriangle, Pencil } from "lucide-react";
import { getPhotoUrl } from "../lib/photos";
import type { MouseEvent } from "react";

type Props = {
  order: Order;
  selected?: boolean;
  checked?: boolean;
  selectable?: boolean;
  onSelect?: (order: Order) => void;
  onToggleSelect?: (order: Order, checked: boolean) => void;
  onCut?: (order: Order) => void;
  onSew?: (order: Order) => void;
  hasStock?: boolean;
  onShelf?: (order: Order) => void;
  onCutToSew?: (order: Order) => void;
  onBack?: (order: Order) => void;
  onDone?: (order: Order) => void;
  onEdit?: (order: Order) => void;
  pulse?: boolean;
};

export const OrderCard = ({
  order,
  selected,
  checked,
  selectable,
  onSelect,
  onToggleSelect,
  onCut,
  onSew,
  hasStock,
  onShelf,
  onCutToSew,
  onBack,
  onDone,
  onEdit,
  pulse,
}: Props) => {
  const tone = priorityTone[order.priority];
  const isIndividual = !!order.individual;
  const status = isIndividual ? "Індивідуальний пошив" : statusLabel[order.status];
  const statusColor = isIndividual ? "tone-red-text" : statusTone[order.status];
  const photo = getPhotoUrl(order.sku);

  const dueShort = (() => {
    if (!isIndividual || !order.launchDate) return null;
    const m = order.launchDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}`;
    const dm = order.launchDate.match(/^(\d{2})\.(\d{2})/);
    return dm ? `${dm[1]}.${dm[2]}` : null;
  })();

  const badge = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const isDateToday = (d?: string) => {
      if (!d) return false;
      if (d.length >= 10 && d.slice(0, 10) === today) return true;
      const parts = d.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` === today : false;
    };
    const createdToday = isDateToday(order.createdAt) || isDateToday(order.launchDate);
    const updatedToday = isDateToday(order.updatedAt);
    if (createdToday) return "new";
    if (updatedToday) return "updated";
    return null;
  })();

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <article
      className={`card compact ${selected ? "card-selected" : ""} ${pulse ? "card-pulse" : ""}`}
      onClick={() => onSelect?.(order)}
      role="button"
      tabIndex={0}
      style={{ position: "relative" }}
    >
      {badge === "new" && <span className="card-badge-new" />}
      {badge === "updated" && <span className="card-badge-updated" />}
      <div className="card-head">
        <div className="card-head-left">
          {selectable && (
            <input
              type="checkbox"
              className="card-check"
              checked={checked}
              onClick={stop}
              onChange={(e) => onToggleSelect?.(order, e.target.checked)}
            />
          )}
          <div>
            <div className="sku">{order.sku}</div>
            <div className="mini-title">{order.productType}</div>
          </div>
        </div>
        <div className={`pill ${isIndividual ? "tone-red" : tone}`}>
          {isIndividual ? (dueShort ? `до ${dueShort}` : "Індив.") : order.priority}
        </div>
      </div>

      <div className="mini-row">
        <div className="mini-meta">
          <span><strong>Колір:</strong> {order.color}</span>
          <span><strong>Розмір:</strong> {order.size}</span>
          <span><strong>Кількість:</strong> {order.quantity} шт.</span>
        </div>
        {photo && (
          <div className="thumb-box">
            <img src={photo} alt={order.sku} className="thumb-img" />
          </div>
        )}
      </div>

      <div className="summary-line">
        <span className={statusColor} style={isIndividual ? { fontWeight: 600 } : undefined}>{status}</span>
        {(order.priority === "Дефіцит" || isIndividual) && <AlertTriangle size={16} className="alert-icon" />}
        <div className="card-actions">
          {onEdit && (
            <button
              className="btn mini ghost icon-only"
              title="Редагувати задачу"
              onClick={(e) => { stop(e); onEdit(order); }}
            >
              <Pencil size={14} />
            </button>
          )}
          {onCut && order.status === "incoming" && (
            <button className="btn mini primary" onClick={(e) => { stop(e); onCut(order); }}>
              В розкрій
            </button>
          )}
          {onSew && order.status === "incoming" && (
            <button
              className="btn mini ghost"
              onClick={(e) => { stop(e); onSew(order); }}
              disabled={!hasStock}
              title={hasStock ? "Взяти в пошив зі складу" : "Немає залишків крою на складі"}
            >
              В пошив
            </button>
          )}
          {onShelf && order.status === "cutting" && (
            <button className="btn mini primary" onClick={(e) => { stop(e); onShelf(order); }}>
              На склад
            </button>
          )}
          {onCutToSew && order.status === "cutting" && (
            <button className="btn mini ghost" onClick={(e) => { stop(e); onCutToSew(order); }}>
              В пошив
            </button>
          )}
          {onBack && order.status === "in-progress" && (
            <button className="btn mini ghost" onClick={(e) => { stop(e); onBack(order); }}>
              Повернути
            </button>
          )}
          {onDone && order.status !== "done" && (
            <button className="btn mini success" onClick={(e) => { stop(e); onDone(order); }}>
              Виконано
            </button>
          )}
        </div>
      </div>
    </article>
  );
};
