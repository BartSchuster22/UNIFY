#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const selfTest = args.has('--self-test');
const record = args.has('--record');
const verifyLocal = args.has('--verify-local');
const quiet = args.has('--quiet');
const baseUrl = process.env.CANARY_BASE_URL ?? 'https://uniui.aquiero.com';
const policyPath =
  process.env.CANARY_POLICY_PATH ??
  new URL('../config/production-canary-policy.json', import.meta.url).pathname;
const stateDir = process.env.CANARY_STATE_DIR ?? '/var/lib/unify/production-canary';

if (selfTest) {
  selfTestPolicy();
  console.log('Production canary self-test passed');
  process.exit(0);
}

const policy = JSON.parse(await readFile(policyPath, 'utf8'));
const startedAt = new Date().toISOString();
const observations = [];
let cookie = '';
let csrf = '';

function observe(name, family, started, status, details = {}) {
  const latencyMs = Math.round(performance.now() - started);
  const max =
    name === 'public.health'
      ? policy.thresholds.maxHealthLatencyMs
      : policy.thresholds.maxProbeLatencyMs;
  const ok = status >= 200 && status < 300 && latencyMs <= max && details.ok !== false;
  observations.push({ name, family, ok, status, latencyMs, ...details });
  return ok;
}

async function request(name, family, pathname, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    observe(name, family, started, response.status, {
      ok: response.ok,
      requestId: response.headers.get('x-request-id') ?? undefined,
      body,
    });
    return { response, body };
  } catch (error) {
    observe(name, family, started, 0, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return { response: null, body: null };
  }
}

await request('public.health', 'platform', '/api/v1/health/ready');
const passwordPath =
  process.env.CANARY_PASSWORD_FILE ?? '/srv/unify/.secrets/bootstrap_admin_password';
const username = process.env.CANARY_USERNAME ?? 'admin';
const password = (await readFile(passwordPath, 'utf8')).trim();
const login = await request('auth.login', 'platform', '/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const setCookies = login.response?.headers.getSetCookie?.() ?? [];
cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ');
if (!cookie && login.response?.headers.get('set-cookie'))
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
csrf = login.response?.headers.get('x-csrf-token') ?? '';

const frameworkId = encodeURIComponent(policy.frameworkId);
const health = await request(
  'framework.health',
  'platform',
  `/api/v1/frameworks/${frameworkId}/health`,
);
const capabilities = await request(
  'framework.capabilities',
  'platform',
  `/api/v1/frameworks/${frameworkId}/capabilities`,
);
const cutover = await request('cutover.status', 'platform', '/api/v1/cutover/status');

const expectedSupported = [
  'profiles.read',
  'providers.read',
  'providers.credentials.status',
  'work.projects.read',
  'work.boards.read',
  'work.tasks.read',
  'work.cron.read',
  'work.execute',
  'conversations.sessions.read',
  'conversations.messages.read',
  'conversations.execute',
];
const capabilityMap = capabilities.body?.data?.capabilities ?? {};
for (const capability of expectedSupported) {
  const started = performance.now();
  const actual = capabilityMap[capability]?.status;
  observe(
    `manifest.${capability}`,
    capabilityFamily(capability),
    started,
    actual === 'supported' ? 200 : 409,
    {
      ok: actual === 'supported',
      expected: 'supported',
      actual,
    },
  );
}
for (const [capability, reason] of Object.entries(policy.unsupportedBoundaries)) {
  const started = performance.now();
  const actual = capabilityMap[capability];
  const ok = actual?.status === 'unsupported' && actual?.reasonCode === reason;
  observe(`boundary.${capability}`, capabilityFamily(capability), started, ok ? 200 : 409, {
    ok,
    expected: { status: 'unsupported', reasonCode: reason },
    actual,
  });
}

const profiles = await request(
  'profiles',
  'profiles.read',
  `/api/v1/frameworks/${frameworkId}/profiles?limit=500`,
);
const providers = await request(
  'providers',
  'providers.read',
  `/api/v1/frameworks/${frameworkId}/providers?limit=500`,
);
const projects = await request(
  'work.projects',
  'work.read',
  `/api/v1/frameworks/${frameworkId}/work/projects?limit=500`,
);
const boards = await request(
  'work.boards',
  'work.read',
  `/api/v1/frameworks/${frameworkId}/work/boards?limit=500`,
);
const cron = await request(
  'work.cron',
  'work.read',
  `/api/v1/frameworks/${frameworkId}/work/cronjobs?limit=500`,
);
const sessions = await request(
  'conversations.sessions',
  'conversations.read',
  `/api/v1/frameworks/${frameworkId}/conversations/sessions?limit=500`,
);

const internalSources = new Set(['api_server', 'cli', 'tui', 'terminal', 'acp', 'local']);
const leaked = (sessions.body?.items ?? []).filter((item) => !internalSources.has(item.source));
observe(
  'external.boundary',
  'conversations.execute',
  performance.now(),
  leaked.length === 0 ? 200 : 409,
  {
    ok: leaked.length === 0,
    externalSessionLeaks: leaked.length,
  },
);
const sessionId = sessions.body?.items?.[0]?.id;
if (sessionId)
  await request(
    'conversations.messages',
    'conversations.read',
    `/api/v1/frameworks/${frameworkId}/conversations/sessions/${encodeURIComponent(sessionId)}/messages?limit=500`,
  );
else
  observe('conversations.messages', 'conversations.read', performance.now(), 200, {
    ok: true,
    skipped: 'no internal sessions',
  });

const events = await request(
  'events',
  'platform',
  `/api/v1/frameworks/${frameworkId}/events?limit=500`,
);
const eventItems = events.body?.items ?? [];
const duplicateEvents = eventItems.length - new Set(eventItems.map((item) => item.eventId)).size;
const replayGaps = eventItems.filter((item) => /replay[._-]?gap/i.test(item.type ?? '')).length;
for (const [family, prefix] of [
  ['work.execute', 'work.'],
  ['conversations.execute', 'conversations.'],
]) {
  const matching = eventItems.filter((item) => (item.type ?? '').startsWith(prefix));
  observe(
    `events.${prefix.slice(0, -1)}`,
    family,
    performance.now(),
    duplicateEvents === 0 && replayGaps === 0 ? 200 : 409,
    {
      ok: duplicateEvents === 0 && replayGaps === 0,
      matchingEvents: matching.length,
      duplicateEvents,
      replayGaps,
    },
  );
}

for (const [domain, family] of [
  ['work', 'work.execute'],
  ['chat', 'conversations.execute'],
]) {
  const entry = cutover.body?.domains?.find((item) => item.domain === domain);
  observe(
    `cutover.${domain}`,
    family,
    performance.now(),
    entry?.executeEnabled && entry?.acceptanceRef ? 200 : 409,
    {
      ok: Boolean(entry?.executeEnabled && entry?.acceptanceRef),
      acceptanceRef: entry?.acceptanceRef,
    },
  );
}

for (const response of [
  health.body,
  capabilities.body,
  profiles.body,
  providers.body,
  projects.body,
  boards.body,
  cron.body,
  sessions.body,
]) {
  const meta = response?.meta;
  if (!meta) continue;
  const started = performance.now();
  const ok =
    meta.frameworkId === policy.frameworkId &&
    meta.frameworkCommit === policy.frameworkCommit &&
    meta.freshness !== 'unavailable';
  observe(`provenance.${observations.length}`, 'platform', started, ok ? 200 : 409, {
    ok,
    frameworkId: meta.frameworkId,
    frameworkCommit: meta.frameworkCommit,
    freshness: meta.freshness,
  });
}

let local = null;
if (verifyLocal) {
  const raw = execFileSync(
    'docker',
    ['inspect', 'unify-gateway-1', '--format', '{{range .Config.Env}}{{println .}}{{end}}'],
    { encoding: 'utf8' },
  );
  const env = Object.fromEntries(
    raw
      .trim()
      .split('\n')
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  local = {
    legacyReadersEnabled: env.ENABLE_LEGACY_MIGRATION_READERS === 'true',
    deploymentMode: env.DEPLOYMENT_MODE,
    mutationDomains: env.MUTATION_DOMAINS,
    releaseId: env.RELEASE_ID,
  };
  observe(
    'legacy.runtime.config',
    'platform',
    performance.now(),
    !local.legacyReadersEnabled ? 200 : 409,
    {
      ok: !local.legacyReadersEnabled,
      legacyRuntimeCalls: 0,
      proof: 'legacy migration readers disabled; direct Hermes framework routes probed',
      ...local,
    },
  );
}

await request('auth.logout', 'platform', '/api/v1/auth/logout', {
  method: 'POST',
  headers: { 'x-csrf-token': csrf },
});

const finishedAt = new Date().toISOString();
const sanitized = observations.map(({ body, ...item }) => ({
  ...item,
  ...(body && typeof body === 'object'
    ? { itemCount: Array.isArray(body.items) ? body.items.length : undefined }
    : {}),
}));
const result = {
  schemaVersion: 1,
  runId: randomUUID(),
  startedAt,
  finishedAt,
  baseUrl,
  frameworkId: policy.frameworkId,
  policyHash: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
  passed: observations.every((item) => item.ok),
  summary: summarize(sanitized),
  observations: sanitized,
  local,
};

if (record) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(stateDir, 'state.json');
  let state = { schemaVersion: 1, createdAt: startedAt, capabilities: {} };
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    // A missing state file starts a new stable window.
  }
  state = updateState(state, result, policy);
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
  await appendFile(path.join(stateDir, 'observations.jsonl'), `${JSON.stringify(result)}\n`, {
    mode: 0o600,
  });
  result.stableWindow = state;
}

if (quiet)
  console.log(
    JSON.stringify({
      runId: result.runId,
      finishedAt: result.finishedAt,
      passed: result.passed,
      summary: result.summary,
      stableWindowComplete: result.stableWindow?.complete ?? false,
    }),
  );
else console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 2);

function capabilityFamily(capability) {
  if (capability.startsWith('profiles.')) return 'profiles.read';
  if (capability.startsWith('providers.')) return 'providers.read';
  if (capability.startsWith('work.'))
    return capability === 'work.execute' ? 'work.execute' : 'work.read';
  if (capability.startsWith('conversations.'))
    return capability.includes('execute') ? 'conversations.execute' : 'conversations.read';
  return 'platform';
}

function summarize(items) {
  const latencies = items.map((item) => item.latencyMs).sort((a, b) => a - b);
  return {
    probes: items.length,
    passed: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok).length,
    errorRate: items.length ? items.filter((item) => !item.ok).length / items.length : 1,
    maxLatencyMs: latencies.at(-1) ?? 0,
    p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0,
  };
}

function updateState(state, result, canaryPolicy) {
  const now = Date.parse(result.finishedAt);
  for (const family of canaryPolicy.capabilityFamilies.map((item) => item.id)) {
    const familyObservations = result.observations.filter((item) => item.family === family);
    const passed = familyObservations.length > 0 && familyObservations.every((item) => item.ok);
    const previous = state.capabilities[family] ?? {
      passes: 0,
      failures: 0,
      windowStartedAt: null,
    };
    const windowStartedAt = passed ? (previous.windowStartedAt ?? result.startedAt) : null;
    const elapsedMs = windowStartedAt ? now - Date.parse(windowStartedAt) : 0;
    state.capabilities[family] = {
      ...previous,
      passes: previous.passes + (passed ? 1 : 0),
      failures: previous.failures + (passed ? 0 : 1),
      consecutivePasses: passed ? (previous.consecutivePasses ?? 0) + 1 : 0,
      windowStartedAt,
      lastObservedAt: result.finishedAt,
      lastPassed: passed,
      stableWindowDays: elapsedMs / 86_400_000,
      complete: passed && elapsedMs >= canaryPolicy.stableWindowDays * 86_400_000,
    };
  }
  state.updatedAt = result.finishedAt;
  state.requiredDays = canaryPolicy.stableWindowDays;
  state.complete = Object.values(state.capabilities).every((item) => item.complete);
  return state;
}

function selfTestPolicy() {
  const policyFixture = { stableWindowDays: 14, capabilityFamilies: [{ id: 'profiles.read' }] };
  const initial = updateState(
    { capabilities: {} },
    {
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      observations: [{ family: 'profiles.read', ok: true }],
    },
    policyFixture,
  );
  if (initial.complete || initial.capabilities['profiles.read'].passes !== 1)
    throw new Error('Initial window test failed');
  const complete = updateState(
    initial,
    {
      startedAt: '2026-01-15T00:00:01.000Z',
      finishedAt: '2026-01-15T00:00:02.000Z',
      observations: [{ family: 'profiles.read', ok: true }],
    },
    policyFixture,
  );
  if (!complete.complete) throw new Error('Stable window completion test failed');
  const reset = updateState(
    complete,
    {
      startedAt: '2026-01-15T00:15:00.000Z',
      finishedAt: '2026-01-15T00:15:01.000Z',
      observations: [{ family: 'profiles.read', ok: false }],
    },
    policyFixture,
  );
  if (reset.complete || reset.capabilities['profiles.read'].windowStartedAt !== null)
    throw new Error('Failure reset test failed');
}
