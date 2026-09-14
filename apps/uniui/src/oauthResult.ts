import type { MutationResponse } from './types';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function oauthPayload(response: MutationResponse): Record<string, unknown> {
  if (response.operation.state !== 'verified') {
    throw new Error(`OAuth operation did not verify (${response.operation.state}). Please retry.`);
  }
  const envelope = record(response.result);
  // Core returns the owner envelope containing the native command receipt.
  // Retain the direct receipt shape for older compatible gateways.
  return 'data' in envelope ? record(record(envelope.data).result) : envelope;
}

export function oauthStart(response: MutationResponse) {
  const data = oauthPayload(response);
  const fields = ['session_id', 'user_code', 'verification_url'];
  if (fields.some((key) => typeof data[key] !== 'string' || !(data[key] as string).trim()) || data.status !== 'pending') {
    throw new Error('OAuth start returned an incomplete authorization handoff. No approval polling has started; please retry.');
  }
  const url = new URL(data.verification_url as string);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('OAuth returned an unsafe authorization URL. Authorization was not opened.');
  }
  const expiresIn = Number(data.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('OAuth returned an invalid authorization deadline. Please retry.');
  }
  return {
    sessionId: data.session_id as string,
    userCode: data.user_code as string,
    verificationUrl: url.href,
    expiresIn,
  };
}

export function oauthStatus(response: MutationResponse) {
  const data = oauthPayload(response);
  const status = data.status === 'connected' ? 'approved' : data.status === 'disconnected' ? 'error' : data.status;
  if (!['pending', 'approved', 'denied', 'expired', 'error'].includes(String(status))) {
    throw new Error('OAuth polling returned an invalid status. Please refresh provider status.');
  }
  return {
    status: status as 'pending' | 'approved' | 'denied' | 'expired' | 'error',
    error: typeof data.error_message === 'string' ? data.error_message : '',
  };
}
