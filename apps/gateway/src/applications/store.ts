import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { AuthError } from '../auth/service.js';
import { canonicalHash } from '../governance/canonical.js';
import {
  parseManifest,
  parseRequest,
  type ApplicationManifest,
  type ApplicationRequest,
} from './contract.js';
export interface Registration {
  credential_id?: string;
  native_binding?: Record<string,string>;
  id: string;
  owner_id: string;
  manifest: ApplicationManifest;
  callback_secret_ciphertext: string | null;
  revoked_at: Date | null;
}
export interface Receipt {
  id: string;
  application_id: string;
  payload: ApplicationRequest | null;
  phase: string;
  native_reference: Record<string, unknown> | null;
  result: unknown;
  error_code: string | null;
  expires_at: Date;
}
export class ApplicationStore {
  constructor(readonly pool: Pool) {}
  async register(
    ownerId: string,
    input: unknown,
    callbackSecretCiphertext: string | null,
    id = randomUUID(),
    nativeBinding: Record<string,string> = {},
  ) {
    const manifest = parseManifest(input);
    const r = await this.pool.query<Registration>(
      'INSERT INTO application_integrations(id,owner_id,manifest,callback_secret_ciphertext,native_binding) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [id, ownerId, manifest, callbackSecretCiphertext,nativeBinding],
    );
    return r.rows[0]!;
  }
  async credential(appId: string, ttlSeconds = 3600) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400)
      throw new AuthError('APPLICATION_CREDENTIAL_INVALID', 422, 'TTL must be 60..86400 seconds');
    const token = 'dsha1_' + randomBytes(32).toString('base64url');
    const id = randomUUID();
    const r = await this.pool.query(
      "INSERT INTO application_credentials(id,application_id,token_hash,expires_at) SELECT $1,id,$3,now()+($4 * interval '1 second') FROM application_integrations WHERE id=$2 AND revoked_at IS NULL RETURNING id,expires_at",
      [id, appId, digest(token), ttlSeconds],
    );
    if (!r.rowCount)
      throw new AuthError('APPLICATION_NOT_FOUND', 404, 'Active application not found');
    return { id, token, expiresAt: r.rows[0].expires_at };
  }
  async authorize(header: unknown): Promise<Registration> {
    if (typeof header !== 'string' || !/^Bearer dsha1_[A-Za-z0-9_-]{43}$/.test(header))
      throw new AuthError('APPLICATION_AUTH_REQUIRED', 401, 'Application credential required');
    const r = await this.pool.query<Registration>(
      'SELECT a.*,c.id AS credential_id FROM application_integrations a JOIN application_credentials c ON c.application_id=a.id WHERE c.token_hash=$1 AND c.revoked_at IS NULL AND c.expires_at>now() AND a.revoked_at IS NULL',
      [digest(header.slice(7))],
    );
    if (!r.rows[0])
      throw new AuthError('APPLICATION_AUTH_REQUIRED', 401, 'Application credential required');
    return r.rows[0];
  }
  async revokeCredential(appId: string, id: string) {
    return (
      (
        await this.pool.query(
          'UPDATE application_credentials SET revoked_at=now() WHERE application_id=$1 AND id=$2 AND revoked_at IS NULL',
          [appId, id],
        )
      ).rowCount === 1
    );
  }
  async accept(app: Registration, key: unknown, value: unknown, admissionGuard?: () => Promise<boolean>) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,200}$/.test(key))
      throw new AuthError('APPLICATION_IDEMPOTENCY_REQUIRED', 428, 'Idempotency-Key is required');
    const payload = parseRequest(value, app.manifest);
    const hash = canonicalHash(payload);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Revocation and admission serialize on the registration row.
      const active = await client.query(
        'SELECT id FROM application_integrations WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',
        [app.id],
      );
      if (!active.rowCount)
        throw new AuthError('APPLICATION_AUTH_REQUIRED', 401, 'Application revoked');
      const credential = await client.query(
        'SELECT id FROM application_credentials WHERE id=$1 AND application_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',
        [app.credential_id, app.id],
      );
      if (!credential.rowCount)
        throw new AuthError('APPLICATION_AUTH_REQUIRED', 401, 'Credential is no longer active');
      const priorKey = await client.query<Receipt & {payload_hash:string}>(
        'SELECT * FROM application_receipts WHERE application_id=$1 AND idempotency_key=$2',[app.id,key]);
      if (priorKey.rows[0]) {
        if (priorKey.rows[0].payload_hash !== hash)
          throw new AuthError('APPLICATION_IDEMPOTENCY_CONFLICT',409,'Key already identifies another payload');
        // A durable replay is a read: source deletion, target correction and native
        // downtime cannot turn it into a new admission or cause paid execution.
        await client.query('COMMIT');
        return {receipt:priorKey.rows[0],replayed:true};
      }
      {
        const budget = await client.query<{active:string;recent:string}>(`SELECT count(*) FILTER (WHERE phase IN ('accepted','dispatch-unknown','native-linked','cancel-requested')) AS active,count(*) FILTER (WHERE created_at>now()-interval '1 hour') AS recent FROM application_receipts WHERE application_id=$1`,[app.id]);
        if(Number(budget.rows[0]!.active)>=8 || Number(budget.rows[0]!.recent)>=60) throw new AuthError('APPLICATION_ADMISSION_LIMIT',429,'Bounded application request budget exhausted');
      }
      if (payload.corrects) {
        const prior = await client.query(
          "SELECT id FROM application_receipts WHERE id=$1 AND application_id=$2 AND payload->>'subject'=$3 AND phase='result-ready'",
          [payload.corrects, app.id, payload.subject],
        );
        if (!prior.rowCount)
          throw new AuthError(
            'APPLICATION_CORRECTION_DENIED',
            403,
            'Correction target is outside the subject scope',
          );
      }
      if (admissionGuard && !(await admissionGuard()))
        throw new AuthError('APPLICATION_NATIVE_UNAVAILABLE',503,'Required bounded native operation is unavailable');
      const r = await client.query<Receipt>(
        `INSERT INTO application_receipts(id,application_id,idempotency_key,payload_hash,payload,phase,expires_at) VALUES($1,$2,$3,$4,$5,'accepted',now()+($6 * interval '1 day')) ON CONFLICT(application_id,idempotency_key) DO NOTHING RETURNING *`,
        [randomUUID(), app.id, key, hash, payload, app.manifest.retentionDays],
      );
      const prior =
        r.rows[0] ??
        (
          await client.query<Receipt & { payload_hash: string }>(
            'SELECT * FROM application_receipts WHERE application_id=$1 AND idempotency_key=$2',
            [app.id, key],
          )
        ).rows[0]!;
      if (!r.rowCount && (prior as Receipt & { payload_hash: string }).payload_hash !== hash)
        throw new AuthError(
          'APPLICATION_IDEMPOTENCY_CONFLICT',
          409,
          'Key already identifies another payload',
        );
      await client.query('COMMIT');
      return { receipt: prior, replayed: !r.rowCount };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async get(appId: string, id: string) {
    const r = await this.pool.query<Receipt>(
      'SELECT * FROM application_receipts WHERE application_id=$1 AND id=$2',
      [appId, id],
    );
    if (!r.rows[0]) throw new AuthError('APPLICATION_RECEIPT_NOT_FOUND', 404, 'Receipt not found');
    return r.rows[0];
  }
  async claimDispatch() {
    // Unknown is durable BEFORE calling Hermes. A crash must never restore accepted.
    const r = await this.pool.query<Receipt>(
      `UPDATE application_receipts SET phase='dispatch-unknown',updated_at=now() WHERE id=(SELECT r.id FROM application_receipts r JOIN application_integrations a ON a.id=r.application_id WHERE r.phase='accepted' AND r.expires_at>now() AND a.revoked_at IS NULL ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1) RETURNING *`,
    );
    return r.rows[0] ?? null;
  }
  async link(id: string, reference: Record<string, unknown>) {
    return (
      (
        await this.pool.query(
          "UPDATE application_receipts SET phase='native-linked',native_reference=$2,updated_at=now() WHERE id=$1 AND phase='dispatch-unknown'",
          [id, reference],
        )
      ).rowCount === 1
    );
  }
  async cancel(appId: string, id: string) {
    await this.get(appId, id);
    await this.pool.query(
      "UPDATE application_receipts SET phase=CASE WHEN phase='accepted' THEN 'cancelled' ELSE 'cancel-requested' END,updated_at=now() WHERE application_id=$1 AND id=$2 AND phase IN ('accepted','dispatch-unknown','native-linked')",
      [appId, id],
    );
    return this.get(appId, id);
  }
  async complete(id: string, result: unknown) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<Receipt>(
        "UPDATE application_receipts SET phase='result-ready',result=$2,updated_at=now() WHERE id=$1 AND phase='native-linked' RETURNING *",
        [id, result],
      );
      if (r.rows[0])
        await client.query(
          "INSERT INTO application_outbox(id,receipt_id,application_id,state) SELECT $1,$2,a.id,'pending' FROM application_integrations a WHERE a.id=$3 AND a.manifest->>'callbackUrl' IS NOT NULL AND a.revoked_at IS NULL ON CONFLICT(receipt_id) DO NOTHING",
          [randomUUID(), id, r.rows[0].application_id],
        );
      await client.query('COMMIT');
      return Boolean(r.rowCount);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
