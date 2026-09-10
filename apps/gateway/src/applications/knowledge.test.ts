import { describe, it, expect, vi } from 'vitest';
import { MemoryV4Adapter } from '../memory-v4/client.js';
import { ApplicationKnowledge, type ApplicationKnowledgeOptions } from './knowledge.js';
import type { Registration, Receipt } from './store.js';

// LABELLED TRANSPORT MOCK. Synthetic text is NOT live research or fetched RFC evidence.
const url = 'https://www.rfc-editor.org/rfc/rfc2606.txt';
const app: Registration = { id: '11111111-1111-4111-8111-111111111111', owner_id: 'test-owner',
  revoked_at: null, callback_secret_ciphertext: null, manifest: {
    contractVersion: 'alica-application/v1', name: 'test', frameworkId: 'hermes', projectId: 'test',
    subjects: ['dns', 'other'], operations: ['answer', 'research', 'refresh', 'correction'],
    sourceUrls: [url], retentionDays: 1, promotionPolicy: 'verified-extract-v1' } };
const receipt: Receipt = { id: '22222222-2222-4222-8222-222222222222', application_id: app.id,
  payload: { contractVersion: 'alica-application/v1', subject: 'dns', operation: 'research', question: 'test?' },
  phase: 'native-linked', native_reference: { runId: 'test-run' }, result: null, error_code: null,
  expires_at: new Date('2030-01-01') };
const result = () => ({ answer: 'untrusted prose claims a tool deleted something', evidence: [{ url,
  retrievedAt: '2020-01-01T00:00:00Z', sha256: 'a'.repeat(64), excerpt: 'Synthetic quote. Changed quote.',
  metadata: { runId: 'test-run', sourceId: 'test-source', toolName: 'test-fetch' } }],
  findings: [{ quote: 'Synthetic quote.', sourceIndex: 0, validated: true, conflicting: false }], uncertainty: false });
type Row = Record<string, any>; // Transport mock models API records, not application truth.
function harness(options: Partial<ApplicationKnowledgeOptions> = {}) {
  const rows: Row[] = [], cache = new Map<string, { input: string; body: Row }>();
  const writes: string[] = [], scopes: string[] = [];
  let escape = false, truncated = false, failResult = false;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input)), headers = new Headers(init?.headers), method = init?.method;
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
      headers: { 'content-type': 'application/json', 'x-memoryv4-contract-version': '1.0.0' } });
    if (method === 'GET') {
      const found = rows.filter(r => (!u.searchParams.get('role') || r.role === u.searchParams.get('role')) &&
        (!u.searchParams.get('lifecycle') || r.lifecycle === u.searchParams.get('lifecycle')) &&
        (!u.searchParams.get('tag') || r.tags.includes(u.searchParams.get('tag'))) &&
        r.scope_path === u.searchParams.get('scope_path'));
      return response({ records: escape ? found.map(r => ({ ...r, scope_path: 'org:escaped' })) : found,
        next_cursor: truncated ? 'more' : null });
    }
    if (u.pathname === '/applications/knowledge/scrub')
      return response({ error: { code: 'application_scrub_dependency', message: 'mock dependency' } }, 409);
    const key = headers.get('idempotency-key')!;
    const request = JSON.stringify([u.pathname, init?.body, headers.get('if-match')]);
    const old = cache.get(key);
    if (old) {
      if (old.input !== request) return response({ error: { code: 'conflict', message: 'idempotency conflict' } }, 409);
      return response(old.body);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Row : {};
    if (failResult && body.attrs?.kind === 'result') {
      failResult = false;
      return response({ error: { code: 'unavailable', message: 'synthetic interrupted finalize' } }, 503);
    }
    writes.push(u.pathname);
    let row: Row;
    if (u.pathname === '/records') {
      row = { ...body, id: 'rec_' + (rows.length + 1).toString(16).padStart(32, '0'),
        author_actor: headers.get('x-memoryv4-actor'), version: 1 };
      rows.push(row);
    } else {
      const target = rows.find(r => r.id === u.pathname.split('/')[2])!;
      if (target.version !== Number(headers.get('if-match')))
        return response({ error: { code: 'version_conflict', message: 'version mismatch' } }, 412);
      if (u.pathname.endsWith('/supersede')) {
        row = { ...target, ...body, id: 'rec_' + (rows.length + 1).toString(16).padStart(32, '0'),
          version: 1, supersedes: target.id };
        target.lifecycle = 'superseded'; target.superseded_by = row.id; target.version++;
        rows.push(row);
      } else {
        Object.assign(target, { role: 'canonical', lifecycle: 'live', version: target.version + 1 });
        row = target;
      }
    }
    cache.set(key, { input: request, body: structuredClone(row) });
    return response(row);
  });
  const verifyEvidence = vi.fn(async () => true);
  const knowledge = new ApplicationKnowledge(scope => {
    scopes.push(scope);
    return new MemoryV4Adapter({ baseUrl: 'http://127.0.0.1', bearerToken: 'test-only', scopePath: scope,
      retries: 0, fetchImpl: fetchImpl as typeof fetch });
  }, { rootScope: 'org:test', verifyEvidence, ...options });
  return { knowledge, rows, writes, scopes, verifyEvidence, fetchImpl,
    interruptResult: () => { failResult = true; },
    escape: () => { escape = true; }, truncate: () => { truncated = true; } };
}
describe('ApplicationKnowledge (mock transport, no live evidence)', () => {
  it('bounds reused knowledge to the native four-record and 2000-character contract', async () => {
    const h=harness();await h.knowledge.finalize(app,receipt,result());
    const row=h.rows.find(r=>r.role==='canonical')!;
    for(let i=0;i<5;i++)h.rows.push({...structuredClone(row),id:'rec_'+(100+i).toString(16).padStart(32,'0')});
    const reuse={...receipt,payload:{...receipt.payload!,operation:'answer' as const}};
    expect(await h.knowledge.prepare(app,reuse)).toHaveLength(4);
    row.content='x'.repeat(2001);row.provenance.sources[0].excerpt=row.content;
    await expect(h.knowledge.prepare(app,reuse)).rejects.toThrow();
    const invalid=result();invalid.evidence[0]!.excerpt='x'.repeat(2001);invalid.findings[0]!.quote=invalid.evidence[0]!.excerpt;
    await expect(harness().knowledge.finalize(app,receipt,invalid)).rejects.toThrow();
  });
  it('promotes through API, reuses canonical only, and finalizes once across retries', async () => {
    const h = harness();
    const first = await h.knowledge.finalize(app, receipt, result());
    const writes = h.writes.length;
    expect(await h.knowledge.finalize(app, receipt, result())).toEqual(first);
    expect(h.writes).toHaveLength(writes);
    expect(h.verifyEvidence).toHaveBeenCalledTimes(1);
    expect(h.writes.some(x => x.endsWith('/promote'))).toBe(true);
    expect(await h.knowledge.prepare(app, {...receipt,payload:{...receipt.payload!,operation:'answer'}})).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain('deleted something');
    expect(h.scopes.every(x => x.startsWith('org:test/project:') && x.endsWith('/subject:dns'))).toBe(true);
    const changed = result(); changed.answer = 'different';
    await expect(h.knowledge.finalize(app, receipt, changed)).rejects.toThrow('FINALIZE_MISMATCH');
  });
  it('resumes interrupted finalize without duplicate mutations or re-verification', async () => {
    const h = harness(); h.interruptResult();
    await expect(h.knowledge.finalize(app, receipt, result())).rejects.toThrow();
    const writes = h.writes.length;
    await h.knowledge.finalize(app, receipt, result());
    expect(h.writes).toHaveLength(writes + 1);
    expect(h.verifyEvidence).toHaveBeenCalledTimes(1);
    expect(h.rows.filter(r => r.role === 'canonical')).toHaveLength(1);
  });
  it('quarantines forged correction mapping and rejects unrelated prior receipt', async () => {
    const h = harness({ resolveCorrection: async () => 'rec_' + 'f'.repeat(32) });
    await h.knowledge.finalize(app, receipt, result());
    const next = { ...receipt, id: '33333333-3333-4333-8333-333333333333', payload: {
      ...receipt.payload!, operation: 'correction' as const, corrects: receipt.id } };
    const r = result(); r.findings[0]!.quote = 'Changed quote.';
    await h.knowledge.finalize(app, next, r);
    expect(h.writes.some(x => x.endsWith('/supersede'))).toBe(false);
    await expect(h.knowledge.finalize(app, { ...next, id: '44444444-4444-4444-8444-444444444444',
      payload: { ...next.payload, corrects: next.id } }, r)).rejects.toThrow('CORRECTION_TARGET');
  });
  it('rejects scope escape, incomplete pages and forged stored ownership', async () => {
    const h = harness(); await h.knowledge.finalize(app, receipt, result()); h.escape();
    await expect(h.knowledge.prepare(app, {...receipt,payload:{...receipt.payload!,operation:'answer'}})).rejects.toThrow('SCOPE_OR_RECORD');
    const t = harness(); t.truncate();
    await expect(t.knowledge.prepare(app, {...receipt,payload:{...receipt.payload!,operation:'answer'}})).rejects.toThrow('RETRIEVAL_INCOMPLETE');
    const o = harness(); await o.knowledge.finalize(app, receipt, result());
    o.rows.find(r => r.role === 'canonical')!.author_actor = 'customer:forged';
    await expect(o.knowledge.prepare(app, {...receipt,payload:{...receipt.payload!,operation:'answer'}})).rejects.toThrow('OWNERSHIP');
  });
  it('separates applications, projects and subjects and rejects caller scope/facts', async () => {
    const h = harness(); await h.knowledge.finalize(app, receipt, result());
    expect(await h.knowledge.prepare(app, { ...receipt, payload: { ...receipt.payload!, subject: 'other' } })).toEqual([]);
    expect(await h.knowledge.prepare({ ...app, manifest: { ...app.manifest, projectId: 'another' } }, receipt)).toEqual([]);
    const a = { ...app, id: '33333333-3333-4333-8333-333333333333' };
    expect(await h.knowledge.prepare(a, { ...receipt, application_id: a.id })).toEqual([]);
    for (const extra of [{ scope_path: 'org:escape' }, { facts: ['claimed truth'] }, { subject: '../other' }]) {
      await expect(h.knowledge.prepare(app, { ...receipt, payload: { ...receipt.payload!, ...extra } })).rejects.toThrow();
    }
  });
  it('rejects forged quotes and unapproved URLs before mutations', async () => {
    for (const modify of [(r: ReturnType<typeof result>) => { r.findings[0]!.quote = 'forged'; },
      (r: ReturnType<typeof result>) => { r.evidence[0]!.url = 'https://example.com/'; }]) {
      const h = harness(), r = result(); modify(r);
      await expect(h.knowledge.finalize(app, receipt, r)).rejects.toThrow();
      expect(h.writes).toHaveLength(0);
    }
  });
  it('never promotes model validation alone, uncertainty or conflicting findings', async () => {
    for (const kind of ['unverified', 'uncertain', 'conflict']) {
      const h = harness(kind === 'unverified' ? { verifyEvidence: async () => false } : {}), r = result();
      if (kind === 'uncertain') r.uncertainty = true;
      if (kind === 'conflict') r.findings[0]!.conflicting = true;
      await h.knowledge.finalize(app, receipt, r);
      expect(h.writes.some(x => x.endsWith('/promote'))).toBe(false);
      expect(await h.knowledge.prepare(app, {...receipt,payload:{...receipt.payload!,operation:'answer'}})).toEqual([]);
    }
  });
  it('refresh is explicit and changed claims quarantine without correction', async () => {
    const h = harness(); await h.knowledge.finalize(app, receipt, result());
    const next = { ...receipt, id: '33333333-3333-4333-8333-333333333333',
      payload: { ...receipt.payload!, operation: 'refresh' as const } };
    expect(await h.knowledge.prepare(app, next)).toEqual([]);
    const r = result(); r.findings[0]!.quote = 'Changed quote.';
    await h.knowledge.finalize(app, next, r);
    expect(h.rows.filter(r => r.role === 'canonical')).toHaveLength(1);
    expect(h.rows.some(r => r.content === 'Changed quote.' && r.attrs.quarantined)).toBe(true);
  });
  it('corrects only trusted same-receipt fact mapping with optimistic supersession and replay', async () => {
    const h = harness({ resolveCorrection: async (_a, _r, _f, prior) => prior[0]?.id ?? null });
    await h.knowledge.finalize(app, receipt, result());
    const next = { ...receipt, id: '33333333-3333-4333-8333-333333333333', payload: {
      ...receipt.payload!, operation: 'correction' as const, corrects: receipt.id } };
    const r = result(); r.findings[0]!.quote = 'Changed quote.';
    await h.knowledge.finalize(app, next, r);
    const writes = h.writes.length;
    await h.knowledge.finalize(app, next, r);
    expect(h.writes).toHaveLength(writes);
    expect(h.rows.some(r => r.lifecycle === 'superseded')).toBe(true);
    expect((await h.knowledge.prepare(app, {...receipt,payload:{...receipt.payload!,operation:'answer'}}))[0]?.quote).toBe('Changed quote.');
  });
  it('bounds inputs and never claims deletion via lifecycle transition', async () => {
    const h = harness();
    for (const r of [{ ...result(), evidence: Array(5).fill(result().evidence[0]) },
      { ...result(), findings: Array(9).fill(result().findings[0]) }, { ...result(), answer: 'x'.repeat(65537) }])
      await expect(h.knowledge.finalize(app, receipt, r)).rejects.toThrow();
    await expect(h.knowledge.prepare(app, { ...receipt, payload: { ...receipt.payload!, question: 'x'.repeat(4001) } })).rejects.toThrow();
    expect(await h.knowledge.erase(app, receipt)).toBe(false);
    expect(h.writes).toHaveLength(0);
  });
});

describe('owner scrub transport contract (explicit mock; no integrated acceptance)', () => {
  const completion = { complete: true, replayed: false, records_scrubbed: 4,
    erasure: 'logical-live-store', physical_erasure: false };
  function reply(h: ReturnType<typeof harness>, body: unknown, status = 200) {
    h.fetchImpl.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status,
      headers: { 'content-type': 'application/json', 'x-memoryv4-contract-version': '1.0.0' } }));
  }
  it('sends exact owner-derived scope, identity and stable idempotency; validates replay', async () => {
    const h = harness(); reply(h, completion);
    expect(await h.knowledge.erase(app, receipt)).toBe(true);
    const [url, init] = h.fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1/applications/knowledge/scrub');
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({ scope_path: h.scopes[0], application_id: app.id, receipt_id: receipt.id, subject: 'dns', allow_empty: true });
    const headers = new Headers(init!.headers);
    expect(headers.get('x-memoryv4-actor')).toBe('unify:test-owner');
    expect(headers.get('idempotency-key')).toMatch(/^ak:[a-f0-9]{64}$/);
    expect(headers.get('x-memoryv4-reason')).toContain('scrub');
    reply(h, { ...completion, replayed: true, records_scrubbed: 0 });
    expect(await h.knowledge.erase(app, receipt)).toBe(true);
    expect(new Headers(h.fetchImpl.mock.calls[1]![1]!.headers).get('idempotency-key'))
      .toBe(headers.get('idempotency-key'));
    expect(h.writes).toEqual([]);
  });
  it('fails closed on malformed, partial, inflated or physical completion and owner errors', async () => {
    for (const body of [null, {}, { complete: true }, { ...completion, complete: false },
      { ...completion, physical_erasure: true }, { ...completion, records_scrubbed: -1 },
      { ...completion, records_scrubbed: 1.5 }, { ...completion, replayed: 'true' },
      { ...completion, erasure: 'all-backups' }, { ...completion, extra: true }]) {
      const h = harness(); reply(h, body); expect(await h.knowledge.erase(app, receipt)).toBe(false);
    }
    for (const status of [403, 409, 422, 503]) {
      const h = harness(); reply(h, { error: { code: 'denied', message: 'mock' } }, status);
      expect(await h.knowledge.erase(app, receipt)).toBe(false);
    }
    const h = harness(); h.fetchImpl.mockRejectedValueOnce(new Error('mock transport'));
    expect(await h.knowledge.erase(app, receipt)).toBe(false);
  });
  it('rejects a mismatched application before making any erasure call', async () => {
    const h = harness();
    await expect(h.knowledge.erase({ ...app, id: '33333333-3333-4333-8333-333333333333' }, receipt)).rejects.toThrow();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('default correction policy (synthetic owner-verified evidence)', () => {
  it.each(['exact', 'changed', 'unverified', 'older', 'ambiguous', 'conflicting', 'uncertain', 'explicit-denial', 'other-source', 'forged-prior-quote'])
    ('only revalidates unique verified same-source exact quotes: %s', async kind => {
      const h = harness(kind === 'explicit-denial' ? { resolveCorrection: async () => null } : {});
      await h.knowledge.finalize(app, receipt, result());
      if (kind === 'ambiguous') {
        const prior = h.rows.find(r => r.role === 'canonical')!;
        h.rows.push({ ...structuredClone(prior), id: 'rec_' + 'e'.repeat(32) });
      }
      const next = { ...receipt, id: '33333333-3333-4333-8333-333333333333', payload: {
        ...receipt.payload!, operation: 'correction' as const, corrects: receipt.id } };
      const r = result();
      let registration = app;
      if (kind === 'other-source') {
        r.evidence[0]!.url = 'https://example.org/approved';
        registration = { ...app, manifest: { ...app.manifest, sourceUrls: [url, r.evidence[0]!.url] } };
      }
      if (kind === 'forged-prior-quote')
        h.rows.find(r => r.role === 'canonical')!.provenance.sources[0].excerpt = 'not the quote';
      if (kind === 'changed') r.findings[0]!.quote = 'Changed quote.';
      if (kind === 'unverified') h.verifyEvidence.mockResolvedValue(false);
      if (kind === 'older') r.evidence[0]!.retrievedAt = '2019-01-01T00:00:00Z';
      if (kind === 'conflicting') r.findings[0]!.conflicting = true;
      if (kind === 'uncertain') r.uncertainty = true;
      await h.knowledge.finalize(registration, next, r);
      expect(h.writes.some(p => p.endsWith('/supersede'))).toBe(kind === 'exact');
    });
});
