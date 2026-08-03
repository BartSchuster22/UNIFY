#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const directory = mkdtempSync(resolve(tmpdir(), 'unify-backup-retention-'));
const script = resolve(new URL('.', import.meta.url).pathname, 'prune-gateway-backups.mjs');

try {
  const start = new Date('2026-07-01T01:30:00Z');
  for (let index = 0; index < 34; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const stamp = date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '');
    const artifact = resolve(directory, `gateway-${stamp}.tar.enc`);
    writeFileSync(artifact, `backup-${index}\n`);
    writeFileSync(`${artifact}.sha256`, `checksum-${index}\n`);
  }
  writeFileSync(resolve(directory, 'phase7-rehearsal.tar.enc'), 'protected\n');

  const output = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKUP_DIR: directory,
      BACKUP_KEEP_DAILY: '3',
      BACKUP_KEEP_WEEKLY: '2',
    },
  });
  const report = JSON.parse(output);
  if (report.retained.length !== 5) {
    throw new Error(`expected five retained artifacts, got ${report.retained.length}`);
  }
  if (report.deleted.length !== 29) {
    throw new Error(`expected 29 deleted artifacts, got ${report.deleted.length}`);
  }
  const remainingArtifacts = readdirSync(directory).filter((name) => name.endsWith('.tar.enc'));
  if (remainingArtifacts.length !== 6) {
    throw new Error(
      `expected five retained Gateway artifacts and one protected artifact, got ${remainingArtifacts.length}`,
    );
  }
  if (!remainingArtifacts.includes('phase7-rehearsal.tar.enc')) {
    throw new Error('non-Gateway evidence artifact was deleted');
  }
  const orphanChecksums = readdirSync(directory).filter(
    (name) =>
      name.startsWith('gateway-') &&
      name.endsWith('.sha256') &&
      !remainingArtifacts.includes(name.replace('.sha256', '')),
  );
  if (orphanChecksums.length !== 0) {
    throw new Error('deleted backup left an orphan checksum');
  }
  console.log('Gateway backup retention self-test passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
