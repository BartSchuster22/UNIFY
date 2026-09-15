import type {
  HermesBoard,
  HermesCronjob,
  HermesControlCommand,
  HermesConversationCommand,
  HermesEventEnvelope,
  HermesMessage,
  HermesModel,
  HermesModelManagementCommand,
  HermesProfile,
  HermesProfileCommand,
  HermesProject,
  HermesProvider,
  HermesSession,
  HermesTask,
  HermesWorkCommand,
  HermesWorkspace,
} from '@aquiero/contracts';

export type CapabilityFamily = 'profiles' | 'providers' | 'models' | 'work' | 'conversations';

export interface Snapshot<T> {
  items: T[];
  sourceVersion: string;
}

export interface AdapterSource {
  profiles(): Promise<Snapshot<HermesProfile>>;
  agentConfiguration?(id: string): Promise<Snapshot<Record<string, any>>>;
  validateAgentConfiguration?(command: HermesProfileCommand): Promise<void>;
  executeProfile(command: HermesProfileCommand): Promise<Record<string, unknown>>;
  providers(refresh?: boolean): Promise<Snapshot<HermesProvider>>;
  models(refresh?: boolean): Promise<Snapshot<HermesModel>>;
  executeModelManagement(command: HermesModelManagementCommand): Promise<Record<string, unknown>>;
  workspaceFiles?(action: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  workspaces?(): Promise<Snapshot<HermesWorkspace>>;
  validateWorkSelections?(command: HermesWorkCommand): Promise<void>;
  projects(): Promise<Snapshot<HermesProject>>;
  boards(): Promise<Snapshot<HermesBoard>>;
  tasks(boardId: string): Promise<Snapshot<HermesTask>>;
  cronjobs(): Promise<Snapshot<HermesCronjob>>;
  executeWork(command: HermesWorkCommand): Promise<Record<string, unknown>>;
  executeConversation(command: HermesConversationCommand): Promise<Record<string, unknown>>;
  sessions(): Promise<Snapshot<HermesSession>>;
  messages(sessionId: string): Promise<Snapshot<HermesMessage>>;
  health(): Promise<Record<string, 'healthy' | 'degraded' | 'unavailable'>>;
  conversationsConfigured(): boolean;
  modelManagementConfigured(): boolean;
}

export interface DerivedEventInput {
  family: CapabilityFamily;
  type: string;
  sourceVersion: string;
  correlationId: string;
  operationId: string;
  payload: Record<string, unknown>;
}

export interface IdempotentCommitInput {
  frameworkId: string;
  capability: string;
  idempotencyKey: string;
  requestHash: string;
  command:
    | HermesControlCommand
    | HermesProfileCommand
    | HermesModelManagementCommand
    | HermesWorkCommand
    | HermesConversationCommand;
  response: Record<string, unknown>;
  events: DerivedEventInput[];
}

export interface IdempotentCommitResult {
  response: Record<string, unknown>;
  replayed: boolean;
  emittedEvents: number;
}

export interface AdapterEventStore {
  ready(): Promise<boolean>;
  replay(
    frameworkId: string,
    capability: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<IdempotentCommitResult | null>;
  commit(input: IdempotentCommitInput): Promise<IdempotentCommitResult>;
  list(frameworkId: string, afterSequence: number, limit: number): Promise<HermesEventEnvelope[]>;
  audit(input: AdapterAuditInput): Promise<void>;
}

export interface AdapterAuditInput {
  frameworkId: string;
  eventType: string;
  outcome: 'success' | 'denied' | 'failure' | 'inconclusive';
  requestId: string;
  correlationId: string;
  actorType?: string;
  actorId?: string;
  operationId?: string;
  safeMetadata: Record<string, unknown>;
}
