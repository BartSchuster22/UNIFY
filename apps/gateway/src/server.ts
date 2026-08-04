import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { PostgresAuthStore } from './auth/postgres-store.js';
import { PostgresGovernanceStore } from './governance/postgres-store.js';
import { createDefaultAdapters } from './integrations/adapters.js';
import { IntegrationService } from './integrations/service.js';
import { PostgresNotificationStore } from './notifications/postgres-store.js';
import { CutoverPolicy } from './cutover/policy.js';
import { PostgresFrameworkRegistrationStore } from './framework-registry/postgres-store.js';
import { FrameworkRegistryService } from './framework-registry/service.js';
import { HttpFrameworkProbe } from './framework-registry/probe.js';
import { PostgresFrameworkEventJournal } from './hermes-control/event-journal.js';
import { HermesGatewayService } from './hermes-control/service.js';
async function secret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value.trim();
}
const databaseUrl = await secret('DATABASE_URL');
const authPepper = await secret('AUTH_PEPPER');
const integrationEnv = { ...process.env };
const legacyMigrationEnabled = process.env.ENABLE_LEGACY_MIGRATION_READERS === 'true';
const integrationSecrets = legacyMigrationEnabled
  ? ['DMM_USERNAME', 'DMM_PASSWORD', 'CHAT_PASSWORD', 'WORKER_TOKEN', 'MEMORY_V4_TOKEN']
  : ['WORKER_TOKEN', 'CHAT_PASSWORD', 'MEMORY_V4_TOKEN'];
for (const name of integrationSecrets) {
  const file = process.env[`${name}_FILE`];
  if (file) integrationEnv[name] = (await readFile(file, 'utf8')).trim();
}
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
const adapters = createDefaultAdapters(integrationEnv).filter(
  (adapter) => legacyMigrationEnabled || adapter.id !== 'dmm-read-v1',
);
const legacyMutationOwners = legacyMigrationEnabled
  ? (await import('./migration/legacy/owner-client.js')).MutationOwnerClient.fromEnv(integrationEnv)
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
  integrations: new IntegrationService(adapters),
  ...(legacyMutationOwners ? { mutationOwners: legacyMutationOwners } : {}),
  notificationStore: new PostgresNotificationStore(pool),
  frameworkRegistry,
  hermesGateway,
  cutoverPolicy: CutoverPolicy.fromEnv(process.env),
  requestRateLimit: Number(process.env.REQUESTS_PER_MINUTE ?? 600),
});
const configuredPollInterval = Number(process.env.HERMES_EVENT_POLL_MS ?? 5_000);
if (!Number.isFinite(configuredPollInterval) || configuredPollInterval < 1_000)
  throw new Error('HERMES_EVENT_POLL_MS must be at least 1000');
const poll = setInterval(() => void hermesGateway.ingestAll(), configuredPollInterval);
poll.unref();
app.addHook('onClose', async () => clearInterval(poll));
const close = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  await pool.end();
};
process.once('SIGTERM', () => void close('SIGTERM'));
process.once('SIGINT', () => void close('SIGINT'));
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
