#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import {
  HermesConversationOperationSchema,
  HermesModelManagementOperationSchema,
  HermesProfileOperationSchema,
  HermesWorkOperationSchema,
} from '../packages/contracts/dist/index.js';
import {
  HERMES_AUTHORIZATION_SHADOW_CONTRACT,
  evaluateHermesAuthorizationShadow,
  inspectHermesAuthorizationSurface,
} from './lib/alica-hermes-authorization-shadow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'deploy/five-service/hermes-authorization-shadow-fixtures.v1.json');
const read = (path) => readFileSync(join(root, path), 'utf8');
const inventory = inspectHermesAuthorizationSurface({
  gatewaySource: read('apps/gateway/src/app.ts'),
  adapterSource: read('apps/hermes-control-adapter/src/app.ts'),
  mutationDefinitionsSource: read('apps/gateway/src/mutations/types.ts'),
  schemas: {
    profile: HermesProfileOperationSchema,
    model: HermesModelManagementOperationSchema,
    work: HermesWorkOperationSchema,
    conversation: HermesConversationOperationSchema,
  },
});

const ids = Object.freeze({
  principal: 'prn_018f47e2-9097-7a31-8dd8-21df0f736c3a',
  tenant: 'ten_018f47e2-9097-7a31-8dd8-21df0f736c3b',
  client: 'cli_018f47e2-9097-7a31-8dd8-21df0f736c3c',
  agent: 'agt_018f47e2-9097-7a31-8dd8-21df0f736c3d',
  conversation: 'con_018f47e2-9097-7a31-8dd8-21df0f736c3e',
  framework: 'hermes-main',
  native: 'native-resource-1',
});

const clone = (value) => structuredClone(value);

function inputFor(surface) {
  const requiresChatLink = surface.requiresChatLink === true;
  return {
    surface,
    predecessor: {
      authenticated: true,
      principalActive: true,
      permissionGranted: true,
      adapterScopeAllowed: true,
    },
    target: {
      principal: {
        id: ids.principal,
        status: 'active',
        authenticationFresh: true,
        authenticationStrongEnough: true,
      },
      tenant: {
        id: ids.tenant,
        status: 'active',
        membershipStatus: 'active',
        membershipFresh: true,
      },
      client: {
        id: ids.client,
        status: 'active',
        tenantGrantAllows: true,
        principalGrantAllows: true,
      },
      resource: {
        requestedFrameworkId: ids.framework,
        grantedFrameworkId: ids.framework,
        nativeResourceId: ids.native,
        tenantId: ids.tenant,
        exactGrantAllows: true,
        collectionFiltered: true,
        registrationStatus: 'active',
        registrationVerified: true,
        compatibilityAccepted: true,
        tenantClientAvailability: true,
      },
      adapterScopeAllows: true,
      capability:
        surface.capability && surface.capability !== 'dynamic'
          ? { name: surface.capability, status: 'supported', modes: [surface.mode] }
          : null,
      policy: {
        explicitDeny: false,
        projectionFresh: true,
        approvalRequired: surface.highRisk === true,
        approvalProvided: true,
      },
      delegation: { kind: 'direct' },
      ...(requiresChatLink
        ? {
            chat: {
              conversationId: ids.conversation,
              accessAllows: true,
              tenantId: ids.tenant,
              clientId: ids.client,
              frameworkId: ids.framework,
              nativeSessionId: ids.native,
            },
          }
        : {}),
    },
  };
}

function fixture(name, input, expectedReason) {
  const result = evaluateHermesAuthorizationShadow(input);
  if (expectedReason && result.shadowTarget.reasonCode !== expectedReason)
    throw new Error(`${name}: expected ${expectedReason}, got ${result.shadowTarget.reasonCode}`);
  return {
    name,
    input,
    expected: {
      predecessor: result.predecessor,
      shadowTarget: result.shadowTarget,
      comparison: result.comparison,
    },
  };
}

const coverageFixtures = inventory.catalog.map((surface) =>
  fixture(`coverage:${surface.key}`, inputFor(surface)),
);

const operation = (name) => {
  const found = inventory.operations.find((item) => item.operation === name);
  if (!found) throw new Error(`Operation ${name} is absent`);
  return found;
};
const readSurface = inventory.gatewayRoutes.find((item) => item.path.endsWith('/profiles'));
if (!readSurface) throw new Error('Profile read surface is absent');

const agentInput = inputFor(operation('conversation.message.send'));
agentInput.target.delegation = {
  kind: 'product-agent',
  agentId: ids.agent,
  status: 'active',
  tenantId: ids.tenant,
  clientId: ids.client,
  principalId: ids.principal,
  capabilities: [agentInput.surface.capability],
  frameworkId: ids.framework,
};
const delegationFixtures = [fixture('delegation:product-agent-chat-message-allow', agentInput)];

const negative = [];
function reject(name, expectedReason, surface, mutate) {
  const input = inputFor(surface);
  mutate(input);
  negative.push(fixture(`deny:${name}`, input, expectedReason));
}
const standard = operation('profile.create');
const risky = operation('profile.rename');
const chat = operation('conversation.message.send');

reject('unauthenticated', 'AUTHENTICATION_REQUIRED', standard, (i) => {
  i.predecessor.authenticated = false;
});
reject('inactive-predecessor-principal', 'PRINCIPAL_INACTIVE', standard, (i) => {
  i.predecessor.principalActive = false;
});
reject('legacy-permission', 'PERMISSION_DENIED', standard, (i) => {
  i.predecessor.permissionGranted = false;
});
reject('legacy-adapter-scope', 'ADAPTER_SCOPE_DENIED', standard, (i) => {
  i.predecessor.adapterScopeAllowed = false;
});
reject('canonical-principal-missing', 'PRINCIPAL_BINDING_MISSING', standard, (i) => {
  i.target.principal.id = null;
});
reject('canonical-principal-inactive', 'PRINCIPAL_INACTIVE', standard, (i) => {
  i.target.principal.status = 'inactive';
});
reject('authentication-stale', 'AUTHENTICATION_STALE', standard, (i) => {
  i.target.principal.authenticationFresh = false;
});
reject('step-up-required', 'STEP_UP_REQUIRED', standard, (i) => {
  i.target.principal.authenticationStrongEnough = false;
});
reject('tenant-missing', 'TENANT_CONTEXT_MISSING', standard, (i) => {
  i.target.tenant = null;
});
reject('tenant-inactive', 'TENANT_INACTIVE', standard, (i) => {
  i.target.tenant.status = 'inactive';
});
reject('membership-inactive', 'MEMBERSHIP_INACTIVE', standard, (i) => {
  i.target.tenant.membershipStatus = 'inactive';
});
reject('membership-stale', 'MEMBERSHIP_STALE', standard, (i) => {
  i.target.tenant.membershipFresh = false;
});
reject('client-missing', 'CLIENT_CONTEXT_MISSING', standard, (i) => {
  i.target.client = null;
});
reject('client-inactive', 'CLIENT_INACTIVE', standard, (i) => {
  i.target.client.status = 'inactive';
});
reject('tenant-client-grant', 'TENANT_CLIENT_GRANT_DENIED', standard, (i) => {
  i.target.client.tenantGrantAllows = false;
});
reject('principal-client-grant', 'PRINCIPAL_CLIENT_GRANT_DENIED', standard, (i) => {
  i.target.client.principalGrantAllows = false;
});
reject('resource-missing', 'RESOURCE_CONTEXT_MISSING', standard, (i) => {
  i.target.resource = null;
});
reject('framework-mismatch', 'FRAMEWORK_SCOPE_MISMATCH', standard, (i) => {
  i.target.resource.grantedFrameworkId = 'hermes-other';
});
reject('cross-tenant-resource', 'TENANT_SCOPE_MISMATCH', standard, (i) => {
  i.target.resource.tenantId = 'ten_other';
});
reject('resource-grant', 'RESOURCE_GRANT_DENIED', standard, (i) => {
  i.target.resource.exactGrantAllows = false;
});
reject('collection-unfiltered', 'COLLECTION_FILTER_MISSING', readSurface, (i) => {
  i.target.resource.collectionFiltered = false;
});
reject('registration-inactive', 'FRAMEWORK_REGISTRATION_INACTIVE', standard, (i) => {
  i.target.resource.registrationStatus = 'inactive';
});
reject('registration-unverified', 'FRAMEWORK_REGISTRATION_UNVERIFIED', standard, (i) => {
  i.target.resource.registrationVerified = false;
});
reject('compatibility-denied', 'FRAMEWORK_COMPATIBILITY_DENIED', standard, (i) => {
  i.target.resource.compatibilityAccepted = false;
});
reject('framework-availability', 'FRAMEWORK_AVAILABILITY_DENIED', standard, (i) => {
  i.target.resource.tenantClientAvailability = false;
});
reject('target-adapter-scope', 'ADAPTER_SCOPE_DENIED', standard, (i) => {
  i.target.adapterScopeAllows = false;
});
reject('capability-unknown', 'CAPABILITY_UNKNOWN', standard, (i) => {
  i.target.capability = null;
});
reject('capability-mismatch', 'CAPABILITY_MISMATCH', standard, (i) => {
  i.target.capability.name = 'other.execute';
});
for (const [status, reason] of [
  ['unsupported', 'CAPABILITY_UNSUPPORTED'],
  ['unavailable', 'CAPABILITY_UNAVAILABLE'],
  ['forbidden', 'CAPABILITY_FORBIDDEN'],
]) {
  reject(`capability-${status}`, reason, standard, (i) => {
    i.target.capability.status = status;
  });
}
reject('capability-mode', 'CAPABILITY_MODE_DENIED', standard, (i) => {
  i.target.capability.modes = ['read'];
});
reject('explicit-deny', 'EXPLICIT_DENY', standard, (i) => {
  i.target.policy.explicitDeny = true;
});
reject('high-risk-projection-stale', 'PROJECTION_STALE', risky, (i) => {
  i.target.policy.projectionFresh = false;
});
reject('approval-missing', 'APPROVAL_REQUIRED', risky, (i) => {
  i.target.policy.approvalProvided = false;
});
const agentMutations = [
  ['agent-inactive', 'AGENT_DELEGATION_INACTIVE', (d) => (d.status = 'inactive')],
  ['agent-tenant', 'AGENT_TENANT_MISMATCH', (d) => (d.tenantId = 'ten_other')],
  ['agent-client', 'AGENT_CLIENT_MISMATCH', (d) => (d.clientId = 'cli_other')],
  ['agent-principal', 'AGENT_PRINCIPAL_MISMATCH', (d) => (d.principalId = 'prn_other')],
  ['agent-capability', 'AGENT_CAPABILITY_CEILING', (d) => (d.capabilities = [])],
  ['agent-framework', 'AGENT_FRAMEWORK_MISMATCH', (d) => (d.frameworkId = 'hermes-other')],
];
for (const [name, reason, mutate] of agentMutations) {
  reject(name, reason, chat, (i) => {
    i.target.delegation = clone(agentInput.target.delegation);
    mutate(i.target.delegation);
  });
}
reject('chat-link-missing', 'CHAT_LINK_MISSING', chat, (i) => {
  i.target.chat = null;
});
reject('chat-access', 'CHAT_ACCESS_DENIED', chat, (i) => {
  i.target.chat.accessAllows = false;
});
reject('chat-tenant', 'CHAT_TENANT_MISMATCH', chat, (i) => {
  i.target.chat.tenantId = 'ten_other';
});
reject('chat-client', 'CHAT_CLIENT_MISMATCH', chat, (i) => {
  i.target.chat.clientId = 'cli_other';
});
reject('chat-framework', 'CHAT_FRAMEWORK_MISMATCH', chat, (i) => {
  i.target.chat.frameworkId = 'hermes-other';
});
reject('chat-native-link', 'CHAT_NATIVE_LINK_MISMATCH', chat, (i) => {
  i.target.chat.nativeSessionId = 'native-other';
});
reject('chat-access-does-not-grant-raw-hermes', 'RESOURCE_GRANT_DENIED', readSurface, (i) => {
  i.target.resource.exactGrantAllows = false;
  i.target.chat = clone(inputFor(chat).target.chat);
});

const document = {
  schemaVersion: 'alica-hermes-authorization-shadow-fixtures/v1',
  contractVersion: HERMES_AUTHORIZATION_SHADOW_CONTRACT,
  sourceVersion: inventory.sourceVersion,
  generatedFrom: {
    gateway: 'apps/gateway/src/app.ts',
    adapter: 'apps/hermes-control-adapter/src/app.ts',
    mutationDefinitions: 'apps/gateway/src/mutations/types.ts',
    typebox: [
      'HermesProfileOperationSchema',
      'HermesModelManagementOperationSchema',
      'HermesWorkOperationSchema',
      'HermesConversationOperationSchema',
    ],
  },
  boundary: {
    mode: 'shadow-only',
    enforcementApplied: false,
    executionAuthorized: false,
    liveAccess: false,
    mutationPerformed: false,
  },
  inventory: {
    gatewayRoutes: inventory.gatewayRoutes.length,
    adapterRoutes: inventory.adapterRoutes.length,
    operations: inventory.operations.length,
    dynamicPermissionExpressions: inventory.dynamicPermissionExpressions,
  },
  fixtures: [...coverageFixtures, ...delegationFixtures, ...negative],
};
const generated = await format(JSON.stringify(document), { parser: 'json' });
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== generated) {
    process.stderr.write('Hermes authorization shadow fixtures are stale\n');
    process.exit(1);
  }
  process.stdout.write(
    `Hermes authorization shadow fixtures current: gatewayRoutes=${document.inventory.gatewayRoutes} adapterRoutes=${document.inventory.adapterRoutes} operations=${document.inventory.operations} fixtures=${document.fixtures.length}\n`,
  );
} else {
  writeFileSync(target, generated, { mode: 0o600 });
  process.stdout.write(`Generated ${target}\n`);
}
