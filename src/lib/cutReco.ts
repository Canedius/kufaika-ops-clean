import ky from "ky";
import snapshot from "../data/cutRecoSnapshot.json";
import { createCuttingOrder, fabricFromSku } from "./api";

// Дефолтні вебхуки n8n — щоб модуль працював навіть там, де env не долетіли в білд
// (напр. Vercel без VITE_N8N_CUTRECO_*). env, якщо заданий, завжди має пріоритет.
const N8N_BASE = "https://primary-production-eeb3.up.railway.app/webhook";
const CUTRECO_GET = import.meta.env.VITE_N8N_CUTRECO_GET || `${N8N_BASE}/kufaika-cutreco-get`;
const CUTRECO_REFRESH = import.meta.env.VITE_N8N_CUTRECO_REFRESH || `${N8N_BASE}/kufaika-cutreco-refresh`;

/**
 * Чи налаштовані вебхуки. Без них модуль мовчки живе на bundled-знімку, а «Оновити»
 * нічого не робить — тому стан показуємо в інтерфейсі, а не тільки в консолі.
 */
export const cutRecoLive = { get: !!CUTRECO_GET, refresh: !!CUTRECO_REFRESH };

export type CutStatus = "red" | "yellow" | "green";
export type CutDriver = "pull" | "seasonal";

export interface CutRecoRow {
  sku: string;
  product: string;
  productKey: string;
  color: string;
  colorKey: string;
  size: string;
  template: string; // "МАЛА" | "ВЕЛИКА"
  adu: number;
  /** темп продажів назад (без сезонного форварду) */
  aduTrailing?: number;
  /** сезонний форвард-прогноз (торішнє вікно × ріст); 0 для несезонних */
  aduForward?: number;
  /** що керує рекомендацією: поточний попит ("pull") чи сезонна підготовка ("seasonal") */
  driver?: CutDriver;
  finished: number;
  sewing: number;
  cutStock: number;
  cutting: number;
  position: number;
  coverDays: number;
  target: number;
  reorder: number;
  deficit: number;
  status: CutStatus;
  /** штук у ящику — для перерахунку boxes_to_sew при створенні задачі */
  box?: number;
}

export interface CutRecoData {
  generatedAt: string;
  season: number;
  horizons: { target: number; reorder: number; red: number };
  minRun: number;
  /** горизонт форвард-погляду для сезонних категорій (днів) */
  lookahead?: number;
  sizeOrder: string[];
  products: string[];
  rows: CutRecoRow[];
}

/**
 * Джерело рекомендацій крою. Наразі — сьогоднішній echelon-знімок (bundled JSON).
 * Коли увімкнемо гілку n8n `Calculate To Cut` → замінюється на fetch вебхука `kufaika_cut_reco`
 * (сигнатура лишається та сама, тому решта коду не міняється).
 */
export function getCutReco(): CutRecoData {
  return snapshot as CutRecoData;
}

/**
 * Жива версія: тягне рекомендації з n8n (вебхук kufaika-cutreco-get, оновлюється 2×/день
 * за розкладом + вручну). Якщо вебхук недоступний або порожній — падає на bundled-знімок.
 */
export async function fetchCutReco(): Promise<CutRecoData> {
  if (CUTRECO_GET) {
    try {
      const d = await ky.get(CUTRECO_GET, { timeout: 15000 }).json<CutRecoData>();
      if (d && Array.isArray(d.rows) && d.rows.length) return d;
    } catch (e) {
      console.warn("[cutReco] fetch failed, fallback to snapshot", e);
    }
  }
  return snapshot as CutRecoData;
}

/** Ручне «Оновити»: смикає n8n-перерахунок (POST). Компонент потім робить refetch getCutReco. */
export async function refreshCutReco(): Promise<void> {
  if (!CUTRECO_REFRESH) return;
  await ky.post(CUTRECO_REFRESH, { timeout: 200000 });
}

/** Скільки штук уже кинуто в розкрій із поточного знімка: sku → шт. */
export type SentMap = Record<string, number>;

const SENT_KEY = "kufaika:cutreco:sent";

/**
 * Журнал уже відправлених у розкрій позицій. Прив'язаний до `generatedAt` знімка:
 * після наступного перерахунку n8n цей крій уже сидить у ланцюгу (cutting), тому
 * журнал скидається — інакше дефіцит віднявся б двічі.
 */
export function loadSent(generatedAt: string): SentMap {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { generatedAt?: string; sent?: SentMap };
    return parsed.generatedAt === generatedAt ? parsed.sent || {} : {};
  } catch {
    return {};
  }
}

export function saveSent(generatedAt: string, sent: SentMap): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ generatedAt, sent }));
  } catch {
    /* приватний режим / переповнене сховище — журнал просто не переживе перезавантаження */
  }
}

/** Віднімає вже відправлене від дефіциту: таблиця показує тільки те, що ще треба кроїти. */
export function applySent(data: CutRecoData, sent: SentMap): CutRecoData {
  if (!Object.keys(sent).length) return data;
  return {
    ...data,
    rows: data.rows.map((r) => {
      const s = sent[r.sku];
      return s ? { ...r, deficit: Math.max(0, r.deficit - s) } : r;
    }),
  };
}

/**
 * Створює складську задачу зі статусом «В РОЗКРОЇ» на одну позицію рекомендації.
 * Той самий шлях, що й кнопка «В розкрій» на картці замовлення (вебхук kufaika-status).
 */
export async function sendRowToCut(row: CutRecoRow, qty: number): Promise<void> {
  const box = row.box && row.box > 0 ? row.box : 0;
  await createCuttingOrder(
    {
      sku: row.sku,
      size: row.size,
      launchDate: "",
      priority: row.status === "red" ? "Терміново" : "Низький",
      fabric: fabricFromSku(row.sku),
      comment: "",
      targetQty: row.target,
      quantity: qty,
      boxes: box ? Math.round(qty / box) : 0,
      currentAvailable: row.finished,
      productType: row.product,
      color: row.color,
    },
    qty,
    "",
    "cutting",
    false,
  );
}

export interface ProductGroup {
  productKey: string;
  product: string;
  colors: string[];      // впорядковані за сумарним ADU
  rows: CutRecoRow[];
  worstCover: number;    // мінімальне покриття (найгарячіший розмір)
  status: CutStatus;     // найгірший статус у товарі
}

const STATUS_RANK: Record<CutStatus, number> = { red: 0, yellow: 1, green: 2 };

/** Групує рядки по товару; кольори впорядковані за попитом. */
export function groupByProduct(data: CutRecoData): ProductGroup[] {
  const map = new Map<string, CutRecoRow[]>();
  for (const r of data.rows) {
    if (!map.has(r.productKey)) map.set(r.productKey, []);
    map.get(r.productKey)!.push(r);
  }
  const groups: ProductGroup[] = [];
  for (const [productKey, rows] of map) {
    const aduByColor = new Map<string, number>();
    for (const r of rows) aduByColor.set(r.color, (aduByColor.get(r.color) || 0) + r.adu);
    const colors = [...aduByColor.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const worstCover = Math.min(...rows.map((r) => r.coverDays));
    const status = rows.reduce<CutStatus>((w, r) => (STATUS_RANK[r.status] < STATUS_RANK[w] ? r.status : w), "green");
    groups.push({ productKey, product: rows[0].product, colors, rows, worstCover, status });
  }
  // найгарячіші товари зверху
  return groups.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.worstCover - b.worstCover);
}

export interface TemplateRun {
  productKey: string;
  product: string;
  template: string;
  sizes: string[];
  byColor: { color: string; perSize: Record<string, number>; total: number }[];
  marker: { size: string; qty: number }[];
  total: number;
  viable: boolean;
  minCover: number; // найменше покриття серед дефіцитних позицій заходу
}

/** Заходи розкрою по шаблонах для конкретного товару. */
export function buildRuns(group: ProductGroup, data: CutRecoData): TemplateRun[] {
  const runs: TemplateRun[] = [];
  for (const template of ["МАЛА", "ВЕЛИКА"]) {
    const tRows = group.rows.filter((r) => r.template === template && r.deficit > 0);
    if (!tRows.length) continue;
    const sizes = data.sizeOrder.filter((s) => tRows.some((r) => r.size === s));
    const colorMap = new Map<string, { color: string; perSize: Record<string, number>; total: number }>();
    const markerMap: Record<string, number> = {};
    for (const r of tRows) {
      let c = colorMap.get(r.color);
      if (!c) { c = { color: r.color, perSize: {}, total: 0 }; colorMap.set(r.color, c); }
      c.perSize[r.size] = (c.perSize[r.size] || 0) + r.deficit;
      c.total += r.deficit;
      markerMap[r.size] = (markerMap[r.size] || 0) + r.deficit;
    }
    const byColor = [...colorMap.values()].sort((a, b) => b.total - a.total);
    const marker = sizes.map((size) => ({ size, qty: markerMap[size] || 0 }));
    const total = tRows.reduce((s, r) => s + r.deficit, 0);
    const minCover = Math.min(...tRows.map((r) => r.coverDays));
    runs.push({ productKey: group.productKey, product: group.product, template, sizes, byColor, marker, total, viable: total >= data.minRun, minCover });
  }
  return runs;
}

/** Усі заходи по всіх товарах — для списку «кроїти зараз». Життєздатні + найгарячіші зверху. */
export function allRuns(data: CutRecoData): TemplateRun[] {
  const runs: TemplateRun[] = [];
  for (const g of groupByProduct(data)) runs.push(...buildRuns(g, data));
  return runs.sort((a, b) => Number(b.viable) - Number(a.viable) || a.minCover - b.minCover);
}

export interface Summary {
  red: number; yellow: number; green: number;
  totalDeficit: number; viableRuns: number; skuCount: number;
}

export function summarize(data: CutRecoData): Summary {
  const s: Summary = { red: 0, yellow: 0, green: 0, totalDeficit: 0, viableRuns: 0, skuCount: data.rows.length };
  for (const r of data.rows) { s[r.status]++; s.totalDeficit += r.deficit; }
  s.viableRuns = allRuns(data).filter((r) => r.viable).length;
  return s;
}
