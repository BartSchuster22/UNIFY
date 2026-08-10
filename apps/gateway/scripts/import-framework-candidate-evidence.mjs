#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const evidencePath = process.env.FRAMEWORK_CANDIDATE_EVIDENCE_FILE;
if (!evidencePath) throw new Error('FRAMEWORK_CANDIDATE_EVIDENCE_FILE is required');
const databaseUrl = await databaseConnection();
const raw = await readFile(evidencePath, 'utf8');
if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Candidate evidence exceeds 1 MiB');
const document = JSON.parse(raw);
validate(document);
const evidenceDigest = `sha256:${sha256(stable(document.evidence))}`;
if (document.evidenceDigest !== evidenceDigest)
  throw new Error('Candidate evidence digest mismatch');
const assessmentId = `fca_${sha256(`${document.candidateId}\n${evidenceDigest}`)}`;
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const candidate = await pool.query(
    'SELECT commit_sha FROM framework_update_candidates WHERE candidate_id=$1',
    [document.candidateId],
  );
  if (candidate.rows.length !== 1) throw new Error('Candidate is not present in trusted discovery');
  if (candidate.rows[0].commit_sha !== document.sourceCommit)
    throw new Error('Assessment commit does not match trusted candidate');
  await pool.query(
    `INSERT INTO framework_candidate_assessments(
       assessment_id,candidate_id,state,source_commit,source_archive_digest,
       image_reference,image_digest,adapter_release,contract_version,
       contract_passed,acceptance_passed,evidence,evidence_digest,
       safe_failure_code,safe_failure_reason,assessed_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
     ON CONFLICT(candidate_id,evidence_digest) DO NOTHING`,
    [
      assessmentId,
      document.candidateId,
      document.state,
      document.sourceCommit,
      document.sourceArchiveDigest,
      document.imageReference ?? null,
      document.imageDigest ?? null,
      document.adapterRelease,
      document.contractVersion,
      document.contractPassed,
      document.acceptancePassed,
      JSON.stringify(document.evidence),
      document.evidenceDigest,
      document.safeFailureCode ?? null,
      document.safeFailureReason ?? null,
      document.assessedAt,
    ],
  );
  process.stdout.write(`${JSON.stringify({ assessmentId, state: document.state })}\n`);
} finally {
  await pool.end();
}

async function databaseConnection() {
  if (process.env.DATABASE_URL_FILE)
    return (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  throw new Error('DATABASE_URL_FILE or DATABASE_URL is required');
}

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid evidence');
  const requiredStrings = [
    'candidateId',
    'state',
    'sourceCommit',
    'sourceArchiveDigest',
    'adapterRelease',
    'contractVersion',
    'evidenceDigest',
    'assessedAt',
  ];
  for (const key of requiredStrings)
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Invalid ${key}`);
  if (!/^fuc_[a-f0-9]{64}$/.test(value.candidateId)) throw new Error('Invalid candidateId');
  if (!/^[a-f0-9]{40}$/.test(value.sourceCommit)) throw new Error('Invalid sourceCommit');
  for (const key of ['sourceArchiveDigest', 'evidenceDigest'])
    if (!/^sha256:[a-f0-9]{64}$/.test(value[key])) throw new Error(`Invalid ${key}`);
  if (!['ready', 'blocked'].includes(value.state)) throw new Error('Invalid state');
  if (typeof value.contractPassed !== 'boolean' || typeof value.acceptancePassed !== 'boolean')
    throw new Error('Invalid test results');
  if (!value.evidence || typeof value.evidence !== 'object' || Array.isArray(value.evidence))
    throw new Error('Invalid evidence object');
  if (Number.isNaN(Date.parse(value.assessedAt))) throw new Error('Invalid assessedAt');
  if (value.state === 'ready') {
    if (!value.contractPassed || !value.acceptancePassed)
      throw new Error('Ready candidate failed checks');
    if (!/^sha256:[a-f0-9]{64}$/.test(value.imageDigest ?? ''))
      throw new Error('Invalid imageDigest');
    if (typeof value.imageReference !== 'string' || !value.imageReference.includes('@sha256:'))
      throw new Error('Ready candidate requires digest-pinned imageReference');
    if (value.safeFailureCode || value.safeFailureReason)
      throw new Error('Ready candidate has failure');
  } else {
    if (!/^[A-Z0-9_]{3,100}$/.test(value.safeFailureCode ?? ''))
      throw new Error('Blocked candidate requires safeFailureCode');
    if (typeof value.safeFailureReason !== 'string' || !value.safeFailureReason)
      throw new Error('Blocked candidate requires safeFailureReason');
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
