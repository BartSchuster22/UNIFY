import { readFile } from 'node:fs/promises';
import pg from 'pg';

const declarations = [
  { name: 'unify_alica_adapter', secret: 'ALICA_DATABASE_URL' },
  { name: 'unify_herman_adapter', secret: 'HERMAN_DATABASE_URL' },
] as const;
const adminDatabaseUrl = await requiredSecret('DATABASE_URL');
const adminUrl = new URL(adminDatabaseUrl);
const client = new pg.Client({ connectionString: adminDatabaseUrl });
await client.connect();
const results: Array<{ role: string; changed: boolean }> = [];
try {
  for (const declaration of declarations) {
    const connectionString = await requiredSecret(declaration.secret);
    const roleUrl = new URL(connectionString);
    validateRoleUrl(roleUrl, adminUrl, declaration.name);
    const result = await client.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolinherit: boolean;
      runtime_member: boolean;
    }>(
      `SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
              r.rolreplication, r.rolinherit,
              pg_has_role(r.oid, 'unify_hermes_adapter_runtime', 'member') AS runtime_member
         FROM pg_roles r WHERE r.rolname=$1`,
      [declaration.name],
    );
    const role = result.rows[0];
    if (!role) throw new Error(`Database migration did not create role ${declaration.name}`);
    if (
      role.rolsuper ||
      role.rolcreatedb ||
      role.rolcreaterole ||
      role.rolreplication ||
      !role.rolinherit ||
      !role.runtime_member
    )
      throw new Error(`Database role ${declaration.name} violates the least-privilege contract`);

    let changed = false;
    if (!role.rolcanlogin) {
      const quoted = await client.query<{ value: string }>('SELECT quote_literal($1) AS value', [
        decodeURIComponent(roleUrl.password),
      ]);
      await client.query(`ALTER ROLE ${declaration.name} LOGIN PASSWORD ${quoted.rows[0]?.value}`);
      changed = true;
    }
    await verifyRoleConnection(connectionString, declaration.name);
    results.push({ role: declaration.name, changed });
  }
  console.log(
    JSON.stringify({
      schemaVersion: 'unify-database-roles/v1',
      changed: results.filter((result) => result.changed).length,
      roles: results,
    }),
  );
} finally {
  await client.end();
}

async function requiredSecret(name: string) {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  const value = direct ?? (file ? (await readFile(file, 'utf8')).trim() : '');
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value;
}

function validateRoleUrl(roleUrl: URL, adminUrl: URL, expectedRole: string) {
  if (roleUrl.protocol !== 'postgres:' && roleUrl.protocol !== 'postgresql:')
    throw new Error(`${expectedRole} database URL must use PostgreSQL`);
  if (decodeURIComponent(roleUrl.username) !== expectedRole)
    throw new Error(`${expectedRole} database URL has an unexpected username`);
  if (!roleUrl.password) throw new Error(`${expectedRole} database URL must contain a password`);
  if (
    roleUrl.hostname !== adminUrl.hostname ||
    roleUrl.port !== adminUrl.port ||
    roleUrl.pathname !== adminUrl.pathname
  )
    throw new Error(`${expectedRole} database URL must target the Core database`);
}

async function verifyRoleConnection(connectionString: string, expectedRole: string) {
  const roleClient = new pg.Client({ connectionString });
  try {
    await roleClient.connect();
    const result = await roleClient.query<{ current_user: string }>('SELECT current_user');
    if (result.rows[0]?.current_user !== expectedRole)
      throw new Error(`${expectedRole} connection resolved to an unexpected role`);
    await roleClient.query('SELECT 1 FROM hermes_adapter_events LIMIT 1');
    await roleClient.query('SELECT 1 FROM hermes_adapter_idempotency LIMIT 1');
    await roleClient.query('SELECT 1 FROM hermes_adapter_audit LIMIT 1');
    try {
      await roleClient.query('SELECT 1 FROM framework_registrations LIMIT 1');
      throw new Error(`${expectedRole} can read Core framework registrations`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('can read Core')) throw error;
      const code = (error as { code?: string }).code;
      if (code !== '42501') throw error;
    }
  } finally {
    await roleClient.end().catch(() => undefined);
  }
}
