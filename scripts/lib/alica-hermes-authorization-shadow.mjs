import { createHash } from 'node:crypto';

export const HERMES_AUTHORIZATION_SHADOW_CONTRACT = 'alica-hermes-authorization-shadow/v0.1';
export const HERMES_AUTHORIZATION_SHADOW_DECISION = 'alica-hermes-authorization-shadow-decision/v1';
export const HERMES_AUTHORIZATION_SURFACE = 'alica-hermes-authorization-surface/v1';

const ROUTE_RE = /app\.(get|post|put|patch|delete)(?:<[\s\S]{0,700}?>)?\(\s*['"]([^'"]+)['"]/gu;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

function routes(source, prefix) {
  return [...source.matchAll(ROUTE_RE)]
    .map((match) => ({
      method: match[1].toUpperCase(),
      path: match[2],
      offset: match.index,
    }))
    .filter((route) => route.path.startsWith(prefix));
}

function literalValues(schema) {
  const alternatives = schema.anyOf ?? [];
  return alternatives.map((item) => item.const).filter((value) => typeof value === 'string');
}

function mutationDefinitions(source) {
  const definitions = [];
  const entry =
    /'([^']+)':\s*\{[\s\S]{0,350}?kind:\s*'([^']+)'[\s\S]{0,350}?permission:\s*'([^']+)'[\s\S]{0,350}?executionPath:\s*'hermes-control'[\s\S]{0,120}?\}/gu;
  for (const match of source.matchAll(entry)) {
    definitions.push({ operation: match[1], kind: match[2], permission: match[3] });
  }
  const reconcile =
    /frameworkReconcileDefinition[\s\S]{0,300}?kind:\s*'([^']+)'[\s\S]{0,100}?permission:\s*'([^']+)'/u.exec(
      source,
    );
  if (!reconcile) throw new Error('Framework reconcile definition is absent');
  definitions.push({
    operation: 'framework.reconcile',
    kind: reconcile[1],
    permission: reconcile[2],
  });
  return definitions.sort((left, right) => left.operation.localeCompare(right.operation));
}

function adapterOperation(operation) {
  return operation.startsWith('work.')
    ? operation.slice('work.'.length)
    : operation.startsWith('conversation.')
      ? operation.slice('conversation.'.length)
      : operation;
}

function commandPath(operation) {
  if (operation === 'framework.reconcile') return '/control/v1/commands/reconcile';
  if (operation.startsWith('profile.')) return '/control/v1/commands/profiles';
  if (operation.startsWith('model.') || operation.startsWith('provider.'))
    return '/control/v1/commands/models';
  if (operation.startsWith('work.')) return '/control/v1/commands/work';
  return '/control/v1/commands/conversations';
}

function operationCapability(operation) {
  if (operation === 'framework.reconcile') return 'control.reconcile';
  if (operation.startsWith('profile.')) return 'profiles.execute';
  if (operation.startsWith('provider.credential.') || operation.startsWith('provider.oauth.'))
    return 'providers.credentials.execute';
  if (operation.startsWith('model.') || operation.startsWith('provider.')) return 'models.execute';
  if (operation.startsWith('work.')) return 'work.execute';
  return 'conversations.execute';
}

function operationScope(operation) {
  return operation.startsWith('provider.credential.') || operation.startsWith('provider.oauth.')
    ? 'control:secrets'
    : 'control:execute';
}

function highRisk(operation) {
  return (
    operation.includes('delete') ||
    operation.includes('credential') ||
    operation.includes('oauth') ||
    operation === 'profile.rename' ||
    operation === 'model.select' ||
    operation === 'work.cron.create' ||
    operation === 'work.cron.resume' ||
    operation === 'conversation.message.send'
  );
}

const GATEWAY_ROUTE_POLICY = Object.freeze({
  'GET /api/v1/frameworks': ['frameworks.read', null, 'control:read', true],
  'GET /api/v1/frameworks/:frameworkId': ['frameworks.read', null, 'control:read', false],
  'PUT /api/v1/frameworks/:frameworkId': ['settings.manage', null, 'control:approval', false],
  'DELETE /api/v1/frameworks/:frameworkId': ['settings.manage', null, 'control:approval', false],
  'GET /api/v1/frameworks/:frameworkId/health': [
    'frameworks.read',
    'control.health',
    'control:read',
    false,
  ],
  'GET /api/v1/frameworks/:frameworkId/capabilities': [
    'frameworks.read',
    'control.capabilities',
    'control:read',
    false,
  ],
  'GET /api/v1/frameworks/:frameworkId/profiles': [
    'profiles.read',
    'profiles.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/agents': [
    'profiles.read',
    'profiles.read',
    'control:read',
    true,
  ],
  'POST /api/v1/frameworks/:frameworkId/agents': [
    'profiles.manage',
    'profiles.execute',
    'control:execute',
    false,
  ],
  'PATCH /api/v1/frameworks/:frameworkId/agents/:profileId': [
    'profiles.manage',
    'profiles.execute',
    'control:execute',
    false,
  ],
  'POST /api/v1/frameworks/:frameworkId/agents/:profileId/rename': [
    'profiles.manage',
    'profiles.execute',
    'control:execute',
    false,
  ],
  'DELETE /api/v1/frameworks/:frameworkId/agents/:profileId': [
    'profiles.manage',
    'profiles.execute',
    'control:execute',
    false,
  ],
  'GET /api/v1/frameworks/:frameworkId/providers': [
    'models.read',
    'providers.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/models': [
    'models.read',
    'models.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/work/projects': [
    'work.read',
    'work.projects.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/work/boards': [
    'work.read',
    'work.boards.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/work/boards/:boardId/tasks': [
    'work.read',
    'work.tasks.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/kanban/boards': [
    'work.read',
    'work.boards.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/kanban/boards/:boardId/cards': [
    'work.read',
    'work.tasks.read',
    'control:read',
    true,
  ],
  'POST /api/v1/frameworks/:frameworkId/kanban/boards/:boardId/cards': [
    'work.manage',
    'work.execute',
    'control:execute',
    false,
  ],
  'GET /api/v1/frameworks/:frameworkId/work/cronjobs': [
    'work.read',
    'work.cron.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/conversations/sessions': [
    'chat.read',
    'conversations.sessions.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/conversations/sessions/:sessionId/messages': [
    'chat.read',
    'conversations.messages.read',
    'control:read',
    true,
  ],
  'GET /api/v1/frameworks/:frameworkId/events': [
    'operations.read',
    'events.read',
    'control:events',
    true,
    false,
  ],
});

const ADAPTER_ROUTE_POLICY = Object.freeze({
  'GET /control/v1/identity': ['frameworks.read', null, 'authenticated', false],
  'GET /control/v1/version': ['frameworks.read', null, 'authenticated', false],
  'GET /control/v1/health': ['frameworks.read', 'control.health', 'control:read', false],
  'GET /control/v1/capabilities': [
    'frameworks.read',
    'control.capabilities',
    'control:read',
    false,
  ],
  'GET /control/v1/profiles': ['profiles.read', 'profiles.read', 'control:read', true],
  'GET /control/v1/providers': ['models.read', 'providers.read', 'control:read', true],
  'GET /control/v1/models': ['models.read', 'models.read', 'control:read', true],
  'GET /control/v1/work/projects': ['work.read', 'work.projects.read', 'control:read', true],
  'GET /control/v1/work/boards': ['work.read', 'work.boards.read', 'control:read', true],
  'GET /control/v1/work/boards/:boardId/tasks': [
    'work.read',
    'work.tasks.read',
    'control:read',
    true,
  ],
  'GET /control/v1/work/cronjobs': ['work.read', 'work.cron.read', 'control:read', true],
  'GET /control/v1/conversations/sessions': [
    'chat.read',
    'conversations.sessions.read',
    'control:read',
    true,
  ],
  'GET /control/v1/conversations/sessions/:sessionId/messages': [
    'chat.read',
    'conversations.messages.read',
    'control:read',
    true,
  ],
  'GET /control/v1/events': ['operations.read', 'events.read', 'control:events', true, false],
  'POST /control/v1/commands/reconcile': [
    'frameworks.manage',
    'control.reconcile',
    'control:execute',
    false,
  ],
  'POST /control/v1/commands/profiles': [
    'profiles.manage',
    'profiles.execute',
    'control:execute',
    false,
  ],
  'POST /control/v1/commands/models': ['dynamic', 'dynamic', 'dynamic', false],
  'POST /control/v1/commands/work': ['work.manage', 'work.execute', 'control:execute', false],
  'POST /control/v1/commands/conversations': [
    'chat.use',
    'conversations.execute',
    'control:execute',
    false,
  ],
});

function routeCatalog(discovered, policy, surface) {
  const discoveredKeys = discovered.map(routeKey).sort();
  const policyKeys = Object.keys(policy).sort();
  if (JSON.stringify(discoveredKeys) !== JSON.stringify(policyKeys))
    throw new Error(
      `${surface} route policy does not match discovered source routes; discovered=${JSON.stringify(discoveredKeys)} policy=${JSON.stringify(policyKeys)}`,
    );
  return discovered.map((route) => {
    const [permission, capability, adapterScope, collection, capabilityAdvertised = true] =
      policy[routeKey(route)];
    return {
      key: `${surface}:${routeKey(route)}`,
      surface,
      method: route.method,
      path: route.path,
      permission,
      capability,
      capabilityAdvertised,
      adapterScope,
      collection,
      mode: route.method === 'GET' ? 'read' : 'execute',
    };
  });
}

/** Pure source/schema inventory: callers provide source text and built TypeBox schemas. */
export function inspectHermesAuthorizationSurface(input) {
  const gatewayRoutes = routeCatalog(
    routes(input.gatewaySource, '/api/v1/frameworks'),
    GATEWAY_ROUTE_POLICY,
    'gateway-route',
  );
  for (const action of ['start', 'block', 'unblock', 'complete'])
    gatewayRoutes.push({
      key: `gateway-route:POST /api/v1/frameworks/:frameworkId/kanban/boards/:boardId/cards/:taskId/${action}`,
      surface: 'gateway-route',
      method: 'POST',
      path: `/api/v1/frameworks/:frameworkId/kanban/boards/:boardId/cards/:taskId/${action}`,
      permission: 'work.manage',
      capability: 'work.execute',
      capabilityAdvertised: true,
      adapterScope: 'control:execute',
      collection: false,
      mode: 'execute',
    });
  gatewayRoutes.push({
    key: 'gateway-route:POST /api/v1/mutations',
    surface: 'gateway-route',
    method: 'POST',
    path: '/api/v1/mutations',
    permission: 'mutations.permission(input)',
    capability: 'dynamic',
    capabilityAdvertised: true,
    adapterScope: 'dynamic',
    collection: false,
    mode: 'execute',
  });
  const adapterRoutes = routeCatalog(
    routes(input.adapterSource, '/control/v1/'),
    ADAPTER_ROUTE_POLICY,
    'adapter-route',
  );
  const definitions = mutationDefinitions(input.mutationDefinitionsSource);
  const schemaOperations = [
    ...literalValues(input.schemas.profile).map((operation) => operation),
    ...literalValues(input.schemas.model).map((operation) => operation),
    ...literalValues(input.schemas.work).map((operation) => `work.${operation}`),
    ...literalValues(input.schemas.conversation).map((operation) => `conversation.${operation}`),
    'framework.reconcile',
  ].sort();
  const definitionOperations = definitions.map((item) => item.operation).sort();
  if (JSON.stringify(schemaOperations) !== JSON.stringify(definitionOperations))
    throw new Error('Gateway mutation definitions do not match frozen TypeBox operation unions');
  const operations = definitions.map((definition) => ({
    key: `operation:${definition.operation}`,
    surface: 'operation',
    method: 'POST',
    path: '/api/v1/mutations',
    adapterPath: commandPath(definition.operation),
    operation: definition.operation,
    adapterOperation: adapterOperation(definition.operation),
    kind: definition.kind,
    permission: definition.permission,
    capability: operationCapability(definition.operation),
    capabilityAdvertised: true,
    adapterScope: operationScope(definition.operation),
    collection: false,
    mode: 'execute',
    highRisk: highRisk(definition.operation),
    requiresChatLink: definition.operation.startsWith('conversation.'),
  }));
  const catalog = [...gatewayRoutes, ...adapterRoutes, ...operations];
  return {
    schemaVersion: HERMES_AUTHORIZATION_SURFACE,
    contractVersion: HERMES_AUTHORIZATION_SHADOW_CONTRACT,
    gatewayRoutes,
    adapterRoutes,
    operations,
    catalog,
    dynamicPermissionExpressions: ['mutations.permission(input)'],
    sourceVersion: `sha256:${sha256(JSON.stringify(stable(catalog)))}`,
    mutationPerformed: false,
    enforcementChanged: false,
  };
}

function deny(reasonCode) {
  return { effect: 'deny', reasonCode };
}

function predecessorDecision(input) {
  const predecessor = input.predecessor;
  if (!predecessor.authenticated) return deny('AUTHENTICATION_REQUIRED');
  if (!predecessor.principalActive) return deny('PRINCIPAL_INACTIVE');
  if (!predecessor.permissionGranted) return deny('PERMISSION_DENIED');
  if (!predecessor.adapterScopeAllowed) return deny('ADAPTER_SCOPE_DENIED');
  return { effect: 'allow', reasonCode: 'AUTHORIZED' };
}

function targetDecision(input, predecessor) {
  if (predecessor.effect === 'deny') return predecessor;
  const target = input.target;
  const principal = target.principal;
  if (!principal?.id?.startsWith('prn_')) return deny('PRINCIPAL_BINDING_MISSING');
  if (principal.status !== 'active') return deny('PRINCIPAL_INACTIVE');
  if (!principal.authenticationFresh) return deny('AUTHENTICATION_STALE');
  if (!principal.authenticationStrongEnough) return deny('STEP_UP_REQUIRED');
  const tenant = target.tenant;
  if (!tenant) return deny('TENANT_CONTEXT_MISSING');
  if (tenant.status !== 'active') return deny('TENANT_INACTIVE');
  if (tenant.membershipStatus !== 'active') return deny('MEMBERSHIP_INACTIVE');
  if (!tenant.membershipFresh) return deny('MEMBERSHIP_STALE');
  const client = target.client;
  if (!client?.id?.startsWith('cli_')) return deny('CLIENT_CONTEXT_MISSING');
  if (client.status !== 'active') return deny('CLIENT_INACTIVE');
  if (!client.tenantGrantAllows) return deny('TENANT_CLIENT_GRANT_DENIED');
  if (!client.principalGrantAllows) return deny('PRINCIPAL_CLIENT_GRANT_DENIED');
  const resource = target.resource;
  if (!resource) return deny('RESOURCE_CONTEXT_MISSING');
  if (resource.requestedFrameworkId !== resource.grantedFrameworkId)
    return deny('FRAMEWORK_SCOPE_MISMATCH');
  if (resource.tenantId !== tenant.id) return deny('TENANT_SCOPE_MISMATCH');
  if (!resource.exactGrantAllows) return deny('RESOURCE_GRANT_DENIED');
  if (input.surface.collection && !resource.collectionFiltered)
    return deny('COLLECTION_FILTER_MISSING');
  if (resource.registrationStatus !== 'active') return deny('FRAMEWORK_REGISTRATION_INACTIVE');
  if (!resource.registrationVerified) return deny('FRAMEWORK_REGISTRATION_UNVERIFIED');
  if (!resource.compatibilityAccepted) return deny('FRAMEWORK_COMPATIBILITY_DENIED');
  if (!resource.tenantClientAvailability) return deny('FRAMEWORK_AVAILABILITY_DENIED');
  if (!target.adapterScopeAllows) return deny('ADAPTER_SCOPE_DENIED');
  if (input.surface.capability && input.surface.capability !== 'dynamic') {
    if (input.surface.capabilityAdvertised === false) return deny('CAPABILITY_UNADVERTISED');
    if (!target.capability) return deny('CAPABILITY_UNKNOWN');
    if (target.capability.name !== input.surface.capability) return deny('CAPABILITY_MISMATCH');
    if (target.capability.status === 'unsupported') return deny('CAPABILITY_UNSUPPORTED');
    if (target.capability.status === 'unavailable') return deny('CAPABILITY_UNAVAILABLE');
    if (target.capability.status === 'forbidden') return deny('CAPABILITY_FORBIDDEN');
    if (target.capability.status !== 'supported') return deny('CAPABILITY_UNKNOWN');
    if (!target.capability.modes.includes(input.surface.mode))
      return deny('CAPABILITY_MODE_DENIED');
  }
  const policy = target.policy;
  if (policy.explicitDeny) return deny('EXPLICIT_DENY');
  if (input.surface.highRisk && !policy.projectionFresh) return deny('PROJECTION_STALE');
  if (policy.approvalRequired && !policy.approvalProvided) return deny('APPROVAL_REQUIRED');
  const delegation = target.delegation;
  if (delegation.kind === 'product-agent') {
    if (!delegation.agentId?.startsWith('agt_') || delegation.status !== 'active')
      return deny('AGENT_DELEGATION_INACTIVE');
    if (delegation.tenantId !== tenant.id) return deny('AGENT_TENANT_MISMATCH');
    if (delegation.clientId !== client.id) return deny('AGENT_CLIENT_MISMATCH');
    if (delegation.principalId !== principal.id) return deny('AGENT_PRINCIPAL_MISMATCH');
    if (!delegation.capabilities.includes(input.surface.capability ?? input.surface.permission))
      return deny('AGENT_CAPABILITY_CEILING');
    if (delegation.frameworkId !== resource.requestedFrameworkId)
      return deny('AGENT_FRAMEWORK_MISMATCH');
  }
  if (input.surface.requiresChatLink) {
    const chat = target.chat;
    if (!chat?.conversationId?.startsWith('con_')) return deny('CHAT_LINK_MISSING');
    if (!chat.accessAllows) return deny('CHAT_ACCESS_DENIED');
    if (chat.tenantId !== tenant.id) return deny('CHAT_TENANT_MISMATCH');
    if (chat.clientId !== client.id) return deny('CHAT_CLIENT_MISMATCH');
    if (chat.frameworkId !== resource.requestedFrameworkId) return deny('CHAT_FRAMEWORK_MISMATCH');
    if (chat.nativeSessionId !== resource.nativeResourceId)
      return deny('CHAT_NATIVE_LINK_MISMATCH');
  }
  return { effect: 'allow', reasonCode: 'AUTHORIZED' };
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Input must be an object');
  if (!input.surface || !input.predecessor || !input.target)
    throw new Error('surface, predecessor and target are required');
  for (const key of [
    'authenticated',
    'principalActive',
    'permissionGranted',
    'adapterScopeAllowed',
  ]) {
    if (typeof input.predecessor[key] !== 'boolean')
      throw new Error(`predecessor.${key} must be boolean`);
  }
}

/** Pure evidence-only evaluator. It cannot authorize or dispatch execution. */
export function evaluateHermesAuthorizationShadow(input) {
  validateInput(input);
  const predecessor = predecessorDecision(input);
  const shadowTarget = targetDecision(input, predecessor);
  const comparison =
    predecessor.effect === shadowTarget.effect
      ? 'matched'
      : predecessor.effect === 'allow'
        ? 'tightened'
        : 'widened';
  return {
    schemaVersion: HERMES_AUTHORIZATION_SHADOW_DECISION,
    contractVersion: HERMES_AUTHORIZATION_SHADOW_CONTRACT,
    mode: 'shadow-only',
    enforcementApplied: false,
    executionAuthorized: false,
    mutationPerformed: false,
    evidenceId: `sha256:${sha256(JSON.stringify(stable(input)))}`,
    predecessor,
    shadowTarget,
    comparison,
  };
}
