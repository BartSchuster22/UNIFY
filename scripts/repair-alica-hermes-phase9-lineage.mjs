#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.UNIFY_DB_CONTAINER ?? 'unify-postgres-1';
const expectedCatalog = '25fd0cdc88d46ce2ccac8b0ac95f77328c02a29e08e8cf1d9226abcd8788fe28|125';
const migrations = [
  [
    19,
    'alica_hermes_phase9_capability_families',
    '9dc2875183ad61a108dc877b0d6b64d23ab9a5c07df00f438e08434f4c85d5cb',
  ],
  [
    20,
    'alica_hermes_phase9_immutable_journal_recovery',
    '459539c72ef770db6a8cfcc4d6736c9e07ba02d57265441dd82124207364ac5d',
  ],
  [
    21,
    'alica_hermes_phase9_operation_timestamp_recovery',
    '2953807a0bc37b753cedf2db26c2818a3cef5bbb7c40b268972faf4c9d5ffcab',
  ],
];

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', input });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
}
function psql(sql) {
  return run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'unify',
      '-d',
      'unify',
      '-v',
      'ON_ERROR_STOP=1',
      '-X',
      '-At',
      '-F',
      '|',
    ],
    sql,
  );
}

for (const [version, name, expected] of migrations) {
  const path = join(
    root,
    'apps/core/migrations',
    `${String(version).padStart(3, '0')}_${name}.sql`,
  );
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(actual, expected, `migration ${version} source checksum mismatch`);
}

const before = psql(
  "SELECT string_agg(version::text,',' ORDER BY version) FROM core.schema_migrations;",
);
assert.equal(
  before,
  Array.from({ length: 18 }, (_, index) => index + 1).join(','),
  'lineage is not exactly 1-18',
);

const catalog = psql(`WITH pieces AS (
 SELECT 'column' k,table_name||'|'||ordinal_position||'|'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'') v FROM information_schema.columns WHERE table_schema='core' AND table_name LIKE 'framework_capability_canary_%'
 UNION ALL SELECT 'constraint',c.relname||'|'||con.conname||'|'||pg_get_constraintdef(con.oid,true) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname LIKE 'framework_capability_canary_%'
 UNION ALL SELECT 'trigger',c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid,true) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname LIKE 'framework_capability_canary_%' AND NOT t.tgisinternal
 UNION ALL SELECT 'function',p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname LIKE '%phase9%'
) SELECT encode(digest(string_agg(k||'|'||v,E'\\n' ORDER BY k,v),'sha256'),'hex'),count(*) FROM pieces;`);
assert.equal(
  catalog,
  expectedCatalog,
  'live Phase 9 catalog does not equal source-derived reference',
);

const values = migrations
  .map(([version, name, checksum]) => `(${version},'${name}','${checksum}')`)
  .join(',');
psql(`BEGIN;
SELECT pg_advisory_xact_lock(hashtext('unify_core_schema_migrations_v1'));
DO $$ BEGIN
  IF (SELECT string_agg(version::text,',' ORDER BY version) FROM core.schema_migrations) <> '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18' THEN
    RAISE EXCEPTION 'P10_LINEAGE_CHANGED';
  END IF;
END $$;
INSERT INTO core.schema_migrations(version,name,checksum) VALUES ${values};
COMMIT;`);

const after = psql(
  "SELECT string_agg(version::text||':'||name||':'||trim(checksum),',' ORDER BY version) FROM core.schema_migrations WHERE version>=19;",
);
assert.equal(
  after,
  migrations.map(([version, name, checksum]) => `${version}:${name}:${checksum}`).join(','),
);
console.log(
  JSON.stringify({
    ok: true,
    before,
    repaired: [19, 20, 21],
    catalogDigest: catalog.split('|')[0],
    catalogElements: 125,
  }),
);
