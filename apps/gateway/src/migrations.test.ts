import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../migrations/001_gateway_foundation.up.sql'),
  'utf8',
);
describe('gateway foundation migration', () => {
  it.each([
    'users',
    'sessions',
    'roles',
    'permissions',
    'operations',
    'idempotency_records',
    'audit_events',
    'evidence_references',
    'resource_mappings',
  ])('owns required table %s', (table) => {
    expect(migration).toContain(`CREATE TABLE ${table} (`);
  });
  it('does not create downstream inventory tables', () => {
    expect(migration).not.toMatch(/CREATE TABLE (models|messages|memory_records|kanban_cards) \(/);
  });
  it('constrains operation payload hashes and idempotency scope', () => {
    expect(migration).toContain("payload_hash ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain('PRIMARY KEY (actor_id, operation_class, idempotency_key)');
  });
});
