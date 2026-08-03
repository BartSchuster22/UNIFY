#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statfsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = resolve(ROOT, 'config/identity-capacity-policy.json');

function run(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stderr ?? error.message).trim(),
    };
  }
}

function readMeminfo(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const match = /^([^:]+):\s+(\d+)\s+kB$/.exec(line);
    if (match) result[match[1]] = Number(match[2]) * 1024;
  }
  return result;
}

function readMemoryPsi(text) {
  const full = text.split('\n').find((line) => line.startsWith('full '));
  const match = /avg60=([0-9.]+)/.exec(full ?? '');
  return match ? Number(match[1]) : null;
}

function readInodePercent() {
  const result = run('df', ['-Pi', '/']);
  if (!result.ok) return null;
  const lines = result.output.split('\n');
  const fields = lines.at(-1)?.trim().split(/\s+/);
  if (!fields || fields.length < 6) return null;
  const usedPercent = Number(fields[4].replace('%', ''));
  return 100 - usedPercent;
}

function latestEncryptedBackup(directory) {
  try {
    const candidates = readdirSync(directory)
      .filter((name) => name.endsWith('.tar.enc'))
      .map((name) => ({ name, stat: statSync(resolve(directory, name)) }))
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    if (candidates.length === 0) return null;
    return {
      name: candidates[0].name,
      modifiedAt: candidates[0].stat.mtime.toISOString(),
      ageHours: (Date.now() - candidates[0].stat.mtimeMs) / 3_600_000,
      bytes: candidates[0].stat.size,
    };
  } catch {
    return null;
  }
}

function checkPostgres(policy) {
  const health = run('docker', [
    'inspect',
    policy.container,
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
  ]);
  const capacity = run('docker', [
    'exec',
    policy.container,
    'psql',
    '-U',
    policy.user,
    '-d',
    policy.database,
    '-Atc',
    "SELECT current_setting('max_connections')::int || '|' || (SELECT count(*) FROM pg_stat_activity) || '|' || pg_database_size(current_database());",
  ]);

  if (!health.ok || !capacity.ok) {
    return {
      pass: false,
      health: health.output,
      error: capacity.output || health.output,
    };
  }

  const [maxConnections, usedConnections, databaseBytes] = capacity.output.split('|').map(Number);
  const freeConnections = maxConnections - usedConnections;
  return {
    pass: health.output === 'healthy' && freeConnections >= policy.minimumFreeConnections,
    health: health.output,
    maxConnections,
    usedConnections,
    freeConnections,
    minimumFreeConnections: policy.minimumFreeConnections,
    databaseBytes,
  };
}

function checkTimer(timer, required) {
  const enabled = run('systemctl', ['is-enabled', timer]);
  return {
    pass: !required || (enabled.ok && enabled.output === 'enabled'),
    required,
    timer,
    enabled: enabled.ok ? enabled.output : 'not-installed-or-disabled',
  };
}

function evaluate(policy, inputs) {
  const requiredDiskBytes =
    policy.disk.rootSafetyFloorBytes +
    policy.disk.identityCurrentAndRollbackImagesBytes +
    policy.disk.identityDatabaseAndWalBytes +
    policy.disk.identityBackupRetentionBytes +
    policy.disk.existingHostBackupGrowthBytes;
  const requiredMemoryBytes =
    policy.identityAuthority.hardMemoryBytes + policy.memory.hostAvailableReserveBytes;

  const disk = {
    pass:
      inputs.diskAvailableBytes >= requiredDiskBytes &&
      inputs.freeInodePercent >= policy.disk.minimumFreeInodePercent,
    availableBytes: inputs.diskAvailableBytes,
    requiredBytes: requiredDiskBytes,
    deficitBytes: Math.max(0, requiredDiskBytes - inputs.diskAvailableBytes),
    freeInodePercent: inputs.freeInodePercent,
    minimumFreeInodePercent: policy.disk.minimumFreeInodePercent,
    reservations: {
      rootSafetyFloorBytes: policy.disk.rootSafetyFloorBytes,
      identityCurrentAndRollbackImagesBytes: policy.disk.identityCurrentAndRollbackImagesBytes,
      identityDatabaseAndWalBytes: policy.disk.identityDatabaseAndWalBytes,
      identityBackupRetentionBytes: policy.disk.identityBackupRetentionBytes,
      existingHostBackupGrowthBytes: policy.disk.existingHostBackupGrowthBytes,
    },
  };

  const memory = {
    pass:
      inputs.memoryAvailableBytes >= requiredMemoryBytes &&
      inputs.memoryPsiFullAvg60 !== null &&
      inputs.memoryPsiFullAvg60 <= policy.memory.maximumFullPsiAvg60,
    availableBytes: inputs.memoryAvailableBytes,
    requiredBytes: requiredMemoryBytes,
    deficitBytes: Math.max(0, requiredMemoryBytes - inputs.memoryAvailableBytes),
    swapUsedBytes: inputs.swapUsedBytes,
    psiFullAvg60: inputs.memoryPsiFullAvg60,
    maximumFullPsiAvg60: policy.memory.maximumFullPsiAvg60,
  };

  const backup = {
    pass:
      inputs.latestBackup !== null &&
      inputs.latestBackup.ageHours <= policy.backups.maximumBaselineAgeHours &&
      inputs.backupTimer.pass,
    latest: inputs.latestBackup,
    maximumBaselineAgeHours: policy.backups.maximumBaselineAgeHours,
    timer: inputs.backupTimer,
    plannedDailyCopies: policy.backups.plannedDailyCopies,
    plannedWeeklyCopies: policy.backups.plannedWeeklyCopies,
  };

  const checks = {
    disk,
    memory,
    postgres: inputs.postgres,
    backup,
  };
  return {
    version: 1,
    observedAt: new Date().toISOString(),
    verdict: Object.values(checks).every((check) => check.pass) ? 'PASS' : 'STOP',
    candidate: policy.identityAuthority,
    checks,
  };
}

function selfTest() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  const requiredDiskBytes =
    policy.disk.rootSafetyFloorBytes +
    policy.disk.identityCurrentAndRollbackImagesBytes +
    policy.disk.identityDatabaseAndWalBytes +
    policy.disk.identityBackupRetentionBytes +
    policy.disk.existingHostBackupGrowthBytes;
  const requiredMemoryBytes =
    policy.identityAuthority.hardMemoryBytes + policy.memory.hostAvailableReserveBytes;
  const baseline = {
    diskAvailableBytes: requiredDiskBytes,
    freeInodePercent: policy.disk.minimumFreeInodePercent,
    memoryAvailableBytes: requiredMemoryBytes,
    memoryPsiFullAvg60: policy.memory.maximumFullPsiAvg60,
    swapUsedBytes: 0,
    latestBackup: { ageHours: 1, name: 'test.tar.enc' },
    backupTimer: { pass: true },
    postgres: { pass: true },
  };
  if (evaluate(policy, baseline).verdict !== 'PASS') {
    throw new Error('capacity boundary must pass at exact thresholds');
  }
  if (
    evaluate(policy, { ...baseline, diskAvailableBytes: requiredDiskBytes - 1 }).verdict !== 'STOP'
  ) {
    throw new Error('disk below reservation must stop');
  }
  if (
    evaluate(policy, {
      ...baseline,
      memoryAvailableBytes: requiredMemoryBytes - 1,
    }).verdict !== 'STOP'
  ) {
    throw new Error('memory below reservation must stop');
  }
  if (
    evaluate(policy, {
      ...baseline,
      postgres: { pass: false },
    }).verdict !== 'STOP'
  ) {
    throw new Error('PostgreSQL failure must stop');
  }
  if (
    evaluate(policy, {
      ...baseline,
      backupTimer: { pass: false },
    }).verdict !== 'STOP'
  ) {
    throw new Error('required backup timer failure must stop');
  }
  console.log('Identity capacity gate self-test passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const filesystem = statfsSync(policy.disk.mount);
const meminfo = readMeminfo(readFileSync('/proc/meminfo', 'utf8'));
const memoryPsi = readMemoryPsi(readFileSync('/proc/pressure/memory', 'utf8'));
const backupDirectory = resolve(ROOT, policy.backups.directory);
const result = evaluate(policy, {
  diskAvailableBytes: filesystem.bavail * filesystem.bsize,
  freeInodePercent: readInodePercent(),
  memoryAvailableBytes: meminfo.MemAvailable,
  memoryPsiFullAvg60: memoryPsi,
  swapUsedBytes: (meminfo.SwapTotal ?? 0) - (meminfo.SwapFree ?? 0),
  latestBackup: latestEncryptedBackup(backupDirectory),
  backupTimer: checkTimer(policy.backups.timer, policy.backups.requireEnabledTimer),
  postgres: checkPostgres(policy.postgres),
});

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.verdict === 'PASS' ? 0 : 2;
