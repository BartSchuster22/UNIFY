import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { buildCoreV1OpenApi } from '../dist/contracts/v1/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../contracts/v1/openapi.json');
const sdkTarget = resolve(here, '../contracts/v1/schema.d.ts');
const configuration = (await resolveConfig(target)) ?? {};
const expected = await format(JSON.stringify(buildCoreV1OpenApi()), {
  ...configuration,
  filepath: target,
});
const temp = await mkdtemp(join(tmpdir(), 'unify-core-contracts-'));
try {
  const tempOpenApi = join(temp, 'openapi.json');
  const tempSdk = join(temp, 'schema.d.ts');
  await writeFile(tempOpenApi, expected, 'utf8');
  execFileSync(
    resolve(here, '../../../node_modules/.bin/openapi-typescript'),
    [tempOpenApi, '--output', tempSdk],
    {
      stdio: 'inherit',
    },
  );
  const [actual, actualSdk, expectedSdkRaw] = await Promise.all([
    readFile(target, 'utf8'),
    readFile(sdkTarget, 'utf8'),
    readFile(tempSdk, 'utf8'),
  ]);
  const expectedSdk = await format(expectedSdkRaw, { ...configuration, filepath: sdkTarget });
  if (actual !== expected || actualSdk !== expectedSdk) {
    console.error(
      'Generated OpenAPI or SDK is stale. Run pnpm --filter @unify/core generate:contracts.',
    );
    process.exitCode = 1;
  } else {
    console.log('Core v1 OpenAPI and TypeScript SDK are current.');
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
