import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';

const targets = JSON.parse(process.env.DOGHOUSE_TARGETS ?? '[]');
const dataDir = '/var/lib/doghouse';
mkdirSync(dataDir, { recursive: true });
let report = { schemaVersion: 'doghouse-report/v1', mode: 'report-only', sequence: 0, observedAt: null, incidents: [] };

function incidentId(target, condition) {
  return `inc_${createHash('sha256').update(`${target}|${condition}`).digest('hex').slice(0, 24)}`;
}
function persist(next) {
  const temp = `${dataDir}/report.json.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, `${dataDir}/report.json`);
}
async function observe() {
  const incidents = [];
  for (const target of targets) {
    try {
      const response = await fetch(target.url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) incidents.push({ incidentId: incidentId(target.id, `http-${response.status}`), target: target.id, condition: `http-${response.status}`, disposition: 'reported' });
    } catch {
      incidents.push({ incidentId: incidentId(target.id, 'unreachable'), target: target.id, condition: 'unreachable', disposition: 'reported' });
    }
  }
  report = { schemaVersion: 'doghouse-report/v1', mode: 'report-only', sequence: report.sequence + 1, observedAt: new Date().toISOString(), incidents };
  persist(report);
}
function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) });
  res.end(raw);
}
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, report.observedAt ? 200 : 503, { status: report.observedAt ? 'healthy' : 'starting', mode: 'report-only' });
  if (req.method === 'GET' && (req.url === '/status' || req.url === '/incidents')) return send(res, 200, report);
  return send(res, 405, { error: 'report_only_surface' });
});
await observe();
setInterval(observe, 15000).unref();
server.listen(8790, '0.0.0.0');
