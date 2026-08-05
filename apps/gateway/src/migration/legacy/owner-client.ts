import { GovernanceError } from '../../governance/service.js';

export type MutationTarget = {
  owner: 'hermes' | 'memory-v4';
  kind: string;
  nativeId: string;
  frameworkId?: string;
};
export type MutationInput = {
  operationType: string;
  target: MutationTarget;
  payload: Record<string, unknown>;
  mode: 'validate' | 'dry-run' | 'execute';
  confirmed: boolean;
};
type OwnerConfig = { memoryUrl: string; memoryToken: string };
export type MutationDefinition = {
  owner: MutationTarget['owner'];
  kind: string;
  permission: string;
  executionPath: 'migration-legacy';
  destructive?: boolean;
};
export const mutationDefinitions: Record<string, MutationDefinition> = {
  'memory.record.write': {
    owner: 'memory-v4',
    kind: 'memory-record',
    permission: 'memory.write',
    executionPath: 'migration-legacy',
  },
};

/** Quarantined MemoryV4 migration client. Native conversations never enter this client. */
export class MutationOwnerClient {
  constructor(private readonly config: OwnerConfig) {}

  static fromEnv(env: NodeJS.ProcessEnv): MutationOwnerClient {
    const required = (name: string) => {
      const value = env[name]?.trim();
      if (!value) throw new Error(`${name} is required for mutation execution`);
      return value;
    };
    return new MutationOwnerClient({
      memoryUrl: required('MEMORY_V4_URL'),
      memoryToken: required('MEMORY_V4_TOKEN'),
    });
  }

  definition(operationType: string): MutationDefinition {
    const definition = mutationDefinitions[operationType];
    if (!definition)
      throw new GovernanceError('MUTATION_UNSUPPORTED', 422, 'Mutation type is not supported');
    return definition;
  }

  validate(input: MutationInput): MutationDefinition {
    const definition = this.definition(input.operationType);
    if (input.target.owner !== definition.owner || input.target.kind !== definition.kind)
      throw new GovernanceError(
        'MUTATION_TARGET_INVALID',
        422,
        'Mutation target does not match operation type',
      );
    if (!input.target.nativeId.trim() || input.target.nativeId.length > 1024)
      throw new GovernanceError('MUTATION_TARGET_INVALID', 422, 'Mutation target id is invalid');
    const role = input.payload.role;
    const lifecycle = input.payload.lifecycle;
    const permitted =
      (role === 'active' && lifecycle === 'working') ||
      (role === 'evidence' && (lifecycle === 'working' || lifecycle === 'live'));
    if (!permitted)
      throw new GovernanceError(
        'MEMORY_WRITE_DENIED',
        403,
        'Only active/working and evidence/working-or-live MemoryV4 records are permitted',
      );
    for (const field of ['entityType', 'entityId', 'topic', 'title', 'content'])
      string(input.payload[field], field);
    return definition;
  }

  async execute(input: MutationInput): Promise<unknown> {
    this.validate(input);
    if (input.mode === 'validate') return { valid: true, operationType: input.operationType };
    if (input.mode === 'dry-run') return { valid: true, dryRun: true };
    const entityType = string(input.payload.entityType, 'entityType');
    const entityId = string(input.payload.entityId, 'entityId');
    const record = { ...input.payload };
    delete record.entityType;
    delete record.entityId;
    const response = await fetch(
      `${base(this.config.memoryUrl)}/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/records`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.memoryToken}`,
        },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024)
      throw new GovernanceError('UPSTREAM_RESPONSE_TOO_LARGE', 502, 'Owner response exceeds 2 MB');
    if (!response.ok) throw upstreamError(response.status, text);
    try {
      return text ? JSON.parse(text) : { ok: true };
    } catch {
      throw new GovernanceError('UPSTREAM_INVALID_RESPONSE', 502, 'Owner returned invalid JSON');
    }
  }
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200_000)
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      `${name} must be a non-empty string`,
    );
  return value;
}
function base(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new GovernanceError('UPSTREAM_URL_INVALID', 500, 'Owner URL protocol is invalid');
  return parsed.toString().replace(/\/$/, '');
}
function upstreamError(status: number, body = ''): GovernanceError {
  const safeDetail = body.slice(0, 256).replace(/[\r\n\t]/g, ' ');
  return new GovernanceError(
    'UPSTREAM_REQUEST_FAILED',
    502,
    `memory-v4 request failed with ${status}${safeDetail ? `: ${safeDetail}` : ''}`,
  );
}
