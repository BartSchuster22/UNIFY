import { BlockList, isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';
const dns = new Resolver({ timeout: 1500, tries: 2 });
const resolve4 = (host: string) => dns.resolve4(host);
export type CallbackPins = Readonly<Record<string, readonly string[]>>;
const privateNetwork = new BlockList();
privateNetwork.addSubnet('10.0.0.0',8,'ipv4');
privateNetwork.addSubnet('172.16.0.0',12,'ipv4');
privateNetwork.addSubnet('192.168.0.0',16,'ipv4');
import { request } from 'node:https';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError } from '../auth/service.js';
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
export function publicAddress(address: string) {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}
export async function destination(
  value: string,
  resolve: (host: string) => Promise<string[]> = resolve4,
  pins: CallbackPins = {},
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw denied();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw denied();
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolve(url.hostname);
  const explicit = Object.hasOwn(pins,url.href) ? pins[url.href] : undefined;
  if (!addresses.length || addresses.length > 32 || addresses.some((a) => explicit
    ? !explicit.includes(a) || (!publicAddress(a) && !(isIP(a)===4 && privateNetwork.check(a,'ipv4')))
    : !publicAddress(a))) throw denied();
  return { url, address: addresses[0]! };
}
function denied() {
  return new AuthError(
    'APPLICATION_DESTINATION_DENIED',
    403,
    'Destination is outside the public HTTPS IPv4 policy',
  );
}
// Resolve, validate ALL answers, then pin the selected address on the socket.
// No redirects, no environment proxy, no connection pooling across validations.
export async function boundedHttps(
  value: string,
  method: 'GET' | 'POST',
  headers: Record<string, string> = {},
  body?: string,
  maxBytes = 262144,
  pins: CallbackPins = {},
) {
  const { url, address } = await destination(value,undefined,method==='POST'?pins:{});
  return new Promise<{ status: number; body: string; contentType: string }>((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers,
        agent: false,
        servername: url.hostname,
        timeout: 10000,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address, family: 4 }]);
          else callback(null, address, 4);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error('APPLICATION_RESPONSE_LIMIT'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            reject(denied());
            return;
          }
          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: String(res.headers['content-type'] ?? ''),
          });
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('APPLICATION_TRANSPORT_TIMEOUT')), 10000);
    timer.unref();
    req.on('close', () => clearTimeout(timer));
    req.on('timeout', () => req.destroy(new Error('APPLICATION_TRANSPORT_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}
export function deliverySignature(secret: string, id: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${id}.${body}`).digest('hex');
}
export function verifyDelivery(
  secret: string,
  id: string,
  timestamp: unknown,
  signature: unknown,
  body: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    typeof timestamp !== 'string' ||
    !/^[0-9]{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300 ||
    typeof signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !/^[a-f0-9-]{36}$/.test(id)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(deliverySignature(secret, id, Number(timestamp), body), 'hex'),
  );
}
