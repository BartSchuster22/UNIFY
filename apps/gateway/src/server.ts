import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { PostgresAuthStore } from './auth/postgres-store.js';
import { PostgresGovernanceStore } from './governance/postgres-store.js';
import { createDefaultAdapters } from './integrations/adapters.js';
import { IntegrationService } from './integrations/service.js';
import { MutationOwnerClient } from './mutations/owner-client.js';
import { PostgresNotificationStore } from './notifications/postgres-store.js';
import { CutoverPolicy } from './cutover/policy.js';
async function secret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value.trim();
}
const databaseUrl = await secret('DATABASE_URL');
const authPepper = await secret('AUTH_PEPPER');
const integrationEnv = { ...process.env };
for (const name of [
  'AGENCY_USERNAME',
  'AGENCY_PASSWORD',
  'DMM_USERNAME',
  'DMM_PASSWORD',
  'CHAT_PASSWORD',
  'WORKER_TOKEN',
  'MEMORY_V4_TOKEN',
]) {
  const file = process.env[`${name}_FILE`];
  if (file) integrationEnv[name] = (await readFile(file, 'utf8')).trim();
}
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
});
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
  integrations: new IntegrationService(createDefaultAdapters(integrationEnv)),
  mutationOwners: MutationOwnerClient.fromEnv(integrationEnv),
  notificationStore: new PostgresNotificationStore(pool),
  cutoverPolicy: CutoverPolicy.fromEnv(process.env),
  requestRateLimit: Number(process.env.REQUESTS_PER_MINUTE ?? 600),
});
const close = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  await pool.end();
};
process.once('SIGTERM', () => void close('SIGTERM'));
process.once('SIGINT', () => void close('SIGINT'));
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
