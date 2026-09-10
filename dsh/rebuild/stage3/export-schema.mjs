#!/usr/bin/env node
// Export the schemas actually validated by the gateway. No copied validation model.
import { readFile, writeFile } from 'node:fs/promises';
import { APPLICATION_CONTRACT, ManifestSchema, RequestSchema } from '../../../apps/gateway/dist/applications/contract.js';
const output = new URL('./application-v1.schema.json', import.meta.url);
const bytes = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: APPLICATION_CONTRACT,
  description: 'Frozen syntactic schemas. CONTRACT-V1.md additionally governs authorization, HTTPS/DNS pinning, correction dependencies, evidence verification and lifecycle semantics.',
  definitions: { Manifest: ManifestSchema, Request: RequestSchema },
}, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== bytes) throw new Error('Application contract schema drift');
  console.log('Application v1 schema matches the built gateway validators');
} else {
  await writeFile(output, bytes);
  console.log('Exported Application v1 schema from built gateway validators');
}
