import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, '.secrets');
const force = process.argv.includes('--force');
const secret = () => randomBytes(32).toString('base64url');

await mkdir(directory, { recursive: true, mode: 0o700 });
const postgresPassword = secret();
const values = new Map([
  ['postgres_password', postgresPassword],
  [
    'gateway_database_url',
    `postgresql://unify:${postgresPassword}@127.0.0.1:${process.env.UNIFY_DB_PORT ?? '25432'}/unify`,
  ],
  ['gateway_auth_pepper', secret()],
  ['backup_encryption_key', secret()],
  ['bootstrap_admin_password', secret()],
  ['agency_username', ''],
  ['agency_password', ''],
  ['dmm_username', ''],
  ['dmm_password', ''],
  ['worker_token', ''],
  ['chat_password', ''],
  ['memory_v4_token', ''],
]);
for (const [name, value] of values) {
  const path = resolve(directory, name);
  if (force || !existsSync(path)) await writeFile(path, `${value}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
await chmod(directory, 0o700);
const acl = spawnSync('setfacl', ['-m', 'u:70:--x,u:10001:--x', directory], { encoding: 'utf8' });
if (acl.status !== 0) {
  throw new Error(`setfacl is required for least-privilege Compose secrets: ${acl.stderr.trim()}`);
}
for (const [uid, names] of [
  ['70', ['postgres_password']],
  [
    '10001',
    [
      'gateway_database_url',
      'gateway_auth_pepper',
      'bootstrap_admin_password',
      'agency_username',
      'agency_password',
      'dmm_username',
      'dmm_password',
      'worker_token',
      'chat_password',
      'memory_v4_token',
    ],
  ],
]) {
  const result = spawnSync(
    'setfacl',
    ['-m', `u:${uid}:r--`, ...names.map((name) => resolve(directory, name))],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr.trim());
}
console.log(`Compose secrets are ready in ${directory}; values were not printed.`);
