import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildOpenApiDocument } from '../packages/contracts/dist/index.js';

const check = process.argv.includes('--check');
const root = resolve(import.meta.dirname, '..');
const openapiPath = join(root, 'openapi', 'openapi.json');
const sdkPath = join(root, 'packages', 'sdk-typescript', 'src', 'schema.d.ts');
const temp = await mkdtemp(join(tmpdir(), 'unify-contracts-'));
try {
  const generatedOpenApi = `${JSON.stringify(buildOpenApiDocument(), null, 2)}${String.fromCharCode(10)}`;
  const tempOpenApi = join(temp, 'openapi.json');
  const tempSdk = join(temp, 'schema.d.ts');
  await writeFile(tempOpenApi, generatedOpenApi);
  execFileSync(
    join(root, 'node_modules', '.bin', 'openapi-typescript'),
    [tempOpenApi, '--output', tempSdk],
    { stdio: 'inherit' },
  );
  if (check) {
    const [currentOpenApi, currentSdk, generatedSdk] = await Promise.all([
      readFile(openapiPath, 'utf8'),
      readFile(sdkPath, 'utf8'),
      readFile(tempSdk, 'utf8'),
    ]);
    if (currentOpenApi !== generatedOpenApi || currentSdk !== generatedSdk) {
      console.error('Generated OpenAPI or SDK is stale. Run pnpm contracts:generate.');
      process.exit(1);
    }
    console.log('Generated contracts are reproducible');
  } else {
    await mkdir(join(root, 'openapi'), { recursive: true });
    await writeFile(openapiPath, generatedOpenApi);
    await writeFile(sdkPath, await readFile(tempSdk, 'utf8'));
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
