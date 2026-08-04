import { setTimeout as delay } from 'node:timers/promises';
import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  HERMES_CONTROL_VERSION,
  HermesCapabilitiesResponseSchema,
  HermesHealthResponseSchema,
  HermesIdentityResponseSchema,
  HermesVersionResponseSchema,
} from '@aquiero/contracts';
import { MemoryCircuitBreaker } from './circuit.js';
import { normalizedPrivateOrigin } from './private-network.js';
import {
  FrameworkGatewayError,
  type CircuitBreaker,
  type FrameworkGatewayPolicy,
  type FrameworkInspection,
  type GatewayCredential,
  type GatewayCredentialBundle,
  type GatewayCredentialProvider,
  type HermesCapabilitiesResponse,
  type HermesHealthResponse,
  type HermesIdentityResponse,
  type HermesVersionResponse,
  type PrivateEndpointGuard,
} from './types.js';

export interface HermesFrameworkClientOptions {
  readonly endpoint: string;
  readonly credentialReference: string;
  readonly expectedNativeFrameworkId: string;
  readonly expectedInstanceId: string;
  readonly expectedRelease: string;
  readonly expectedCommit: string;
  readonly policy: FrameworkGatewayPolicy;
  readonly credentials: GatewayCredentialProvider;
  readonly endpointGuard: PrivateEndpointGuard;
  readonly circuit?: CircuitBreaker;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface ValidatedResponse<T> {
  readonly document: T;
  readonly credentialVersion: string;
}

export class HermesFrameworkClient {
  readonly #origin: URL;
  readonly #fetch: typeof fetch;
  readonly #circuit: CircuitBreaker;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: HermesFrameworkClientOptions) {
    this.#origin = normalizedPrivateOrigin(options.endpoint);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? (async (milliseconds) => delay(milliseconds));
    this.#circuit =
      options.circuit ??
      new MemoryCircuitBreaker(
        options.policy.circuitFailureThreshold,
        options.policy.circuitOpenMs,
      );
  }

  async inspect(): Promise<FrameworkInspection> {
    return this.#circuit.execute(async () => {
      const identity = await this.#get('/control/v1/identity', HermesIdentityResponseSchema);
      this.#validateIdentity(identity.document);
      const version = await this.#get('/control/v1/version', HermesVersionResponseSchema);
      this.#validateVersion(version.document);
      const health = await this.#get('/control/v1/health', HermesHealthResponseSchema);
      const capabilities = await this.#get(
        '/control/v1/capabilities',
        HermesCapabilitiesResponseSchema,
      );
      const versions = new Set([
        identity.credentialVersion,
        version.credentialVersion,
        health.credentialVersion,
        capabilities.credentialVersion,
      ]);
      if (versions.size !== 1)
        throw new FrameworkGatewayError(
          'framework_credential_changed',
          'Framework credential changed during inspection; retry the inspection',
          true,
        );
      return Object.freeze({
        identity: identity.document,
        version: version.document,
        health: health.document,
        capabilities: capabilities.document,
        credentialVersion: identity.credentialVersion,
      });
    });
  }

  async identity(): Promise<HermesIdentityResponse> {
    const response = await this.#circuit.execute(() =>
      this.#get('/control/v1/identity', HermesIdentityResponseSchema),
    );
    this.#validateIdentity(response.document);
    return response.document;
  }

  async version(): Promise<HermesVersionResponse> {
    const response = await this.#circuit.execute(() =>
      this.#get('/control/v1/version', HermesVersionResponseSchema),
    );
    this.#validateVersion(response.document);
    return response.document;
  }

  async health(): Promise<HermesHealthResponse> {
    return (
      await this.#circuit.execute(() => this.#get('/control/v1/health', HermesHealthResponseSchema))
    ).document;
  }

  async capabilities(): Promise<HermesCapabilitiesResponse> {
    return (
      await this.#circuit.execute(() =>
        this.#get('/control/v1/capabilities', HermesCapabilitiesResponseSchema),
      )
    ).document;
  }

  async #get<S extends TSchema>(path: string, schema: S): Promise<ValidatedResponse<Static<S>>> {
    let bundle = await this.options.credentials.resolve(this.options.credentialReference);
    const attempted = new Set<string>();
    let lastUnauthorized = false;

    for (let refresh = 0; refresh < 2; refresh += 1) {
      for (const credential of credentialCandidates(bundle, attempted)) {
        attempted.add(credential.version);
        const response = await this.#requestWithRetries<Static<S>>(path, schema, credential).catch(
          (error: unknown) => {
            if (error instanceof FrameworkGatewayError && error.code === 'framework_unauthorized') {
              lastUnauthorized = true;
              return null;
            }
            throw error;
          },
        );
        if (response) return response;
      }
      bundle = await this.options.credentials.resolve(this.options.credentialReference, true);
    }
    throw new FrameworkGatewayError(
      'framework_unauthorized',
      lastUnauthorized
        ? 'Framework rejected its configured credentials'
        : 'Framework credential is unavailable',
      false,
      401,
    );
  }

  async #requestWithRetries<T>(
    path: string,
    schema: TSchema,
    credential: GatewayCredential,
  ): Promise<ValidatedResponse<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.policy.retryLimit; attempt += 1) {
      if (attempt > 0) await this.#sleep(this.options.policy.retryBaseDelayMs * 2 ** (attempt - 1));
      try {
        return await this.#request<T>(path, schema, credential);
      } catch (error) {
        lastError = error;
        if (!(error instanceof FrameworkGatewayError) || !error.retryable) throw error;
      }
    }
    throw lastError;
  }

  async #request<T>(
    path: string,
    schema: TSchema,
    credential: GatewayCredential,
  ): Promise<ValidatedResponse<T>> {
    await this.options.endpointGuard.assertPrivate(this.#origin);
    const signal = AbortSignal.timeout(this.options.policy.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#origin), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${credential.token}`,
          'user-agent': 'unify-core-framework-gateway/1',
        },
        redirect: 'error',
        signal,
      });
    } catch {
      throw new FrameworkGatewayError(
        signal.aborted ? 'framework_timeout' : 'framework_network_failure',
        signal.aborted ? 'Framework request timed out' : 'Framework network request failed',
        true,
      );
    }

    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new FrameworkGatewayError(
        'framework_unauthorized',
        'Framework rejected its configured credential',
        false,
        401,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryable = new Set([408, 425, 429, 500, 502, 503, 504]).has(response.status);
      throw new FrameworkGatewayError(
        retryable ? 'framework_temporarily_unavailable' : 'framework_request_rejected',
        retryable ? 'Framework is temporarily unavailable' : 'Framework rejected the request',
        retryable,
        response.status === 403 ? 403 : response.status === 404 ? 404 : 502,
      );
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== 'application/json') {
      await response.body?.cancel().catch(() => undefined);
      throw contractViolation();
    }
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > this.options.policy.maximumResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw responseTooLarge();
    }
    const body = await boundedBody(response, this.options.policy.maximumResponseBytes);
    let document: unknown;
    try {
      document = JSON.parse(body) as unknown;
    } catch {
      throw contractViolation();
    }
    if (!Value.Check(schema, document)) throw contractViolation();
    this.#validateMetadata(document as HermesIdentityResponse);
    return { document: document as T, credentialVersion: credential.version };
  }

  #validateMetadata(document: HermesIdentityResponse): void {
    if (
      document.contractVersion !== HERMES_CONTROL_VERSION ||
      document.frameworkId !== this.options.expectedNativeFrameworkId
    )
      throw new FrameworkGatewayError(
        'framework_identity_mismatch',
        'Framework response identity does not match its registration',
        false,
        409,
      );
  }

  #validateIdentity(document: HermesIdentityResponse): void {
    if (
      document.data.runtime !== 'hermes-agent' ||
      document.data.instanceId !== this.options.expectedInstanceId
    )
      throw new FrameworkGatewayError(
        'framework_identity_mismatch',
        'Framework instance identity does not match its registration',
        false,
        409,
      );
  }

  #validateVersion(document: HermesVersionResponse): void {
    if (
      document.data.release !== this.options.expectedRelease ||
      document.data.commit !== this.options.expectedCommit ||
      document.data.dirty
    )
      throw new FrameworkGatewayError(
        'framework_version_mismatch',
        'Framework version does not match its pinned registration',
        false,
        409,
      );
  }
}

function credentialCandidates(
  bundle: GatewayCredentialBundle,
  attempted: ReadonlySet<string>,
): readonly GatewayCredential[] {
  const now = new Date();
  return [bundle.active, bundle.retiring]
    .filter((value): value is GatewayCredential => Boolean(value))
    .filter((value) => !attempted.has(value.version))
    .filter((value) => !value.notAfter || value.notAfter > now);
}

async function boundedBody(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw responseTooLarge();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function contractViolation(): FrameworkGatewayError {
  return new FrameworkGatewayError(
    'framework_contract_invalid',
    'Framework response failed contract validation',
    false,
    502,
  );
}

function responseTooLarge(): FrameworkGatewayError {
  return new FrameworkGatewayError(
    'framework_response_too_large',
    'Framework response exceeded the configured limit',
    false,
    502,
  );
}
