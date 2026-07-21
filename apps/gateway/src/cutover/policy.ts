import { GovernanceError } from '../governance/service.js';
import {
  mutationDefinitions,
  type MutationInput,
  type MutationTarget,
} from '../mutations/owner-client.js';

export const mutationDomains = ['profiles', 'dmm', 'worker', 'chat', 'memory-v4'] as const;
export type MutationDomain = (typeof mutationDomains)[number];
export type DeploymentMode = 'read-only' | 'mutation-canary';

const ownerDomain: Record<MutationTarget['owner'], MutationDomain> = {
  hermes: 'profiles',
  dmm: 'dmm',
  worker: 'worker',
  chat: 'chat',
  'memory-v4': 'memory-v4',
};

export type DomainStatus = {
  domain: MutationDomain;
  executeEnabled: boolean;
  acceptanceRef: string | null;
  rollback: 'remove-domain-and-redeploy';
};

export class CutoverPolicy {
  readonly mode: DeploymentMode;
  readonly #enabled: ReadonlySet<MutationDomain>;
  readonly #acceptance: ReadonlyMap<MutationDomain, string>;

  constructor(input: {
    mode: DeploymentMode;
    enabled?: Iterable<MutationDomain>;
    acceptance?: Iterable<readonly [MutationDomain, string]>;
  }) {
    this.mode = input.mode;
    this.#enabled = new Set(input.enabled ?? []);
    this.#acceptance = new Map(input.acceptance ?? []);
    if (this.mode === 'read-only' && this.#enabled.size)
      throw new Error('Read-only deployment cannot enable mutation domains');
    for (const domain of this.#enabled) {
      if (!this.#acceptance.get(domain))
        throw new Error(`Mutation domain ${domain} requires a written acceptance reference`);
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv): CutoverPolicy {
    const rawMode = env.DEPLOYMENT_MODE?.trim() || 'read-only';
    if (rawMode !== 'read-only' && rawMode !== 'mutation-canary')
      throw new Error('DEPLOYMENT_MODE must be read-only or mutation-canary');
    const enabled = parseDomains(env.MUTATION_DOMAINS);
    const acceptance = parseAcceptance(env.MUTATION_ACCEPTANCE_REFS);
    return new CutoverPolicy({ mode: rawMode, enabled, acceptance });
  }

  assertAllowed(input: MutationInput): void {
    if (input.mode !== 'execute') return;
    const definition = mutationDefinitions[input.operationType];
    if (!definition || definition.executionPath !== 'hermes-control')
      throw new GovernanceError(
        'LEGACY_WRITE_CONTAINED',
        403,
        'Execution is blocked because this operation still targets a migration-only legacy adapter',
      );
    const domain = ownerDomain[input.target.owner];
    if (this.mode === 'read-only')
      throw new GovernanceError(
        'DEPLOYMENT_READ_ONLY',
        403,
        'This deployment is read-only; owner execution is disabled',
      );
    if (!this.#enabled.has(domain))
      throw new GovernanceError(
        'MUTATION_DOMAIN_DISABLED',
        403,
        `Mutation execution for ${domain} is disabled`,
      );
  }

  status(): {
    mode: DeploymentMode;
    domains: DomainStatus[];
    legacyServicesRetained: true;
    legacyWritesContained: true;
  } {
    return {
      mode: this.mode,
      domains: mutationDomains.map((domain) => ({
        domain,
        executeEnabled: false,
        acceptanceRef: this.#acceptance.get(domain) ?? null,
        rollback: 'remove-domain-and-redeploy',
      })),
      legacyServicesRetained: true,
      legacyWritesContained: true,
    };
  }
}

function parseDomains(value?: string): MutationDomain[] {
  if (!value?.trim()) return [];
  const domains = value.split(',').map((entry) => entry.trim());
  for (const domain of domains) {
    if (!mutationDomains.includes(domain as MutationDomain))
      throw new Error(`Unknown mutation domain: ${domain}`);
  }
  return [...new Set(domains as MutationDomain[])];
}

function parseAcceptance(value?: string): Array<[MutationDomain, string]> {
  if (!value?.trim()) return [];
  return value.split(',').map((entry) => {
    const [domain, reference, extra] = entry.split('=');
    if (extra !== undefined || !domain || !reference)
      throw new Error('MUTATION_ACCEPTANCE_REFS must use domain=reference entries');
    if (!mutationDomains.includes(domain as MutationDomain))
      throw new Error(`Unknown mutation acceptance domain: ${domain}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,199}$/.test(reference))
      throw new Error(`Mutation acceptance reference for ${domain} is invalid`);
    return [domain as MutationDomain, reference];
  });
}
