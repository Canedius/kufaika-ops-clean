import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RotateCcw, Pencil, Check, X as XIcon, Shirt, Loader2 } from "lucide-react";
import { fetchCutStock, updateCutStockQty, consumeFromStock, createCuttingOrder, fabricFromSku, productTypeFromSku, colorNameFromSku } from "../lib/api";
import type { CutStockItem, Priority } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
};

export const StockDrawer = ({ open, onClose }: Props) => {
  const queryClient = useQueryClient();
  const { data: stock = [], isLoading, refetch, isFetching } = useQuery<CutStockItem[]>({
    queryKey: ["cutStock"],
    queryFn: fetchCutStock,
    staleTime: 60 * 1000,
    enabled: open,
  });

  const [editingDtId, setEditingDtId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState<string>("");
  const [sewModal, setSewModal] = useState<{ item: CutStockItem; qty: number; priority: Priority } | null>(null);
  const [sewPending, setSewPending] = useState(false);

  const updateMutation = useMutation({
    mutationFn: ({ dtId, qty }: { dtId: number; qty: number }) =>
      updateCutStockQty(dtId, qty),
    onSuccess: () => {
      setEditingDtId(null);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["cutStock"] }), 2000);
    },
  });

  const sorted = [...stock].sort(
    (a, b) => a.sku.localeCompare(b.sku) || a.size.localeCompare(b.size),
  );

  function startEdit(item: CutStockItem) {
    setEditingDtId(item.dtId ?? null);
    setEditQty(String(item.qty));
  }

  function cancelEdit() {
    setEditingDtId(null);
    setEditQty("");
  }

  function handleSewFromStock() {
    if (!sewModal) return;
    const { item, qty, priority } = sewModal;
    setSewModal(null);

    const orderData = {
      sku: item.sku,
      size: item.size,
      launchDate: "",
      priority,
      fabric: fabricFromSku(item.sku),
      comment: `Зі складу крою${item.shelf ? ` (${item.shelf})` : ""}`,
      targetQty: undefined,
      boxes: 0,
      quantity: qty,
      currentAvailable: undefined,
      productType: productTypeFromSku(item.sku),
      color: colorNameFromSku(item.sku),
    };

    // Оптимістичне оновлення — одразу змінюємо кеш
    queryClient.setQueryData<CutStockItem[]>(["cutStock"], (prev) => {
      if (!prev) return prev;
      const matchKey = item.dtId ? "dtId" : "stockId";
      const matchVal = item.dtId ?? item.stockId;
      return prev
        .map((s) => s[matchKey] === matchVal ? { ...s, qty: s.qty - qty } : s)
        .filter((s) => s.qty > 0);
    });

    setSewPending(true);

    Promise.all([
      createCuttingOrder(orderData, qty, "", "in-progress", item.individual),
      consumeFromStock(item.stockId, qty, item.dtId, item.qty),
    ]).then(() => {
      setTimeout(async () => {
        await queryClient.invalidateQueries({ queryKey: ["cutStock"] });
        await queryClient.invalidateQueries({ queryKey: ["orders"] });
        setSewPending(false);
      }, 3000);
    }).catch(() => {
      setSewPending(false);
    });
  }

  function saveEdit(item: CutStockItem) {
    const qty = parseInt(editQty, 10);
    if (isNaN(qty) || qty < 0 || item.dtId == null) return;
    updateMutation.mutate({ dtId: item.dtId, qty });
  }

  if (!open) return null;

  return (
    <>
      <div className="stock-drawer-backdrop" onClick={onClose} />
      <div className="stock-drawer">
        <div className="stock-drawer-header">
          <span>Залишки крою</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="stock-drawer-close"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Оновити"
            >
              <RotateCcw size={16} />
            </button>
            <button className="stock-drawer-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="stock-drawer-body" style={{ position: "relative" }}>
          {sewPending && (
            <div className="stock-spinner-overlay">
              <Loader2 size={28} className="stock-spinner" />
              <span>Оновлюю дані...</span>
            </div>
          )}
          {isLoading && <p className="muted">Завантажую...</p>}
          {!isLoading && sorted.length === 0 && (
            <p className="muted">Залишків крою немає.</p>
          )}
          {sorted.length > 0 && (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Виріб</th>
                  <th>Колір</th>
                  <th>SKU</th>
                  <th>Розмір</th>
                  <th>Полиця</th>
                  <th>Кількість</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => {
                  const isEditing = editingDtId !== null && editingDtId === item.dtId;
                  const isSaving = updateMutation.isPending && isEditing;
                  return (
                    <tr key={item.dtId ?? `${item.sku}-${item.size}-${item.shelf}`} className={`${isEditing ? "stock-row--editing" : ""} ${item.individual ? "stock-row--individual" : ""}`}>
                      <td className="stock-product">
                        {item.individual && <span className="stock-ind-badge" title="Індивідуальний крій — окремо від складського">🧵 інд.</span>}
                        {productTypeFromSku(item.sku) || "—"}
                      </td>
                      <td className="stock-color">{colorNameFromSku(item.sku) || "—"}</td>
                      <td className="stock-sku">{item.sku}</td>
                      <td>{item.size}</td>
                      <td className="muted">{item.shelf || "—"}</td>
                      <td className="stock-qty">
                        {isEditing ? (
                          <input
                            className="stock-edit-input"
                            type="number"
                            min={0}
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(item);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                        ) : (
                          <>{item.qty} шт</>
                        )}
                      </td>
                      <td className="stock-actions">
                        {isEditing ? (
                          <>
                            <button
                              className="stock-action-btn stock-action-btn--save"
                              onClick={() => saveEdit(item)}
                              disabled={isSaving}
                              title="Зберегти"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="stock-action-btn stock-action-btn--cancel"
                              onClick={cancelEdit}
                              disabled={isSaving}
                              title="Скасувати"
                            >
                              <XIcon size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="stock-action-btn"
                              onClick={() => startEdit(item)}
                              title="Редагувати"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="stock-action-btn stock-action-btn--sew"
                              onClick={() => setSewModal({ item, qty: item.qty, priority: "Низький" })}
                              title="В пошив"
                            >
                              <Shirt size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {sewModal && (
        <div className="modal-overlay" style={{ zIndex: 300 }} onClick={() => setSewModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">В пошив — {sewModal.item.sku} ({sewModal.item.size})</div>
            <div className="modal-field">
              <label>Кількість (шт)</label>
              <input
                type="number"
                min={1}
                max={sewModal.item.qty}
                value={sewModal.qty}
                autoFocus
                onChange={(e) => setSewModal((m) => m && { ...m, qty: Math.min(m.item.qty, Math.max(1, Number(e.target.value))) })}
              />
              <span className="muted" style={{ fontSize: "12px", marginTop: "4px", display: "block" }}>
                На складі: {sewModal.item.qty} шт
              </span>
            </div>
            <div className="modal-field">
              <label>Пріоритет</label>
              <select
                value={sewModal.priority}
                onChange={(e) => setSewModal((m) => m && { ...m, priority: e.target.value as Priority })}
              >
                <option value="Низький">Низький</option>
                <option value="Терміново">Терміново</option>
                <option value="Критично">Критично</option>
                <option value="Дефіцит">Дефіцит</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setSewModal(null)}>Скасувати</button>
              <button
                className="btn primary"
                disabled={sewModal.qty < 1 || sewModal.qty > sewModal.item.qty}
                onClick={handleSewFromStock}
              >
                В пошив
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
