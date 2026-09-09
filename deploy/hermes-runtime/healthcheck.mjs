#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { spawnSync } from 'node:child_process';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const assertServiceUp = (name) => {
  const status = spawnSync('/command/s6-svstat', ['-o', 'up', `/run/service/${name}`], {
    encoding: 'utf8',
  });
  if (status.status !== 0 || status.stdout.trim() !== 'true')
    throw new Error(`${name} is not supervised and up`);
};

const readActiveToken = () => {
  const document = JSON.parse(readFileSync(required('HERMES_ADAPTER_TOKEN_BUNDLE_FILE'), 'utf8'));
  const token = document?.active?.token;
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32)
    throw new Error('The active adapter credential is invalid');
  return token;
};

const getJson = (path, token) =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(process.env.PORT ?? 9443),
        path,
        method: 'GET',
        servername: required('HERMES_ADAPTER_TLS_SERVER_NAME'),
        ca: readFileSync(required('HERMES_ADAPTER_TLS_CA_FILE')),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        timeout: 4_000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('end', () => {
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            reject(new Error(`${path} did not return JSON`));
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`${path} returned HTTP ${response.statusCode}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.once('timeout', () => req.destroy(new Error(`${path} timed out`)));
    req.once('error', reject);
    req.end();
  });

try {
  assertServiceUp('gateway-default');
  assertServiceUp('unify-control-adapter');
  const token = readActiveToken();
  const [health, version] = await Promise.all([
    getJson('/control/v1/health', token),
    getJson('/control/v1/version', token),
  ]);
  if (health?.data?.status !== 'healthy') throw new Error('Adapter source health is not healthy');
  if (version?.frameworkVersion !== required('EXPECTED_HERMES_RELEASE'))
    throw new Error('Adapter framework release does not match the image baseline');
  if (version?.frameworkCommit !== required('EXPECTED_HERMES_COMMIT'))
    throw new Error('Adapter framework commit does not match the image baseline');
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
