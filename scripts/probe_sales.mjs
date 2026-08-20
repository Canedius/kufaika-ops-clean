/**
 * Діагностика рекомендацій крою: показує продажі по днях так, як їх бачить нода
 * Compute Cut, і перераховує її dailyRate() — щоб зрозуміти, чому adu стрибнув.
 *
 * Ключі не зберігаються в репо: n8n-ключ береться з .mcp.json, ключ KeyCRM —
 * з тієї самої ноди Compute Cut, яка ходить в CRM у проді.
 *
 * Запуск:  node scripts/probe_sales.mjs [префікс SKU] [днів]
 */
import { readFileSync } from 'fs';

const BASE = 'https://primary-production-eeb3.up.railway.app';
const PREFIX = (process.argv[2] || 'KUF006KT').toUpperCase();
const DAYS = Number(process.argv[3] || 30);

const n8nKey =
  process.env.N8N_API_KEY ||
  JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'))
    .mcpServers['n8n-mcp'].env.N8N_API_KEY;

const wf = await (await fetch(`${BASE}/api/v1/workflows/I0uulysDgp8szc2V`, {
  headers: { 'X-N8N-API-KEY': n8nKey },
})).json();
const code = wf.nodes.find((n) => n.name === 'Compute Cut').parameters.jsCode;
const crmKey = code.match(/const KEY='([^']+)'/)[1];
const KH = { accept: 'application/json', Authorization: 'Bearer ' + crmKey };

const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const start = new Date(now); start.setDate(start.getDate() - DAYS);
const end = new Date(now); end.setDate(end.getDate() + 1);

const SHOW_ORDERS = process.argv.includes('--orders');
const byDay = {};
const ordersPerDay = {};
const hits = []; // окремі замовлення з потрібним SKU — щоб бачити гурт vs роздріб
let page = 1, orders = 0, pages = 0, apiTotal = null;

while (true) {
  const u = `${'https://openapi.keycrm.app/v1/order'}?limit=100&page=${page}&sort=-created_at&include=products.offer&` +
    `${encodeURIComponent('filter[created_between]')}=${iso(start)},${iso(end)}`;
  const res = await (await fetch(u, { headers: KH })).json();
  const os = res.data || [];
  if (!os.length) break;
  pages++;
  apiTotal = res.total ?? apiTotal;
  for (const o of os) {
    orders++;
    const day = (o.created_at || '').slice(0, 10);
    if (!day) continue;
    ordersPerDay[day] = (ordersPerDay[day] || 0) + 1;
    for (const p of o.products || []) {
      const sku = ((p.offer && p.offer.sku) || p.sku || '').trim().toUpperCase();
      if (!sku.startsWith(PREFIX)) continue;
      (byDay[sku] = byDay[sku] || {});
      byDay[sku][day] = (byDay[sku][day] || 0) + (Number(p.quantity) || 1);
      if (SHOW_ORDERS) hits.push({ day, id: o.id, source: o.source_id, sku, qty: Number(p.quantity) || 1 });
    }
  }
  const tp = res.total && res.per_page ? Math.ceil(res.total / res.per_page) : null;
  if ((tp && page >= tp) || (!tp && !(res.links && res.links.next))) break;
  page++;
  await new Promise((r) => setTimeout(r, 180));
}

console.log(`вікно ${iso(start)}..${iso(end)} | сторінок ${pages} | замовлень ${orders} | API total=${apiTotal}`);

if (SHOW_ORDERS) {
  const perOrder = {};
  for (const h of hits) {
    const k = h.day + '|' + h.id;
    (perOrder[k] = perOrder[k] || { day: h.day, id: h.id, source: h.source, items: [], qty: 0 });
    perOrder[k].items.push(`${h.sku.replace(PREFIX, '')}×${h.qty}`);
    perOrder[k].qty += h.qty;
  }
  console.log(`\nокремі замовлення з ${PREFIX} (день | № | шт | розміри):`);
  for (const o of Object.values(perOrder).sort((a, b) => a.day.localeCompare(b.day) || b.qty - a.qty)) {
    console.log(`  ${o.day}  #${o.id}  ${String(o.qty).padStart(3)} шт  ${o.items.join(' ')}`);
  }
}
console.log('\nвсього замовлень по днях:');
for (const d of Object.keys(ordersPerDay).sort()) {
  console.log(`  ${d}  ${'#'.repeat(Math.min(70, ordersPerDay[d]))} ${ordersPerDay[d]}`);
}

// та сама математика, що в Compute Cut
const median = (a) => { const s = [...a].sort((p, q) => p - q), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const iqr = (a) => { if (a.length < 4) return 0; const s = [...a].sort((p, q) => p - q); return s[Math.floor((s.length - 1) * 0.75)] - s[Math.floor((s.length - 1) * 0.25)]; };
const quant = (a, x) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); const pos = (s.length - 1) * x, b = Math.floor(pos), r = pos - b; return (s[b] + (s[b + 1] - s[b]) * r) || s[b]; };

function dailyRate(days) {
  const vals = Object.values(days);
  if (!vals.length) return { dr: 0, cap: 0, dwd: 0, sum: 0 };
  const med = median(vals), sp = iqr(vals);
  const an = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.filter((v) => v > 0).length);
  const cap = Math.min(med + 1.5 * sp || med * 1.5, an * 1.5 || med * 1.5, quant(vals, 0.9) || med * 1.5) || 0;
  const capped = {};
  for (const k in days) capped[k] = Math.min(days[k], cap || days[k]);
  const dwd = Object.keys(capped).length;
  const sum = Object.values(capped).reduce((a, b) => a + b, 0);
  return { dr: +(sum / Math.max(dwd, 14)).toFixed(3), cap: +cap.toFixed(2), dwd, sum: +sum.toFixed(1), raw: vals.reduce((a, b) => a + b, 0) };
}

for (const sku of Object.keys(byDay).sort()) {
  const days = byDay[sku];
  const m = dailyRate(days);
  console.log(`\n${sku}: ${m.raw} шт за ${m.dwd} днів з продажами`);
  console.log('  ' + Object.keys(days).sort().map((d) => `${d.slice(5)}:${days[d]}`).join('  '));
  console.log(`  cap=${m.cap} (стеля на день) → після капування ${m.sum} шт → dr=${m.dr}/день`);

  // що буде, якщо викинути найбільший день — наскільки результат тримається
  const top = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const without = { ...days }; delete without[top[0]];
  const m2 = dailyRate(without);
  console.log(`  без ${top[0].slice(5)} (${top[1]} шт): cap=${m2.cap} → dr=${m2.dr}/день  (${m.dr ? Math.round((m2.dr / m.dr - 1) * 100) : 0}%)`);
}
