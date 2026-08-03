#!/usr/bin/env node

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(
  process.env.BACKUP_DIR ?? new URL('../backups', import.meta.url).pathname,
);
const keepDaily = Number(process.env.BACKUP_KEEP_DAILY ?? 7);
const keepWeekly = Number(process.env.BACKUP_KEEP_WEEKLY ?? 4);
const dryRun = process.argv.includes('--dry-run');
const pattern = /^gateway-(\d{8})T(\d{6})Z\.tar\.enc$/;

if (!Number.isInteger(keepDaily) || keepDaily < 1) {
  throw new Error('BACKUP_KEEP_DAILY must be a positive integer');
}
if (!Number.isInteger(keepWeekly) || keepWeekly < 0) {
  throw new Error('BACKUP_KEEP_WEEKLY must be a non-negative integer');
}

const artifacts = readdirSync(directory)
  .map((name) => {
    const match = pattern.exec(name);
    if (!match) return null;
    const date = match[1];
    const timestamp = `${date}T${match[2]}Z`;
    const parsed = new Date(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}Z`,
    );
    const path = resolve(directory, name);
    return {
      name,
      path,
      checksumPath: `${path}.sha256`,
      date,
      timestamp,
      parsed,
      bytes: statSync(path).size,
    };
  })
  .filter(Boolean)
  .sort((left, right) => right.parsed - left.parsed);

const latestPerDay = [];
const seenDays = new Set();
for (const artifact of artifacts) {
  if (seenDays.has(artifact.date)) continue;
  seenDays.add(artifact.date);
  latestPerDay.push(artifact);
}

const keep = new Set(latestPerDay.slice(0, keepDaily).map((item) => item.path));
const weeklyCandidates = latestPerDay
  .slice(keepDaily)
  .filter((item) => item.parsed.getUTCDay() === 0)
  .slice(0, keepWeekly);
for (const artifact of weeklyCandidates) keep.add(artifact.path);

const deleted = [];
const retained = [];
for (const artifact of artifacts) {
  if (keep.has(artifact.path)) {
    retained.push(artifact);
    continue;
  }
  if (!dryRun) {
    unlinkSync(artifact.path);
    try {
      unlinkSync(artifact.checksumPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  deleted.push(artifact);
}

console.log(
  JSON.stringify(
    {
      directory,
      dryRun,
      policy: { keepDaily, keepWeekly },
      retained: retained.map(({ name, timestamp, bytes }) => ({
        name,
        timestamp,
        bytes,
      })),
      deleted: deleted.map(({ name, timestamp, bytes }) => ({
        name,
        timestamp,
        bytes,
      })),
      ignoredNonGatewayArtifacts: readdirSync(directory).filter(
        (name) => !pattern.test(name) && !name.endsWith('.sha256'),
      ).length,
    },
    null,
    2,
  ),
);
