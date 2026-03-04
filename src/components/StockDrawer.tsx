import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RotateCcw, Pencil, Check, X as XIcon } from "lucide-react";
import { fetchCutStock, updateCutStockQty } from "../lib/api";
import type { CutStockItem } from "../types";

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string>("");

  const updateMutation = useMutation({
    mutationFn: ({ stockId, qty }: { stockId: string; qty: number }) =>
      updateCutStockQty(stockId, qty),
    onSuccess: () => {
      setEditingId(null);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["cutStock"] }), 2000);
    },
  });

  const sorted = [...stock].sort(
    (a, b) => a.sku.localeCompare(b.sku) || a.size.localeCompare(b.size),
  );

  function startEdit(item: CutStockItem) {
    setEditingId(item.stockId);
    setEditQty(String(item.qty));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditQty("");
  }

  function saveEdit(item: CutStockItem) {
    const qty = parseInt(editQty, 10);
    if (isNaN(qty) || qty < 0) return;
    updateMutation.mutate({ stockId: item.stockId, qty });
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
        <div className="stock-drawer-body">
          {isLoading && <p className="muted">Завантажую...</p>}
          {!isLoading && sorted.length === 0 && (
            <p className="muted">Залишків крою немає.</p>
          )}
          {sorted.length > 0 && (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Розмір</th>
                  <th>Полиця</th>
                  <th>Кількість</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => {
                  const isEditing = editingId === item.stockId;
                  const isSaving =
                    updateMutation.isPending &&
                    editingId === item.stockId;
                  return (
                    <tr key={item.stockId} className={isEditing ? "stock-row--editing" : ""}>
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
                          <button
                            className="stock-action-btn"
                            onClick={() => startEdit(item)}
                            title="Редагувати"
                          >
                            <Pencil size={14} />
                          </button>
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
    </>
  );
};
