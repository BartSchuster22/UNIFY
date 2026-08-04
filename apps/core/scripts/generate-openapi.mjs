import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { buildCoreV1OpenApi } from '../dist/contracts/v1/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../contracts/v1/openapi.json');
await mkdir(dirname(target), { recursive: true });
const configuration = (await resolveConfig(target)) ?? {};
const document = await format(JSON.stringify(buildCoreV1OpenApi()), {
  ...configuration,
  filepath: target,
});
await writeFile(target, document, 'utf8');
console.log(target);
