import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthError } from '../auth/service.js';
import { ApplicationStore, type Registration, type Receipt } from './store.js';
import { parseManifest, type ApplicationManifest } from './contract.js';
import { boundedHttps, destination, deliverySignature, type CallbackPins } from './transport.js';
export type NativeObservation = {
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  reference: Record<string, unknown>;
  result?: unknown;
};
export interface ApplicationNativeBackend {
  bind(manifest:ApplicationManifest):Promise<Record<string,string>>;
  available(app: Registration): Promise<boolean>;
  submit(app: Registration, receipt: Receipt): Promise<NativeObservation>;
  lookup(app: Registration, receipt: Receipt): Promise<NativeObservation | null>;
  cancel(app: Registration, receipt: Receipt): Promise<NativeObservation | null>;
  // Finalization uses MemoryV4 idempotency and validated promotion policy; not inference.
  finalize(app: Registration, receipt: Receipt, result: unknown): Promise<unknown>;
  erase(app: Registration, receipt: Receipt): Promise<boolean>;
}
export class ApplicationService {
  private readonly key: Buffer;
  constructor(
    readonly store: ApplicationStore,
    readonly native: ApplicationNativeBackend,
    pepper: string,
    private readonly callbackPins: CallbackPins = {},
  ) {
    if (pepper.length < 32)
      throw new Error('Application encryption requires an existing strong Core secret');
    this.key = createHash('sha256')
      .update('alica-application-callback/v1\0' + pepper)
      .digest();
  }
  async register(
    ownerId: string,
    value: unknown,
    projectExists: (framework: string, project: string) => Promise<boolean>,
  ) {
    const manifest = parseManifest(value);
    if (!(await projectExists(manifest.frameworkId, manifest.projectId)))
      throw new AuthError('APPLICATION_PROJECT_NOT_FOUND', 404, 'Native project not found');
    for (const url of manifest.sourceUrls) await destination(url);
    if(manifest.callbackUrl) await destination(manifest.callbackUrl,undefined,this.callbackPins);
    const id = randomUUID();
    const signingSecret = manifest.callbackUrl ? randomBytes(32).toString('base64url') : null;
    const app = await this.store.register(
      ownerId,
      manifest,
      signingSecret ? this.encrypt(signingSecret, id) : null,
      id,
      await this.native.bind(manifest),
    );
    return {
      applicationId: app.id,
      manifest,
      credential: await this.store.credential(app.id),
      ...(signingSecret ? { callbackSigningSecret: signingSecret } : {}),
    };
  }
  async accept(app: Registration, key: unknown, payload: unknown) {
    return this.store.accept(app, key, payload, () => this.native.available(app));
  }
  async registration(id: string) {
    const r = await this.store.pool.query<Registration>(
      'SELECT * FROM application_integrations WHERE id=$1',
      [id],
    );
    if (!r.rows[0]) throw new AuthError('APPLICATION_NOT_FOUND', 404, 'Application not found');
    return r.rows[0];
  }
  async dispatchOne() {
    const receipt = await this.store.claimDispatch();
    if (!receipt) return false;
    const app = await this.registration(receipt.application_id);
    try {
      const observed = await this.native.submit(app, receipt);
      await this.store.link(receipt.id, observed.reference);
    } catch {
      // Do NOT reset accepted: the native owner may already have committed effects.
      await this.store.pool.query(
        "UPDATE application_receipts SET error_code='NATIVE_DISPATCH_UNCERTAIN',updated_at=now() WHERE id=$1 AND phase='dispatch-unknown'",
        [receipt.id],
      );
    }
    return true;
  }
  async reconcileOne() {
    const found = await this.store.pool.query<Receipt>(
      "SELECT * FROM application_receipts WHERE phase IN ('dispatch-unknown','native-linked','cancel-requested','deletion-pending') ORDER BY updated_at LIMIT 1",
    );
    const receipt = found.rows[0];
    if (!receipt) return false;
    const app = await this.registration(receipt.application_id);
    // Fairness even when one native owner is unavailable. Never automatically resubmit.
    await this.store.pool.query('UPDATE application_receipts SET updated_at=now() WHERE id=$1', [
      receipt.id,
    ]);
    if (receipt.phase === 'deletion-pending') {
      if (await this.native.erase(app, receipt)) await this.eraseCore(receipt);
      return true;
    }
    const cancelling = receipt.phase === 'cancel-requested' || Boolean(app.revoked_at);
    const observed = await (cancelling
      ? this.native.cancel(app, receipt)
      : this.native.lookup(app, receipt));
    if (!observed) return true;
    if (cancelling) {
      if (observed.state !== 'running')
        await this.store.pool.query(
          "UPDATE application_receipts SET phase='cancelled',updated_at=now() WHERE id=$1 AND phase IN ('cancel-requested','dispatch-unknown','native-linked')",
          [receipt.id],
        );
      return true;
    }
    if (receipt.phase === 'dispatch-unknown') { await this.store.link(receipt.id, observed.reference); receipt.native_reference=observed.reference; }
    if (observed.state === 'completed') {
      const owner=await this.store.pool.connect();
      const key=receipt.application_id+':'+receipt.payload?.subject;
      let locked=false;
      try{
        locked=(await owner.query<{held:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held',[key])).rows[0]!.held;
        if(!locked)return true;
        const current=await this.store.get(app.id,receipt.id);
        if(current.phase!=='native-linked')return true;
        const result=await this.native.finalize(app,current,observed.result);
        if(Buffer.byteLength(JSON.stringify(result))>65536)throw new Error('Application result limit');
        await this.store.complete(receipt.id,result);
      }finally{if(locked)await owner.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);owner.release();}
    } else if (observed.state === 'failed' || observed.state === 'cancelled')
      await this.store.pool.query(
        "UPDATE application_receipts SET phase=$2,error_code=$3,updated_at=now() WHERE id=$1 AND phase='native-linked'",
        [
          receipt.id,
          observed.state === 'cancelled' ? 'cancelled' : 'rejected',
          observed.state === 'failed' ? 'NATIVE_EXECUTION_FAILED' : null,
        ],
      );
    return true;
  }
  async deliverOne() {
    const lease = randomUUID();
    const claimed = await this.store.pool.query<{
      id: string;
      receipt_id: string;
      application_id: string;
      attempt: number;
    }>(
      `UPDATE application_outbox SET state='delivering',lease_id=$1,lease_until=now()+interval '30 seconds',attempt=attempt+1 WHERE id=(SELECT o.id FROM application_outbox o JOIN application_integrations a ON a.id=o.application_id JOIN application_receipts r ON r.id=o.receipt_id WHERE a.revoked_at IS NULL AND r.phase='result-ready' AND ((o.state='pending' AND o.next_attempt_at<=now()) OR (o.state='delivering' AND o.lease_until<now())) ORDER BY o.next_attempt_at FOR UPDATE OF o SKIP LOCKED LIMIT 1) RETURNING application_outbox.*`,
      [lease],
    );
    const o = claimed.rows[0];
    if (!o) return false;
    try {
      const app = await this.registration(o.application_id);
      const r = await this.store.get(app.id, o.receipt_id);
      if (
        app.revoked_at ||
        r.phase !== 'result-ready' ||
        !app.manifest.callbackUrl ||
        !app.callback_secret_ciphertext
      )
        throw new Error('DELIVERY_NO_LONGER_AUTHORIZED');
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        contractVersion: 'alica-application/v1',
        deliveryId: o.id,
        applicationId: app.id,
        receiptId: r.id,
        subject: r.payload?.subject,
        result: r.result,
      });
      const signature = deliverySignature(
        this.decrypt(app.callback_secret_ciphertext, app.id),
        o.id,
        timestamp,
        body,
      );
      const response = await boundedHttps(
        app.manifest.callbackUrl,
        'POST',
        {
          'content-type': 'application/json',
          'x-alica-delivery': o.id,
          'x-alica-timestamp': String(timestamp),
          'x-alica-signature': signature,
        },
        body,
        4096,
        this.callbackPins,
      );
      if (response.status < 200 || response.status >= 300) throw new Error('DELIVERY_REJECTED');
      await this.store.pool.query(
        "UPDATE application_outbox SET state='delivered',delivered_at=now(),lease_id=NULL,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_id=$2",
        [o.id, lease],
      );
    } catch {
      await this.store.pool.query(
        "UPDATE application_outbox SET state=$3,next_attempt_at=now()+($4 * interval '1 second'),lease_id=NULL,lease_until=NULL,last_error='CALLBACK_NOT_ACKNOWLEDGED' WHERE id=$1 AND lease_id=$2",
        [
          o.id,
          lease,
          o.attempt >= 5 ? 'exhausted' : 'pending',
          Math.min(3600, 30 * 2 ** Math.min(o.attempt, 7)),
        ],
      );
    }
    return true;
  }
  async retryDelivery(appId: string, id: string) {
    await this.store.get(appId, id);
    return (
      (
        await this.store.pool.query(
          "UPDATE application_outbox SET state='pending',attempt=0,next_attempt_at=now(),last_error=NULL WHERE application_id=$1 AND receipt_id=$2 AND state='exhausted'",
          [appId, id],
        )
      ).rowCount === 1
    );
  }
  async delivery(appId: string, id: string) {
    await this.store.get(appId, id);
    return (
      (
        await this.store.pool.query(
          'SELECT id,state,attempt,next_attempt_at,last_error,delivered_at FROM application_outbox WHERE application_id=$1 AND receipt_id=$2',
          [appId, id],
        )
      ).rows[0] ?? null
    );
  }
  async requestErase(appId: string, id: string) {
    const r = await this.store.get(appId, id);
    if (!['result-ready', 'rejected', 'cancelled', 'deleted'].includes(r.phase))
      throw new AuthError(
        'APPLICATION_DELETE_UNSETTLED',
        409,
        'Cancel and settle execution before deletion',
      );
    await this.store.pool.query(
      "UPDATE application_receipts SET phase='deletion-pending',updated_at=now() WHERE id=$1 AND phase IN ('result-ready','rejected','cancelled')",
      [id],
    );
    await this.store.pool.query(
      "UPDATE application_outbox SET state='cancelled' WHERE receipt_id=$1 AND state NOT IN ('delivered','cancelled')",
      [id],
    );
    return this.store.get(appId, id);
  }
  private async eraseCore(r: Receipt) {
    const c = await this.store.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM application_outbox WHERE receipt_id=$1', [r.id]);
      await c.query(
        "UPDATE application_receipts SET phase='deleted',payload=NULL,result=NULL,native_reference=NULL,error_code=NULL,updated_at=now() WHERE id=$1 AND phase='deletion-pending'",
        [r.id],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async expireOne() {
    const found=await this.store.pool.query<Receipt>("SELECT * FROM application_receipts WHERE expires_at<=now() AND phase NOT IN ('deleted','deletion-pending') ORDER BY updated_at LIMIT 1");
    const r=found.rows[0];if(!r)return false;
    if(['result-ready','cancelled','rejected'].includes(r.phase)) await this.requestErase(r.application_id,r.id);
    else await this.store.cancel(r.application_id,r.id);
    return true;
  }
  async revoke(appId:string) {
    const c=await this.store.pool.connect();try{await c.query('BEGIN');
      await c.query('UPDATE application_integrations SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1',[appId]);
      await c.query('UPDATE application_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE application_id=$1',[appId]);
      await c.query("UPDATE application_receipts SET phase=CASE WHEN phase='accepted' THEN 'cancelled' ELSE 'cancel-requested' END,updated_at=now() WHERE application_id=$1 AND phase IN ('accepted','dispatch-unknown','native-linked')",[appId]);
      await c.query("UPDATE application_outbox SET state='cancelled' WHERE application_id=$1 AND state NOT IN ('delivered','cancelled')",[appId]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  private encrypt(value: string, id: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const b = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), b].map((x) => x.toString('base64url')).join('.');
  }
  private decrypt(value: string, id: string) {
    const [iv, tag, body] = value.split('.');
    if (!iv || !tag || !body) throw new Error('APPLICATION_SECRET_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
