/**
 * Фікс множника тренду в рекомендаціях крою.
 *
 * dailyRate() рахував tr як середнє за «останні 3 дні» ВКЛЮЧНО з поточним, а
 * перерахунок іде о 7:00 ранку — за сьогодні продажів майже нема. Третина вікна
 * завжди була штучно нульовою і систематично занижувала adu (по KUF006KTM —
 * рівно вдвічі: tr 0.67 замість 1.35).
 *
 * Стало: три ЗАВЕРШЕНІ дні (вчора, позавчора, третього дня).
 *
 * Запуск:  node scripts/patch_trend_window.mjs [--dry]
 */
import { readFileSync } from 'fs';

const BASE = 'https://primary-production-eeb3.up.railway.app';
const WF_ID = 'I0uulysDgp8szc2V';
const DRY = process.argv.includes('--dry');

const API_KEY =
  process.env.N8N_API_KEY ||
  JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'))
    .mcpServers['n8n-mcp'].env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

const SETTINGS_KEYS = [
  'executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions',
  'saveExecutionProgress', 'executionTimeout', 'errorWorkflow', 'timezone', 'callerPolicy',
];

const FROM = 'for(let i=0;i<3;i++){const d=new Date(nn);d.setDate(d.getDate()-i);s3+=(capped[iso(d)]||0);}';
const TO = 'for(let i=1;i<=3;i++){const d=new Date(nn);d.setDate(d.getDate()-i);s3+=(capped[iso(d)]||0);}';

const wf = await (await fetch(`${BASE}/api/v1/workflows/${WF_ID}`, { headers: H })).json();
const node = wf.nodes.find((n) => n.name === 'Compute Cut');

if (node.parameters.jsCode.includes(TO)) {
  console.log('вже пропатчено — вікно тренду рахує завершені дні');
  process.exit(0);
}
if (!node.parameters.jsCode.includes(FROM)) throw new Error('шаблон циклу тренду не знайдено');
node.parameters.jsCode = node.parameters.jsCode.replace(FROM, TO);
console.log('Compute Cut: вікно тренду зсунуто на i=1..3 (без поточного дня)');

if (DRY) { console.log('[dry] PUT пропущено'); process.exit(0); }

const settings = Object.fromEntries(
  Object.entries(wf.settings || {}).filter(([k]) => SETTINGS_KEYS.includes(k)),
);
const res = await fetch(`${BASE}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
if (!res.ok) throw new Error(`PUT: ${res.status} ${(await res.text()).slice(0, 400)}`);
console.log('PUT OK');
