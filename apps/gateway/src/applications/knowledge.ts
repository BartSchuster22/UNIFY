import { createHash } from 'node:crypto';
import { MemoryV4Adapter, type MemoryV4Request } from '../memory-v4/client.js';
import { memoryRoute, validateScopePath } from '../memory-v4/types.js';
import { parseRequest } from './contract.js';
import type { Registration, Receipt } from './store.js';
export interface KnowledgeSource {
  url: string; retrievedAt: string; sha256: string; excerpt: string;
  metadata: { runId: string; sourceId: string; toolName: string };
}
export interface ValidatedKnowledge { recordId: string; quote: string; source: KnowledgeSource }
export interface ApplicationKnowledgeOptions {
  /** Server configuration, never request data. */
  rootScope: string;
  /** Verify owner-stored native fetch bytes, digest, timestamp, metadata and receipt binding.
   * NOT an LLM/boolean from model output; no inference or side effects here.
   * No verifier means no promotion. */
  /** Trusted owner policy, not model output. Return an exact prior record ID only after
   * fact-level correction review; this callback MUST NOT run inference or effects.
   * When unset, only unique same-source byte-exact quote revalidation is allowed.
   * An explicit null is a denial, never a fallback to default approval. */
  resolveCorrection?: (app: Registration, receipt: Receipt, fact: { quote: string; source: KnowledgeSource },
    prior: ReadonlyArray<{ id: string; quote: string; source: KnowledgeSource }>) => Promise<string | null>;
  verifyEvidence?: (app: Registration, receipt: Receipt, source: KnowledgeSource) => Promise<boolean>;
}
export type ScopedMemoryV4Factory = (scopePath: string) => MemoryV4Adapter;
type Obj = Record<string, unknown>;
interface Stored extends Obj { id: string; version: number; scope_path: string; content: string; attrs: Obj }
type Fact = { quote: string; sourceIndex: number; validated: boolean; conflicting: boolean };
type Plan = { inputHash: string; evidence: KnowledgeSource[]; findings: Fact[];
  eligible: boolean[]; reuses?: Array<ValidatedKnowledge|null>; priorIds: string[]; replacements: Array<{ id: string; version: number } | null>; uncertainty: boolean };
const POLICY = 'verified-extract-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function object(x: unknown): Obj {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('KNOWLEDGE_INVALID');
  return x as Obj;
}
function text(x: unknown, max: number): string {
  if (typeof x !== 'string' || !x.trim() || x.length > max || x.includes('\0')) throw new Error('KNOWLEDGE_INVALID');
  return x;
}
function bounded(x: unknown): string {
  const s = JSON.stringify(x);
  if (!s || Buffer.byteLength(s) > 65536) throw new Error('KNOWLEDGE_SIZE_LIMIT');
  return s;
}
// Intern only byte-identical excerpts inside the immutable plan. Original source
// timestamps, digests, metadata, quotes and record identities remain untouched.
// Input, stored-plan and public-result bounds remain 64 KiB.
function encodePlan(plan: Plan): string {
  return bounded({ ...plan, reuses: plan.reuses?.map(reuse => {
    if (!reuse) return null;
    const index = plan.evidence.findIndex(source => source.excerpt === reuse.source.excerpt);
    if (index < 0) return reuse;
    const { excerpt: _excerpt, ...source } = reuse.source;
    return { ...reuse, source: { ...source, excerptFromEvidence: index } };
  }) });
}
function decodePlan(content: string): Plan {
  if (Buffer.byteLength(content) > 65536) throw new Error('KNOWLEDGE_SIZE_LIMIT');
  const plan = JSON.parse(content) as Plan;
  if (!Array.isArray(plan.evidence) || plan.evidence.length > 4 ||
      (plan.reuses && (!Array.isArray(plan.reuses) || plan.reuses.length > 8)))
    throw new Error('KNOWLEDGE_INVALID');
  for (const reuse of plan.reuses ?? []) {
    if (!reuse) continue;
    const source = object(reuse.source);
    if (!Object.hasOwn(source, 'excerptFromEvidence')) continue; // Existing plans.
    const index = source.excerptFromEvidence;
    if (Object.hasOwn(source, 'excerpt') || !Number.isInteger(index) || Number(index) < 0 ||
        Number(index) >= plan.evidence.length) throw new Error('KNOWLEDGE_INVALID');
    source.excerpt = text(plan.evidence[Number(index)]!.excerpt, 12000);
    delete source.excerptFromEvidence;
  }
  return plan;
}
function stored(x: unknown, scope: string): Stored {
  const r = object(x);
  if (r.scope_path !== scope || !/^rec_[a-f0-9]{32}$/.test(String(r.id)) ||
      !Number.isInteger(r.version) || Number(r.version) < 1 || typeof r.content !== 'string')
    throw new Error('KNOWLEDGE_SCOPE_OR_RECORD_INVALID');
  object(r.attrs);
  return r as Stored;
}
/** MemoryV4 owns all state. Core results are projections. Source text has no tool authority.
 * Corrections require trusted mapping or conservative exact-quote revalidation.
 * Erase uses only the Memory owner scrub API; transition/PATCH are not deletion.
 */
export class ApplicationKnowledge {
  constructor(private readonly factory: ScopedMemoryV4Factory, private readonly options: ApplicationKnowledgeOptions) {
    validateScopePath(options.rootScope);
    if (['global', 'public'].includes(options.rootScope)) throw new Error('KNOWLEDGE_ROOT_REQUIRED');
  }
  private context(app: Registration, r: Receipt) {
    if (!UUID.test(app.id) || !UUID.test(r.id) || r.application_id !== app.id || !r.payload)
      throw new Error('KNOWLEDGE_RECEIPT_SCOPE');
    const payload = parseRequest(r.payload, app.manifest);
    if (app.manifest.sourceUrls.length > 4 || app.manifest.promotionPolicy !== POLICY) throw new Error('KNOWLEDGE_POLICY');
    const scope = validateScopePath(`${this.options.rootScope}/project:${digest(JSON.stringify([
      app.manifest.frameworkId, app.manifest.projectId]))}/application:${app.id}/subject:${payload.subject}`);
    return { scope, payload, adapter: this.factory(scope), topic: `application-knowledge:${digest(scope)}` };
  }
  private async call(c: ReturnType<ApplicationKnowledge['context']>, app: Registration,
    r: Receipt, method: MemoryV4Request['method'], path: string, op: string,
    body?: unknown, query?: Obj, version?: number): Promise<unknown> {
    const route = memoryRoute(method, path);
    if (!route) throw new Error('KNOWLEDGE_ROUTE_UNAVAILABLE');
    const response = await c.adapter.execute({ method, path, route, actorUserId: app.owner_id,
      requestId: r.id, ...(body === undefined ? {} : { body }), ...(query ? { query } : {}),
      ...(method === 'GET' ? {} : { idempotencyKey: `ak:${digest(c.scope + ':' + r.id + ':' + op)}`,
        reason: `application ${POLICY} ${op}`, ...(version ? { ifMatch: String(version) } : {}) }) });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('KNOWLEDGE_MEMORY_WRITE_FAILED');
    return response.body;
  }
  private async list(c: ReturnType<ApplicationKnowledge['context']>, app: Registration, r: Receipt, query: Obj): Promise<Stored[]> {
    const page = object(await this.call(c, app, r, 'GET', '/records', 'list', undefined,
      { scope_path: c.scope, include_public: false, topic: c.topic, limit: 100, ...query }));
    if (!Array.isArray(page.records) || page.records.length > 100 || page.next_cursor) throw new Error('KNOWLEDGE_RETRIEVAL_INCOMPLETE');
    // API includes ancestors: fail closed rather than returning any cross-scope record.
    return page.records.map(x => {
      const row = stored(x, c.scope);
      if (row.author_actor !== `unify:${app.owner_id}` || row.attrs.policy !== POLICY ||
          row.attrs.applicationId !== app.id || row.attrs.subject !== c.payload.subject)
        throw new Error('KNOWLEDGE_RECORD_OWNERSHIP');
      return row;
    });
  }
  private async create(c: ReturnType<ApplicationKnowledge['context']>, app: Registration,
    r: Receipt, op: string, content: string, role: string, attrs: Obj, sources: KnowledgeSource[] = []) {
    return stored(await this.call(c, app, r, 'POST', '/records', op, {
      title: `Application ${op}`, content, role, lifecycle: 'working', write_policy: 'immutable',
      scope_path: c.scope, topic: c.topic, tags: [`receipt:${r.id}`, `kind:${op}`],
      source_refs: sources.map(s => s.url), provenance: { sources, nativeReferenceHash: digest(bounded(r.native_reference)) },
      attrs: { policy: POLICY, applicationId: app.id, receiptId: r.id, subject: c.payload.subject, ...attrs },
    }), c.scope);
  }
  async prepare(app: Registration, r: Receipt): Promise<ValidatedKnowledge[]> {
    const c = this.context(app, r);
    if (c.payload.operation === 'research' || c.payload.operation === 'refresh' || c.payload.operation === 'correction') return [];
    const rows = await this.list(c, app, r, { role: 'canonical', lifecycle: 'live' });
    const result: ValidatedKnowledge[] = [];
    for (const row of rows) {
      if (row.attrs.policy !== POLICY || row.attrs.applicationId !== app.id || row.attrs.subject !== c.payload.subject ||
          row.attrs.validated !== true || row.attrs.quarantined === true || row.deleted_at || row.superseded_by) continue;
      const sources = object(row.provenance).sources;
      const source = this.source(app, Array.isArray(sources) ? sources[0] : undefined);
      if (!source.excerpt.includes(row.content)) throw new Error('KNOWLEDGE_FORGED_STORED_QUOTE');
      result.push({ recordId: row.id, quote: text(row.content, 2000), source });
      if (result.length === 4) break;
    }
    bounded(result);
    return result;
  }
  private source(app: Registration, value: unknown): KnowledgeSource {
    const s = object(value), m = object(s.metadata), url = text(s.url, 2048), parsed = new URL(url);
    if (!app.manifest.sourceUrls.includes(url) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash)
      throw new Error('KNOWLEDGE_SOURCE_NOT_APPROVED');
    const retrievedAt = text(s.retrievedAt, 40);
    if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(retrievedAt) ||
        !Number.isFinite(Date.parse(retrievedAt)) || Date.parse(retrievedAt) > Date.now() + 60000) throw new Error('KNOWLEDGE_SOURCE_TIME');
    const sha256 = text(s.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('KNOWLEDGE_SOURCE_DIGEST');
    return { url, retrievedAt, sha256, excerpt: text(s.excerpt, 12000), metadata: {
      runId: text(m.runId, 200), sourceId: text(m.sourceId, 200), toolName: text(m.toolName, 100) } };
  }
  async finalize(app: Registration, r: Receipt, nativeResult: unknown): Promise<unknown> {
    const c = this.context(app, r);
    if (!r.native_reference || !Object.keys(r.native_reference).length) throw new Error('KNOWLEDGE_NATIVE_REFERENCE_REQUIRED');
    const inputHash = digest(bounded(nativeResult));
    const existing = await this.list(c, app, r, { tag: `receipt:${r.id}` });
    const completed = existing.filter(row => row.attrs.kind === 'result');
    if (completed.length > 1) throw new Error('KNOWLEDGE_DUPLICATE_RESULT');
    const plans = existing.filter(row => row.attrs.kind === 'plan');
    if (plans.length > 1) throw new Error('KNOWLEDGE_DUPLICATE_PLAN');
    let plan: Plan;
    if (plans[0]) {
      plan = decodePlan(plans[0].content);
      if (plan.inputHash !== inputHash) throw new Error('KNOWLEDGE_FINALIZE_MISMATCH');
      if (completed[0]) return JSON.parse(completed[0].content) as unknown;
    } else {
      if (completed.length) throw new Error('KNOWLEDGE_ORPHAN_RESULT');
      const n = object(nativeResult);
      text(n.answer, 16000); // Never promote prose or report arbitrary claimed tool effects.
      if (!Array.isArray(n.evidence) || n.evidence.length > 4 || !Array.isArray(n.findings) || n.findings.length > 8)
        throw new Error('KNOWLEDGE_SIZE_LIMIT');
      const evidence = n.evidence.map(s => this.source(app, s));
      const findings = n.findings.map((value): Fact => {
        const f = object(value), quote = text(f.quote, 2000);
        if (!Number.isInteger(f.sourceIndex) || !evidence[Number(f.sourceIndex)]?.excerpt.includes(quote)) throw new Error('KNOWLEDGE_FORGED_QUOTE');
        if (typeof f.validated !== 'boolean' || typeof f.conflicting !== 'boolean') throw new Error('KNOWLEDGE_FINDING_INVALID');
        return { quote, sourceIndex: Number(f.sourceIndex), validated: f.validated, conflicting: f.conflicting };
      });
      const uncertainty = !(n.uncertainty === false || n.uncertainty === '');
      const verified = await Promise.all(evidence.map(s => this.options.verifyEvidence?.(app, r, s) ?? false));
      const prior = (await this.list(c, app, r, { role: 'canonical', lifecycle: 'live' }))
        .filter(row => row.attrs.validated === true && row.attrs.quarantined !== true && !row.deleted_at && !row.superseded_by);
      if (prior.length > 8) throw new Error('KNOWLEDGE_PRIOR_BOUND');
      if (c.payload.corrects && !prior.some(row => row.attrs.receiptId === c.payload.corrects)) throw new Error('KNOWLEDGE_CORRECTION_TARGET');
      const replacements: Plan['replacements'] = findings.map(() => null);
      const eligible: boolean[] = [];
      const targeted = new Set<string>();
      const reuses: Array<ValidatedKnowledge|null> = findings.map(()=>null);
      for (let i = 0; i < findings.length; i++) {
        const f = findings[i]!, source = evidence[f.sourceIndex]!;
        let approved = !uncertainty && f.validated && !f.conflicting && verified[f.sourceIndex] === true;
        if (c.payload.operation === 'correction') {
          const targets = prior.filter(row => row.attrs.receiptId === c.payload.corrects);
          const snapshots = targets.map(row => ({ id: row.id, quote: row.content,
            source: this.source(app, (object(row.provenance).sources as unknown[])[0]) }));
          // Default: one byte-exact quote from the same approved URL, with
          // verified new evidence. Never infer a semantic correction.
          const exact = snapshots.filter(p => p.quote === f.quote && p.source.url === source.url &&
            p.source.excerpt.includes(p.quote));
          const id = !approved ? null : this.options.resolveCorrection
            ? await this.options.resolveCorrection(app, r, { quote: f.quote, source }, snapshots)
            : exact.length === 1 ? exact[0]!.id : null;
          const target = targets.find(row => row.id === id);
          const previous = snapshots.find(row => row.id === id);
          approved = Boolean(target && previous && !targeted.has(target.id) &&
            source.url === previous.source.url && Date.parse(source.retrievedAt) >= Date.parse(previous.source.retrievedAt));
          if (approved && target) {
            targeted.add(target.id);
            replacements[i] = { id: target.id, version: target.version };
          }
        } else {
          // Without a trusted semantic conflict map, conservatively quarantine changed
          // claims against the same source. Refresh fetches but does not silently correct.
          const same=prior.find(row=>row.content===f.quote&&(row.source_refs as string[]).includes(source.url));
          if(approved&&same){
            if(c.payload.operation==='refresh')replacements[i]={id:same.id,version:same.version};
            else reuses[i]={recordId:same.id,quote:same.content,source:this.source(app,(object(same.provenance).sources as unknown[])[0])};
          }else approved &&= !prior.some(row=>(row.source_refs as string[]).includes(source.url));
        }
        // Conflicting findings in the same result are never promoted.
        approved &&= !findings.some(other => other.sourceIndex === f.sourceIndex && other.conflicting);
        eligible.push(approved);
      }
      plan = { inputHash, evidence, findings, eligible, replacements, reuses, priorIds: prior.map(row => row.id), uncertainty };
      const saved = await this.create(c, app, r, 'plan', encodePlan(plan), 'exhaust', { kind: 'plan' });
      plan = decodePlan(saved.content);
    }
    const quotes: ValidatedKnowledge[] = [];
    for (let i = 0; i < plan.evidence.length; i++) {
      const source = plan.evidence[i]!;
      await this.create(c, app, r, `evidence-${i}`, source.excerpt, 'evidence', { kind: 'evidence' }, [source]);
    }
    for (let i = 0; i < plan.findings.length; i++) {
      const f = plan.findings[i]!, source = plan.evidence[f.sourceIndex]!, eligible = plan.eligible[i] === true;
      if(eligible&&plan.reuses?.[i]){quotes.push(plan.reuses[i]!);continue;}
      let candidate = await this.create(c, app, r, `candidate-${i}`, f.quote, 'active', {
        kind: 'fact', validated: eligible, quarantined: !eligible,
        correctsReceipt: c.payload.corrects ?? null, priorIds: plan.priorIds,
      }, [source]);
      if (eligible && plan.replacements[i]) {
        const target = plan.replacements[i]!;
        // Canonical supersession creates the canonical replacement atomically in MemoryV4.
        candidate = stored(await this.call(c, app, r, 'POST', `/records/${target.id}/supersede`,
          `supersede-${i}`, { title: 'Application validated fact revision', content: f.quote,
            tags: [`receipt:${r.id}`, `kind:corrected-${i}`], source_refs: [source.url],
            provenance: { sources: [source], nativeReferenceHash: digest(bounded(r.native_reference)) },
            attrs: { ...candidate.attrs, candidateId: candidate.id, correctsRecordId: target.id },
            write_policy: 'immutable' }, undefined, target.version), c.scope);
        quotes.push({ recordId: candidate.id, quote: f.quote, source });
      } else if (eligible) {
        // Create replay returns original version; promotion replay uses stable If-Match.
        candidate = stored(await this.call(c, app, r, 'POST', `/records/${candidate.id}/promote`,
          `promote-${i}`, undefined, undefined, candidate.version), c.scope);
        quotes.push({ recordId: candidate.id, quote: f.quote, source });
      }
    }
    const projection = { answer: quotes.length ? quotes.map(q => q.quote).join('\n\n') : 'No governed validated answer is available.',
      knowledge: quotes, uncertainty: plan.uncertainty || !quotes.length || plan.eligible.some(x => !x),
      quarantined: plan.eligible.filter(x => !x).length, receiptId: r.id };
    const result = await this.create(c, app, r, 'result', bounded(projection), 'exhaust', { kind: 'result' });
    return JSON.parse(result.content) as unknown;
  }
  async erase(app: Registration, r: Receipt): Promise<boolean> {
    const c = this.context(app, r);
    // True is logical Memory live-store completion ONLY. Parent owns native/Core
    // erasure, dependency coordination, and backup/replica/export expiry policy.
    try {
      const body = object(await this.call(c, app, r, 'POST', '/applications/knowledge/scrub', 'scrub', {
        scope_path: c.scope, application_id: app.id, receipt_id: r.id, subject: c.payload.subject, allow_empty: true,
      }));
      return Object.keys(body).sort().join(',') ===
        'complete,erasure,physical_erasure,records_scrubbed,replayed' &&
        body.complete === true && body.erasure === 'logical-live-store' && body.physical_erasure === false &&
        typeof body.replayed === 'boolean' && Number.isSafeInteger(body.records_scrubbed) &&
        Number(body.records_scrubbed) >= 0;
    } catch {
      // Dependencies, unavailable owner and invalid responses retain pending.
      return false;
    }
  }
}
