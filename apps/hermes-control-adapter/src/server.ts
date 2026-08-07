import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import {
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkScope,
} from '@aquiero/contracts';
import { buildHermesControlAdapter } from './app.js';
import { PostgresAdapterEventStore } from './event-store.js';
import { HermesCliRunner, HermesNativeSource } from './source.js';
import { startPrivateHermesManagement } from './management-process.js';
import { FileRotatingBearerTokenVerifier } from './token-credentials.js';

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const repo = required('HERMES_REPO');
const hermesBin = process.env.HERMES_BIN ?? 'hermes';
await verifyImmutableBaseline(repo, hermesBin);
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
const managementBaseUrl = process.env.HERMES_MANAGEMENT_BASE_URL;
const managementAutostart = process.env.HERMES_MANAGEMENT_AUTOSTART === 'true';
const managementToken = managementBaseUrl
  ? managementAutostart
    ? randomBytes(32).toString('base64url')
    : await optionalSecret('HERMES_MANAGEMENT_SESSION_TOKEN')
  : undefined;
const managementProcess =
  managementAutostart && managementBaseUrl && managementToken
    ? await startPrivateHermesManagement(
        hermesBin,
        managementBaseUrl,
        managementToken,
        process.env.HERMES_HOME,
      )
    : undefined;
const pythonVersion = (
  await execFileAsync('python3', ['--version'], { encoding: 'utf8', timeout: 5_000 })
).stdout
  .trim()
  .replace(/^Python\s+/, '');

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const source = new HermesNativeSource({
  runner: new HermesCliRunner(hermesBin, process.env.HERMES_HOME),
  ...(process.env.HERMES_API_BASE_URL ? { apiBaseUrl: process.env.HERMES_API_BASE_URL } : {}),
  ...(apiToken ? { apiToken } : {}),
  ...(managementBaseUrl ? { managementBaseUrl } : {}),
  ...(managementToken ? { managementToken } : {}),
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
    managementProcess?.kill('SIGTERM');
    void app.close().finally(() => pool.end());
  });

async function verifyImmutableBaseline(path: string, binary: string) {
  try {
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
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('not a git repository') && !message.includes('unknown revision'))
      throw error;
  }

  const version = (await execFileAsync(binary, ['version'], { encoding: 'utf8', timeout: 5_000 }))
    .stdout;
  const release = /Hermes Agent v([^\s]+)/u.exec(version)?.[1];
  const commit = /upstream\s+([0-9a-f]{8,40})/u.exec(version)?.[1];
  const carriedCommit = /local\s+([0-9a-f]{8,40})/u.exec(version)?.[1];
  const immutableDockerBuild = commit === '413ed6b9' && carriedCommit === '9e54eee4';
  if (
    release !== PINNED_HERMES_RELEASE ||
    (!immutableDockerBuild && (!commit || !PINNED_HERMES_COMMIT.startsWith(commit)))
  )
    throw new Error('Installed Hermes release does not match the immutable supported baseline');
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
