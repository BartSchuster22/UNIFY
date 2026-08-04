import { createHash } from 'node:crypto';
import { HermesCapabilitiesResponseSchema, type HermesProfileCommand } from '@aquiero/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ulid } from 'ulid';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import type { CapabilityDocument } from '../contracts/v1/capabilities.js';
import { PostgresFrameworkCircuitBreaker } from './circuit.js';
import { HermesFrameworkClient } from './client.js';
import { normalizedPrivateOrigin } from './private-network.js';
import {
  DEFAULT_FRAMEWORK_GATEWAY_POLICY,
  FrameworkGatewayError,
  type FrameworkGatewayPolicy,
  type FrameworkGatewayRegistration,
  type FrameworkInspection,
  type FrameworkRegistrationInput,
  type GatewayCredentialProvider,
  type PrivateEndpointGuard,
} from './types.js';

interface RegistrationRow extends QueryResultRow {
  id: string;
  name: string;
  endpoint: string;
  credential_reference: string;
  desired_state: 'active' | 'disabled';
  observed_state: 'unknown' | 'available' | 'degraded' | 'unavailable' | 'disabled';
  observed_version: string | null;
  last_health_at: Date | null;
  expected_native_framework_id: string;
  expected_instance_id: string;
  expected_release: string;
  expected_commit: string;
  request_timeout_ms: number;
  retry_limit: number;
  retry_base_delay_ms: number;
  maximum_response_bytes: number;
  circuit_failure_threshold: number;
  circuit_open_ms: number;
}

export interface FrameworkGatewayServiceOptions {
  readonly pool: Pool;
  readonly authentication: AuthenticationService;
  readonly credentials: GatewayCredentialProvider;
  readonly endpointGuard: PrivateEndpointGuard;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

export class FrameworkGatewayService {
  readonly #now: () => Date;

  constructor(private readonly options: FrameworkGatewayServiceOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  async registerFramework(
    input: FrameworkRegistrationInput,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<FrameworkGatewayRegistration> {
    await this.options.authentication.authorize(actor, 'frameworks.manage', undefined, context);
    const policy = validatedPolicy(input.policy);
    validateRegistration(input);
    const endpoint = normalizedPrivateOrigin(input.endpoint);
    await this.options.endpointGuard.assertPrivate(endpoint);

    try {
      await transaction(this.options.pool, async (client) => {
        await client.query(
          `INSERT INTO core.frameworks
             (id,name,endpoint,credential_reference)
           VALUES ($1,$2,$3,$4)`,
          [input.id, input.name.trim(), endpoint.origin, input.credentialReference],
        );
        await client.query(
          `INSERT INTO core.framework_gateway_policies
             (framework_id,expected_native_framework_id,expected_instance_id,expected_release,expected_commit,
              request_timeout_ms,retry_limit,retry_base_delay_ms,maximum_response_bytes,
              circuit_failure_threshold,circuit_open_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            input.id,
            input.expectedNativeFrameworkId,
            input.expectedInstanceId,
            input.expectedRelease,
            input.expectedCommit,
            policy.requestTimeoutMs,
            policy.retryLimit,
            policy.retryBaseDelayMs,
            policy.maximumResponseBytes,
            policy.circuitFailureThreshold,
            policy.circuitOpenMs,
          ],
        );
        await client.query(
          'INSERT INTO core.framework_gateway_runtime (framework_id) VALUES ($1)',
          [input.id],
        );
        await audit(client, actor, context, 'framework.gateway.registered', input.id, 'succeeded', {
          nativeFrameworkId: input.expectedNativeFrameworkId,
          instanceId: input.expectedInstanceId,
        });
      });
    } catch (error) {
      if (isPgUniqueViolation(error))
        throw new FrameworkGatewayError(
          'framework_registration_conflict',
          'Framework endpoint, credential, identity, or instance is already registered',
          false,
          409,
        );
      throw error;
    }
    return this.getFramework(input.id, actor, context);
  }

  async registerAlicaAndHerman(
    alica: FrameworkRegistrationInput,
    herman: FrameworkRegistrationInput,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<readonly [FrameworkGatewayRegistration, FrameworkGatewayRegistration]> {
    validateFrameworkPair(alica, herman);
    const first = await this.registerFramework(alica, actor, context);
    const second = await this.registerFramework(herman, actor, context);
    return [first, second];
  }

  async ensureAlicaAndHermanRegistered(
    alica: FrameworkRegistrationInput,
    herman: FrameworkRegistrationInput,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<readonly [FrameworkGatewayRegistration, FrameworkGatewayRegistration]> {
    validateFrameworkPair(alica, herman);
    const first = await this.#ensureFramework(alica, actor, context);
    const second = await this.#ensureFramework(herman, actor, context);
    return [first, second];
  }

  async #ensureFramework(
    input: FrameworkRegistrationInput,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<FrameworkGatewayRegistration> {
    try {
      const existing = await this.getFramework(input.id, actor, context);
      if (!registrationMatchesInput(existing, input)) throw registrationDrift();
      return existing;
    } catch (error) {
      if (!(error instanceof FrameworkGatewayError) || error.code !== 'framework_not_found')
        throw error;
    }
    try {
      return await this.registerFramework(input, actor, context);
    } catch (error) {
      if (
        !(error instanceof FrameworkGatewayError) ||
        error.code !== 'framework_registration_conflict'
      )
        throw error;
      const existing = await this.getFramework(input.id, actor, context);
      if (!registrationMatchesInput(existing, input)) throw registrationDrift();
      return existing;
    }
  }

  async getFramework(
    frameworkId: string,
    actor: AuthenticatedPrincipal,
    context?: RequestContext,
  ): Promise<FrameworkGatewayRegistration> {
    await this.options.authentication.authorize(
      actor,
      'frameworks.read',
      { kind: 'framework', id: frameworkId },
      context,
    );
    const result = await this.options.pool.query<RegistrationRow>(registrationQuery('$1'), [
      frameworkId,
    ]);
    if (!result.rows[0])
      throw new FrameworkGatewayError('framework_not_found', 'Framework was not found', false, 404);
    return registrationFromRow(result.rows[0]);
  }

  async listFrameworks(
    actor: AuthenticatedPrincipal,
    context?: RequestContext,
  ): Promise<readonly FrameworkGatewayRegistration[]> {
    await this.options.authentication.authorize(actor, 'frameworks.read', undefined, context);
    const result = await this.options.pool.query<RegistrationRow>(
      `${registrationQuery()} ORDER BY framework.name,framework.id`,
    );
    return result.rows.map(registrationFromRow);
  }

  async listNativeProfiles(
    frameworkId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    const registration = await this.getFramework(frameworkId, actor, context);
    return this.#nativeClient(registration).profiles();
  }

  async executeNativeProfile(
    frameworkId: string,
    command: HermesProfileCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.options.authentication.authorize(
      actor,
      'profiles.manage',
      { kind: 'framework', id: frameworkId },
      context,
    );
    const registration = await this.getFramework(frameworkId, actor, context);
    return this.#nativeClient(registration).executeProfile(command);
  }

  #nativeClient(registration: FrameworkGatewayRegistration): HermesFrameworkClient {
    const circuit = new PostgresFrameworkCircuitBreaker(
      this.options.pool,
      registration.id,
      registration.policy.circuitFailureThreshold,
      registration.policy.circuitOpenMs,
      registration.policy.requestTimeoutMs * 4 + 5_000,
      this.#now,
    );
    return new HermesFrameworkClient({
      endpoint: registration.endpoint,
      credentialReference: registration.credentialReference,
      expectedNativeFrameworkId: registration.expectedNativeFrameworkId,
      expectedInstanceId: registration.expectedInstanceId,
      expectedRelease: registration.expectedRelease,
      expectedCommit: registration.expectedCommit,
      policy: registration.policy,
      credentials: this.options.credentials,
      endpointGuard: this.options.endpointGuard,
      circuit,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
    });
  }

  async inspectFramework(
    frameworkId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<FrameworkInspection> {
    const registration = await this.getFramework(frameworkId, actor, context);
    if (registration.desiredState !== 'active')
      throw new FrameworkGatewayError(
        'framework_disabled',
        'Framework registration is disabled',
        false,
        409,
      );
    const circuit = new PostgresFrameworkCircuitBreaker(
      this.options.pool,
      frameworkId,
      registration.policy.circuitFailureThreshold,
      registration.policy.circuitOpenMs,
      registration.policy.requestTimeoutMs * 4 + 5_000,
      this.#now,
    );
    const client = new HermesFrameworkClient({
      endpoint: registration.endpoint,
      credentialReference: registration.credentialReference,
      expectedNativeFrameworkId: registration.expectedNativeFrameworkId,
      expectedInstanceId: registration.expectedInstanceId,
      expectedRelease: registration.expectedRelease,
      expectedCommit: registration.expectedCommit,
      policy: registration.policy,
      credentials: this.options.credentials,
      endpointGuard: this.options.endpointGuard,
      circuit,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
    });

    try {
      const inspection = await client.inspect();
      await this.#persistInspection(registration, inspection, actor, context);
      return inspection;
    } catch (error) {
      await audit(
        this.options.pool,
        actor,
        context,
        'framework.gateway.inspection',
        frameworkId,
        'failed',
        {
          code: safeErrorCode(error),
        },
      );
      throw error;
    }
  }

  async #persistInspection(
    registration: FrameworkGatewayRegistration,
    inspection: FrameworkInspection,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<void> {
    const observedAt = this.#now();
    const sourceVersion = `${inspection.version.data.release}+${inspection.version.data.commit}`;
    await transaction(this.options.pool, async (client) => {
      await client.query('SELECT id FROM core.frameworks WHERE id=$1 FOR UPDATE', [
        registration.id,
      ]);
      for (const [kind, document] of [
        ['identity', inspection.identity],
        ['version', inspection.version],
        ['health', inspection.health],
        ['capabilities', inspection.capabilities],
      ] as const) {
        await client.query(
          `INSERT INTO core.framework_gateway_observations
             (id,framework_id,kind,source_version,credential_version,document,observed_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [
            canonicalId('fob'),
            registration.id,
            kind,
            sourceVersion,
            inspection.credentialVersion,
            JSON.stringify(document),
            new Date(document.observedAt),
          ],
        );
      }
      const runtime = await client.query<{ active_credential_version: string | null }>(
        'SELECT active_credential_version FROM core.framework_gateway_runtime WHERE framework_id=$1 FOR UPDATE',
        [registration.id],
      );
      const previousVersion = runtime.rows[0]?.active_credential_version;
      if (previousVersion && previousVersion !== inspection.credentialVersion) {
        await client.query(
          `INSERT INTO core.framework_gateway_token_rotations
             (id,framework_id,previous_version,active_version,observed_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            canonicalId('rot'),
            registration.id,
            previousVersion,
            inspection.credentialVersion,
            observedAt,
          ],
        );
      }
      await client.query(
        `UPDATE core.framework_gateway_runtime
         SET active_credential_version=$2,updated_at=$3 WHERE framework_id=$1`,
        [registration.id, inspection.credentialVersion, observedAt],
      );
      const observedState =
        inspection.health.data.status === 'healthy'
          ? 'available'
          : inspection.health.data.status === 'degraded'
            ? 'degraded'
            : 'unavailable';
      await client.query(
        `UPDATE core.frameworks
         SET observed_state=$2,observed_version=$3,last_health_at=$4 WHERE id=$1`,
        [registration.id, observedState, inspection.version.data.release, observedAt],
      );
      await persistCapabilities(client, registration.id, inspection, observedAt);
      await audit(
        client,
        actor,
        context,
        'framework.gateway.inspection',
        registration.id,
        'succeeded',
        {
          health: inspection.health.data.status,
          credentialVersion: inspection.credentialVersion,
        },
      );
    });
  }
}

async function persistCapabilities(
  client: PoolClient,
  frameworkId: string,
  inspection: FrameworkInspection,
  observedAt: Date,
): Promise<void> {
  const current = await client.query<{ version: number }>(
    'SELECT coalesce(max(document_version),0)::integer AS version FROM core.framework_capability_documents WHERE framework_id=$1',
    [frameworkId],
  );
  const document = normalizedCapabilities(
    frameworkId,
    inspection,
    (current.rows[0]?.version ?? 0) + 1,
    observedAt,
  );
  await client.query(
    `INSERT INTO core.framework_capability_documents
       (framework_id,document_version,protocol,protocol_version,framework_version,schema_digest,document,issued_at,expires_at)
     VALUES ($1,$2,$3,$4,$5,decode($6,'hex'),$7::jsonb,$8,$9)`,
    [
      frameworkId,
      document.documentVersion,
      document.protocol,
      document.protocolVersion,
      document.frameworkVersion,
      document.schemaDigest,
      JSON.stringify(document),
      new Date(document.issuedAt),
      new Date(document.expiresAt),
    ],
  );
}

function normalizedCapabilities(
  frameworkId: string,
  inspection: FrameworkInspection,
  documentVersion: number,
  observedAt: Date,
): CapabilityDocument {
  const mapping = new Map<
    string,
    readonly [CapabilityDocument['capabilities'][number]['name'], 'read' | 'execute']
  >([
    ['profiles.read', ['profiles.read', 'read']],
    ['providers.read', ['providers.read', 'read']],
    ['work.cron.read', ['schedules.read', 'read']],
    ['work.cron.execute', ['schedules.manage', 'execute']],
    ['conversations.execute', ['conversations.respond', 'execute']],
  ]);
  const capabilities: CapabilityDocument['capabilities'][number][] = [
    {
      name: 'health.read',
      version: '1.0.0',
      availability: 'supported',
      operations: ['read'],
      constraints: {
        supportsIdempotency: false,
        supportsExpectedVersion: false,
        transports: ['https'],
      },
    },
  ];
  for (const [nativeKey, native] of Object.entries(inspection.capabilities.data.capabilities)) {
    const target = mapping.get(nativeKey);
    if (!target || native.status === 'unsupported' || native.status === 'forbidden') continue;
    capabilities.push({
      name: target[0],
      version: '1.0.0',
      availability: native.status === 'supported' ? 'supported' : 'temporarily-unavailable',
      operations: [target[1]],
      constraints: {
        supportsIdempotency: target[1] === 'read',
        supportsExpectedVersion: false,
        transports: ['https'],
      },
      ...(native.status === 'unavailable'
        ? { unavailableReason: native.reasonCode ?? 'Framework reported temporary unavailability.' }
        : {}),
    });
  }
  const issuedAt = observedAt.toISOString();
  return {
    protocol: 'hermes-control',
    protocolVersion: '1.0.0',
    frameworkId,
    frameworkInstance: inspection.identity.data.instanceId,
    frameworkVersion: inspection.version.data.release,
    documentVersion,
    issuedAt,
    expiresAt: new Date(observedAt.getTime() + 5 * 60_000).toISOString(),
    schemaDigest: createHash('sha256')
      .update(canonicalJson(HermesCapabilitiesResponseSchema))
      .digest('hex'),
    capabilities,
  };
}

function validatedPolicy(
  input: Partial<FrameworkGatewayPolicy> | undefined,
): FrameworkGatewayPolicy {
  const policy = { ...DEFAULT_FRAMEWORK_GATEWAY_POLICY, ...input };
  const valid =
    Number.isInteger(policy.requestTimeoutMs) &&
    policy.requestTimeoutMs >= 100 &&
    policy.requestTimeoutMs <= 60_000 &&
    Number.isInteger(policy.retryLimit) &&
    policy.retryLimit >= 0 &&
    policy.retryLimit <= 5 &&
    Number.isInteger(policy.retryBaseDelayMs) &&
    policy.retryBaseDelayMs >= 10 &&
    policy.retryBaseDelayMs <= 5_000 &&
    Number.isInteger(policy.maximumResponseBytes) &&
    policy.maximumResponseBytes >= 1_024 &&
    policy.maximumResponseBytes <= 16_777_216 &&
    Number.isInteger(policy.circuitFailureThreshold) &&
    policy.circuitFailureThreshold >= 1 &&
    policy.circuitFailureThreshold <= 20 &&
    Number.isInteger(policy.circuitOpenMs) &&
    policy.circuitOpenMs >= 1_000 &&
    policy.circuitOpenMs <= 3_600_000;
  if (!valid)
    throw new FrameworkGatewayError(
      'framework_policy_invalid',
      'Framework gateway policy is invalid',
      false,
      422,
    );
  return Object.freeze(policy);
}

function validateRegistration(input: FrameworkRegistrationInput): void {
  if (!/^frm_[0-9A-HJKMNP-TV-Z]{26}$/u.test(input.id)) throw invalidRegistration();
  if (input.name.trim().length < 1 || input.name.length > 200) throw invalidRegistration();
  if (
    !/^secret:\/\/[A-Za-z0-9/_.-]+$/u.test(input.credentialReference) ||
    input.credentialReference.length > 500
  )
    throw invalidRegistration();
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(input.expectedNativeFrameworkId))
    throw invalidRegistration();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.expectedInstanceId))
    throw invalidRegistration();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(input.expectedRelease))
    throw invalidRegistration();
  if (!/^[a-f0-9]{40}$/u.test(input.expectedCommit)) throw invalidRegistration();
}

function validateFrameworkPair(
  alica: FrameworkRegistrationInput,
  herman: FrameworkRegistrationInput,
): void {
  if (alica.name.trim().toLowerCase() !== 'alica' || herman.name.trim().toLowerCase() !== 'herman')
    throw new FrameworkGatewayError(
      'framework_pair_invalid',
      'The framework pair must contain Alica and Herman',
      false,
      422,
    );
  if (
    alica.id === herman.id ||
    normalizedPrivateOrigin(alica.endpoint).origin ===
      normalizedPrivateOrigin(herman.endpoint).origin ||
    alica.credentialReference === herman.credentialReference ||
    alica.expectedNativeFrameworkId === herman.expectedNativeFrameworkId ||
    alica.expectedInstanceId === herman.expectedInstanceId
  )
    throw new FrameworkGatewayError(
      'framework_pair_not_isolated',
      'Alica and Herman require independent identities, endpoints, and credentials',
      false,
      422,
    );
}

function registrationMatchesInput(
  existing: FrameworkGatewayRegistration,
  input: FrameworkRegistrationInput,
): boolean {
  const policy = validatedPolicy(input.policy);
  return (
    existing.name === input.name.trim() &&
    existing.endpoint === normalizedPrivateOrigin(input.endpoint).origin &&
    existing.credentialReference === input.credentialReference &&
    existing.expectedNativeFrameworkId === input.expectedNativeFrameworkId &&
    existing.expectedInstanceId === input.expectedInstanceId &&
    existing.expectedRelease === input.expectedRelease &&
    existing.expectedCommit === input.expectedCommit &&
    Object.entries(policy).every(
      ([key, value]) => existing.policy[key as keyof FrameworkGatewayPolicy] === value,
    )
  );
}

function registrationDrift(): FrameworkGatewayError {
  return new FrameworkGatewayError(
    'framework_registration_drift',
    'Existing framework registration does not match the configured identity, endpoint, credential, version, or policy',
    false,
    409,
  );
}

function invalidRegistration(): FrameworkGatewayError {
  return new FrameworkGatewayError(
    'framework_registration_invalid',
    'Framework registration is invalid',
    false,
    422,
  );
}

function registrationQuery(filter = ''): string {
  return `SELECT framework.id,framework.name,framework.endpoint,framework.credential_reference,
    framework.desired_state,framework.observed_state,framework.observed_version,framework.last_health_at,
    policy.expected_native_framework_id,policy.expected_instance_id,policy.expected_release,policy.expected_commit,
    policy.request_timeout_ms,policy.retry_limit,policy.retry_base_delay_ms,policy.maximum_response_bytes,
    policy.circuit_failure_threshold,policy.circuit_open_ms
   FROM core.frameworks framework
   JOIN core.framework_gateway_policies policy ON policy.framework_id=framework.id
   ${filter ? `WHERE framework.id=${filter}` : ''}`;
}

function registrationFromRow(row: RegistrationRow): FrameworkGatewayRegistration {
  return Object.freeze({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    credentialReference: row.credential_reference,
    expectedNativeFrameworkId: row.expected_native_framework_id,
    expectedInstanceId: row.expected_instance_id,
    expectedRelease: row.expected_release,
    expectedCommit: row.expected_commit,
    desiredState: row.desired_state,
    observedState: row.observed_state,
    observedVersion: row.observed_version,
    lastHealthAt: row.last_health_at,
    policy: Object.freeze({
      requestTimeoutMs: row.request_timeout_ms,
      retryLimit: row.retry_limit,
      retryBaseDelayMs: row.retry_base_delay_ms,
      maximumResponseBytes: row.maximum_response_bytes,
      circuitFailureThreshold: row.circuit_failure_threshold,
      circuitOpenMs: row.circuit_open_ms,
    }),
  });
}

async function audit(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  actor: AuthenticatedPrincipal,
  context: RequestContext,
  action: string,
  resourceId: string,
  outcome: 'succeeded' | 'failed',
  details: Readonly<Record<string, unknown>>,
): Promise<void> {
  const requestId = context.requestId?.startsWith('req_') ? context.requestId : canonicalId('req');
  const correlationId = context.correlationId?.startsWith('cor_')
    ? context.correlationId
    : canonicalId('cor');
  await database.query(
    `INSERT INTO core.audit_records
       (id,actor_kind,actor_id,action,resource_kind,resource_id,request_id,correlation_id,outcome,details)
     VALUES ($1,$2,$3,$4,'framework',$5,$6,$7,$8,$9::jsonb)`,
    [
      canonicalId('aud'),
      actor.kind,
      actor.id,
      action,
      resourceId,
      requestId,
      correlationId,
      outcome,
      JSON.stringify(details),
    ],
  );
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

function safeErrorCode(error: unknown): string {
  return error instanceof FrameworkGatewayError ? error.code : 'framework_request_failed';
}

function isPgUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === '23505',
  );
}
