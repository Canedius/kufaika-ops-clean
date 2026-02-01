import type { Order } from "../types";
import { priorityTone, statusLabel, statusTone } from "../theme";
import { AlertTriangle } from "lucide-react";
import { getPhotoUrl } from "../lib/photos";
import type { MouseEvent } from "react";

type Props = {
  order: Order;
  selected?: boolean;
  checked?: boolean;
  selectable?: boolean;
  onSelect?: (order: Order) => void;
  onToggleSelect?: (order: Order, checked: boolean) => void;
  onTake?: (order: Order) => void;
  onBack?: (order: Order) => void;
  onDone?: (order: Order) => void;
  pulse?: boolean;
};

export const OrderCard = ({
  order,
  selected,
  checked,
  selectable,
  onSelect,
  onToggleSelect,
  onTake,
  onBack,
  onDone,
  pulse,
}: Props) => {
  const tone = priorityTone[order.priority];
  const status = statusLabel[order.status];
  const statusColor = statusTone[order.status];
  const photo = getPhotoUrl(order.sku);

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <article
      className={`card compact ${selected ? "card-selected" : ""} ${pulse ? "card-pulse" : ""}`}
      onClick={() => onSelect?.(order)}
      role="button"
      tabIndex={0}
    >
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
        <div className={`pill ${tone}`}>{order.priority}</div>
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
        <span className={statusColor}>{status}</span>
        {order.priority === "Дефіцит" && <AlertTriangle size={16} className="alert-icon" />}
        <div className="card-actions">
          {onTake && order.status === "incoming" && (
            <button className="btn mini primary" onClick={(e) => { stop(e); onTake(order); }}>
              Взяти
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

