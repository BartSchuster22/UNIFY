import type { Static } from '@sinclair/typebox';
import type {
  HermesCapabilitiesResponseSchema,
  HermesHealthResponseSchema,
  HermesIdentityResponseSchema,
  HermesVersionResponseSchema,
} from '@aquiero/contracts';

export interface FrameworkGatewayPolicy {
  readonly requestTimeoutMs: number;
  readonly retryLimit: number;
  readonly retryBaseDelayMs: number;
  readonly maximumResponseBytes: number;
  readonly circuitFailureThreshold: number;
  readonly circuitOpenMs: number;
}

export interface FrameworkRegistrationInput {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly credentialReference: string;
  readonly expectedNativeFrameworkId: string;
  readonly expectedInstanceId: string;
  readonly expectedRelease: string;
  readonly expectedCommit: string;
  readonly policy?: Partial<FrameworkGatewayPolicy>;
}

export interface FrameworkGatewayRegistration {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly credentialReference: string;
  readonly expectedNativeFrameworkId: string;
  readonly expectedInstanceId: string;
  readonly expectedRelease: string;
  readonly expectedCommit: string;
  readonly desiredState: 'active' | 'disabled';
  readonly observedState: 'unknown' | 'available' | 'degraded' | 'unavailable' | 'disabled';
  readonly observedVersion: string | null;
  readonly lastHealthAt: Date | null;
  readonly policy: FrameworkGatewayPolicy;
}

export interface GatewayCredential {
  readonly version: string;
  readonly token: string;
  readonly notAfter?: Date;
}

export interface GatewayCredentialBundle {
  readonly active: GatewayCredential;
  readonly retiring?: GatewayCredential;
}

export interface GatewayCredentialProvider {
  resolve(reference: string, forceRefresh?: boolean): Promise<GatewayCredentialBundle>;
}

export interface PrivateEndpointGuard {
  assertPrivate(endpoint: URL): Promise<void>;
}

export interface CircuitBreaker {
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export type HermesIdentityResponse = Static<typeof HermesIdentityResponseSchema>;
export type HermesVersionResponse = Static<typeof HermesVersionResponseSchema>;
export type HermesHealthResponse = Static<typeof HermesHealthResponseSchema>;
export type HermesCapabilitiesResponse = Static<typeof HermesCapabilitiesResponseSchema>;

export interface FrameworkInspection {
  readonly identity: HermesIdentityResponse;
  readonly version: HermesVersionResponse;
  readonly health: HermesHealthResponse;
  readonly capabilities: HermesCapabilitiesResponse;
  readonly credentialVersion: string;
}

export const DEFAULT_FRAMEWORK_GATEWAY_POLICY: FrameworkGatewayPolicy = Object.freeze({
  requestTimeoutMs: 5_000,
  retryLimit: 2,
  retryBaseDelayMs: 100,
  maximumResponseBytes: 2 * 1024 * 1024,
  circuitFailureThreshold: 3,
  circuitOpenMs: 30_000,
});

export class FrameworkGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503 = 503,
  ) {
    super(message);
    this.name = 'FrameworkGatewayError';
  }
}
