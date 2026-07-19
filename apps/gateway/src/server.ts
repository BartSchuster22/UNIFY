import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { PostgresAuthStore } from './auth/postgres-store.js';
import { PostgresGovernanceStore } from './governance/postgres-store.js';
async function secret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value.trim();
}
const databaseUrl = await secret('DATABASE_URL');
const authPepper = await secret('AUTH_PEPPER');
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
});
const close = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  await pool.end();
};
process.once('SIGTERM', () => void close('SIGTERM'));
process.once('SIGINT', () => void close('SIGINT'));
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
