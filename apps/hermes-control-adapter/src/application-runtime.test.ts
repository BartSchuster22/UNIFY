import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ApplicationRuntime, validateApplicationRequest, validateApplicationResponse, type ApplicationRequest, type ApplicationScope } from './application-runtime.js';

const scope: ApplicationScope = { receiptId: '11111111-1111-4111-8111-111111111111', applicationId: '22222222-2222-4222-8222-222222222222', projectId: 'fixture-project', subject: 'fixture' };
const request = (): ApplicationRequest => ({ ...scope, payload: { contractVersion: 'alica-application/v1', operation: 'answer', question: 'Fixture question?', subject: scope.subject }, sourceUrls: ['https://example.com/facts'] });
const workerPath = fileURLToPath(new URL('../../../integrations/hermes/application-runtime/fixture_worker.py', import.meta.url));
const runtime = (timeoutMs = 3000) => new ApplicationRuntime({ pythonPath: '/usr/bin/python3', workerPath, timeoutMs });

describe('UNIT restricted application boundary; labelled fixtures, no live Hermes/inference', () => {
  it('accepts bounded execute and scope-only lifecycle actions', () => {
    expect(() => validateApplicationRequest('execute', request())).not.toThrow();
    for (const a of ['lookup', 'cancel', 'erase'] as const) expect(() => validateApplicationRequest(a, scope)).not.toThrow();
  });
  it.each(['model', 'provider', 'credentials', 'profile', 'tools', 'shell', 'callback', 'workspace'])('rejects %s injection at either level', field => {
    expect(() => validateApplicationRequest('execute', { ...request(), [field]: 'bad' })).toThrow();
    expect(() => validateApplicationRequest('execute', { ...request(), payload: { ...request().payload, [field]: 'bad' } })).toThrow();
  });
  it('rejects malformed scope, subject mismatch, operation and finite bounds', () => {
    expect(() => validateApplicationRequest('lookup', { ...scope, projectId: '../escape' })).toThrow();
    expect(() => validateApplicationRequest('lookup', { ...scope, receiptId: '--evil' })).toThrow();
    expect(() => validateApplicationRequest('execute', { ...request(), payload: { ...request().payload, subject: 'other' } })).toThrow();
    expect(() => validateApplicationRequest('execute', { ...request(), payload: { ...request().payload, question: 'x'.repeat(4001) } })).toThrow();
    expect(() => validateApplicationRequest('execute', { ...request(), payload: { ...request().payload, operation: 'shell' } })).toThrow();
    expect(() => validateApplicationRequest('execute', { ...request(), sourceUrls: Array(5).fill('https://example.com') })).toThrow();
  });
  it.each(['http://example.com', 'https://user:password@example.com', 'https://example.com:444', 'https://example.com/#fragment', 'file:///etc/passwd'])('rejects URL %s before spawn', url => {
    expect(() => validateApplicationRequest('execute', { ...request(), sourceUrls: [url] })).toThrow();
  });
  it('validates knowledge quotes and provenance, not confidence', () => {
    const k = { url: 'https://example.com', retrievedAt: '2026-09-09T00:00:00Z', sha256: 'a'.repeat(64), excerpt: 'fixture text', quote: 'fixture', validated: true };
    expect(() => validateApplicationRequest('execute', { ...request(), knowledge: [k] })).not.toThrow();
    for (const bad of [{ ...k, quote: 'forged' }, { ...k, confidence: 1 }, { ...k, validated: false }]) expect(() => validateApplicationRequest('execute', { ...request(), knowledge: [bad] })).toThrow();
  });
  it('validates completed result evidence and exact native scope', () => {
    const ref = { ...scope, taskId: 't_fixture', sessionId: `alica-app-${scope.receiptId}` };
    const out = { state: 'completed', reference: ref, result: { answer: 'A fixture [1].', uncertainty: '', promotion: 'candidate-only', native: ref, evidence: [{ url: 'https://example.com', retrievedAt: '2026-09-09T00:00:00Z', sha256: 'a'.repeat(64), excerpt: 'A fixture' }], findings: [{ quote: 'fixture', sourceIndex: 0, validated: true, conflicting: false }] } };
    expect(() => validateApplicationResponse(out, scope)).not.toThrow();
    expect(() => validateApplicationResponse({ ...out, reference: { ...ref, subject: 'other' } }, scope)).toThrow();
    expect(() => validateApplicationResponse({ ...out, result: { ...out.result, answer: 'Wrong [2].' } }, scope)).toThrow();
    expect(() => validateApplicationResponse({ ...out, result: { ...out.result, findings: [{ quote: 'forged', sourceIndex: 0, validated: true, conflicting: false }] } }, scope)).toThrow();
    expect(() => validateApplicationResponse({ state: 'completed', reference: null }, scope)).toThrow();
  });
  it('rejects server timeout above 180s and nonabsolute executable paths', () => {
    expect(() => new ApplicationRuntime({ pythonPath: 'python', workerPath })).toThrow();
    expect(() => runtime(180001)).toThrow();
  });
});

describe('SUBPROCESS UNIT labelled Python protocol fixture; no native execution', () => {
  it('exercises bounded stdin/stdout for fixed lifecycle action', async () => {
    await expect(runtime().lookup(scope)).resolves.toEqual({ state: 'missing', reference: null });
  });
  it.each(['invalid', 'wrong-scope', 'overflow', 'crash'])('fails honestly for %s and never includes stderr', async subject => {
    await expect(runtime().lookup({ ...scope, subject })).rejects.toThrow(/^application_runtime_/);
    try { await runtime().lookup({ ...scope, subject }); } catch (e) { expect(String(e)).not.toContain('MOCK-SECRET'); }
  });
  it('times out and kills only its own uncooperative child, awaiting close', async () => {
    await expect(runtime(800).lookup({ ...scope, subject: 'timeout' })).rejects.toThrow('timeout_reconcile_native');
  });
  it('pins expected scope despite caller mutation during subprocess execution', async () => {
    const mutable = { ...scope, subject: 'scope-echo' };
    const pending = runtime().lookup(mutable);
    mutable.subject = 'other';
    await expect(pending).resolves.toMatchObject({ state: 'running', reference: { subject: 'scope-echo' } });
  });
  it('spawn failure is settled without hanging', async () => {
    const r = new ApplicationRuntime({ pythonPath: '/nonexistent/labelled-fixture-python', workerPath, timeoutMs: 1000 });
    await expect(r.lookup(scope)).rejects.toThrow('spawn_failed');
  });
});
