import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from '../auth/crypto.js';

async function requiredSecret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value.trim();
}

const databaseUrl = await requiredSecret('DATABASE_URL');
const pepper = await requiredSecret('AUTH_PEPPER');
const password = await requiredSecret('BOOTSTRAP_ADMIN_PASSWORD');
const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin').trim();
const displayName = (process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME ?? 'Administrator').trim();
if (password.length < 16) throw new Error('Bootstrap password must contain at least 16 characters');
if (!username) throw new Error('Bootstrap username is required');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [74120932]);
  const count = Number(
    (await client.query('SELECT count(*) count FROM users')).rows[0]?.count ?? 0,
  );
  if (count > 0) {
    await client.query('ROLLBACK');
    console.log('Bootstrap skipped: named users already exist');
    process.exitCode = 0;
  } else {
    const passwordHash = await hashPassword(password, pepper);
    const created = await client.query(
      `INSERT INTO users(username,display_name,password_hash)
     VALUES($1,$2,$3) RETURNING id`,
      [username, displayName, passwordHash],
    );
    await client.query(
      `INSERT INTO user_roles(user_id,role_id)
     SELECT $1,id FROM roles WHERE name='Administrator'`,
      [created.rows[0].id],
    );
    await client.query('COMMIT');
    console.log(`Bootstrapped named administrator: ${username}`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
