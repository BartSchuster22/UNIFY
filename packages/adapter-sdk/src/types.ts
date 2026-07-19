import type { CapabilityManifest, ResourceRef, TruthState } from '@aquiero/contracts';
export interface AdapterContext {
  correlationId: string;
  requestId: string;
  actorId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
export interface AdapterResult<T> {
  data: T;
  sourceStatus: TruthState;
  observedAt: string;
  expiresAt?: string;
  sourceVersion?: string;
  warnings: string[];
}
export interface AdapterMutation<TPayload = unknown> {
  action: string;
  target: ResourceRef;
  payload: TPayload;
  mode: 'validate' | 'dry-run' | 'execute' | 'verify' | 'rollback';
}
export interface FrameworkAdapter {
  readonly id: string;
  capabilities(context: AdapterContext): Promise<CapabilityManifest>;
  read<T>(resource: ResourceRef, context: AdapterContext): Promise<AdapterResult<T>>;
  mutate<T>(mutation: AdapterMutation, context: AdapterContext): Promise<AdapterResult<T>>;
}
export interface CredentialProvider {
  resolve(handle: string, signal?: AbortSignal): Promise<Readonly<Record<string, string>>>;
}
export type AdapterErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'protocol'
  | 'circuit_open'
  | 'unknown';
export class AdapterError extends Error {
  constructor(
    readonly code: string,
    readonly category: AdapterErrorCategory,
    readonly retryable: boolean,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
