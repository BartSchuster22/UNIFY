import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { PostgresAuthStore } from './auth/postgres-store.js';
import { PostgresGovernanceStore } from './governance/postgres-store.js';
import { PostgresNotificationStore } from './notifications/postgres-store.js';
import { PostgresFrameworkRegistrationStore } from './framework-registry/postgres-store.js';
import { FrameworkRegistryService } from './framework-registry/service.js';
import { HttpFrameworkProbe } from './framework-registry/probe.js';
import { PostgresFrameworkEventJournal } from './hermes-control/event-journal.js';
import { HermesGatewayService } from './hermes-control/service.js';
import { MemoryV4Adapter } from './memory-v4/client.js';
import {
  FrameworkUpdateVisibilityService,
  GitHubTrustedReleaseClient,
  PostgresFrameworkUpdateStore,
  type DeploymentMetadataInput,
} from './framework-updates/index.js';
async function secret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
const databaseUrl = await secret('DATABASE_URL');
const authPepper = await secret('AUTH_PEPPER');

for (const name of (process.env.FRAMEWORK_AUTH_ENV_NAMES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)) {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(name))
    throw new Error('FRAMEWORK_AUTH_ENV_NAMES contains an invalid environment name');
  const file = process.env[`${name}_FILE`];
  if (file) process.env[name] = (await readFile(file, 'utf8')).trim();
}
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
});
const frameworkRegistry = new FrameworkRegistryService(
  new PostgresFrameworkRegistrationStore(pool),
  new HttpFrameworkProbe(),
);
const hermesGateway = new HermesGatewayService(
  frameworkRegistry,
  new PostgresFrameworkEventJournal(pool),
);
const updateRepository = process.env.HERMES_UPSTREAM_REPOSITORY ?? 'NousResearch/hermes-agent';
const deployedImages = {
  'hermes-alica':
    process.env.ALICA_HERMES_RUNTIME_IMAGE ?? requiredEnvironment('HERMES_RUNTIME_IMAGE'),
  'hermes-herman':
    process.env.HERMAN_HERMES_RUNTIME_IMAGE ?? requiredEnvironment('HERMES_RUNTIME_IMAGE'),
} as const;
const deployedVersion = requiredEnvironment('HERMES_DEPLOYED_FRAMEWORK_VERSION');
const deployedCommit = requiredEnvironment('HERMES_DEPLOYED_FRAMEWORK_COMMIT');
if (!/^[a-f0-9]{40}$/.test(deployedCommit))
  throw new Error('HERMES_DEPLOYED_FRAMEWORK_COMMIT must be a full Git commit');
const deploymentInputs: DeploymentMetadataInput[] = (
  Object.keys(deployedImages) as Array<keyof typeof deployedImages>
).map((frameworkId) => {
  const deployedImage = deployedImages[frameworkId];
  const deployedDigest = deployedImage.match(/@(sha256:[a-f0-9]{64})$/)?.[1];
  if (!deployedDigest)
    throw new Error(`${frameworkId} runtime image must be pinned by sha256 digest`);
  return {
    frameworkId,
    releaseId: process.env.RELEASE_ID ?? 'development',
    imageReference: deployedImage,
    imageDigest: deployedDigest,
    frameworkVersion: deployedVersion,
    frameworkCommit: deployedCommit,
  };
});
const frameworkUpdates = new FrameworkUpdateVisibilityService({
  sourceId: 'hermes-agent',
  repository: updateRepository,
  deployments: deploymentInputs,
  store: new PostgresFrameworkUpdateStore(pool),
  client: new GitHubTrustedReleaseClient(updateRepository),
});
const memoryV4Url = process.env.MEMORY_V4_URL?.trim();
const memoryV4ScopePath = process.env.MEMORY_V4_SCOPE_PATH?.trim();
const memoryV4AllowPrivateHttp = process.env.MEMORY_V4_ALLOW_PRIVATE_HTTP?.trim();
if (memoryV4AllowPrivateHttp && !['true', 'false'].includes(memoryV4AllowPrivateHttp))
  throw new Error('MEMORY_V4_ALLOW_PRIVATE_HTTP must be true or false');
if (memoryV4Url && !memoryV4ScopePath)
  throw new Error('MEMORY_V4_SCOPE_PATH is required when MEMORY_V4_URL is configured');
if (!memoryV4Url && memoryV4ScopePath)
  throw new Error('MEMORY_V4_URL is required when MEMORY_V4_SCOPE_PATH is configured');
const memoryV4Adapter = memoryV4Url
  ? new MemoryV4Adapter({
      baseUrl: memoryV4Url,
      bearerToken: await secret('MEMORY_V4_TOKEN'),
      scopePath: memoryV4ScopePath!,
      timeoutMs: Number(process.env.MEMORY_V4_TIMEOUT_MS ?? 8_000),
      maxResponseBytes: Number(process.env.MEMORY_V4_MAX_RESPONSE_BYTES ?? 16 * 1024 * 1024),
      retries: Number(process.env.MEMORY_V4_RETRIES ?? 1),
      allowPrivateHttp: memoryV4AllowPrivateHttp === 'true',
    })
  : undefined;
const app = buildApp({
  authStore: new PostgresAuthStore(pool),
  governanceStore: new PostgresGovernanceStore(pool),
  authPepper,
  secureCookies: process.env.NODE_ENV === 'production',
  release: process.env.RELEASE_ID ?? 'development',
  logger: true,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  notificationStore: new PostgresNotificationStore(pool),
  frameworkRegistry,
  hermesGateway,
  frameworkUpdates,
  ...(memoryV4Adapter ? { memoryV4Adapter } : {}),

  requestRateLimit: Number(process.env.REQUESTS_PER_MINUTE ?? 600),
});
const configuredPollInterval = Number(process.env.HERMES_EVENT_POLL_MS ?? 5_000);
if (!Number.isFinite(configuredPollInterval) || configuredPollInterval < 1_000)
  throw new Error('HERMES_EVENT_POLL_MS must be at least 1000');
const poll = setInterval(() => void hermesGateway.ingestAll(), configuredPollInterval);
poll.unref();
const updateDiscoveryInterval = Number(
  process.env.HERMES_UPDATE_DISCOVERY_INTERVAL_MS ?? 6 * 60 * 60 * 1_000,
);
if (!Number.isFinite(updateDiscoveryInterval) || updateDiscoveryInterval < 60_000)
  throw new Error('HERMES_UPDATE_DISCOVERY_INTERVAL_MS must be at least 60000');
await frameworkUpdates.refresh();
const updatePoll = setInterval(() => void frameworkUpdates.refresh(), updateDiscoveryInterval);
updatePoll.unref();
app.addHook('onClose', async () => {
  clearInterval(poll);
  clearInterval(updatePoll);
});
let shutdown: Promise<void> | undefined;
const close = (signal: NodeJS.Signals): Promise<void> => {
  if (shutdown) return shutdown;
  clearInterval(poll);
  app.log.info({ signal }, 'graceful shutdown started');
  shutdown = (async () => {
    await app.close();
    await pool.end();
    app.log.info({ signal }, 'graceful shutdown complete');
  })();
  return shutdown;
};
const onSignal = (signal: NodeJS.Signals) => {
  void close(signal).catch((error: unknown) => {
    app.log.error({ error, signal }, 'graceful shutdown failed');
    process.exitCode = 1;
  });
};
process.once('SIGTERM', () => onSignal('SIGTERM'));
process.once('SIGINT', () => onSignal('SIGINT'));
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
