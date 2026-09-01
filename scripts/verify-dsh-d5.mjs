import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const update = readFileSync('dsh/alicactl/internal/update/update.go', 'utf8');
const main = readFileSync('dsh/alicactl/cmd/alicactl/main.go', 'utf8');
for (const token of [
  'alica-update/v1', 'candidate channel', 'pinned root digest mismatch',
  'root threshold', 'metadata rollback or replay rejected',
  'mandatory pre-update backup', 'mandatory backup lacks off-host replication',
  'exact directional source edge', 'definition-only edge',
  'target activation rolled back before acceptance', 'alica-update-state/v1',
  'MutationPerformed', 'manualApproval', 'riskAcceptanceDigest'
]) assert.ok(update.includes(token), `missing D5 control: ${token}`);
for (const command of ['update-plan', 'update']) assert.ok(main.includes(`"${command}"`));
assert.ok(main.includes('1.0.0-d5'));
execFileSync('docker', ['run', '--rm', '-v', `${process.cwd()}/dsh:/src`, '-w', '/src', 'golang:1.24-bookworm', 'sh', '-c', 'test -z "$(gofmt -l alicactl/internal/update/update.go alicactl/cmd/alicactl/main.go)" && cd alicactl && go test -race ./...'], {stdio:'inherit'});
console.log(JSON.stringify({status:'PASS', gate:'D5', controls:15, mutationCommands:['update'], readOnlyCommands:['update-plan']}, null, 2));
