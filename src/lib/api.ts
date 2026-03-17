import ky from "ky";
import type { Order, OrderStatus, Priority, CutStockItem } from "../types";
import { mockOrders } from "../mocks/orders";

const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const ARCHIVE_RANGE = import.meta.env.VITE_ARCHIVE_RANGE || "Archive!A:N";
const WEBHOOK_STATUS = import.meta.env.VITE_N8N_STATUS_WEBHOOK;
const WEBHOOK_STATUS_UPDATE = import.meta.env.VITE_N8N_STATUS_UPDATE_WEBHOOK;
const WEBHOOK_CUTSTOCK = import.meta.env.VITE_N8N_CUTSTOCK_WEBHOOK;
const WEBHOOK_CUTSTOCK_CONSUME = import.meta.env.VITE_N8N_CUTSTOCK_CONSUME_WEBHOOK;
const WEBHOOK_ARCHIVE = import.meta.env.VITE_N8N_ARCHIVE_WEBHOOK;
const WEBHOOK_ORDERS_READ = import.meta.env.VITE_N8N_ORDERS_READ;
const WEBHOOK_CUTSTOCK_READ = import.meta.env.VITE_N8N_CUTSTOCK_READ;
const WEBHOOK_ARCHIVE_READ = import.meta.env.VITE_N8N_ARCHIVE_READ;

const sheetsClient = ky.create({
  prefixUrl: "https://sheets.googleapis.com/v4/spreadsheets",
  retry: { limit: 2, methods: ["get"] },
  timeout: 8000,
});

// Used only by fetchArchive (still reads from Sheets)
const STATUS_MAP: Record<string, OrderStatus> = {
  "ЗАПУЩЕНО": "incoming",
  "В РОБОТІ": "in-progress",
  "В РОБОТИ": "in-progress",
  "В РОБОТI": "in-progress",
  "В РОЗКРОЇ": "cutting",
  "РОЗКРІЙ": "cutting",
  "ГОТОВО": "done",
  INCOMING: "incoming",
  CUTTING: "cutting",
  "IN-PROGRESS": "in-progress",
  "IN PROGRESS": "in-progress",
  DONE: "done",
  ARCHIVED: "archived",
  "АРХІВ": "archived",
};

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function parseNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function colorNameFromSku(sku: string): string {
  const code = (sku.match(/^KUF\d{3}([A-Z]{2})/)?.[1] || "").toUpperCase();
  const map: Record<string, string> = {
    BK: "Чорний",
    PK: "Ніжно-рожевий",
    GF: "Сірий грі",
    KH: "Хакі",
    NU: "Бежевий",
    WH: "Білий",
    GB: "Графітовий",
    KT: "Койот",
    OG: "Олива",
    KZ: "Кремовий",
  };
  return map[code] || code || "";
}

export function productTypeFromSku(sku: string): string {
  const prefix = sku.slice(0, 6).toUpperCase();
  const map: Record<string, string> = {
    KUF001: "Худі утеплений",
    KUF004: "Світшот утеплений",
    KUF005: "Світшот легкий",
    KUF006: "Футболка Premium",
    KUF007: "Футболка Oversize",
    KUF008: "Футболка Relaxed",
    KUF009: "Футболка",
  };
  return map[prefix] || "";
}

export function fabricFromSku(sku: string): string {
  const prefix = sku.slice(0, 6).toUpperCase();
  const heavyLoop = ["KUF001", "KUF004"];
  const lightLoop = ["KUF006", "KUF007", "KUF008", "KUF009"];
  const doubleLoop = ["KUF002", "KUF005"];
  if (heavyLoop.includes(prefix)) return "трьохнитка 320 г/м²";
  if (lightLoop.includes(prefix)) return "стрейч кулір 200 г/м²";
  if (doubleLoop.includes(prefix)) return "двонитка 240 г/м²";
  return "";
}

async function fetchRange(range: string, forcedStatus?: OrderStatus): Promise<Order[]> {
  const url = `${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await sheetsClient.get(url).json<{ values: string[][] }>();
  const rows = res.values || [];
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const orders: Order[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const cells = r.map((v) => (v || "").trim());
    if (cells.every((c) => !c)) continue;
    const get = (name: string) => {
      const j = idx(name);
      return j >= 0 ? cells[j] || "" : "";
    };

    const sku = get("sku");
    if (!sku) continue;

    const rawStatus = forcedStatus ? forcedStatus : get("status").trim();
    const upperStatus = rawStatus.toUpperCase();
    const status: OrderStatus =
      forcedStatus ||
      STATUS_MAP[upperStatus] ||
      (upperStatus.includes("РОЗКРІЙ") || upperStatus.includes("РОЗКРО") ? "cutting"
        : upperStatus.includes("РОБОТ") ? "in-progress"
        : upperStatus.includes("ГОТОВ") ? "done"
        : "incoming");

    const baseId = get("launch_id") || get("launch_date") || `row-${range}`;
    const id = `${baseId}-${sku}-${i}`;

    const priority = (get("priority") || "Низький") as Priority;

    orders.push({
      id,
      sku,
      productType: productTypeFromSku(sku),
      color: colorNameFromSku(sku),
      size: get("size") || sku.slice(8),
      quantity: parseNumber(get("to_sew")) || 0,
      boxes: parseNumber(get("boxes_to_sew")) || 0,
      priority,
      status,
      launchDate: get("launch_date") || "",
      comment: get("comment") || "",
      currentAvailable: parseNumber(get("current_available")),
      targetQty: parseNumber(get("target_qty")),
      fabric: get("fabric") || fabricFromSku(sku),
      cutting_qty: parseNumber(get("cutting_qty")),
      shelf: get("shelf") || undefined,
    });
  }

  return orders;
}

export async function fetchOrders(): Promise<Order[]> {
  if (!WEBHOOK_ORDERS_READ) {
    return mockOrders;
  }

  try {
    const orders = await ky.get(WEBHOOK_ORDERS_READ, { timeout: 10000 }).json<Order[]>();
    console.info("[n8n cache] fetched orders", orders.length);
    return orders
      .filter((o) => o.status !== "archived")
      .map((o) => ({
        ...o,
        size: o.size || o.sku.match(/^KUF\d{3}[A-Z]{2}(.*)/i)?.[1] || "",
        color: o.color || colorNameFromSku(o.sku),
        productType: o.productType || productTypeFromSku(o.sku),
      }));
  } catch (err) {
    console.error("Failed to fetch orders from n8n cache", err);
    return mockOrders;
  }
}

export async function fetchArchive(): Promise<Order[]> {
  if (WEBHOOK_ARCHIVE_READ) {
    try {
      const orders = await ky.get(WEBHOOK_ARCHIVE_READ, { timeout: 10000 }).json<Order[]>();
      console.info("[n8n DT] fetched archive", orders.length);
      return orders;
    } catch (err) {
      console.error("Failed to fetch archive from n8n DT", err);
    }
  }
  if (!SHEET_ID || !API_KEY) return [];
  try {
    return await fetchRange(ARCHIVE_RANGE);
  } catch (err) {
    console.error("Failed to fetch Archive sheet.", err);
    return [];
  }
}

export async function fetchCutStock(): Promise<CutStockItem[]> {
  if (!WEBHOOK_CUTSTOCK_READ) return [];
  try {
    const items = await ky.get(WEBHOOK_CUTSTOCK_READ, { timeout: 10000 }).json<CutStockItem[]>();
    console.info("[n8n cache] fetched cutstock", items.length);
    return items;
  } catch (err) {
    console.error("Failed to fetch CutStock from n8n cache", err);
    return [];
  }
}

export async function updateCutStockQty(stockId: string, qty: number): Promise<void> {
  if (!WEBHOOK_CUTSTOCK) {
    console.info(`[mock] updateCutStockQty stockId=${stockId} qty=${qty}`);
    return;
  }
  await ky.post(WEBHOOK_CUTSTOCK, { json: { action: "update", stockId, qty }, timeout: 10000 });
}

export async function consumeFromStock(stockId: string, qty: number, dtId?: number, currentQty?: number): Promise<void> {
  const url = WEBHOOK_CUTSTOCK_CONSUME || WEBHOOK_CUTSTOCK;
  if (!url) {
    console.info(`[mock] consumeFromStock stockId=${stockId} dtId=${dtId} qty=${qty}`);
    return;
  }
  await ky.post(url, { json: { action: "consume", stockId, dtId, qty, currentQty }, timeout: 10000 });
}

export async function addToStock(item: Omit<CutStockItem, "stockId" | "status">): Promise<void> {
  if (!WEBHOOK_CUTSTOCK) {
    console.info(`[mock] addToStock`, item);
    return;
  }
  await ky.post(WEBHOOK_CUTSTOCK, { json: { action: "add", ...item }, timeout: 10000 });
}

export async function createCuttingOrder(
  order: Pick<Order, "sku" | "size" | "launchDate" | "priority" | "fabric" | "comment" | "targetQty" | "boxes" | "quantity" | "currentAvailable" | "productType" | "color">,
  qty: number,
  shelf: string,
  status: OrderStatus = "cutting",
): Promise<void> {
  if (!WEBHOOK_STATUS) {
    console.info(`[mock] createCuttingOrder sku=${order.sku} qty=${qty} shelf=${shelf} status=${status}`);
    return;
  }
  const boxes_to_sew = order.quantity > 0 ? Math.round((qty / order.quantity) * order.boxes) : 0;
  await ky.post(WEBHOOK_STATUS, {
    json: {
      action: "create",
      order: {
        sku: order.sku,
        size: order.size,
        launchDate: formatDate(new Date().toISOString()),
        priority: order.priority,
        fabric: order.fabric,
        comment: order.comment,
        targetQty: order.targetQty,
        boxes_to_sew,
        current_available: order.currentAvailable ?? "",
        product_type: order.productType || productTypeFromSku(order.sku),
        color: order.color || colorNameFromSku(order.sku),
      },
      status,
      cutting_qty: qty,
      to_sew: qty,
      shelf,
    },
    timeout: 10000,
  });
}

export async function createIncomingOrder(fields: {
  productType: string;
  size: string;
  qty: number;
  priority: Priority;
  sku?: string;
  boxes?: number;
  comment?: string;
  targetQty?: number;
}): Promise<void> {
  if (!WEBHOOK_STATUS) {
    console.info(`[mock] createIncomingOrder`, fields);
    return;
  }
  const sku = fields.sku || "";
  await ky.post(WEBHOOK_STATUS, {
    json: {
      action: "create",
      order: {
        sku,
        size: fields.size,
        launchDate: formatDate(new Date().toISOString()),
        priority: fields.priority,
        fabric: fabricFromSku(sku),
        comment: fields.comment || "",
        targetQty: fields.targetQty,
        boxes_to_sew: fields.boxes || 0,
        product_type: fields.productType,
      },
      status: "incoming",
      cutting_qty: 0,
      to_sew: fields.qty,
      shelf: "",
    },
    timeout: 10000,
  });
}

export async function archiveOrder(order: Order): Promise<void> {
  if (!WEBHOOK_ARCHIVE) {
    console.info(`[mock] archiveOrder sku=${order.sku} status=${order.status}`);
    return;
  }
  await ky.post(WEBHOOK_ARCHIVE, {
    json: {
      action: "archive",
      dtId: order.dtId,
      order: {
        sku: order.sku,
        status: order.status,
        launch_date: order.launchDate,
        priority: order.priority,
        size: order.size,
        to_sew: order.quantity,
        boxes_to_sew: order.boxes,
        comment: order.comment || "",
        cutting_qty: order.cutting_qty || 0,
        fabric: order.fabric || "",
        current_available: order.currentAvailable ?? "",
        target_qty: order.targetQty ?? "",
      },
    },
    timeout: 10000,
  });
}

export async function updateOrder(
  dtId: number,
  currentOrder: Pick<Order, "status" | "quantity" | "cutting_qty" | "boxes" | "shelf">,
  fields: Partial<{ status: OrderStatus; to_sew: number; cutting_qty: number; boxes_to_sew: number; shelf: string }>,
): Promise<void> {
  const updateUrl = WEBHOOK_STATUS_UPDATE || WEBHOOK_STATUS;
  if (!updateUrl) {
    console.info(`[mock] updateOrder dtId=${dtId}`, fields);
    return;
  }
  // Завжди шлемо всі 5 полів — інакше DT Update обнулить відсутні
  await ky.post(updateUrl, {
    json: {
      action: "update",
      dtId,
      status: fields.status ?? currentOrder.status,
      to_sew: fields.to_sew ?? currentOrder.quantity,
      cutting_qty: fields.cutting_qty ?? (currentOrder.cutting_qty || 0),
      boxes_to_sew: fields.boxes_to_sew ?? currentOrder.boxes,
      shelf: fields.shelf ?? (currentOrder.shelf || ""),
    },
    timeout: 10000,
  });
}
