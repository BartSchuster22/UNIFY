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

export const profileMutationDefinitions: Record<string, MutationDefinition> = {
  'profile.create': {
    owner: 'hermes',
    kind: 'profile',
    permission: 'profiles.manage',
    executionPath: 'hermes-control',
  },
  'profile.update': {
    owner: 'hermes',
    kind: 'profile',
    permission: 'profiles.manage',
    executionPath: 'hermes-control',
  },
  'profile.rename': {
    owner: 'hermes',
    kind: 'profile',
    permission: 'profiles.manage',
    executionPath: 'hermes-control',
    destructive: true,
  },
  'profile.delete': {
    owner: 'hermes',
    kind: 'profile',
    permission: 'profiles.manage',
    executionPath: 'hermes-control',
    destructive: true,
  },
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
  'provider.validate': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'models.manage',
    executionPath: 'hermes-control',
  },
  'provider.models.refresh': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'models.manage',
    executionPath: 'hermes-control',
  },
  'provider.inference.test': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'models.manage',
    executionPath: 'hermes-control',
  },
  'provider.persistence.verify': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'models.manage',
    executionPath: 'hermes-control',
  },
  'provider.oauth.start': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'credentials.manage',
    executionPath: 'hermes-control',
  },
  'provider.oauth.status': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'credentials.manage',
    executionPath: 'hermes-control',
  },
  'provider.oauth.reconnect': {
    owner: 'hermes',
    kind: 'provider',
    permission: 'credentials.manage',
    executionPath: 'hermes-control',
    destructive: true,
  },
  'provider.oauth.disconnect': {
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
  'work.task.run': {
    owner: 'hermes',
    kind: 'profile',
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
