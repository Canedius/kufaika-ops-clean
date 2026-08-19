/**
 * Перерахувати рекомендації крою і показати, що змінилось по вказаних SKU.
 * Запуск:  node scripts/verify_cut_reco.mjs [SKU...]
 */
const BASE = 'https://primary-production-eeb3.up.railway.app/webhook';
const skus = process.argv.slice(2).map((s) => s.toUpperCase());

const before = await (await fetch(`${BASE}/kufaika-cutreco-get`)).json();
console.log('знімок до:', before.generatedAt);

console.log('перерахунок…');
const r = await fetch(`${BASE}/kufaika-cutreco-refresh`, { method: 'POST' });
console.log('refresh ->', r.status);

const after = await (await fetch(`${BASE}/kufaika-cutreco-get`)).json();
console.log('знімок після:', after.generatedAt);

const pick = (d) => Object.fromEntries(d.rows.filter((x) => !skus.length || skus.includes(x.sku)).map((x) => [x.sku, x]));
const A = pick(before), B = pick(after);
for (const sku of Object.keys(B)) {
  const a = A[sku], b = B[sku];
  if (!a || (a.cutStock === b.cutStock && a.deficit === b.deficit)) continue;
  console.log(
    `${sku}: крій ${a.cutStock}→${b.cutStock}, ланцюг ${a.position}→${b.position}, ` +
    `покриття ${a.coverDays}→${b.coverDays} дн, до крою ${a.deficit}→${b.deficit} (${a.status}→${b.status})`,
  );
}
console.log('позицій з дефіцитом:', before.rows.filter((x) => x.deficit > 0).length, '→', after.rows.filter((x) => x.deficit > 0).length);
