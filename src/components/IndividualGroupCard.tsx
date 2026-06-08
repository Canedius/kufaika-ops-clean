import type { Order } from "../types";
import { AlertTriangle } from "lucide-react";
import { getPhotoUrl } from "../lib/photos";
import type { MouseEvent } from "react";

type Props = {
  members: Order[];
  selectedId?: string | null;
  hasStock?: boolean;
  onSelectMember?: (order: Order) => void;
  onCut?: (members: Order[]) => void;
  onSew?: (members: Order[]) => void;
  onShelf?: (members: Order[]) => void;
  onCutToSew?: (members: Order[]) => void;
  onBack?: (members: Order[]) => void;
  onDone?: (members: Order[]) => void;
  pulse?: boolean;
};

const shortDate = (s?: string): string | null => {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}`;
  const dm = s.match(/^(\d{2})\.(\d{2})/);
  return dm ? `${dm[1]}.${dm[2]}` : null;
};

export const IndividualGroupCard = ({
  members,
  selectedId,
  hasStock,
  onSelectMember,
  onCut,
  onSew,
  onShelf,
  onCutToSew,
  onBack,
  onDone,
  pulse,
}: Props) => {
  const status = members[0]?.status;
  const totalQty = members.reduce((s, m) => s + m.quantity, 0);

  const earliestDue = members
    .map((m) => m.launchDate)
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  const dueShort = shortDate(earliestDue);

  const isSelected = members.some((m) => m.id === selectedId);
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <article
      className={`card compact card-group ${isSelected ? "card-selected" : ""} ${pulse ? "card-pulse" : ""}`}
      style={{ position: "relative" }}
    >
      <div className="card-head">
        <div className="card-head-left">
          <div>
            <div className="sku">Індивідуальна задача</div>
            <div className="mini-title">{members.length} позицій · {totalQty} шт</div>
          </div>
        </div>
        <div className="pill tone-red">{dueShort ? `до ${dueShort}` : "Індив."}</div>
      </div>

      <div className="group-positions">
        {members.map((m) => {
          const photo = getPhotoUrl(m.sku);
          return (
            <button
              key={`${m.id}-${m.sku}`}
              type="button"
              className={`group-pos${m.id === selectedId ? " group-pos--active" : ""}`}
              onClick={(e) => { stop(e); onSelectMember?.(m); }}
            >
              {photo && (
                <span className="group-pos-thumb">
                  <img src={photo} alt={m.sku} />
                </span>
              )}
              <span className="group-pos-main">
                <span className="group-pos-title">{m.productType}</span>
                <span className="group-pos-meta">{m.color} · {m.size} · {m.quantity} шт</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="summary-line">
        <span className="tone-red-text" style={{ fontWeight: 600 }}>Індивідуальний пошив</span>
        <AlertTriangle size={16} className="alert-icon" />
        <div className="card-actions">
          {onCut && status === "incoming" && (
            <button className="btn mini primary" onClick={(e) => { stop(e); onCut(members); }}>
              В розкрій
            </button>
          )}
          {onSew && status === "incoming" && (
            <button
              className="btn mini ghost"
              onClick={(e) => { stop(e); onSew(members); }}
              disabled={!hasStock}
              title={hasStock ? "Взяти в пошив зі складу" : "Немає залишків крою на складі для всіх позицій"}
            >
              В пошив
            </button>
          )}
          {onShelf && status === "cutting" && (
            <button className="btn mini primary" onClick={(e) => { stop(e); onShelf(members); }}>
              На склад
            </button>
          )}
          {onCutToSew && status === "cutting" && (
            <button className="btn mini ghost" onClick={(e) => { stop(e); onCutToSew(members); }}>
              В пошив
            </button>
          )}
          {onBack && status === "in-progress" && (
            <button className="btn mini ghost" onClick={(e) => { stop(e); onBack(members); }}>
              Повернути
            </button>
          )}
          {onDone && status !== "done" && (
            <button className="btn mini success" onClick={(e) => { stop(e); onDone(members); }}>
              Виконано
            </button>
          )}
        </div>
      </div>
    </article>
  );
};
