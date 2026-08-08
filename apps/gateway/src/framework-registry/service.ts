import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkRegistration,
  type FrameworkRegistrationInput,
  type FrameworkScope,
} from '@aquiero/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  FrameworkConnection,
  FrameworkProbe,
  FrameworkRegistrationRecord,
  FrameworkRegistrationStore,
} from './types.js';

export class FrameworkRegistryError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class FrameworkRegistryService {
  constructor(
    private readonly store: FrameworkRegistrationStore,
    private readonly probe: FrameworkProbe,
    private readonly resolveAuth: (reference: string) => string | undefined = (reference) => {
      const name = /^env:([A-Z][A-Z0-9_]{2,127})$/.exec(reference)?.[1];
      return name ? process.env[name] : undefined;
    },
  ) {}

  async ready() {
    return this.store.ready();
  }

  async list(): Promise<FrameworkRegistration[]> {
    return (await this.store.list()).map(publicRegistration);
  }

  async get(frameworkId: string): Promise<FrameworkRegistration | null> {
    const value = await this.store.get(frameworkId);
    return value ? publicRegistration(value) : null;
  }

  async authenticateBearer(
    bearerToken: string | undefined,
    requiredScope: Extract<FrameworkScope, 'memory:read' | 'memory:write'>,
  ): Promise<{ frameworkId: string; scopes: FrameworkScope[] }> {
    if (!bearerToken || bearerToken.length < 16 || bearerToken.length > 4_096)
      throw new FrameworkRegistryError(
        'FRAMEWORK_AUTH_INVALID',
        401,
        'Framework service authentication is invalid',
      );
    let matched: FrameworkRegistrationRecord | undefined;
    let matches = 0;
    for (const record of await this.store.list()) {
      const expected = this.resolveAuth(record.serviceAuthReference);
      if (expected && sameSecret(expected, bearerToken)) {
        matched = record;
        matches += 1;
      }
    }
    if (matches !== 1 || !matched || !matched.enabled || matched.status !== 'verified')
      throw new FrameworkRegistryError(
        'FRAMEWORK_AUTH_INVALID',
        401,
        'Framework service authentication is invalid',
      );
    if (!matched.scopes.includes(requiredScope))
      throw new FrameworkRegistryError(
        'FRAMEWORK_SCOPE_DENIED',
        403,
        'Framework registration does not grant the required scope',
      );
    return { frameworkId: matched.frameworkId, scopes: [...matched.scopes] };
  }

  async connection(
    frameworkId: string,
    requiredScope: FrameworkScope,
  ): Promise<FrameworkConnection> {
    const record = await this.store.get(frameworkId);
    if (!record)
      throw new FrameworkRegistryError('FRAMEWORK_NOT_FOUND', 404, 'Framework not found');
    if (!record.enabled || record.status !== 'verified')
      throw new FrameworkRegistryError(
        'FRAMEWORK_UNAVAILABLE',
        503,
        'Framework registration is not enabled and verified',
      );
    if (!record.scopes.includes(requiredScope))
      throw new FrameworkRegistryError(
        'FRAMEWORK_SCOPE_DENIED',
        403,
        'Framework registration does not grant the required scope',
      );
    const bearerToken = this.resolveAuth(record.serviceAuthReference);
    if (!bearerToken)
      throw new FrameworkRegistryError(
        'SERVICE_AUTH_UNAVAILABLE',
        503,
        'Framework service authentication is unavailable',
      );
    return {
      frameworkId: record.frameworkId,
      baseUrl: record.baseUrl,
      bearerToken,
      scopes: [...record.scopes],
      frameworkVersion: record.frameworkVersion,
      frameworkCommit: record.frameworkCommit,
    };
  }

  async register(input: FrameworkRegistrationInput): Promise<FrameworkRegistration> {
    return (await this.reconcile(input)).registration;
  }

  async reconcile(
    input: FrameworkRegistrationInput,
  ): Promise<{ registration: FrameworkRegistration; changed: boolean }> {
    validateBaseUrl(input.baseUrl);
    if (input.expectedContractVersion !== HERMES_CONTROL_VERSION)
      throw new FrameworkRegistryError(
        'UNSUPPORTED_CONTRACT_VERSION',
        422,
        'Unsupported Hermes control contract',
      );
    if (
      input.expectedFrameworkVersion !== PINNED_HERMES_RELEASE ||
      input.expectedFrameworkCommit !== PINNED_HERMES_COMMIT
    )
      throw new FrameworkRegistryError(
        'UNSUPPORTED_FRAMEWORK_VERSION',
        422,
        'Unsupported Hermes framework baseline',
      );
    const token = this.resolveAuth(input.serviceAuthReference);
    if (!token)
      throw new FrameworkRegistryError(
        'SERVICE_AUTH_UNAVAILABLE',
        422,
        'Service authentication reference is unavailable',
      );

    let observed;
    try {
      observed = await this.probe.inspect(normalizeBaseUrl(input.baseUrl), token);
    } catch {
      throw new FrameworkRegistryError(
        'FRAMEWORK_PROBE_FAILED',
        422,
        'Framework contract probe failed',
      );
    }
    const identity = observed.identity;
    const version = observed.version;
    if (
      identity.contractVersion !== input.expectedContractVersion ||
      version.contractVersion !== input.expectedContractVersion ||
      observed.capabilities.contractVersion !== input.expectedContractVersion
    )
      throw new FrameworkRegistryError(
        'UNSUPPORTED_CONTRACT_VERSION',
        422,
        'Framework returned an unsupported contract',
      );
    if (
      identity.frameworkId !== input.frameworkId ||
      version.frameworkId !== input.frameworkId ||
      observed.capabilities.frameworkId !== input.frameworkId
    )
      throw new FrameworkRegistryError(
        'FRAMEWORK_ID_MISMATCH',
        422,
        'Framework identity does not match registration',
      );
    if (
      version.data.release !== input.expectedFrameworkVersion ||
      version.data.commit !== input.expectedFrameworkCommit ||
      version.frameworkCommit !== input.expectedFrameworkCommit
    )
      throw new FrameworkRegistryError(
        'UNSUPPORTED_FRAMEWORK_VERSION',
        422,
        'Framework does not match the pinned baseline',
      );

    const now = new Date().toISOString();
    const existing = await this.store.get(input.frameworkId);
    const desiredStatus = input.enabled ? 'verified' : 'disabled';
    if (
      existing &&
      existing.displayName === input.displayName &&
      existing.baseUrl === normalizeBaseUrl(input.baseUrl) &&
      existing.serviceAuthReference === input.serviceAuthReference &&
      existing.enabled === input.enabled &&
      existing.status === desiredStatus &&
      existing.contractVersion === input.expectedContractVersion &&
      existing.frameworkVersion === input.expectedFrameworkVersion &&
      existing.frameworkCommit === input.expectedFrameworkCommit &&
      sameScopes(existing.scopes, input.scopes)
    )
      return { registration: publicRegistration(existing), changed: false };
    const record: FrameworkRegistrationRecord = {
      frameworkId: input.frameworkId,
      displayName: input.displayName,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      serviceAuthReference: input.serviceAuthReference,
      serviceAuthConfigured: true,
      scopes: [...input.scopes],
      contractVersion: input.expectedContractVersion,
      frameworkVersion: input.expectedFrameworkVersion,
      frameworkCommit: input.expectedFrameworkCommit,
      status: desiredStatus,
      enabled: input.enabled,
      verifiedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return { registration: publicRegistration(await this.store.upsert(record)), changed: true };
  }

  async remove(frameworkId: string) {
    return this.store.remove(frameworkId);
  }
}

function sameSecret(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function sameScopes(left: readonly FrameworkScope[], right: readonly FrameworkScope[]) {
  const sortedRight = [...right].sort();
  return (
    left.length === sortedRight.length &&
    [...left].sort().every((scope, index) => scope === sortedRight[index])
  );
}

function publicRegistration(record: FrameworkRegistrationRecord): FrameworkRegistration {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'serviceAuthReference'),
  ) as FrameworkRegistration;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function validateBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FrameworkRegistryError('INVALID_FRAMEWORK_URL', 422, 'Framework URL is invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password
  )
    throw new FrameworkRegistryError(
      'INVALID_FRAMEWORK_URL',
      422,
      'Framework URL must use HTTPS or loopback HTTP and contain no credentials',
    );
  if (url.pathname !== '/' || url.search || url.hash)
    throw new FrameworkRegistryError(
      'INVALID_FRAMEWORK_URL',
      422,
      'Framework URL must be an origin without path, query, or fragment',
    );
}
