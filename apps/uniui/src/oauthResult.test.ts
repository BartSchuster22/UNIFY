import { describe, expect, it } from 'vitest';
import { oauthStart, oauthStatus } from './oauthResult';
import type { MutationResponse } from './types';
const handoff = { session_id: 'fixture-session', user_code: 'TEST-CODE', verification_url: 'https://provider.example/device', expires_in: 900, status: 'pending' };
function response(data: unknown, state = 'verified', nested = true) {
  return { operation: { state }, result: nested ? { meta: { owner: 'hermes' }, data: { status: 'succeeded', result: data } } : data } as unknown as MutationResponse;
}
describe('OAuth owner response contract', () => {
  it('unwraps the actual Core/owner/native response envelope', () => {
    expect(oauthStart(response(handoff))).toEqual({ sessionId: 'fixture-session', userCode: 'TEST-CODE', verificationUrl: 'https://provider.example/device', expiresIn: 900 });
  });
  it('supports direct compatible receipts', () => expect(oauthStart(response(handoff, 'verified', false)).sessionId).toBe('fixture-session'));
  it.each(['session_id', 'user_code', 'verification_url'])('rejects missing %s rather than opening an empty pending modal', (key) => {
    expect(() => oauthStart(response({ ...handoff, [key]: '' }))).toThrow('incomplete authorization handoff');
  });
  it('rejects unverified operations', () => expect(() => oauthStart(response(handoff, 'failed'))).toThrow('did not verify'));
  it.each(['javascript:alert(1)', 'http://provider.example/device', 'https://user:password@provider.example/device'])('rejects unsafe URL %s', (url) => {
    expect(() => oauthStart(response({ ...handoff, verification_url: url }))).toThrow('unsafe');
  });
  it.each([0, -1, undefined, 'invalid'])('rejects invalid expiry %s', (expiry) => expect(() => oauthStart(response({ ...handoff, expires_in: expiry }))).toThrow('deadline'));
  it.each(['pending', 'approved', 'denied', 'expired', 'error'])('unwraps native polling status %s', (status) => expect(oauthStatus(response({ status })).status).toBe(status));
  it('does not silently invent pending status for malformed polling replies', () => expect(() => oauthStatus(response({}))).toThrow('invalid status'));
  it('maps connected to approved', () => expect(oauthStatus(response({ status: 'connected' })).status).toBe('approved'));
});
