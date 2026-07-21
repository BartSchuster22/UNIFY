import type { Pool } from 'pg';
import type { FrameworkRegistrationRecord, FrameworkRegistrationStore } from './types.js';

function map(row: Record<string, unknown>): FrameworkRegistrationRecord {
  const record: FrameworkRegistrationRecord = {
    frameworkId: String(row.id),
    displayName: String(row.display_name),
    baseUrl: String(row.base_url),
    serviceAuthReference: String(row.secret_reference),
    serviceAuthConfigured: Boolean(row.secret_reference),
    scopes: row.scopes as FrameworkRegistrationRecord['scopes'],
    contractVersion: row.contract_version as FrameworkRegistrationRecord['contractVersion'],
    frameworkVersion: row.framework_version as FrameworkRegistrationRecord['frameworkVersion'],
    frameworkCommit: row.framework_commit as FrameworkRegistrationRecord['frameworkCommit'],
    status: row.status as FrameworkRegistrationRecord['status'],
    enabled: Boolean(row.enabled),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
  if (row.verified_at) record.verifiedAt = (row.verified_at as Date).toISOString();
  return record;
}

export class PostgresFrameworkRegistrationStore implements FrameworkRegistrationStore {
  constructor(private readonly pool: Pool) {}
  async ready() {
    try {
      await this.pool.query('SELECT 1 FROM framework_registrations LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }
  async list() {
    const result = await this.pool.query(
      "SELECT * FROM framework_registrations WHERE adapter_id='hermes-control/v1' ORDER BY id",
    );
    return result.rows.map(map);
  }
  async get(frameworkId: string) {
    const result = await this.pool.query(
      "SELECT * FROM framework_registrations WHERE id=$1 AND adapter_id='hermes-control/v1'",
      [frameworkId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async upsert(input: FrameworkRegistrationRecord) {
    const result = await this.pool.query(
      `INSERT INTO framework_registrations(
         id,display_name,adapter_id,base_url,secret_reference,enabled,scopes,
         contract_version,framework_version,framework_commit,status,verified_at,created_at,updated_at
       ) VALUES($1,$2,'hermes-control/v1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(id) DO UPDATE SET
         display_name=excluded.display_name,adapter_id=excluded.adapter_id,base_url=excluded.base_url,
         secret_reference=excluded.secret_reference,enabled=excluded.enabled,scopes=excluded.scopes,
         contract_version=excluded.contract_version,framework_version=excluded.framework_version,
         framework_commit=excluded.framework_commit,status=excluded.status,verified_at=excluded.verified_at,
         updated_at=excluded.updated_at
       RETURNING *`,
      [
        input.frameworkId,
        input.displayName,
        input.baseUrl,
        input.serviceAuthReference,
        input.enabled,
        input.scopes,
        input.contractVersion,
        input.frameworkVersion,
        input.frameworkCommit,
        input.status,
        input.verifiedAt ?? null,
        input.createdAt,
        input.updatedAt,
      ],
    );
    return map(result.rows[0]);
  }
  async remove(frameworkId: string) {
    const result = await this.pool.query(
      "DELETE FROM framework_registrations WHERE id=$1 AND adapter_id='hermes-control/v1'",
      [frameworkId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
