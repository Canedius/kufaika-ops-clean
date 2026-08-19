/**
 * Фікс «загубленого крою»: записи kufaika_cutstock з порожнім status не потрапляли
 * в рекомендації крою, бо Compute Cut рахував тільки status === 'available'.
 * Порожній статус з'являвся сам — Format Update Stock затирав його при редагуванні кількості.
 *
 * Запуск:  N8N_API_KEY=... node scripts/patch_cutstock_status.mjs [--dry]
 */
import { readFileSync } from 'fs';

const BASE = 'https://primary-production-eeb3.up.railway.app';
const DRY = process.argv.includes('--dry');
const API_KEY =
  process.env.N8N_API_KEY ||
  JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'))
    .mcpServers['n8n-mcp'].env.N8N_API_KEY;

const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

async function getWf(id) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}

// public API приймає лише частину ключів settings — решту (binaryMode, availableInMCP) відкидає з 400
const SETTINGS_KEYS = [
  'executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions',
  'saveExecutionProgress', 'executionTimeout', 'errorWorkflow', 'timezone', 'callerPolicy',
];

async function putWf(id, wf) {
  const settings = Object.fromEntries(
    Object.entries(wf.settings || {}).filter(([k]) => SETTINGS_KEYS.includes(k)),
  );
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
  if (DRY) return console.log(`  [dry] PUT ${id} пропущено`);
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PUT ${id}: ${r.status} ${(await r.text()).slice(0, 500)}`);
  console.log(`  PUT ${id} OK`);
}

/** Заміна в jsCode ноди з перевіркою, що шаблон реально знайшовся. */
function patchCode(wf, nodeName, from, to) {
  const n = wf.nodes.find((x) => x.name === nodeName);
  if (!n) throw new Error(`нема ноди ${nodeName}`);
  if (n.parameters.jsCode.includes(to)) return console.log(`  ${nodeName}: вже пропатчено`), false;
  if (!n.parameters.jsCode.includes(from)) throw new Error(`${nodeName}: шаблон не знайдено`);
  n.parameters.jsCode = n.parameters.jsCode.replace(from, to);
  console.log(`  ${nodeName}: пропатчено`);
  return true;
}

// 1) Kufaika — Cut Reco: рахувати весь складський крій, а не лише status === 'available'
console.log('Kufaika — Cut Reco (I0uulysDgp8szc2V)');
const cutReco = await getWf('I0uulysDgp8szc2V');
if (
  patchCode(
    cutReco,
    'Compute Cut',
    "if(realSkus.has(sku)&&!c.individual&&c.status==='available')",
    "if(realSkus.has(sku)&&!c.individual&&c.status!=='individual'&&c.status!=='used')",
  )
) await putWf('I0uulysDgp8szc2V', cutReco);

// 2) Kufaika Operations Railway: не затирати status при оновленні кількості крою
console.log('Kufaika Operations Railway (SOR6dpb3wFmpeBKb)');
const ops = await getWf('SOR6dpb3wFmpeBKb');
if (
  patchCode(
    ops,
    'Format Update Stock',
    "status: b.status || '',",
    "status: b.status || 'available',",
  )
) await putWf('SOR6dpb3wFmpeBKb', ops);

console.log('Готово.');
