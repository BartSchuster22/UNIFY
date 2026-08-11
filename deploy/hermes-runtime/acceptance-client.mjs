#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { randomUUID } from 'node:crypto';

const tokenBundle = JSON.parse(readFileSync(process.env.HERMES_ADAPTER_TOKEN_BUNDLE_FILE, 'utf8'));
const token = tokenBundle.active.token;
const ca = readFileSync(process.env.HERMES_ADAPTER_TLS_CA_FILE);
const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 28082);
const servername = process.env.HERMES_ADAPTER_TLS_SERVER_NAME;
const expectedRelease = process.env.EXPECTED_HERMES_RELEASE;
const expectedCommit = process.env.EXPECTED_HERMES_COMMIT;
assert.match(expectedRelease ?? '', /^[0-9A-Za-z._-]+$/u);
assert.match(expectedCommit ?? '', /^[a-f0-9]{40}$/u);

const call = (method, path, body, authorization = `Bearer ${token}`) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host,
        port,
        servername,
        ca,
        method,
        path,
        timeout: 10_000,
        headers: {
          accept: 'application/json',
          authorization,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': String(payload.length) }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            reject(new Error(`${method} ${path} returned non-JSON HTTP ${response.statusCode}`));
            return;
          }
          resolve({ status: response.statusCode, body: json });
        });
      },
    );
    req.once('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const command = (operation, targetId, payload) => ({
  mode: 'execute',
  operation,
  targetId,
  idempotencyKey: `phase-14-1-${operation}-${randomUUID()}`,
  requestId: randomUUID(),
  correlationId: randomUUID(),
  actor: { type: 'service', id: 'phase-14-1-acceptance' },
  payload,
});

const unauthorized = await call('GET', '/control/v1/identity', undefined, 'Bearer wrong');
assert.equal(unauthorized.status, 401);

const version = await call('GET', '/control/v1/version');
assert.equal(version.status, 200);
assert.equal(version.body.frameworkVersion, expectedRelease);
assert.equal(version.body.frameworkCommit, expectedCommit);
assert.equal(version.body.data.release, expectedRelease);
assert.equal(version.body.data.commit, expectedCommit);

const health = await call('GET', '/control/v1/health');
assert.equal(health.status, 200);
assert.equal(health.body.data.status, 'healthy');
for (const check of ['cli', 'conversations', 'eventStore'])
  assert.equal(health.body.data.checks[check].status, 'healthy');

const projectId = 'phase-14-1-fixture';
const createdProject = await call(
  'POST',
  '/control/v1/commands/work',
  command('project.create', projectId, {
    name: 'Phase 14.1 isolated fixture',
    description: 'Ephemeral combined-image acceptance data',
  }),
);
assert.equal(createdProject.status, 200);
assert.equal(createdProject.body.data.status, 'completed');

const projects = await call('GET', '/control/v1/work/projects');
assert.equal(projects.status, 200);
assert.ok(projects.body.data.items.some((item) => item.id === projectId));
const cliProject = execFileSync(
  '/command/s6-setuidgid',
  ['hermes', '/opt/hermes/bin/hermes', 'project', 'show', projectId],
  { encoding: 'utf8', env: { ...process.env, HOME: '/opt/data', HERMES_HOME: '/opt/data' } },
);
assert.match(cliProject, /Phase 14\.1 isolated fixture/u);

const conversationTitle = `Phase 14.1 loopback ${randomUUID()}`;
const createdSession = await call(
  'POST',
  '/control/v1/commands/conversations',
  command('session.create', 'phase-14-1-session', { title: conversationTitle }),
);
assert.equal(createdSession.status, 200);
assert.equal(createdSession.body.data.status, 'completed');

const sessions = await call('GET', '/control/v1/conversations/sessions');
assert.equal(sessions.status, 200);
const session = sessions.body.data.items.find((item) => item.title === conversationTitle);
assert.ok(session, 'The session created through the adapter was not read back through loopback');
const messages = await call(
  'GET',
  `/control/v1/conversations/sessions/${encodeURIComponent(session.id)}/messages`,
);
assert.equal(messages.status, 200);
assert.ok(Array.isArray(messages.body.data.items));

for (const service of ['unify-hermes-gateway', 'unify-control-adapter']) {
  const result = spawnSync('/command/s6-svstat', ['-o', 'pid', `/run/service/${service}`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${service} is not supervised`);
  const pid = result.stdout.trim();
  assert.match(pid, /^[1-9][0-9]*$/u);
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  assert.match(status, /^Uid:\s+10000\s+10000\s+10000\s+10000$/mu, `${service} is not uid 10000`);
}

const tcp = readFileSync('/proc/net/tcp', 'utf8');
assert.match(tcp, /0100007F:21C2\s/u, 'Hermes native API is not bound to 127.0.0.1:8642');
assert.doesNotMatch(tcp, /00000000:21C2\s/u, 'Hermes native API is externally bound');
assert.match(tcp, /00000000:6DB2\s/u, 'The TLS adapter is not bound on port 28082');

console.log('Hermes combined runtime authenticated contract: PASS');
