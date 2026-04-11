import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";
import { OrderCard } from "./OrderCard";
import { fetchOrders, fetchCutStock, updateOrder, consumeFromStock, addToStock, createCuttingOrder, createIncomingOrder, archiveOrder, formatDate, PRODUCT_CATALOG, COLOR_CATALOG } from "../lib/api";
import type { Order, OrderStatus, Priority, CutStockItem, SortLevel } from "../types";
import { priorityTone, statusLabel, statusTone } from "../theme";
import { getPhotoUrl } from "../lib/photos";
import { Info, Shirt, Palette, Ruler, Package, BarChart3, Target, RotateCcw, Scissors, Layers } from "lucide-react";

type ShelfModal = {
  order: Order;
  qty: number;
};

type CutModal = { order: Order; qty: number };
type SewModal = { order: Order; qty: number };
type CutToSewModal = { order: Order; qty: number };

type NewOrderForm = {
  productCode: string;
  colorCode: string;
  size: string;
  qty: number;
  priority: Priority;
  sku: string; // manual override; empty = auto-generated
  comment: string;
};

type Props = {
  filterBy: OrderStatus[];
  emptyText: string;
  actions: {
    cut?: boolean;
    sew?: boolean;
    shelf?: boolean;
    complete?: boolean;
    backToIncoming?: boolean;
    cutToSew?: boolean;
  };
};

export const OrdersPage = ({ filterBy, emptyText, actions }: Props) => {
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: cutStock = [] } = useQuery<CutStockItem[]>({
    queryKey: ["cutStock"],
    queryFn: fetchCutStock,
    staleTime: 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const pendingArchiveIds = useRef<Set<string>>(new Set());
  const orders = data || [];

  const optimisticUpdate = (id: string, patch: Partial<Order>) => {
    qc.cancelQueries({ queryKey: ["orders"] });
    qc.setQueryData<Order[]>(["orders"], (prev) => (prev || []).map((o) => (o.id !== id ? o : { ...o, ...patch })));
  };

  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sorts, setSorts] = useState<SortLevel[]>([{ field: "priority", dir: "desc" }]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [shelfModal, setShelfModal] = useState<ShelfModal | null>(null);
  const [cutModal, setCutModal] = useState<CutModal | null>(null);
  const [sewModal, setSewModal] = useState<SewModal | null>(null);
  const [cutToSewModal, setCutToSewModal] = useState<CutToSewModal | null>(null);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState<NewOrderForm>({
    productCode: "", colorCode: "", size: "", qty: 1, priority: "Низький", sku: "", comment: "",
  });

  useEffect(() => {
    setBulkSelected(new Set());
    setSelectedId(null);
  }, [filterBy.join(",")]);

  // Map SKU|size → total available qty on shelf
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of cutStock) {
      const key = `${s.sku}|${s.size}`;
      map.set(key, (map.get(key) ?? 0) + s.qty);
    }
    return map;
  }, [cutStock]);

  const filtered = useMemo(() => {
    const withoutPending = orders.filter((o) => !pendingArchiveIds.current.has(o.id));
    const base = withoutPending.filter((o) => filterBy.includes(o.status));
    const byTerm = base.filter((o) =>
      `${o.sku} ${o.color} ${o.productType}`.toLowerCase().includes(search.toLowerCase()),
    );
    const byPr = priority === "all" ? byTerm : byTerm.filter((o) => o.priority === priority);
    const sorted = [...byPr].sort((a, b) => {
      for (const { field, dir } of sorts) {
        let cmp = 0;
        if (field === "priority") cmp = priorityWeight(a.priority) - priorityWeight(b.priority);
        else if (field === "date") cmp = new Date(a.launchDate).getTime() - new Date(b.launchDate).getTime();
        else if (field === "sku") cmp = a.sku.localeCompare(b.sku);
        else if (field === "size") cmp = sizeWeight(a.size) - sizeWeight(b.size);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return sorted;
  }, [orders, filterBy, priority, search, sorts]);

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
    ids
      .map((id) => filtered.find((o) => o.id === id))
      .filter((o): o is Order => !!o)
      .forEach((o) => handleUpdate(o, status));
    setBulkSelected(new Set());
  };

  const handleUpdate = (order: Order, status: OrderStatus) => {
    if (status === "in-progress") {
      setPulseId(order.id);
      setTimeout(() => setPulseId(null), 800);
    }
    optimisticUpdate(order.id, { status });
    if (order.dtId) {
      updateOrder(order.dtId, order, { status })
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    }
  };

  // "В розкрій" — відкриває модал з кількістю
  const handleCut = (order: Order) => {
    setCutModal({ order, qty: order.quantity });
  };

  const handleCutConfirm = () => {
    if (!cutModal) return;
    const { order, qty } = cutModal;
    setCutModal(null);
    const isFullQty = qty >= order.quantity;
    console.log("[CUT]", { sku: order.sku, dtId: order.dtId, orderId: order.id, orderQty: order.quantity, cutQty: qty, isFullQty, remainder: order.quantity - qty });
    if (isFullQty && order.dtId) {
      // Повне — оновлюємо існуючий рядок
      optimisticUpdate(order.id, { status: "cutting", cutting_qty: qty });
      updateOrder(order.dtId, order, { status: "cutting", cutting_qty: qty })
        .then(() => { console.log("[CUT] full update OK"); setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000); });
    } else if (order.dtId) {
      // Часткове — зменшуємо оригінал, створюємо новий рядок для відщепленої частини
      const remainder = order.quantity - qty;
      console.log("[CUT] partial: updating dtId", order.dtId, "to_sew →", remainder);
      optimisticUpdate(order.id, { quantity: remainder });
      updateOrder(order.dtId, order, { to_sew: remainder })
        .then(() => { console.log("[CUT] update OK, creating cutting order…"); return createCuttingOrder(order, qty, "", "cutting"); })
        .then(() => { console.log("[CUT] create OK, invalidating in 3s"); setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000); })
        .catch((err) => {
          console.error("[CUT] Partial cut failed:", err);
          optimisticUpdate(order.id, { quantity: order.quantity });
          qc.invalidateQueries({ queryKey: ["orders"] });
        });
    } else {
      createCuttingOrder(order, qty, "", "cutting")
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    }
  };

  // "На склад" — відкриває модал з qty + shelf
  const openShelfModal = (o: Order) => {
    setShelfModal({ order: o, qty: o.cutting_qty || o.quantity });
  };

  const handleShelfConfirm = () => {
    if (!shelfModal) return;
    const { order, qty } = shelfModal;
    setShelfModal(null);
    const maxQty = order.cutting_qty || order.quantity;
    const isFullQty = qty >= maxQty;

    addToStock({ sku: order.sku, size: order.size, qty, shelf: "", cutDate: new Date().toISOString().split("T")[0] });

    if (isFullQty) {
      // Повне — архівуємо весь ордер
      pendingArchiveIds.current.add(order.id);
      optimisticUpdate(order.id, { status: "archived" });
      archiveOrder(order);
    } else if (order.dtId) {
      // Часткове — зменшуємо залишок в розкрої
      const remainder = maxQty - qty;
      optimisticUpdate(order.id, { cutting_qty: remainder, quantity: remainder });
      updateOrder(order.dtId, order, { cutting_qty: remainder, to_sew: remainder });
    }

    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["cutStock"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    }, 3000);
  };

  const handleComplete = (order: Order) => {
    pendingArchiveIds.current.add(order.id);
    optimisticUpdate(order.id, { status: "archived" });
    archiveOrder(order);
    setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000);
  };

  // "В пошив" — відкриває модал з кількістю (часткова подача можлива)
  const handleSew = (order: Order) => {
    const avail = stockMap.get(`${order.sku}|${order.size}`) ?? 0;
    setSewModal({ order, qty: Math.min(avail, order.quantity) });
  };

  const handleSewConfirm = () => {
    if (!sewModal) return;
    const { order, qty } = sewModal;
    setSewModal(null);

    // Списуємо зі складу крою
    const available = cutStock.filter((s) => s.sku === order.sku && s.size === order.size);
    let remaining = qty;
    for (const item of available) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, item.qty);
      consumeFromStock(item.stockId, take, item.dtId, item.qty);
      remaining -= take;
    }

    const isFullQty = qty >= order.quantity;
    if (isFullQty && order.dtId) {
      // Повне — оновлюємо існуючий рядок на in-progress
      optimisticUpdate(order.id, { status: "in-progress" });
      updateOrder(order.dtId, order, { status: "in-progress" })
        .then(() => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["cutStock"] });
          qc.invalidateQueries({ queryKey: ["orders"] });
        }, 3000));
    } else if (order.dtId) {
      // Часткове — зменшуємо оригінал, створюємо новий in-progress
      const remainder = order.quantity - qty;
      optimisticUpdate(order.id, { quantity: remainder });
      updateOrder(order.dtId, order, { to_sew: remainder });
      createCuttingOrder(order, qty, "", "in-progress")
        .then(() => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["cutStock"] });
          qc.invalidateQueries({ queryKey: ["orders"] });
        }, 3000));
    } else {
      createCuttingOrder(order, qty, "", "in-progress")
        .then(() => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["cutStock"] });
          qc.invalidateQueries({ queryKey: ["orders"] });
        }, 3000));
    }
  };

  const handleCutToSew = (order: Order) => {
    setCutToSewModal({ order, qty: order.cutting_qty || order.quantity });
  };

  const handleCutToSewConfirm = () => {
    if (!cutToSewModal) return;
    const { order, qty } = cutToSewModal;
    const maxQty = order.cutting_qty || order.quantity;
    const remainder = maxQty - qty;
    setCutToSewModal(null);

    if (remainder === 0 && order.dtId) {
      // Повне — оновлюємо статус на in-progress
      optimisticUpdate(order.id, { status: "in-progress" });
      updateOrder(order.dtId, order, { status: "in-progress" })
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    } else if (order.dtId) {
      // Часткове — зменшуємо оригінал, створюємо новий in-progress
      optimisticUpdate(order.id, { cutting_qty: remainder, quantity: remainder });
      updateOrder(order.dtId, order, { cutting_qty: remainder, to_sew: remainder });
      createCuttingOrder(order, qty, "", "in-progress")
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    } else {
      createCuttingOrder(order, qty, "", "in-progress")
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    }
  };

  const handleNewOrderConfirm = () => {
    const f = newOrderForm;
    const product = PRODUCT_CATALOG.find((p) => p.code === f.productCode);
    if (!product || !f.colorCode || !f.size || f.qty < 1) return;
    const autoSku = `${f.productCode}${f.colorCode}${f.size}`;
    const effectiveSku = f.sku.trim() || autoSku;
    setNewOrderOpen(false);
    setNewOrderForm({ productCode: "", colorCode: "", size: "", qty: 1, priority: "Низький", sku: "", comment: "" });
    createIncomingOrder({
      productType: product.name,
      size: f.size,
      qty: f.qty,
      priority: f.priority,
      sku: effectiveSku,
      comment: f.comment.trim() || undefined,
    }).then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
  };

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <FilterBar onSearch={setSearch} onPriority={setPriority} sorts={sorts} onSortsChange={setSorts} />
        <button className="btn mini ghost refresh-btn" onClick={() => refetch()} disabled={isFetching}>
          <RotateCcw size={14} />
          <span className="btn-label">{isFetching ? "Оновлюю..." : "Оновити"}</span>
        </button>
      </div>

      {isLoading && <div className="muted">Завантажую...</div>}
      {!isLoading && filtered.length === 0 && <div className="muted">{emptyText}</div>}

      <div className="board">
        <div className="cards-list">
          {filterBy.includes("incoming") && (
            <button className="btn add-sew-btn" onClick={() => setNewOrderOpen(true)}>
              + Додати пошив
            </button>
          )}
          {bulkSelected.size > 0 && (
            <div className="bulk-bar">
              <span>Виділено: {bulkSelected.size}</span>
              <div className="bulk-actions">
                {actions.backToIncoming && (
                  <button className="btn mini ghost" onClick={() => bulkHandle("incoming")}>
                    Повернути в чергу
                  </button>
                )}
                {actions.complete && (
                  <button className="btn mini success" onClick={() => {
                    Array.from(bulkSelected)
                      .map((id) => filtered.find((o) => o.id === id))
                      .filter((o): o is Order => !!o)
                      .forEach(handleComplete);
                    setBulkSelected(new Set());
                  }}>
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
              onCut={actions.cut ? handleCut : undefined}
              onSew={actions.sew ? handleSew : undefined}
              hasStock={stockMap.get(`${order.sku}|${order.size}`) ? (stockMap.get(`${order.sku}|${order.size}`)! > 0) : false}
              onShelf={actions.shelf ? openShelfModal : undefined}
              onCutToSew={actions.cutToSew ? handleCutToSew : undefined}
              onBack={actions.backToIncoming ? (o) => handleUpdate(o, "incoming") : undefined}
              onDone={actions.complete ? handleComplete : undefined}
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

              <div className="detail-photo-row">
                {getPhotoUrl(selected.sku) && (
                  <div className="detail-photo">
                    <img src={getPhotoUrl(selected.sku)!} alt={selected.sku} />
                  </div>
                )}
                <div className="detail-quick">
                  <Detail icon={<Info size={14} />} label="Статус" value={statusLabel[selected.status]} tone={statusTone[selected.status]} />
                  {selected.launchDate
                    ? <Detail label="Дата запуску" value={formatDate(selected.launchDate)} />
                    : <div />
                  }
                  <Detail icon={<Palette size={14} />} label="Колір" value={selected.color} />
                  <Detail icon={<Ruler size={14} />} label="Розмір" value={selected.size} />
                  <Detail icon={<Package size={14} />} label="Кількість / Ящики" value={`${selected.quantity} шт / ${selected.boxes ?? "н/д"} ящ`} />
                  <Detail icon={<Shirt size={14} />} label="Тканина" value={selected.fabric || "н/д"} />
                </div>
              </div>

              <div className="detail-section-label">Склад</div>
              <div className="detail-grid two-col">
                <div className="detail-col">
                  {(selected.cutting_qty !== undefined && selected.cutting_qty > 0) && (
                    <Detail icon={<Scissors size={14} />} label="В розкрої" value={`${selected.cutting_qty} шт`} tone="tone-orange" />
                  )}
                  {selected.shelf && (
                    <Detail label="Полиця" value={selected.shelf} />
                  )}
                  {selected.currentAvailable !== undefined && (
                    <Detail
                      icon={<BarChart3 size={14} />}
                      label="Поточний запас"
                      value={selected.currentAvailable.toString()}
                      tone={selected.currentAvailable < 0 ? "tone-red-text" : undefined}
                    />
                  )}
                  {(() => {
                    const avail = stockMap.get(`${selected.sku}|${selected.size}`);
                    return avail !== undefined && avail > 0 ? (
                      <Detail icon={<Layers size={14} />} label="На складі (крій)" value={`${avail} шт`} tone="tone-green" />
                    ) : null;
                  })()}
                </div>
                <div className="detail-col">
                  {selected.targetQty !== undefined && (
                    <Detail icon={<Target size={14} />} label="Цільовий запас" value={selected.targetQty.toString()} />
                  )}
                </div>
              </div>

              {selected.comment && <p className="comment">{selected.comment}</p>}

              <div className="actions">
                {actions.cut && selected.status === "incoming" && (
                  <button className="btn primary" onClick={() => handleCut(selected)}>
                    В розкрій
                  </button>
                )}
                {actions.sew && selected.status === "incoming" && (() => {
                  const avail = stockMap.get(`${selected.sku}|${selected.size}`) ?? 0;
                  return (
                    <button
                      className="btn ghost"
                      disabled={avail === 0}
                      onClick={() => handleSew(selected)}
                      title={avail === 0 ? "Немає залишків крою на складі" : `На складі ${avail} шт`}
                    >
                      В пошив {avail > 0 ? `(${avail} шт)` : ""}
                    </button>
                  );
                })()}
                {actions.shelf && selected.status === "cutting" && (
                  <button className="btn primary" onClick={() => openShelfModal(selected)}>
                    На склад
                  </button>
                )}
                {actions.cutToSew && selected.status === "cutting" && (
                  <button className="btn ghost" onClick={() => handleCutToSew(selected)}>
                    В пошив
                  </button>
                )}
                {actions.backToIncoming && selected.status === "in-progress" && (
                  <button className="btn ghost" onClick={() => handleUpdate(selected, "incoming")}>
                    Повернути в чергу
                  </button>
                )}
                {actions.complete && selected.status !== "done" && (
                  <button className="btn success" onClick={() => handleComplete(selected)}>
                    Виконано
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {cutModal && (
        <div className="modal-overlay" onClick={() => setCutModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">В розкрій — {cutModal.order.sku} ({cutModal.order.size})</div>
            <div className="modal-field">
              <label>Кількість у розкрій (шт)</label>
              <input
                type="number"
                min={1}
                value={cutModal.qty}
                onChange={(e) => setCutModal((m) => m && { ...m, qty: Math.max(1, Number(e.target.value)) })}
              />
              <span className="muted" style={{ fontSize: "12px", marginTop: "4px", display: "block" }}>
                Всього: {cutModal.order.quantity} шт
              </span>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setCutModal(null)}>Скасувати</button>
              <button className="btn primary" disabled={cutModal.qty < 1} onClick={handleCutConfirm}>
                Підтвердити
              </button>
            </div>
          </div>
        </div>
      )}

      {sewModal && (() => {
        const avail = stockMap.get(`${sewModal.order.sku}|${sewModal.order.size}`) ?? 0;
        return (
          <div className="modal-overlay" onClick={() => setSewModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">В пошив — {sewModal.order.sku} ({sewModal.order.size})</div>
              <div className="modal-field">
                <label>Кількість у пошив (шт)</label>
                <input
                  type="number"
                  min={1}
                  max={avail}
                  value={sewModal.qty}
                  onChange={(e) => setSewModal((m) => m && { ...m, qty: Math.min(avail, Math.max(1, Number(e.target.value))) })}
                />
                <span className="muted" style={{ fontSize: "12px", marginTop: "4px", display: "block" }}>
                  На складі: {avail} шт — більше передати неможливо
                </span>
              </div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setSewModal(null)}>Скасувати</button>
                <button className="btn primary" disabled={sewModal.qty < 1 || sewModal.qty > avail} onClick={handleSewConfirm}>
                  Підтвердити
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {shelfModal && (() => {
        const maxQty = shelfModal.order.cutting_qty || shelfModal.order.quantity;
        return (
        <div className="modal-overlay" onClick={() => setShelfModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              На склад — {shelfModal.order.sku} ({shelfModal.order.size})
            </div>

            <div className="modal-field">
              <label>Кількість (шт)</label>
              <input
                type="number"
                min={1}
                max={maxQty}
                value={shelfModal.qty}
                onChange={(e) => setShelfModal((m) => m && { ...m, qty: Math.min(maxQty, Math.max(1, Number(e.target.value))) })}
              />
              <span className="muted" style={{ fontSize: "12px", marginTop: "4px", display: "block" }}>
                У розкрої: {maxQty} шт
              </span>
            </div>

            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShelfModal(null)}>Скасувати</button>
              <button
                className="btn primary"
                disabled={shelfModal.qty < 1 || shelfModal.qty > maxQty}
                onClick={handleShelfConfirm}
              >
                Підтвердити
              </button>
            </div>
          </div>
        </div>
        );
      })()}
      {cutToSewModal && (() => {
        const maxQty = cutToSewModal.order.cutting_qty || cutToSewModal.order.quantity;
        return (
          <div className="modal-overlay" onClick={() => setCutToSewModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">В пошив з розкрою — {cutToSewModal.order.sku} ({cutToSewModal.order.size})</div>
              <div className="modal-field">
                <label>Кількість у пошив (шт)</label>
                <input
                  type="number"
                  min={1}
                  max={maxQty}
                  value={cutToSewModal.qty}
                  onChange={(e) => setCutToSewModal((m) => m && { ...m, qty: Math.min(maxQty, Math.max(1, Number(e.target.value))) })}
                />
                <span className="muted" style={{ fontSize: "12px", marginTop: "4px", display: "block" }}>
                  У розкрої: {maxQty} шт
                </span>
              </div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setCutToSewModal(null)}>Скасувати</button>
                <button className="btn primary" disabled={cutToSewModal.qty < 1 || cutToSewModal.qty > maxQty} onClick={handleCutToSewConfirm}>
                  Підтвердити
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {newOrderOpen && (() => {
        const selectedProduct = PRODUCT_CATALOG.find((p) => p.code === newOrderForm.productCode);
        const availableColors = selectedProduct
          ? COLOR_CATALOG.filter((c) => selectedProduct.colors.includes(c.code))
          : COLOR_CATALOG;
        const availableSizes = selectedProduct?.sizes ?? [];
        const canSubmit = !!selectedProduct && !!newOrderForm.colorCode && !!newOrderForm.size && newOrderForm.qty >= 1;
        return (
          <div className="modal-overlay" onClick={() => setNewOrderOpen(false)}>
            <div className="modal modal--new-order" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Нова задача</div>

              <div className="modal-field">
                <label>Товар *</label>
                <select
                  autoFocus
                  value={newOrderForm.productCode}
                  onChange={(e) => setNewOrderForm((f) => ({ ...f, productCode: e.target.value, colorCode: "", size: "", sku: "" }))}
                >
                  <option value="">— оберіть товар —</option>
                  {PRODUCT_CATALOG.map((p) => (
                    <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
                  ))}
                </select>
              </div>

              <div className="modal-row-2">
                <div className="modal-field">
                  <label>
                    Колір *
                    {newOrderForm.colorCode && (
                      <span className="modal-selected-label">
                        {availableColors.find(c => c.code === newOrderForm.colorCode)?.name}
                      </span>
                    )}
                  </label>
                  <div className={`color-swatches${!selectedProduct ? " color-swatches--disabled" : ""}`}>
                    {availableColors.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        className={`color-swatch${newOrderForm.colorCode === c.code ? " color-swatch--active" : ""}`}
                        style={{ background: c.hex }}
                        title={c.name}
                        disabled={!selectedProduct}
                        onClick={() => setNewOrderForm((f) => ({ ...f, colorCode: c.code, sku: "" }))}
                      />
                    ))}
                  </div>
                </div>
                <div className="modal-field">
                  <label>Розмір *</label>
                  <select
                    value={newOrderForm.size}
                    disabled={!selectedProduct}
                    onChange={(e) => setNewOrderForm((f) => ({ ...f, size: e.target.value, sku: "" }))}
                  >
                    <option value="">— розмір —</option>
                    {availableSizes.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-row-2">
                <div className="modal-field">
                  <label>Кількість (шт) *</label>
                  <input
                    type="number"
                    min={1}
                    value={newOrderForm.qty}
                    onChange={(e) => setNewOrderForm((f) => ({ ...f, qty: Math.max(1, Number(e.target.value)) }))}
                  />
                </div>
                <div className="modal-field">
                  <label>Пріоритет *</label>
                  <select
                    className="select"
                    style={{ color: PRIORITY_STYLE[newOrderForm.priority].color }}
                    value={newOrderForm.priority}
                    onChange={(e) => setNewOrderForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                  >
                    <option value="Низький"   style={{ color: "#0b7b42" }}>Низький</option>
                    <option value="Терміново" style={{ color: "#c08a00" }}>Терміново</option>
                    <option value="Критично"  style={{ color: "#c92b36" }}>Критично</option>
                    <option value="Дефіцит"   style={{ color: "#6934d8" }}>Дефіцит</option>
                  </select>
                </div>
              </div>

              <div className="modal-field">
                <label>Коментар <span className="modal-optional">(необов'язково)</span></label>
                <input
                  type="text"
                  placeholder="Будь-яка нотатка…"
                  value={newOrderForm.comment}
                  onChange={(e) => setNewOrderForm((f) => ({ ...f, comment: e.target.value }))}
                />
              </div>

              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setNewOrderOpen(false)}>Скасувати</button>
                <button className="btn primary" disabled={!canSubmit} onClick={handleNewOrderConfirm}>
                  Створити
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const PRIORITY_STYLE: Record<Priority, React.CSSProperties> = {
  Низький:   { background: "rgba(18,164,84,0.14)",  color: "#0b7b42" },
  Терміново: { background: "rgba(192,138,0,0.14)",  color: "#c08a00" },
  Критично:  { background: "rgba(230,57,70,0.14)",  color: "#c92b36" },
  Дефіцит:   { background: "rgba(139,92,246,0.14)", color: "#6934d8" },
};

const priorityWeight = (p: Priority) =>
  ({ Дефіцит: 4, Критично: 3, Терміново: 2, Низький: 1 }[p] ?? 0);

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "XXXXL", "5XL"];
const sizeWeight = (s: string) => {
  // Для комбінованих розмірів типу "XS/S", "M/L", "XL/2XL" — беремо перший
  const first = s.split("/")[0].toUpperCase().trim();
  const idx = SIZE_ORDER.indexOf(first);
  return idx === -1 ? 99 : idx;
};

const Detail = ({ icon, label, value, tone }: { icon?: ReactNode; label: string; value: string; tone?: string }) => (
  <div className="detail">
    <span className="detail-label">
      {icon && <span className="detail-icon">{icon}</span>}
      {label}
    </span>
    <span className={tone ? `detail-value ${tone}` : "detail-value"}>{value}</span>
  </div>
);
