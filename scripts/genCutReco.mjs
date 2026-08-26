// Генерує знімок рекомендацій крою (src/data/cutRecoSnapshot.json) з живих даних KeyCRM + DataTable.
// Логіка: echelon DDMRP (ціль 30д / reorder 20д / red 10д).
// Для СЕЗОННИХ категорій (худі/утеплені світшоти) — форвард-сигнал:
//   ADU = max(темп_назад, торішнє_вікно_60д / 60 × ріст).
// Запуск: node scripts/genCutReco.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';

const KEY = 'YjRmYWRmY2Y4YzExYTEyOTg4MzM0MzI3YzI4OWNlODA0ZWMzODVmYg';
const OUT = fileURLToPath(new URL('../src/data/cutRecoSnapshot.json', import.meta.url));

// KeyCRM GET зі стійкістю до rate-limit (429) / 5xx — інакше побита сторінка мовчки недорахує.
async function apiGet(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url, { headers: { Authorization: "Bearer " + KEY } }); }
    catch (e) { await new Promise(r => setTimeout(r, Math.min(8000, 500 * 2 ** i))); continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, Math.min(10000, 700 * 2 ** i))); continue; }
    throw new Error("KeyCRM " + res.status + " :: " + url.slice(0, 90));
  }
  throw new Error("KeyCRM: вичерпано спроби :: " + url.slice(0, 90));
}

// Активна сітка SKU = виходи Filter-вузлів n8n (SOR6dpb3wFmpeBKb, exec 170275). Не хардкод TARGET_SKUS.
const LISTS = {
  Hoodies: "KUF001BKXS,KUF001BKS,KUF001BKM,KUF001BKL,KUF001BKXL,KUF001BKXXL,KUF001BK3XL,KUF001PKS,KUF001PKM,KUF001PKL,KUF001PKXL,KUF001PKXXL,KUF001GFS,KUF001GFM,KUF001GFL,KUF001GFXL,KUF001GFXXL,KUF001KHS,KUF001KHM,KUF001KHL,KUF001KHXL,KUF001KHXXL,KUF001NUS,KUF001NUM,KUF001NUL,KUF001NUXL,KUF001NUXXL,KUF001WHS,KUF001WHM,KUF001WHL,KUF001WHXL,KUF001WHXXL,KUF004BKS,KUF004BKM,KUF004BKL,KUF004BKXL,KUF004BKXXL",
  Premium: "KUF006BKXS,KUF006BKS,KUF006BKM,KUF006BKL,KUF006BKXL,KUF006BKXXL,KUF006BK3XL,KUF006WHXS,KUF006WHS,KUF006WHM,KUF006WHL,KUF006WHXL,KUF006WHXXL,KUF006WH3XL,KUF006PKS,KUF006PKM,KUF006PKL,KUF006PKXL,KUF006PKXXL,KUF006OGS,KUF006OGM,KUF006OGL,KUF006OGXL,KUF006OGXXL,KUF006GBS,KUF006GBM,KUF006GBL,KUF006GBXL,KUF006GBXXL,KUF006KTS,KUF006KTM,KUF006KTL,KUF006KTXL,KUF006KTXXL",
  Oversize: "KUF008BKXS/S,KUF008BKM/L,KUF008BKXL/2XL,KUF008WHXS/S,KUF008WHM/L,KUF008WHXL/2XL",
  Sweatshirts: "KUF002BKXS,KUF002BKS,KUF002BKM,KUF002BKL,KUF002BKXL,KUF002BKXXL,KUF002BK3XL",
};
const universe = [...new Set(Object.values(LISTS).flatMap(s => s.split(",")))];

const PRODUCTS = { KUF001: "Худі утеплений", KUF002: "Худі легкий", KUF004: "Світшот утеплений", KUF005: "Світшот легкий", KUF006: "Футболка Premium", KUF007: "Футболка Oversize", KUF008: "Футболка Relaxed", KUF009: "Футболка Lightness" };
const CLR = { BK: "Чорний", PK: "Ніжно-рожевий", GF: "Сірий грі", KH: "Хакі", NU: "Бежевий", WH: "Білий", GB: "Сірий", KT: "Койот", OG: "Олива", KZ: "Кремовий" };

// Сезонні категорії ЗИМОВІ (форвард-сигнал за торішнім вікном) → множник росту YoY.
const SEASONAL_GROWTH = { KUF001: 1.48, KUF002: 1.25, KUF004: 1.25 };
const LOOKAHEAD = 60;                                   // днів уперед для сезонної підготовки
// Сезонні криві по категоріях (як у відповідних Calculate To Sew n8n).
const SEASON_PREMIUM = m => [6, 7, 8].includes(m) ? 1.3 : [5, 9].includes(m) ? 1.1 : [3, 4, 10].includes(m) ? 1.0 : 0.85;
const SEASON_OVERSIZE = m => [6, 7, 8].includes(m) ? 2.3 : [5, 9].includes(m) ? 1.8 : [3, 4, 10].includes(m) ? 1.3 : [11, 12, 1, 2].includes(m) ? 0.9 : 1.5;
// Оверсайз (KUF007/008): floor мінімального запасу на SKU (minTargetAvailable з Calculate To Sew2 n8n).
const OVERSIZE_FLOOR = {
  "KUF007BKXS/S": 50, "KUF007BKM/L": 50, "KUF007BKXL/XXL": 50, "KUF007WHXS/S": 50, "KUF007WHM/L": 50, "KUF007WHXL/XXL": 50,
  "KUF008BKXS/S": 150, "KUF008BKM/L": 200, "KUF008BKXL/2XL": 150, "KUF008WHXS/S": 150, "KUF008WHM/L": 200, "KUF008WHXL/2XL": 150,
};
const H_TARGET = 30, H_REORDER = 20, H_RED = 10, MIN_RUN = 70;

// Розмір коробки (1 закрита коробка) — як у відповідних Calculate To Sew n8n.
function getBox(sku, size) {
  const p = sku.slice(0, 6), c = sku.slice(6, 8);
  if (p === "KUF006") return (c === "BK" || c === "WH") ? 50 : 15;      // Premium: чорна/біла 50, кольорові 15
  if (p === "KUF007" || p === "KUF008") return 50;                       // Оверсайз/Relaxed
  if (p === "KUF002") return 20;                                         // Худі легкий: у Calculate To Sew3 усі коробки 20
  if (size === "XS") return 7;                                           // Худі/світшоти утеплені
  if (["S", "M", "L"].includes(size)) return 12;
  return 10;
}
const TMPL = sz => ["XS", "S", "M", "L", "XS/S", "M/L"].includes(sz.toUpperCase()) ? "МАЛА" : "ВЕЛИКА";

const iso = d => d.toISOString().slice(0, 10);
async function fetchOrders(start, end, onOrder) {
  let page = 1;
  while (true) {
    const u = "https://openapi.keycrm.app/v1/order?limit=100&page=" + page + "&sort=-created_at&include=products.offer&" +
      encodeURIComponent("filter[created_between]") + "=" + start + "," + end;
    const res = await apiGet(u);
    const os = res?.data || []; if (!os.length) break;
    for (const o of os) onOrder(o);
    const tp = res.total && res.per_page ? Math.ceil(res.total / res.per_page) : null;
    if ((tp && page >= tp) || (!tp && !res?.links?.next)) break;
    page++; await new Promise(r => setTimeout(r, 180));
  }
}

// --- helpers для daily_rate (та сама формула, що у Filter Premium n8n) ---
const quant = (a, x) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); const pos = (s.length - 1) * x, b = Math.floor(pos), r = pos - b; return (s[b] + (s[b + 1] - s[b]) * r) || s[b]; };
const median = a => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const iqr = a => { if (a.length < 4) return 0; const s = [...a].sort((p, q) => p - q); return s[Math.floor((s.length - 1) * 0.75)] - s[Math.floor((s.length - 1) * 0.25)]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function dailyRate(byDay) {
  const vals = Object.values(byDay); if (!vals.length) return { dr: 0, tr: 1 };
  const med = median(vals), sp = iqr(vals), an = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.filter(v => v > 0).length);
  const cap = Math.min(med + 1.5 * sp || med * 1.5, an * 1.5 || med * 1.5, quant(vals, 0.9) || med * 1.5) || 0;
  const capped = {}; for (const [d, v] of Object.entries(byDay)) capped[d] = Math.min(v, cap || v);
  const dwd = Object.keys(capped).length, sum = Object.values(capped).reduce((a, b) => a + b, 0); const dr = sum / Math.max(dwd, 14);
  const now = new Date(); let s3 = 0; for (let i = 1; i <= 3; i++) { const d = new Date(now); d.setDate(d.getDate() - i); s3 += (capped[iso(d)] || 0); }
  return { dr: +dr.toFixed(3), tr: dr > 0 ? +clamp((s3 / 3) / dr, 0.6, 1.4).toFixed(2) : 1 };
}

async function main() {
  // 1) реальні offer-и + готовий склад (KeyCRM stocks)
  const finished = {}, realSkus = new Set();
  for (let i = 0; i < universe.length; i += 40) {
    const batch = universe.slice(i, i + 40); let pg = 1;
    while (true) {
      const u = "https://openapi.keycrm.app/v1/offers/stocks?limit=50&page=" + pg + "&" + encodeURIComponent("filter[offers_sku]") + "=" + encodeURIComponent(batch.join(",")) + "&" + encodeURIComponent("filter[details]") + "=true";
      const j = await apiGet(u);
      const d = j?.data || []; if (!d.length) break;
      for (const st of d) { const sku = (st.sku || "").trim().toUpperCase(); if (!universe.includes(sku)) continue; realSkus.add(sku); const wh = (st.warehouse || []).find(w => w.id === 1); finished[sku] = wh ? ((wh.quantity || 0) - (wh.reserve || 0)) : 0; }
      if (!j?.links?.next) break; pg++; await new Promise(r => setTimeout(r, 180));
    }
  }

  // 2) продажі за 30 днів → темп назад
  const now = new Date();
  const start30 = new Date(now); start30.setDate(start30.getDate() - 30);
  const end1 = new Date(now); end1.setDate(end1.getDate() + 1);
  const sales = {};
  await fetchOrders(iso(start30), iso(end1), o => {
    const day = (o.created_at || "").slice(0, 10); if (!day) return;
    for (const p of (o.products || [])) { const sku = (p.offer?.sku || p.sku || "").trim().toUpperCase(); if (!realSkus.has(sku)) continue; (sales[sku] = sales[sku] || { byDay: {} }); sales[sku].byDay[day] = (sales[sku].byDay[day] || 0) + (Number(p.quantity) || 1); }
  });

  // 3) ФОРВАРД: торішнє вікно [today−1рік ; +LOOKAHEAD] для сезонних SKU
  const seasonalSkus = new Set([...realSkus].filter(s => SEASONAL_GROWTH[s.slice(0, 6)]));
  const lyStart = new Date(now); lyStart.setFullYear(lyStart.getFullYear() - 1);
  const lyEnd = new Date(lyStart); lyEnd.setDate(lyEnd.getDate() + LOOKAHEAD);
  const lastYearQty = {};
  if (seasonalSkus.size) {
    await fetchOrders(iso(lyStart), iso(lyEnd), o => {
      for (const p of (o.products || [])) { const sku = (p.offer?.sku || p.sku || "").trim().toUpperCase(); if (!seasonalSkus.has(sku)) continue; lastYearQty[sku] = (lastYearQty[sku] || 0) + (Number(p.quantity) || 1); }
    });
  }

  // 4) дошка (крій/пошив/розкрій) з фронт-вебхуків
  const orders = await (await fetch("https://primary-production-eeb3.up.railway.app/webhook/kufaika-orders-get")).json();
  const cutstock = await (await fetch("https://primary-production-eeb3.up.railway.app/webhook/kufaika-cutstock-get")).json();
  const sew = {}, cutting = {}, cut = {};
  for (const o of orders) { const sku = (o.sku || "").toUpperCase(); if (!realSkus.has(sku)) continue; if (o.status === "in-progress") sew[sku] = (sew[sku] || 0) + (o.quantity || 0); if (o.status === "cutting") cutting[sku] = (cutting[sku] || 0) + (o.cutting_qty || o.quantity || 0); }
  for (const c of cutstock) { const sku = (c.sku || "").toUpperCase(); if (realSkus.has(sku) && !c.individual && c.status !== "individual" && c.status !== "used") cut[sku] = (cut[sku] || 0) + (c.qty || 0); }

  // 5) рядки + echelon
  const month = now.getMonth() + 1;
  const rows = [];
  for (const sku of realSkus) {
    const pfx = sku.slice(0, 6); if (!PRODUCTS[pfx]) continue;
    const { dr, tr } = dailyRate(sales[sku]?.byDay || {});
    let adu, aduTrailing = +(dr * tr).toFixed(2), aduForward = 0, driver = "pull", floor = 0;
    if (SEASONAL_GROWTH[pfx]) {
      // ЗИМОВІ: форвард за торішнім вікном
      aduForward = +((lastYearQty[sku] || 0) / LOOKAHEAD * SEASONAL_GROWTH[pfx]).toFixed(2);
      adu = Math.max(aduTrailing, aduForward);
      driver = aduForward > aduTrailing ? "seasonal" : "pull";
    } else if (pfx === "KUF007" || pfx === "KUF008") {
      // ОВЕРСАЙЗ: своя сезонна крива (літо 2.3) + floor мін. запасу, як у Calculate To Sew2
      adu = +(dr * SEASON_OVERSIZE(month) * tr).toFixed(2);
      floor = OVERSIZE_FLOOR[sku] || 0;
    } else {
      // PREMIUM (KUF006) та інші футболки: крива Premium
      adu = +(dr * SEASON_PREMIUM(month) * tr).toFixed(2);
    }
    const fin = finished[sku] || 0, s = sew[sku] || 0, c = cut[sku] || 0, ic = cutting[sku] || 0, pos = fin + s + c + ic;
    const cover = adu > 0.05 ? pos / adu : 999;
    const box = getBox(sku, sku.slice(8));
    // Полиця не може бути нижчою за 1 повну коробку — так само, як minTargetBoxes=1 в усіх
    // Calculate To Sew n8n. Без цього крій мовчав там, де пошив уже подав задачу (напр. KUF002BKL).
    const total30 = Object.values(sales[sku]?.byDay || {}).reduce((a, b) => a + b, 0);
    const shelfFloor = (adu > 0 || total30 > 0 || pos < box) ? box : 0;
    const floorEff = Math.max(floor, shelfFloor);
    // Ціль = ceil(попит×горизонт до коробів) з floor мін.запасу — так само, як desiredAvailable у пошиві
    // (тому крій ≥ того, що пошив збирається спожити). reorder = 2/3 цілі.
    const target = Math.max(Math.ceil(adu * H_TARGET / box) * box, floorEff);
    const reorder = Math.round(target * H_REORDER / H_TARGET);
    let deficit = ((adu > 0.05 || floorEff > 0) && pos < reorder) ? Math.max(0, target - pos) : 0;
    if (deficit > 0) deficit = Math.ceil(deficit / box) * box;          // округлення крою до коробів
    const status = deficit > 0 ? (cover < H_RED ? "red" : "yellow") : "green";
    rows.push({ sku, product: PRODUCTS[pfx], productKey: pfx, color: CLR[sku.slice(6, 8)] || sku.slice(6, 8), colorKey: sku.slice(6, 8), size: sku.slice(8), template: TMPL(sku.slice(8)), adu: +adu.toFixed(1), aduTrailing, aduForward, driver, finished: fin, sewing: s, cutStock: c, cutting: ic, position: pos, coverDays: Math.max(0, Math.round(cover)), target, reorder, deficit, box, status });
  }
  rows.sort((a, b) => a.productKey.localeCompare(b.productKey) || a.colorKey.localeCompare(b.colorKey));

  const meta = {
    generatedAt: new Date().toISOString(), season: SEASON_PREMIUM(now.getMonth() + 1),
    horizons: { target: H_TARGET, reorder: H_REORDER, red: H_RED }, minRun: MIN_RUN, lookahead: LOOKAHEAD,
    sizeOrder: ["XS/S", "XS", "S", "M", "M/L", "L", "XL", "XL/XXL", "XL/2XL", "XXL", "2XL", "3XL"],
    products: [...new Set(rows.map(r => r.product))], rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(meta, null, 1));

  // короткий звіт
  const seasonalRows = rows.filter(r => r.driver === "seasonal");
  console.log("SKU:", rows.length, "| дефіцит>0:", rows.filter(r => r.deficit > 0).length, "| сезонних(driver=seasonal):", seasonalRows.length);
  console.log("Форвард торік [" + iso(lyStart) + " .. " + iso(lyEnd) + "] сумарно:", Object.values(lastYearQty).reduce((a, b) => a + b, 0), "шт");
  const runs = {};
  rows.forEach(r => { if (r.deficit > 0) { const k = r.product + " | " + r.template; runs[k] = (runs[k] || 0) + r.deficit; } });
  console.log("Заходи:"); Object.entries(runs).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + (v >= MIN_RUN ? "✅" : "⏳") + " " + k + " = " + v));
}
main().catch(e => { console.error(e); process.exit(1); });