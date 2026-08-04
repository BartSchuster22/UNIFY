import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { FileRotatingBearerTokenVerifier } from './token-credentials.js';

const OLD_TOKEN = 'old-adapter-token-with-at-least-thirty-two-bytes';
const NEW_TOKEN = 'new-adapter-token-with-at-least-thirty-two-bytes';

test('rotating bearer verifier accepts overlap and reloads an atomic credential rotation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unify-hermes-token-'));
  const path = join(directory, 'credentials.json');
  try {
    await writeFile(path, JSON.stringify({ active: { version: 'v1', token: OLD_TOKEN } }), {
      mode: 0o600,
    });
    const verifier = new FileRotatingBearerTokenVerifier(path, 0);
    assert.equal(await verifier.verify(OLD_TOKEN), true);
    assert.equal(await verifier.verify(NEW_TOKEN), false);

    await writeFile(
      path,
      JSON.stringify({
        active: { version: 'v2', token: NEW_TOKEN },
        retiring: {
          version: 'v1',
          token: OLD_TOKEN,
          notAfter: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
      { mode: 0o600 },
    );
    assert.equal(await verifier.verify(NEW_TOKEN), true);
    assert.equal(await verifier.verify(OLD_TOKEN), true);

    await writeFile(path, JSON.stringify({ active: { version: 'v2', token: NEW_TOKEN } }), {
      mode: 0o600,
    });
    assert.equal(await verifier.verify(OLD_TOKEN), false);
    assert.equal(await verifier.verify(NEW_TOKEN), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rotating bearer verifier fails closed for malformed and expired documents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unify-hermes-token-invalid-'));
  const path = join(directory, 'credentials.json');
  try {
    const verifier = new FileRotatingBearerTokenVerifier(path, 0);
    await writeFile(path, '{not-json', { mode: 0o600 });
    assert.equal(await verifier.verify(NEW_TOKEN), false);
    await writeFile(
      path,
      JSON.stringify({
        active: {
          version: 'v2',
          token: NEW_TOKEN,
          notAfter: '2020-01-01T00:00:00.000Z',
        },
      }),
      { mode: 0o600 },
    );
    assert.equal(await verifier.verify(NEW_TOKEN), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
