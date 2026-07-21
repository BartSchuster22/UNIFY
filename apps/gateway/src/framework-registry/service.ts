import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkRegistration,
  type FrameworkRegistrationInput,
} from '@aquiero/contracts';
import type {
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

  async register(input: FrameworkRegistrationInput): Promise<FrameworkRegistration> {
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
      version.contractVersion !== input.expectedContractVersion
    )
      throw new FrameworkRegistryError(
        'UNSUPPORTED_CONTRACT_VERSION',
        422,
        'Framework returned an unsupported contract',
      );
    if (identity.frameworkId !== input.frameworkId || version.frameworkId !== input.frameworkId)
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
      status: input.enabled ? 'verified' : 'disabled',
      enabled: input.enabled,
      verifiedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return publicRegistration(await this.store.upsert(record));
  }

  async remove(frameworkId: string) {
    return this.store.remove(frameworkId);
  }
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
