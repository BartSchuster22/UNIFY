import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/opt/alica/provider-config.json', 'utf8'));
const token = readFileSync('/run/secrets/ainba-control-token', 'utf8').trim();
const dataDir = '/var/lib/ainba';
mkdirSync(dataDir, { recursive: true });
const startedAt = new Date().toISOString();
let sequence = 0;

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}
function authorized(req) {
  const value = req.headers.authorization ?? '';
  const expected = `Bearer ${token}`;
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 32768) reject(new Error('request_too_large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health')
    return send(res, 200, { status: 'healthy', component: 'ainba-anchor' });
  if (req.method === 'GET' && req.url === '/status')
    return send(res, 200, {
      status: 'running',
      component: 'ainba-anchor',
      lifecycle: 'cell-governed',
      startedAt,
      provider: { mode: config.mode, providerId: config.providerId, configured: true },
      operations: sequence,
    });
  if (req.method !== 'POST' || req.url !== '/v1/run')
    return send(res, 405, { error: 'method_not_allowed' });
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    const body = JSON.parse(await readBody(req));
    if (body.operation !== 'echo' || typeof body.input !== 'string' || body.input.length > 4096)
      return send(res, 400, { error: 'closed_operation_contract_rejected' });
    sequence += 1;
    const record = {
      schemaVersion: 'ainba-anchor-event/v1',
      sequence,
      operation: 'echo',
      inputDigest: `sha256:${createHash('sha256').update(body.input).digest('hex')}`,
      result: body.input,
      occurredAt: new Date().toISOString(),
    };
    appendFileSync(`${dataDir}/events.jsonl`, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return send(res, 200, record);
  } catch (error) {
    return send(res, error.message === 'request_too_large' ? 413 : 400, { error: error.message });
  }
});
server.listen(8787, '0.0.0.0');
