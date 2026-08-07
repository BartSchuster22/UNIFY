export type MutationTarget = {
  owner: 'hermes';
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
  executionPath: 'hermes-control';
  destructive?: boolean;
};

export const frameworkReconcileDefinition: MutationDefinition = {
  owner: 'hermes',
  kind: 'framework',
  permission: 'frameworks.manage',
  executionPath: 'hermes-control',
};

export const modelMutationDefinitions: Record<string, MutationDefinition> = {
  'model.select': {
    owner: 'hermes',
    kind: 'model',
    permission: 'models.manage',
    executionPath: 'hermes-control',
  },
  'provider.credential.set': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'credentials.manage',
    executionPath: 'hermes-control',
  },
  'provider.credential.remove': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'credentials.manage',
    executionPath: 'hermes-control',
    destructive: true,
  },
};

export const workMutationDefinitions: Record<string, MutationDefinition> = {
  'work.project.create': {
    owner: 'hermes',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.project.rename': {
    owner: 'hermes',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.project.archive': {
    owner: 'hermes',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'hermes-control',
    destructive: true,
  },
  'work.task.create': {
    owner: 'hermes',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.task.start': {
    owner: 'hermes',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.task.block': {
    owner: 'hermes',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.task.unblock': {
    owner: 'hermes',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.task.complete': {
    owner: 'hermes',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.cron.create': {
    owner: 'hermes',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.cron.run': {
    owner: 'hermes',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.cron.pause': {
    owner: 'hermes',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.cron.resume': {
    owner: 'hermes',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'hermes-control',
  },
  'work.cron.delete': {
    owner: 'hermes',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'hermes-control',
    destructive: true,
  },
};

export const conversationMutationDefinitions: Record<string, MutationDefinition> = {
  'conversation.session.create': {
    owner: 'hermes',
    kind: 'session',
    permission: 'chat.use',
    executionPath: 'hermes-control',
  },
  'conversation.message.send': {
    owner: 'hermes',
    kind: 'session',
    permission: 'chat.use',
    executionPath: 'hermes-control',
  },
};
