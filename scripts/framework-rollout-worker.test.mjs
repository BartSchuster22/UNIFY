import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const digest = `sha256:${'5'.repeat(64)}`;
const image = `registry.example/unify/hermes-candidate@${digest}`;
const commit = '3c27eb6234bf91b8ceee9e9071591b31e9b148cb';

function fixture(health = 'healthy', imageAvailable = true) {
  const root = mkdtempSync(join(tmpdir(), 'unify-rollout-worker-'));
  const current = join(root, 'current');
  const bin = join(root, 'bin');
  mkdirSync(join(current, 'deploy/five-service'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    join(current, 'compose.env'),
    `ALICA_HERMES_RUNTIME_IMAGE=registry.example/old@sha256:${'1'.repeat(64)}\nHERMAN_HERMES_RUNTIME_IMAGE=registry.example/old@sha256:${'1'.repeat(64)}\n`,
  );
  writeFileSync(join(current, 'deploy/five-service/compose.yaml'), 'services: {}\n');
  const fake = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >>"${root}/docker.log"
if [[ $1 == exec || ( $1 == compose && $* == *' exec -T unify-postgres psql '* ) ]]; then
  sql=$(cat)
  echo "$sql" >>"${root}/sql.log"
  if [[ $sql == *"SELECT plan_id,framework_id,target_image_reference"* ]]; then
    printf '12345678-1234-1234-1234-123456789abc\\thermes-alica\\t${image}\\t${digest}\\thermes-v2026.8.3\\t0.20.0\\t${commit}\\tregistry.example/old@sha256:${'1'.repeat(64)}\\n'
  fi
elif [[ $1 == image && $2 == inspect ]]; then
  ${imageAvailable ? ':' : 'exit 1'}
  args="$*"
  if [[ $args == *RepoDigests* ]]; then echo '${image}';
  elif [[ $args == *com.aquiero.hermes.commit* ]]; then echo '${commit}';
  elif [[ $args == *com.aquiero.hermes.release* ]]; then echo '0.20.0';
  elif [[ $args == *Id* ]]; then echo 'sha256:${'9'.repeat(64)}'; fi
elif [[ $1 == compose ]]; then
  if [[ $* == *' ps -q alica'* ]]; then echo container-alica; fi
elif [[ $1 == inspect ]]; then
  if [[ $* == *'.State.Health'* ]]; then
    if [[ '${health}' == unhealthy ]] && grep -q '${image}' '${current}/compose.env'; then echo unhealthy; else echo healthy; fi
  elif [[ $* == *'.Image'* ]]; then echo 'sha256:${'9'.repeat(64)}'; fi
fi
`;
  writeFileSync(join(bin, 'docker'), fake, { mode: 0o755 });
  return { root, bin };
}

describe('governed framework rollout worker', () => {
  it('targets Alica independently and records automatic convergence', () => {
    const { root, bin } = fixture();
    execFileSync('bash', [resolve('scripts/framework-rollout-worker.sh'), '--once'], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        UNIFY_INSTALLATION_ROOT: root,
        UNIFY_ROLLOUT_LOCK: join(root, 'worker.lock'),
        UNIFY_ROLLOUT_CONVERGENCE_ATTEMPTS: '1',
        UNIFY_ROLLOUT_CONVERGENCE_INTERVAL_SECONDS: '0',
      },
      stdio: 'pipe',
    });
    const environment = readFileSync(join(root, 'current/compose.env'), 'utf8');
    expect(environment).toContain(`ALICA_HERMES_RUNTIME_IMAGE=${image}`);
    expect(environment).toContain(
      `HERMAN_HERMES_RUNTIME_IMAGE=registry.example/old@sha256:${'1'.repeat(64)}`,
    );
    const dockerLog = readFileSync(join(root, 'docker.log'), 'utf8');
    expect(dockerLog).toContain('up -d --no-deps alica');
    expect(dockerLog).not.toContain('up -d --no-deps herman');
    const sqlLog = readFileSync(join(root, 'sql.log'), 'utf8');
    expect(sqlLog).toContain("state='converged'");
    expect(sqlLog).toContain("t.state='executing' AND t.lease_expires_at<now()");
    expect(sqlLog).toContain("'healthy',true");
  });

  it('restores the prior target image when convergence fails', () => {
    const { root, bin } = fixture('unhealthy');
    execFileSync('bash', [resolve('scripts/framework-rollout-worker.sh'), '--once'], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        UNIFY_INSTALLATION_ROOT: root,
        UNIFY_ROLLOUT_LOCK: join(root, 'worker.lock'),
        UNIFY_ROLLOUT_CONVERGENCE_ATTEMPTS: '1',
        UNIFY_ROLLOUT_CONVERGENCE_INTERVAL_SECONDS: '0',
      },
      stdio: 'pipe',
    });
    expect(readFileSync(join(root, 'current/compose.env'), 'utf8')).toContain(
      `ALICA_HERMES_RUNTIME_IMAGE=registry.example/old@sha256:${'1'.repeat(64)}`,
    );
    const sqlLog = readFileSync(join(root, 'sql.log'), 'utf8');
    expect(sqlLog).toContain("safe_error_code='CONVERGENCE_FAILED'");
    expect(sqlLog).toContain("'rolledBack',:'rolled_back'::boolean");
    expect(readFileSync(join(root, 'docker.log'), 'utf8')).toContain(
      `image inspect registry.example/old@sha256:${'1'.repeat(64)}`,
    );
  });

  it('fails closed before mutation when the approved image is unavailable', () => {
    const { root, bin } = fixture('healthy', false);
    execFileSync('bash', [resolve('scripts/framework-rollout-worker.sh'), '--once'], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        UNIFY_INSTALLATION_ROOT: root,
        UNIFY_ROLLOUT_LOCK: join(root, 'worker.lock'),
      },
      stdio: 'pipe',
    });
    const environment = readFileSync(join(root, 'current/compose.env'), 'utf8');
    expect(environment).not.toContain(`ALICA_HERMES_RUNTIME_IMAGE=${image}`);
    const dockerLog = readFileSync(join(root, 'docker.log'), 'utf8');
    expect(dockerLog).not.toContain('up -d --no-deps alica');
    const sqlLog = readFileSync(join(root, 'sql.log'), 'utf8');
    expect(sqlLog).toContain("safe_error_code='TARGET_PREFLIGHT_FAILED'");
    expect(sqlLog).toContain("'mutated',false");
  });

  it('defers without touching Docker while an installation change owns the lock', () => {
    const { root, bin } = fixture();
    writeFileSync(join(root, '.installer.lock'), 'installer-123\n');
    const result = spawnSync('bash', [resolve('scripts/framework-rollout-worker.sh'), '--once'], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        UNIFY_INSTALLATION_ROOT: root,
        UNIFY_ROLLOUT_LOCK: join(root, 'worker.lock'),
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(75);
    expect(result.stderr).toContain('installation is currently being changed');
    expect(readFileSync(join(root, '.installer.lock'), 'utf8')).toBe('installer-123\n');
  });
});
