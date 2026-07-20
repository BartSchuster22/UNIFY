import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const gateway = (process.env.GATEWAY_INTERNAL_URL ?? 'http://gateway:8080').replace(/\/$/, '');
const publicRoot = join(process.cwd(), 'public');
const indexPath = join(publicRoot, 'index.html');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};
const security = {
  'content-security-policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...security,
      });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url?.startsWith('/api/')) {
      await proxy(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, security);
      res.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    const candidate = normalize(join(publicRoot, pathname));
    const safePath = candidate.startsWith(`${publicRoot}/`) ? candidate : indexPath;
    let file = safePath;
    try {
      if (!(await stat(file)).isFile()) file = indexPath;
    } catch {
      file = indexPath;
    }
    const extension = extname(file);
    res.writeHead(200, {
      'content-type': types[extension] ?? 'application/octet-stream',
      'cache-control':
        extension === '.html' || file.endsWith('/sw.js') || extension === '.webmanifest'
          ? 'no-store'
          : 'public, max-age=31536000, immutable',
      ...security,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  } catch (error) {
    console.error('request failed', error instanceof Error ? error.message : 'unknown');
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', ...security });
    res.end(
      JSON.stringify({ error: { code: 'UI_GATEWAY_UNAVAILABLE', message: 'Gateway unavailable' } }),
    );
  }
});
async function proxy(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (value !== undefined && !['host', 'connection', 'content-length'].includes(key))
      headers.set(key, Array.isArray(value) ? value.join(',') : value);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const upstream = await fetch(`${gateway}${req.url}`, {
    method: req.method,
    headers,
    ...(body ? { body } : {}),
    redirect: 'manual',
    signal: controller.signal,
  });
  const outgoing = { ...security };
  upstream.headers.forEach((value, key) => {
    if (
      ![
        'connection',
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'set-cookie',
        'content-security-policy',
      ].includes(key)
    )
      outgoing[key] = value;
  });
  const cookies = upstream.headers.getSetCookie();
  if (cookies.length) outgoing['set-cookie'] = cookies;
  res.writeHead(upstream.status, outgoing);
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
}
server.listen(port, host, () => console.log(`Focused web shell listening on ${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => server.close(() => process.exit(0)));
