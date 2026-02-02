import ky from "ky";
import type { Order, OrderStatus, Priority } from "../types";
import { mockOrders } from "../mocks/orders";

const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const SHEET_RANGE = import.meta.env.VITE_SHEET_RANGE || "Лист1!A:N";
const STATUS_WEBHOOK = "https://pngstudio.app.n8n.cloud/webhook/e5f152ad-a8a5-4bc8-bc6a-c28e5d614d2a";
const DONE_WEBHOOK   = "https://pngstudio.app.n8n.cloud/webhook/3af025d2-b275-4f07-ab85-0ed8c41e15b7";

const STATUS_TO_LABEL: Record<OrderStatus, string> = {
  incoming: "Запущено",
  "in-progress": "В роботі",
  done: "Готово",
};

export async function updateOrderStatus({
  order,
  status,
}: {
  order: Order;
  status: OrderStatus;
}) {
  const payload = {
    id: order.id,
    sku: order.sku,
    status,
    statusLabel: STATUS_TO_LABEL[status] || status,
    order,
  };

  if (!(status === "done" ? DONE_WEBHOOK : STATUS_WEBHOOK)) {
    console.warn("STATUS_WEBHOOK not set; skipping remote update");
    return payload;
  }

  try {
    await ky.post(status === "done" ? DONE_WEBHOOK : STATUS_WEBHOOK, { json: payload, timeout: 8000 });
  } catch (err) {
    console.error("Failed to update status via webhook", err);
  }

  return payload;
}

const sheetsClient = ky.create({
  prefixUrl: "https://sheets.googleapis.com/v4/spreadsheets",
  retry: { limit: 2, methods: ["get"] },
  timeout: 8000,
});

const STATUS_MAP: Record<string, OrderStatus> = {
  "ЗАПУЩЕНО": "incoming",
  "В РОБОТІ": "in-progress",
  "В РОБОТИ": "in-progress",
  "В РОБОТI": "in-progress",
  "ГОТОВО": "done",
  INCOMING: "incoming",
  "IN-PROGRESS": "in-progress",
  "IN PROGRESS": "in-progress",
  DONE: "done",
};

function parseNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function colorNameFromSku(sku: string): string {
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

function productTypeFromSku(sku: string): string {
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

function fabricFromSku(sku: string): string {
  const prefix = sku.slice(0, 6).toUpperCase();
  const heavyLoop = ["KUF001", "KUF004"]; // худі/утеплені
  const lightLoop = ["KUF006", "KUF007", "KUF008", "KUF009"]; // футболки
  const doubleLoop = ["KUF002", "KUF005"]; // двонитка 240 г
  if (heavyLoop.includes(prefix)) return "трьохнитка 320 г/м²";
  if (lightLoop.includes(prefix)) return "стрейч кулір 200 г/м²";
  if (doubleLoop.includes(prefix)) return "двонитка 240 г/м²";
  return "";
}

function sizeFromSku(sku: string): string {
  const norm = sku.toUpperCase().trim().replace(/[^A-Z0-9/]/g, "");
  if (norm.length <= 8) return "";
  // SKU формат: KUF### + XX (колір) + решта = розмір
  return norm.slice(8);
}

export async function fetchOrders(): Promise<Order[]> {
  if (!SHEET_ID || !API_KEY) {
    return mockOrders;
  }

  try {
    const url = `${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${API_KEY}`;
    const res = await sheetsClient.get(url).json<{ values: string[][] }>();
    const rows = res.values || [];
    if (rows.length < 2) return [];

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);

    const orders: Order[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const get = (name: string) => {
        const j = idx(name);
        return j >= 0 ? (r[j] || "").trim() : "";
      };

      const rawStatus = get("status").trim();
      const upperStatus = rawStatus.toUpperCase();
      const status =
        STATUS_MAP[upperStatus] ||
        (upperStatus.includes("РОБОТ") ? "in-progress" : upperStatus.includes("ГОТОВ") ? "done" : "incoming");

      const sku = get("sku");
      const baseId = get("launch_id") || get("launch_date") || `row-${i}`;
      const id = `${baseId}-${sku}`;

      const priority = (get("priority") || "Низький") as Priority;

      orders.push({
        id,
        sku,
      productType: productTypeFromSku(sku),
      color: colorNameFromSku(sku),
      size: sizeFromSku(sku),
      quantity: parseNumber(get("to_sew")) || 0,
      boxes: parseNumber(get("boxes_to_sew")) || 0,
      priority,
      status,
      launchDate: get("launch_date") || "",
      comment: get("comment") || "",
      currentAvailable: parseNumber(get("current_available")),
      targetQty: parseNumber(get("target_qty")),
      fabric: get("fabric") || fabricFromSku(sku),
    });
  }

    return orders;
  } catch (err) {
    console.error("Failed to fetch Google Sheets. Check sheet name/range and API key.", err);
    return mockOrders;
  }
}
