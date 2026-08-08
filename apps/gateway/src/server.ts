import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { PostgresAuthStore } from './auth/postgres-store.js';
import { PostgresGovernanceStore } from './governance/postgres-store.js';
import { PostgresNotificationStore } from './notifications/postgres-store.js';
import { PostgresFrameworkRegistrationStore } from './framework-registry/postgres-store.js';
import { FrameworkRegistryService } from './framework-registry/service.js';
import { HttpFrameworkProbe } from './framework-registry/probe.js';
import { PostgresFrameworkEventJournal } from './hermes-control/event-journal.js';
import { HermesGatewayService } from './hermes-control/service.js';
import { MemoryV4Adapter } from './memory-v4/client.js';
async function secret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value.trim();
}
const databaseUrl = await secret('DATABASE_URL');
const authPepper = await secret('AUTH_PEPPER');

for (const name of (process.env.FRAMEWORK_AUTH_ENV_NAMES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)) {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(name))
    throw new Error('FRAMEWORK_AUTH_ENV_NAMES contains an invalid environment name');
  const file = process.env[`${name}_FILE`];
  if (file) process.env[name] = (await readFile(file, 'utf8')).trim();
}
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
});
const frameworkRegistry = new FrameworkRegistryService(
  new PostgresFrameworkRegistrationStore(pool),
  new HttpFrameworkProbe(),
);
const hermesGateway = new HermesGatewayService(
  frameworkRegistry,
  new PostgresFrameworkEventJournal(pool),
);
const memoryV4Url = process.env.MEMORY_V4_URL?.trim();
const memoryV4ScopePath = process.env.MEMORY_V4_SCOPE_PATH?.trim();
if (memoryV4Url && !memoryV4ScopePath)
  throw new Error('MEMORY_V4_SCOPE_PATH is required when MEMORY_V4_URL is configured');
if (!memoryV4Url && memoryV4ScopePath)
  throw new Error('MEMORY_V4_URL is required when MEMORY_V4_SCOPE_PATH is configured');
const memoryV4Adapter = memoryV4Url
  ? new MemoryV4Adapter({
      baseUrl: memoryV4Url,
      bearerToken: await secret('MEMORY_V4_TOKEN'),
      scopePath: memoryV4ScopePath!,
      timeoutMs: Number(process.env.MEMORY_V4_TIMEOUT_MS ?? 8_000),
      maxResponseBytes: Number(process.env.MEMORY_V4_MAX_RESPONSE_BYTES ?? 16 * 1024 * 1024),
      retries: Number(process.env.MEMORY_V4_RETRIES ?? 1),
    })
  : undefined;
const app = buildApp({
  authStore: new PostgresAuthStore(pool),
  governanceStore: new PostgresGovernanceStore(pool),
  authPepper,
  secureCookies: process.env.NODE_ENV === 'production',
  release: process.env.RELEASE_ID ?? 'development',
  logger: true,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  notificationStore: new PostgresNotificationStore(pool),
  frameworkRegistry,
  hermesGateway,
  ...(memoryV4Adapter ? { memoryV4Adapter } : {}),

  requestRateLimit: Number(process.env.REQUESTS_PER_MINUTE ?? 600),
});
const configuredPollInterval = Number(process.env.HERMES_EVENT_POLL_MS ?? 5_000);
if (!Number.isFinite(configuredPollInterval) || configuredPollInterval < 1_000)
  throw new Error('HERMES_EVENT_POLL_MS must be at least 1000');
const poll = setInterval(() => void hermesGateway.ingestAll(), configuredPollInterval);
poll.unref();
app.addHook('onClose', async () => clearInterval(poll));
let shutdown: Promise<void> | undefined;
const close = (signal: NodeJS.Signals): Promise<void> => {
  if (shutdown) return shutdown;
  clearInterval(poll);
  app.log.info({ signal }, 'graceful shutdown started');
  shutdown = (async () => {
    await app.close();
    await pool.end();
    app.log.info({ signal }, 'graceful shutdown complete');
  })();
  return shutdown;
};
const onSignal = (signal: NodeJS.Signals) => {
  void close(signal).catch((error: unknown) => {
    app.log.error({ error, signal }, 'graceful shutdown failed');
    process.exitCode = 1;
  });
};
process.once('SIGTERM', () => onSignal('SIGTERM'));
process.once('SIGINT', () => onSignal('SIGINT'));
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
