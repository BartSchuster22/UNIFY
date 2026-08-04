import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { PINNED_HERMES_COMMIT, type FrameworkScope } from '@aquiero/contracts';
import { buildHermesControlAdapter } from './app.js';
import { PostgresAdapterEventStore } from './event-store.js';
import { HermesCliRunner, HermesNativeSource } from './source.js';
import { FileRotatingBearerTokenVerifier } from './token-credentials.js';

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const repo = required('HERMES_REPO');
await verifyImmutableBaseline(repo);
const databaseUrl = await secret('DATABASE_URL');
const bearerToken = await optionalSecret('HERMES_ADAPTER_TOKEN');
const bearerTokenBundleFile = process.env.HERMES_ADAPTER_TOKEN_BUNDLE_FILE;
if (Boolean(bearerToken) === Boolean(bearerTokenBundleFile))
  throw new Error(
    'Exactly one of HERMES_ADAPTER_TOKEN[_FILE] or HERMES_ADAPTER_TOKEN_BUNDLE_FILE is required',
  );
if (bearerTokenBundleFile && !bearerTokenBundleFile.startsWith('/'))
  throw new Error('HERMES_ADAPTER_TOKEN_BUNDLE_FILE must be an absolute path');
const rotatingTokenVerifier = bearerTokenBundleFile
  ? new FileRotatingBearerTokenVerifier(
      bearerTokenBundleFile,
      parseBoundedInteger(process.env.HERMES_ADAPTER_TOKEN_CACHE_TTL_MS, 1_000, 0, 60_000),
    )
  : undefined;
const tlsKeyFile = process.env.HERMES_ADAPTER_TLS_KEY_FILE;
const tlsCertificateFile = process.env.HERMES_ADAPTER_TLS_CERT_FILE;
if (Boolean(tlsKeyFile) !== Boolean(tlsCertificateFile))
  throw new Error(
    'HERMES_ADAPTER_TLS_KEY_FILE and HERMES_ADAPTER_TLS_CERT_FILE must be configured together',
  );
const https =
  tlsKeyFile && tlsCertificateFile
    ? {
        key: await readFile(tlsKeyFile),
        cert: await readFile(tlsCertificateFile),
      }
    : undefined;
const apiToken = await optionalSecret('HERMES_API_TOKEN');
const pythonVersion = (
  await execFileAsync('python3', ['--version'], { encoding: 'utf8', timeout: 5_000 })
).stdout
  .trim()
  .replace(/^Python\s+/, '');

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const source = new HermesNativeSource({
  runner: new HermesCliRunner(process.env.HERMES_BIN ?? 'hermes', process.env.HERMES_HOME),
  ...(process.env.HERMES_API_BASE_URL ? { apiBaseUrl: process.env.HERMES_API_BASE_URL } : {}),
  ...(apiToken ? { apiToken } : {}),
});
const app = buildHermesControlAdapter({
  frameworkId: process.env.HERMES_FRAMEWORK_ID ?? 'hermes-dev',
  displayName: process.env.HERMES_DISPLAY_NAME ?? 'Hermes Agent',
  instanceId: process.env.HERMES_INSTANCE_ID ?? 'hermes-local',
  ...(bearerToken ? { bearerToken } : {}),
  ...(rotatingTokenVerifier
    ? { verifyBearerToken: (token: string) => rotatingTokenVerifier.verify(token) }
    : {}),
  ...(https ? { https } : {}),
  scopes: parseScopes(process.env.HERMES_ADAPTER_SCOPES),
  source,
  events: new PostgresAdapterEventStore(pool),
  pythonVersion,
  ...(process.env.HERMES_UPSTREAM_BASE_COMMIT
    ? { upstreamBaseCommit: process.env.HERMES_UPSTREAM_BASE_COMMIT }
    : {}),
  ...(process.env.RELEASE_ID ? { releaseId: process.env.RELEASE_ID } : {}),
});

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 28082);
await app.listen({ host, port });

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().finally(() => pool.end());
  });

async function verifyImmutableBaseline(path: string) {
  const head = (
    await execFileAsync('git', ['-C', path, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5_000,
    })
  ).stdout.trim();
  if (head !== PINNED_HERMES_COMMIT)
    throw new Error(`Hermes baseline ${head} is unsupported; expected ${PINNED_HERMES_COMMIT}`);
  await execFileAsync('git', ['-C', path, 'diff', '--quiet'], { timeout: 5_000 });
  await execFileAsync('git', ['-C', path, 'diff', '--cached', '--quiet'], { timeout: 5_000 });
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function secret(name: string) {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  const value = direct ?? (file ? (await readFile(file, 'utf8')).trim() : '');
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value;
}

async function optionalSecret(name: string) {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  return direct ?? (file ? (await readFile(file, 'utf8')).trim() : undefined);
}

function parseScopes(value: string | undefined): FrameworkScope[] {
  const allowed = new Set<FrameworkScope>([
    'control:read',
    'control:execute',
    'control:events',
    'control:secrets',
    'control:delivery',
    'control:approval',
  ]);
  const scopes = (value ?? 'control:read,control:execute,control:events')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!scopes.length || !scopes.every((scope) => allowed.has(scope as FrameworkScope)))
    throw new Error('HERMES_ADAPTER_SCOPES contains an invalid scope');
  return [...new Set(scopes)] as FrameworkScope[];
}

function parseBoundedInteger(
  supplied: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (supplied === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(supplied))
    throw new Error('HERMES_ADAPTER_TOKEN_CACHE_TTL_MS must be an integer');
  const value = Number(supplied);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error('HERMES_ADAPTER_TOKEN_CACHE_TTL_MS is outside its supported range');
  return value;
}
