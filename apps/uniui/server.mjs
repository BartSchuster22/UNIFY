import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const gateway = (process.env.GATEWAY_INTERNAL_URL ?? 'http://gateway:8080').replace(/\/$/, '');
const index = await readFile(new URL('./index.html', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url?.startsWith('/api/')) {
      await proxy(req, res);
      return;
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      });
      res.end(index);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (error) {
    console.error('request failed', error instanceof Error ? error.message : 'unknown');
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: { code: 'UI_GATEWAY_UNAVAILABLE', message: 'Gateway unavailable' } }),
    );
  }
});
async function proxy(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined && !['host', 'connection', 'content-length'].includes(key))
      headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const upstream = await fetch(`${gateway}${req.url}`, {
    method: req.method,
    headers,
    ...(body ? { body } : {}),
    redirect: 'manual',
  });
  const outgoing = {};
  upstream.headers.forEach((value, key) => {
    if (
      ![
        'connection',
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'set-cookie',
      ].includes(key)
    )
      outgoing[key] = value;
  });
  const cookies = upstream.headers.getSetCookie();
  if (cookies.length) outgoing['set-cookie'] = cookies;
  res.writeHead(upstream.status, outgoing);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
server.listen(port, host, () => console.log(`UNIUI foundation listening on ${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => server.close(() => process.exit(0)));
