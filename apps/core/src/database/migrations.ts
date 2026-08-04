import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Pool, PoolClient, PoolConfig } from "pg";

const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = "unify_core_schema_migrations_v1";
const BOOTSTRAP_SQL = `
  CREATE SCHEMA IF NOT EXISTS core;
  CREATE TABLE IF NOT EXISTS core.schema_migrations (
    version integer PRIMARY KEY CHECK (version > 0),
    name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9_]+$'),
    checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface MigrationResult {
  readonly discovered: number;
  readonly previouslyApplied: number;
  readonly applied: readonly number[];
}

export function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL("../../migrations/", import.meta.url));
}

export async function loadMigrations(directory = defaultMigrationsDirectory()): Promise<readonly Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"));
  const invalid = sqlFiles.filter((entry) => !MIGRATION_FILE.test(entry.name));
  if (invalid.length > 0) throw new Error(`Invalid migration filename: ${invalid.map((entry) => entry.name).join(", ")}`);

  const migrations = await Promise.all(
    sqlFiles.map(async (entry): Promise<Migration> => {
      const match = MIGRATION_FILE.exec(entry.name)!;
      const sql = await readFile(join(directory, entry.name), "utf8");
      return {
        version: Number(match[1]),
        name: match[2]!,
        filename: entry.name,
        checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
        sql,
      };
    }),
  );
  migrations.sort((left, right) => left.version - right.version);
  for (const [index, migration] of migrations.entries()) {
    const expected = index + 1;
    if (migration.version !== expected) throw new Error(`Migration sequence must be contiguous: expected ${expected}, found ${migration.version}`);
  }
  return migrations;
}

async function withMigrationLock<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
  try {
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
  }
}

export async function migrateDatabase(pool: Pool, directory = defaultMigrationsDirectory()): Promise<MigrationResult> {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  try {
    await client.query(BOOTSTRAP_SQL);
    return await withMigrationLock(client, async () => {
      const result = await client.query<{ version: number; name: string; checksum: string }>(
        "SELECT version, name, checksum FROM core.schema_migrations ORDER BY version",
      );
      const discoveredByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
      for (const applied of result.rows) {
        const expected = discoveredByVersion.get(applied.version);
        if (!expected) throw new Error(`Database contains unknown migration version ${applied.version}`);
        if (expected.name !== applied.name) throw new Error(`Migration ${applied.version} name mismatch`);
        if (expected.checksum !== applied.checksum.trim()) throw new Error(`Migration ${applied.version} checksum mismatch`);
      }

      const appliedVersions = new Set(result.rows.map((row) => row.version));
      const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
      const newlyApplied: number[] = [];
      for (const migration of pending) {
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO core.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
            [migration.version, migration.name, migration.checksum],
          );
          await client.query("COMMIT");
          newlyApplied.push(migration.version);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      return { discovered: migrations.length, previouslyApplied: result.rows.length, applied: newlyApplied };
    });
  } finally {
    client.release();
  }
}

export async function verifyDatabase(pool: Pool, directory = defaultMigrationsDirectory()): Promise<void> {
  const expected = await loadMigrations(directory);
  const result = await pool.query<{ version: number; name: string; checksum: string }>(
    "SELECT version, name, checksum FROM core.schema_migrations ORDER BY version",
  );
  if (result.rows.length !== expected.length) throw new Error(`Expected ${expected.length} applied migrations, found ${result.rows.length}`);
  for (const [index, migration] of expected.entries()) {
    const applied = result.rows[index]!;
    if (applied.version !== migration.version || applied.name !== migration.name || applied.checksum.trim() !== migration.checksum) {
      throw new Error(`Applied migration ${migration.version} does not match source`);
    }
  }

  const requiredTables = [
    "identities",
    "authorization_bindings",
    "frameworks",
    "providers",
    "models",
    "operations",
    "events",
    "event_consumers",
    "notifications",
    "audit_records",
  ];
  const tables = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' AND table_name = ANY($1::text[])",
    [requiredTables],
  );
  if (tables.rows.length !== requiredTables.length) throw new Error("Core database is missing required tables");
  const audit = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM core.verify_audit_chain()");
  if (audit.rows[0]?.count !== "0") throw new Error("Audit chain verification failed");
}

export function poolConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): PoolConfig {
  const connectionString = environment.CORE_DATABASE_URL ?? environment.DATABASE_URL;
  if (!connectionString) throw new Error("CORE_DATABASE_URL is required");
  const sslMode = environment.CORE_DATABASE_SSL ?? "require";
  if (!new Set(["disable", "require"]).has(sslMode)) throw new Error("CORE_DATABASE_SSL must be disable or require");
  const poolSize = Number(environment.CORE_DATABASE_POOL_SIZE ?? "10");
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 50) throw new Error("CORE_DATABASE_POOL_SIZE must be an integer from 1 to 50");
  return {
    connectionString,
    max: poolSize,
    ssl: sslMode === "require" ? { rejectUnauthorized: true } : false,
    application_name: "unify-core-migrations",
  };
}
