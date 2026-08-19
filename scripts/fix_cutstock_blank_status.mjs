/**
 * Разова чистка даних: записам kufaika_cutstock з порожнім status проставити 'available'.
 * Порожній статус лишився від старого Format Update Stock, який затирав його при
 * редагуванні кількості (див. scripts/patch_cutstock_status.mjs).
 *
 * Запуск:  node scripts/fix_cutstock_blank_status.mjs [--dry]
 */
const BASE = 'https://primary-production-eeb3.up.railway.app/webhook';
const DRY = process.argv.includes('--dry');

const all = await (await fetch(`${BASE}/kufaika-cutstock-get`)).json();
const broken = all.filter((r) => !r.status && !r.individual && r.dtId != null);

console.log(`записів усього: ${all.length}, з порожнім статусом: ${broken.length}`);
for (const r of broken) {
  console.log(`  ${r.sku} (dtId ${r.dtId}, ${r.qty} шт, полиця "${r.shelf}")`);
  if (DRY) continue;
  const res = await fetch(`${BASE}/cutstock-kufaika`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update', dtId: r.dtId, qty: r.qty, shelf: r.shelf || '', status: 'available' }),
  });
  console.log(`    -> ${res.status} ${res.ok ? 'OK' : (await res.text()).slice(0, 200)}`);
}
console.log(DRY ? 'dry-run, нічого не змінено' : 'Готово.');
