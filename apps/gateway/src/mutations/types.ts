export type MutationTarget = {
  owner: 'hermes' | 'dmm' | 'worker' | 'chat' | 'memory-v4';
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

export type MutationDefinition = {
  owner: MutationTarget['owner'];
  kind: string;
  permission: string;
  executionPath: 'migration-legacy' | 'hermes-control';
  destructive?: boolean;
};

export const frameworkReconcileDefinition: MutationDefinition = {
  owner: 'hermes',
  kind: 'framework',
  permission: 'frameworks.manage',
  executionPath: 'hermes-control',
};

export interface LegacyMutationOwnerClient {
  definition(operationType: string): MutationDefinition;
  validate(input: MutationInput): MutationDefinition;
  execute(input: MutationInput): Promise<unknown>;
  agencyProfileInventory(): Promise<{
    frameworks: unknown;
    profiles: unknown;
    agents: unknown;
  }>;
  agencyProfileContext(
    frameworkId: string,
    profileId?: string,
  ): Promise<{ capabilities: unknown; models: unknown; detail?: unknown }>;
  dmmInventory(): Promise<{
    providers: unknown;
    requirements: unknown;
    credentials: unknown;
    models: unknown;
    normalizedState: unknown;
  }>;
  chatWorkspace(sessionId?: string): Promise<{
    agents: unknown;
    sessions: unknown;
    messages?: unknown;
  }>;
  openChatRealtime(
    onFrame: (frame: unknown) => void,
    onDisconnect: (reason: string) => void,
    lastEventId?: string,
  ): Promise<() => void>;
  download(path: string): Promise<{ body: Buffer; contentType: string; filename: string }>;
}
