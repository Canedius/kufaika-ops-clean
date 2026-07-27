import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";
import { OrderCard } from "./OrderCard";
import { fetchOrders, fetchCutStock, updateOrder, editOrder, consumeFromStock, addToStock, createCuttingOrder, createIncomingOrder, archiveOrder, deleteOrder, formatDate, PRODUCT_CATALOG, COLOR_CATALOG, FABRIC_OPTIONS, fabricFromSku } from "../lib/api";
import type { Order, OrderStatus, Priority, CutStockItem, SortLevel } from "../types";
import { priorityTone, statusLabel, statusTone } from "../theme";
import { getPhotoUrl } from "../lib/photos";
import { Info, Shirt, Palette, Ruler, Package, BarChart3, Target, RotateCcw, Scissors, Layers, Copy } from "lucide-react";

type ShelfModal = {
  order: Order;
  qty: number;
};

type CutModal = { order: Order; qty: number };
type SewModal = { order: Order; qty: number };
type CutToSewModal = { order: Order; qty: number };

type PositionForm = {
  productCode: string;
  colorCode: string;
  customColorName: string;
  size: string;
  qty: number;
  sku: string; // manual override; empty = auto-generated
  fabric: string;
  dtId?: number; // присутній → редагуємо існуючий рядок; відсутній → створюємо новий
};

type NewOrderForm = {
  positions: PositionForm[]; // одна задача може містити кілька позицій
  comment: string;
  dueDate: string; // YYYY-MM-DD — на яке число пошити
  individual: boolean; // true → індивідуальне замовлення, false → складське
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const emptyPosition = (): PositionForm => ({
  productCode: "",
  colorCode: "",
  customColorName: "",
  size: "",
  qty: 1,
  sku: "",
  fabric: "",
});

// Назва кольору з бази/ручного вводу може мати емодзі, зайві пробіли чи інший регістр —
// зводимо до канонічного вигляду, щоб знайти код у COLOR_CATALOG.
const normalizeColorName = (s: string) =>
  s.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().toLowerCase().replace(/\s+/g, " ");

const colorCodeByName = (name: string): string => {
  const n = normalizeColorName(name);
  if (!n) return "";
  return COLOR_CATALOG.find((c) => normalizeColorName(c.name) === n)?.code || "";
};

const emptyNewOrderForm = (): NewOrderForm => ({
  positions: [emptyPosition()],
  comment: "",
  dueDate: todayIso(),
  individual: true,
});

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
    cancelCut?: boolean;
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
  const [newOrderForm, setNewOrderForm] = useState<NewOrderForm>(emptyNewOrderForm);
  // Режим редагування: null = створення нової задачі; інакше — редагуємо ці рядки.
  const [editGroup, setEditGroup] = useState<{ groupId?: string; members: Order[] } | null>(null);

  useEffect(() => {
    setBulkSelected(new Set());
    setSelectedId(null);
  }, [filterBy.join(",")]);

  // Map SKU|size → доступний крій. Окремі пули: складський та індивідуальний,
  // щоб індивідуальний крій не списувався під звичайні замовлення (і навпаки).
  const stockMaps = useMemo(() => {
    const reg = new Map<string, number>();
    const ind = new Map<string, number>();
    for (const s of cutStock) {
      const key = `${s.sku}|${s.size}`;
      const m = s.individual ? ind : reg;
      m.set(key, (m.get(key) ?? 0) + s.qty);
    }
    return { reg, ind };
  }, [cutStock]);

  // Доступний крій для конкретного замовлення — з відповідного пулу.
  const availFor = (o: { sku: string; size: string; individual?: boolean }) =>
    (o.individual ? stockMaps.ind : stockMaps.reg).get(`${o.sku}|${o.size}`) ?? 0;

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
        if (field === "priority") cmp = priorityWeight(a) - priorityWeight(b);
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
        .then(() => { console.log("[CUT] update OK, creating cutting order…"); return createCuttingOrder(order, qty, "", "cutting", order.individual); })
        .then(() => { console.log("[CUT] create OK, invalidating in 3s"); setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000); })
        .catch((err) => {
          console.error("[CUT] Partial cut failed:", err);
          optimisticUpdate(order.id, { quantity: order.quantity });
          qc.invalidateQueries({ queryKey: ["orders"] });
        });
    } else {
      createCuttingOrder(order, qty, "", "cutting", order.individual)
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

    addToStock({ sku: order.sku, size: order.size, qty, shelf: "", cutDate: new Date().toISOString().split("T")[0], individual: order.individual });

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
    const avail = availFor(order);
    setSewModal({ order, qty: Math.min(avail, order.quantity) });
  };

  const handleSewConfirm = () => {
    if (!sewModal) return;
    const { order, qty } = sewModal;
    setSewModal(null);

    // Списуємо зі складу крою — лише з відповідного пулу (інд./складський).
    const available = cutStock.filter((s) => s.sku === order.sku && s.size === order.size && !!s.individual === !!order.individual);
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
      createCuttingOrder(order, qty, "", "in-progress", order.individual)
        .then(() => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["cutStock"] });
          qc.invalidateQueries({ queryKey: ["orders"] });
        }, 3000));
    } else {
      createCuttingOrder(order, qty, "", "in-progress", order.individual)
        .then(() => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["cutStock"] });
          qc.invalidateQueries({ queryKey: ["orders"] });
        }, 3000));
    }
  };

  const handleCutToSew = (order: Order) => {
    setCutToSewModal({ order, qty: order.cutting_qty || order.quantity });
  };

  // "Відмінити розкрій" — повертає кількість із розкрою назад у чергу пошиву.
  // Якщо для цього sku+size вже є замовлення в пошиві (incoming) — додаємо кількість
  // до нього і видаляємо рядок розкрою (без дублювання картки). Якщо такого немає
  // (напр., повний розкрій того ж рядка) — просто повертаємо рядок у incoming.
  const handleCancelCut = (order: Order) => {
    if (!order.dtId) return;
    const qty = order.cutting_qty || order.quantity;
    const target = orders.find(
      (o) =>
        o.status === "incoming" &&
        o.dtId != null &&
        o.dtId !== order.dtId &&
        o.sku === order.sku &&
        o.size === order.size &&
        !!o.individual === !!order.individual,
    );

    if (target && target.dtId != null) {
      // Мердж у наявне замовлення в пошиві + видалення рядка розкрою.
      optimisticUpdate(target.id, { quantity: target.quantity + qty });
      pendingArchiveIds.current.add(order.id);
      optimisticUpdate(order.id, { status: "archived" });
      updateOrder(target.dtId, target, { to_sew: target.quantity + qty })
        .then(() => deleteOrder(order.dtId!))
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000))
        .catch(() => {
          pendingArchiveIds.current.delete(order.id);
          qc.invalidateQueries({ queryKey: ["orders"] });
        });
    } else {
      // Немає куди мерджити — повертаємо цей же рядок у пошив.
      optimisticUpdate(order.id, { status: "incoming", cutting_qty: 0 });
      updateOrder(order.dtId, order, { status: "incoming", cutting_qty: 0 })
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    }
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
      createCuttingOrder(order, qty, "", "in-progress", order.individual)
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    } else {
      createCuttingOrder(order, qty, "", "in-progress", order.individual)
        .then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
    }
  };

  // --- Редагування позицій у формі нової задачі ---
  const updatePosition = (i: number, patch: Partial<PositionForm>) =>
    setNewOrderForm((f) => ({
      ...f,
      positions: f.positions.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));
  const addPosition = () =>
    setNewOrderForm((f) => ({ ...f, positions: [...f.positions, emptyPosition()] }));
  const duplicatePosition = (i: number) =>
    setNewOrderForm((f) => {
      const positions = [...f.positions];
      // Копія — завжди НОВА позиція (без dtId), навіть у режимі редагування.
      positions.splice(i + 1, 0, { ...f.positions[i], dtId: undefined });
      return { ...f, positions };
    });
  const removePosition = (i: number) =>
    setNewOrderForm((f) => ({
      ...f,
      positions: f.positions.length > 1 ? f.positions.filter((_, j) => j !== i) : f.positions,
    }));

  const positionValid = (p: PositionForm) => {
    const product = PRODUCT_CATALOG.find((pr) => pr.code === p.productCode);
    const hasColor = !!p.customColorName.trim() || !!p.colorCode;
    return !!product && hasColor && !!p.size && p.qty >= 1;
  };

  // Перетворює позицію форми на дані замовлення (sku/колір/тканина тощо) або null, якщо неповна.
  const buildPosition = (p: PositionForm) => {
    const product = PRODUCT_CATALOG.find((pr) => pr.code === p.productCode);
    const customName = p.customColorName.trim();
    // Якщо введена вручну назва збігається з каталожною — це звичайний колір, а не "свій":
    // беремо його справжній код, інакше SKU вийшов би з маркером XX.
    const matchedCode = customName ? colorCodeByName(customName) : "";
    const effectiveColorCode = customName ? matchedCode || "XX" : p.colorCode;
    if (!product || (!customName && !p.colorCode) || !p.size || p.qty < 1) return null;
    const catalogName = COLOR_CATALOG.find((c) => c.code === effectiveColorCode)?.name;
    const effectiveColorName = catalogName || customName || effectiveColorCode;
    const autoSku = `${p.productCode}${effectiveColorCode}${p.size}`;
    return {
      productType: product.name,
      size: p.size,
      qty: p.qty,
      sku: p.sku.trim() || autoSku,
      color: effectiveColorName,
      fabric: p.fabric || "",
      dtId: p.dtId,
    };
  };

  const handleNewOrderConfirm = () => {
    const f = newOrderForm;
    const built = f.positions.map(buildPosition);
    if (built.length === 0 || built.some((b) => b === null)) return;
    const positions = built as NonNullable<(typeof built)[number]>[];
    // Кожна позиція створюється як ОКРЕМА індивідуальна задача (окрема картка).
    const comment = f.comment.trim() || undefined;
    setNewOrderOpen(false);
    setNewOrderForm(emptyNewOrderForm());
    Promise.all(
      positions.map((pos) =>
        createIncomingOrder({
          productType: pos.productType,
          size: pos.size,
          qty: pos.qty,
          priority: "Низький",
          sku: pos.sku,
          color: pos.color,
          launchDate: f.dueDate,
          comment,
          individual: f.individual,
          fabric: pos.fabric || undefined,
        }),
      ),
    ).then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
  };

  // --- Редагування індивідуальної задачі ---
  const toIsoDate = (s?: string) => {
    if (!s) return "";
    const dm = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) return `${dm[3]}-${dm[2]}-${dm[1]}`;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : "";
  };

  const orderToPosition = (o: Order): PositionForm => {
    const product = PRODUCT_CATALOG.find((p) => p.name === o.productType);
    const matchedCode = colorCodeByName(o.color || "");
    return {
      productCode: product?.code || "",
      colorCode: matchedCode,
      customColorName: matchedCode ? "" : (o.color || ""),
      size: o.size,
      qty: o.quantity,
      sku: "", // перерахуємо при збереженні
      fabric: o.fabric || "",
      dtId: o.dtId,
    };
  };

  const openEditGroup = (members: Order[]) => {
    if (members.length === 0) return;
    const positions = members.map(orderToPosition);
    const earliestIso = members.map((m) => toIsoDate(m.launchDate)).filter(Boolean).sort()[0];
    const comment = members.find((m) => m.comment)?.comment || "";
    setEditGroup({ groupId: members[0].groupId, members });
    setNewOrderForm({
      positions: positions.length ? positions : [emptyPosition()],
      comment,
      dueDate: earliestIso || todayIso(),
      individual: !!members[0].individual,
    });
    setNewOrderOpen(true);
  };

  const closeModal = () => {
    setNewOrderOpen(false);
    setEditGroup(null);
    setNewOrderForm(emptyNewOrderForm());
  };

  const handleEditConfirm = () => {
    if (!editGroup) return;
    const f = newOrderForm;
    const built = f.positions.map(buildPosition);
    if (built.length === 0 || built.some((b) => b === null)) return;
    const positions = built as NonNullable<(typeof built)[number]>[];
    const members = editGroup.members;
    const comment = f.comment.trim();
    const keptDtIds = new Set(positions.map((p) => p.dtId).filter((x): x is number => x != null));
    const removed = members.filter((m) => m.dtId != null && !keptDtIds.has(m.dtId));

    closeModal();

    const ops: Promise<void>[] = [];
    for (const d of positions) {
      if (d.dtId != null) {
        const origin = members.find((m) => m.dtId === d.dtId);
        if (!origin) continue;
        optimisticUpdate(origin.id, {
          sku: d.sku, size: d.size, color: d.color, fabric: d.fabric,
          productType: d.productType, quantity: d.qty, comment, launchDate: f.dueDate,
        });
        ops.push(editOrder(origin, {
          sku: d.sku, size: d.size, color: d.color, fabric: d.fabric,
          productType: d.productType, priority: origin.priority,
          launchDate: f.dueDate, qty: d.qty, comment,
        }));
      } else {
        // Кожна нова позиція — окрема задача (без обʼєднання в групу).
        ops.push(createIncomingOrder({
          productType: d.productType, size: d.size, qty: d.qty, priority: "Низький",
          sku: d.sku, color: d.color, launchDate: f.dueDate, comment: comment || undefined,
          individual: f.individual, fabric: d.fabric || undefined,
        }));
      }
    }
    for (const m of removed) {
      pendingArchiveIds.current.add(m.id);
      optimisticUpdate(m.id, { status: "archived" });
      ops.push(archiveOrder(m));
    }
    Promise.all(ops).then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000));
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
            <button
              className="btn add-sew-btn"
              onClick={() => { setEditGroup(null); setNewOrderForm(emptyNewOrderForm()); setNewOrderOpen(true); }}
            >
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

          {filtered.map((order) => {
            return (
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
                hasStock={availFor(order) > 0}
                onShelf={actions.shelf ? openShelfModal : undefined}
                onCutToSew={actions.cutToSew ? handleCutToSew : undefined}
                onCancelCut={actions.cancelCut ? handleCancelCut : undefined}
                onBack={actions.backToIncoming ? (o) => handleUpdate(o, "incoming") : undefined}
                onDone={actions.complete ? handleComplete : undefined}
                onEdit={order.individual && order.status === "incoming" ? (o) => openEditGroup([o]) : undefined}
              />
            );
          })}
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
                    const avail = availFor(selected);
                    return avail > 0 ? (
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
                  const avail = availFor(selected);
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
                {actions.cancelCut && selected.status === "cutting" && (
                  <button className="btn danger" onClick={() => handleCancelCut(selected)}>
                    Відмінити розкрій
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
        const avail = availFor(sewModal.order);
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
        const multi = newOrderForm.positions.length > 1;
        const isEdit = !!editGroup;
        const canSubmit = newOrderForm.positions.length > 0 && newOrderForm.positions.every(positionValid);
        return (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="modal modal--new-order" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">
                {isEdit ? "Редагувати задачу" : "Нова задача"}{multi ? ` · ${newOrderForm.positions.length} позицій` : ""}
              </div>

              <div className="modal-field">
                <label>Тип замовлення *</label>
                <div className="order-type-toggle">
                  <button
                    type="button"
                    className={`order-type-btn${newOrderForm.individual ? " is-active" : ""}`}
                    onClick={() => setNewOrderForm((f) => ({ ...f, individual: true }))}
                  >
                    🧵 Індивідуальне
                  </button>
                  <button
                    type="button"
                    className={`order-type-btn${!newOrderForm.individual ? " is-active" : ""}`}
                    onClick={() => setNewOrderForm((f) => ({ ...f, individual: false }))}
                  >
                    📦 Складське
                  </button>
                </div>
              </div>

              {newOrderForm.positions.map((pos, i) => {
                const selectedProduct = PRODUCT_CATALOG.find((p) => p.code === pos.productCode);
                const availableColors = selectedProduct
                  ? COLOR_CATALOG.filter((c) => selectedProduct.colors.includes(c.code))
                  : COLOR_CATALOG;
                const availableSizes = selectedProduct?.sizes ?? [];
                const customName = pos.customColorName.trim();
                return (
                  <div className="modal-position" key={i}>
                    <div className="modal-position-head">
                      <span className="modal-position-num">{multi ? `Позиція ${i + 1}` : "Позиція"}</span>
                      <div className="modal-position-actions">
                        <button
                          type="button"
                          className="btn mini ghost"
                          onClick={() => duplicatePosition(i)}
                          title="Додати таку саму позицію"
                        >
                          <Copy size={13} /> Копіювати
                        </button>
                        {multi && (
                          <button
                            type="button"
                            className="btn mini ghost"
                            onClick={() => removePosition(i)}
                          >
                            Видалити
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="modal-field">
                      <label>Товар *</label>
                      <select
                        autoFocus={i === 0}
                        value={pos.productCode}
                        onChange={(e) => updatePosition(i, {
                          productCode: e.target.value,
                          colorCode: "",
                          customColorName: "",
                          size: "",
                          sku: "",
                          fabric: fabricFromSku(`${e.target.value}XX`) || "",
                        })}
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
                          {!customName && pos.colorCode && (
                            <span className="modal-selected-label">
                              {availableColors.find(c => c.code === pos.colorCode)?.name}
                            </span>
                          )}
                          {customName && (
                            <span className="modal-selected-label">
                              {customName} (свій)
                            </span>
                          )}
                        </label>
                        <div className={`color-swatches${!selectedProduct ? " color-swatches--disabled" : ""}`}>
                          {availableColors.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              className={`color-swatch${!customName && pos.colorCode === c.code ? " color-swatch--active" : ""}`}
                              style={{ background: c.hex }}
                              title={c.name}
                              disabled={!selectedProduct}
                              onClick={() => updatePosition(i, { colorCode: c.code, customColorName: "", sku: "" })}
                            />
                          ))}
                        </div>
                        <input
                          className="custom-color-input"
                          type="text"
                          placeholder="Або введіть свій колір…"
                          value={pos.customColorName}
                          disabled={!selectedProduct}
                          onChange={(e) => updatePosition(i, { customColorName: e.target.value, sku: "" })}
                        />
                      </div>
                      <div className="modal-field">
                        <label>Розмір *</label>
                        <select
                          value={pos.size}
                          disabled={!selectedProduct}
                          onChange={(e) => updatePosition(i, { size: e.target.value, sku: "" })}
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
                          value={pos.qty}
                          onChange={(e) => updatePosition(i, { qty: Math.max(1, Number(e.target.value)) })}
                        />
                      </div>
                      <div className="modal-field">
                        <label>Тканина</label>
                        <select
                          value={pos.fabric}
                          disabled={!selectedProduct}
                          onChange={(e) => updatePosition(i, { fabric: e.target.value })}
                        >
                          <option value="">— оберіть тканину —</option>
                          {FABRIC_OPTIONS.map((fab) => (
                            <option key={fab} value={fab}>{fab}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {(() => {
                      const built = buildPosition(pos);
                      if (!built) return null;
                      const isCustomColor = /^KUF\d{3}XX/.test(built.sku);
                      return (
                        <div className="modal-sku-preview">
                          SKU: <strong>{built.sku}</strong>
                          {isCustomColor && (
                            <span className="modal-sku-warn">
                              нестандартний колір «{customName}» → код XX
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              <button type="button" className="btn ghost modal-add-position" onClick={addPosition}>
                + Додати позицію
              </button>

              <div className="modal-field">
                <label>На яке число пошити *</label>
                <input
                  type="date"
                  value={newOrderForm.dueDate}
                  onChange={(e) => setNewOrderForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
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
                <button className="btn ghost" onClick={closeModal}>Скасувати</button>
                <button
                  className="btn primary"
                  disabled={!canSubmit}
                  onClick={isEdit ? handleEditConfirm : handleNewOrderConfirm}
                >
                  {isEdit ? "Зберегти" : multi ? `Створити (${newOrderForm.positions.length})` : "Створити"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const priorityWeight = (o: Order) => {
  if (o.individual) {
    const ts = new Date(o.launchDate).getTime();
    if (Number.isFinite(ts)) {
      // Closer due date → higher weight (sorted higher in desc mode)
      return 1e15 - ts;
    }
    return 1e15;
  }
  return ({ Дефіцит: 4, Критично: 3, Терміново: 2, Низький: 1 }[o.priority] ?? 0);
};

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
