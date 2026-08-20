import assert from 'node:assert/strict';

export const HMI_PHASE1_SCHEMA = 'alica-hermes-phase1-inventory/v0.1';
export const APPROVED_TARGET = Object.freeze({
  frameworkId: 'hermes-main',
  adapterContract: 'hermes-control/v1',
  frameworkRelease: '0.20.0',
  frameworkCommit: 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
  composeProject: 'unify',
  composeService: 'hermes-main-adapter',
  containerName: 'unify-hermes-main-adapter-1',
  databaseContainer: 'unify-postgres-1',
});

export const CONTROL_PATHS = Object.freeze({
  identity: '/control/v1/identity',
  version: '/control/v1/version',
  health: '/control/v1/health',
  capabilities: '/control/v1/capabilities',
  profiles: '/control/v1/profiles?limit=100',
  providers: '/control/v1/providers?limit=100',
  models: '/control/v1/models?limit=100',
  projects: '/control/v1/work/projects?limit=100',
  boards: '/control/v1/work/boards?limit=100',
  cronjobs: '/control/v1/work/cronjobs?limit=100',
  sessions: '/control/v1/conversations/sessions?limit=100',
  events: '/control/v1/events?limit=1',
});

export const GAP_MATRIX = Object.freeze([
  {
    id: 'HMI-G01',
    requirementClass: 'exact-runtime-provenance',
    status: 'available',
    owner: 'adapter',
    phase: 1,
  },
  {
    id: 'HMI-G02',
    requirementClass: 'health-capability-inventory',
    status: 'available',
    owner: 'adapter',
    phase: 1,
  },
  {
    id: 'HMI-G03',
    requirementClass: 'canonical-event-envelopes',
    status: 'partial',
    owner: 'adapter',
    phase: 3,
  },
  {
    id: 'HMI-G04',
    requirementClass: 'canonical-resource-projections',
    status: 'partial',
    owner: 'UNIFY',
    phase: 2,
  },
  {
    id: 'HMI-G05',
    requirementClass: 'instance-profile-execution-resources',
    status: 'absent',
    owner: 'UNIFY',
    phase: 2,
  },
  {
    id: 'HMI-G06',
    requirementClass: 'authorization-intersection',
    status: 'absent',
    owner: 'Identity',
    phase: 4,
  },
  {
    id: 'HMI-G07',
    requirementClass: 'product-conversation-linkage',
    status: 'absent',
    owner: '/CHAT',
    phase: 8,
  },
  {
    id: 'HMI-G08',
    requirementClass: 'release-compatibility-edges',
    status: 'partial',
    owner: 'Release',
    phase: 10,
  },
  {
    id: 'HMI-G09',
    requirementClass: 'reason-code-completeness',
    status: 'partial',
    owner: 'adapter',
    phase: 3,
  },
  {
    id: 'HMI-G10',
    requirementClass: 'governed-operation-records',
    status: 'absent',
    owner: 'UNIFY',
    phase: 5,
  },
]);

const safeStatuses = new Set(['supported', 'unsupported', 'unavailable', 'forbidden']);
const safeHealth = new Set(['healthy', 'degraded', 'unavailable']);
const safeHealthChecks = new Set(['cli', 'management', 'conversations', 'eventStore']);
const safeReasons = /^[A-Z][A-Z0-9_]{1,99}$/u;

export function assertExactMetadata(value) {
  assert.equal(value.contractVersion, APPROVED_TARGET.adapterContract);
  assert.equal(value.frameworkId, APPROVED_TARGET.frameworkId);
  assert.equal(value.frameworkVersion, APPROVED_TARGET.frameworkRelease);
  assert.equal(value.frameworkCommit, APPROVED_TARGET.frameworkCommit);
  assert.match(
    value.sourceVersion,
    /^(?:identity|sha256:[a-f0-9]{64}|git:[a-f0-9]{40}|adapter:[A-Za-z0-9._-]+)$/u,
  );
  assert.equal(Number.isNaN(Date.parse(value.observedAt)), false);
}

export function summarizeCapabilities(response) {
  assertExactMetadata(response);
  const counts = { supported: 0, unsupported: 0, unavailable: 0, forbidden: 0 };
  const reasons = new Set();
  for (const capability of Object.values(response.data.capabilities)) {
    assert.equal(safeStatuses.has(capability.status), true);
    counts[capability.status] += 1;
    if (capability.reasonCode) {
      assert.match(capability.reasonCode, safeReasons);
      reasons.add(capability.reasonCode);
    }
  }
  return {
    total: Object.keys(response.data.capabilities).length,
    byStatus: counts,
    safeReasonCodes: [...reasons].sort(),
  };
}

export function summarizeHealth(response) {
  assertExactMetadata(response);
  assert.equal(safeHealth.has(response.data.status), true);
  const checks = {};
  for (const [name, check] of Object.entries(response.data.checks)) {
    assert.equal(safeHealthChecks.has(name), true);
    assert.equal(safeHealth.has(check.status), true);
    checks[name] = check.status;
  }
  return { status: response.data.status, checks };
}

export function summarizeCollection(response) {
  assertExactMetadata(response);
  assert.equal(Array.isArray(response.data.items), true);
  assert.equal(response.data.items.length <= 100, true);
  assert.equal(typeof response.data.page.hasMore, 'boolean');
  return {
    status: 'available',
    observedCount: response.data.items.length,
    exact: response.data.page.hasMore === false,
    hasMore: response.data.page.hasMore,
  };
}

export function unavailableCollection(capability) {
  assert.equal(capability.status, 'unavailable');
  assert.match(capability.reasonCode, safeReasons);
  return {
    status: 'unavailable',
    observedCount: 0,
    exact: false,
    safeReasonCode: capability.reasonCode,
  };
}

export function diagnoseConversations(health, capabilities) {
  const sessions = capabilities.data.capabilities['conversations.sessions.read'];
  const messages = capabilities.data.capabilities['conversations.messages.read'];
  assert.ok(sessions);
  assert.ok(messages);
  if (
    health.data.checks.conversations?.status === 'degraded' &&
    sessions.status === 'unavailable' &&
    messages.status === 'unavailable' &&
    sessions.reasonCode === 'HERMES_API_NOT_CONFIGURED' &&
    messages.reasonCode === 'HERMES_API_NOT_CONFIGURED'
  ) {
    return {
      classification: 'configuration-absent',
      safeCode: 'HERMES_API_NOT_CONFIGURED',
      cutoverBlocked: true,
      owner: 'adapter-deployment',
      contentInspected: false,
    };
  }
  return {
    classification: 'unresolved',
    safeCode: 'CONVERSATION_HEALTH_UNRESOLVED',
    cutoverBlocked: true,
    owner: 'adapter-deployment',
    contentInspected: false,
  };
}

export function summarizeGaps() {
  const byStatus = { available: 0, partial: 0, absent: 0 };
  const byOwner = {};
  for (const gap of GAP_MATRIX) {
    byStatus[gap.status] += 1;
    byOwner[gap.owner] = (byOwner[gap.owner] ?? 0) + 1;
  }
  return { total: GAP_MATRIX.length, byStatus, byOwner, assignments: GAP_MATRIX };
}

export function assertRedactedReport(report) {
  assert.equal(report.schemaVersion, HMI_PHASE1_SCHEMA);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.cursorAdvanced, false);
  assert.equal(report.ownerStorageInspected, false);
  assert.equal(report.redaction.identifiersEmitted, false);
  assert.equal(report.redaction.itemFieldsEmitted, false);
  assert.equal(report.redaction.contentEmitted, false);
  assert.equal(report.redaction.secretReferencesEmitted, false);
  assert.equal(report.redaction.endpointsEmitted, false);
  const serialized = JSON.stringify(report).toLowerCase();
  for (const forbidden of [
    'displayname',
    'instanceid',
    'nextcursor',
    'secret_reference',
    'credential_reference',
    'database_url',
    'bearer ',
    '/home/',
    '/opt/data',
    'https://127.0.0.1',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `sensitive field leaked: ${forbidden}`);
  }
}
