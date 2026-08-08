import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const compatibleAppliedChecksums = new Map([
  [
    '006_hermes_020_baseline',
    new Map([
      [
        'b4519c95a8d07b63fc7d19ab2c4f2c89d28ecb0dbdf28b59d360dd881c62bb33',
        new Set(['6cd122ab7c73b1791b3e3c9c769fd06853aa9005835500c691f76950003e4c08']),
      ],
    ]),
  ],
]);
const direction = process.argv[2] ?? 'up';
if (!['up', 'down', 'status'].includes(direction))
  throw new Error(`Unknown direction: ${direction}`);
async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL_FILE)
    return (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error('DATABASE_URL or DATABASE_URL_FILE is required');
}
const directory = resolve(import.meta.dirname, '..', 'migrations');
const client = new Client({ connectionString: await loadDatabaseUrl() });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [74120931]);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Map(
    (
      await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    ).rows.map((row) => [row.version, row.checksum]),
  );
  const files = (await readdir(directory)).filter((name) => name.endsWith('.up.sql')).sort();
  if (direction === 'status') {
    console.log(
      JSON.stringify({
        available: files.map((file) => file.replace('.up.sql', '')),
        applied: [...applied.keys()],
      }),
    );
  } else if (direction === 'up') {
    for (const file of files) {
      const version = file.replace('.up.sql', '');
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(version)) {
        const appliedChecksum = applied.get(version);
        const compatible = compatibleAppliedChecksums
          .get(version)
          ?.get(checksum)
          ?.has(appliedChecksum);
        if (appliedChecksum !== checksum && !compatible)
          throw new Error(`Checksum mismatch for ${version}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2)', [
          version,
          checksum,
        ]);
        await client.query('COMMIT');
        console.log(`applied ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } else {
    const latest = [...applied.keys()].sort().at(-1);
    if (latest) {
      const sql = await readFile(join(directory, `${latest}.down.sql`), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE version=$1', [latest]);
        await client.query('COMMIT');
        console.log(`rolled back ${latest}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [74120931]).catch(() => undefined);
  await client.end();
}
