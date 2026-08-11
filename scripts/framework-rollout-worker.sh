#!/usr/bin/env bash
set -euo pipefail

ROOT=${UNIFY_INSTALLATION_ROOT:-/opt/unify-five-service}
PROJECT=${UNIFY_COMPOSE_PROJECT:-unify}
LOCK=${UNIFY_ROLLOUT_LOCK:-/run/lock/unify-framework-rollout.lock}
WORKER_ID=${UNIFY_ROLLOUT_WORKER_ID:-$(hostname)-$$}
POSTGRES_CONTAINER=${UNIFY_POSTGRES_CONTAINER:-}
ENV_FILE=$ROOT/current/compose.env
COMPOSE_FILE=$ROOT/current/deploy/five-service/compose.yaml
MODE=${1:---once}
CONVERGENCE_ATTEMPTS=${UNIFY_ROLLOUT_CONVERGENCE_ATTEMPTS:-60}
CONVERGENCE_INTERVAL=${UNIFY_ROLLOUT_CONVERGENCE_INTERVAL_SECONDS:-5}

exec 9>"$LOCK"
flock -n 9 || { echo 'Another rollout worker owns the host lock' >&2; exit 75; }
INSTALLER_LOCK=$ROOT/.installer.lock
if ! (set -o noclobber; printf '%s\n' "rollout-worker-$WORKER_ID" >"$INSTALLER_LOCK") 2>/dev/null; then
  echo 'The installation is currently being changed; rollout deferred' >&2
  exit 75
fi
trap 'rm -f "$INSTALLER_LOCK"' EXIT INT TERM

db() {
  if [[ -n $POSTGRES_CONTAINER ]]; then
    docker exec -i "$POSTGRES_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U unify -d unify "$@"
  else
    docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
      exec -T unify-postgres psql -X -q -v ON_ERROR_STOP=1 -U unify -d unify "$@"
  fi
}

claim() {
  db -At -F $'\t' -v worker="$WORKER_ID" <<'SQL'
WITH candidate AS (
  SELECT t.plan_id,t.framework_id
  FROM framework_rollout_targets t
  JOIN framework_rollout_plans p ON p.plan_id=t.plan_id
  WHERE (t.state='pending' OR (t.state='executing' AND t.lease_expires_at<now()))
    AND p.state IN ('queued','executing')
    AND NOT EXISTS (
      SELECT 1 FROM framework_rollout_targets prior
      WHERE prior.plan_id=t.plan_id AND prior.ordinal<t.ordinal AND prior.state<>'converged'
    )
  ORDER BY p.execution_requested_at,t.ordinal
  FOR UPDATE OF t SKIP LOCKED LIMIT 1
), claimed AS (
  UPDATE framework_rollout_targets t SET state='executing',progress=45,worker_id=:'worker',
    lease_expires_at=now()+interval '10 minutes',started_at=coalesce(t.started_at,now())
  FROM candidate c WHERE t.plan_id=c.plan_id AND t.framework_id=c.framework_id
  RETURNING t.*
), plan_started AS (
  UPDATE framework_rollout_plans p SET state='executing',started_at=coalesce(p.started_at,now())
  FROM claimed c WHERE p.plan_id=c.plan_id RETURNING p.plan_id
), event AS (
  INSERT INTO framework_rollout_events(plan_id,framework_id,state,progress,safe_message)
  SELECT plan_id,framework_id,'executing',45,'Target execution started' FROM claimed
)
SELECT plan_id,framework_id,target_image_reference,target_image_digest,target_release_id,
       target_framework_version,target_framework_commit,previous_image_reference
FROM claimed;
SQL
}

set_env_image() {
  local file=$1 name=$2 value=$3
  python3 - "$file" "$name" "$value" <<'PY'
from pathlib import Path
import os, re, sys, tempfile
path=Path(sys.argv[1]); name=sys.argv[2]; value=sys.argv[3]
if not re.fullmatch(r'[A-Z][A-Z0-9_]+', name): raise SystemExit('invalid environment name')
if not re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', value): raise SystemExit('image is not digest pinned')
lines=path.read_text().splitlines()
updated=False
for i,line in enumerate(lines):
    if line.startswith(name+'='):
        lines[i]=name+'='+value; updated=True
if not updated: lines.append(name+'='+value)
fd,tmp=tempfile.mkstemp(prefix='.compose.env.',dir=path.parent)
os.fchmod(fd,0o640)
with os.fdopen(fd,'w') as stream: stream.write('\n'.join(lines)+'\n')
os.replace(tmp,path)
PY
}

finish_plan() {
  local plan=$1
  db -v plan="$plan" <<'SQL'
WITH facts AS (
  SELECT p.plan_id,p.operation_kind,p.state,
    count(*) FILTER (WHERE t.state='converged') AS converged_count,
    count(*) FILTER (WHERE t.state IN ('pending','executing')) AS active_count,
    count(*) FILTER (WHERE t.state='awaiting_promotion') AS promotion_count,
    count(*) FILTER (WHERE t.state='failed') AS failed_count,
    count(*) AS target_count
  FROM framework_rollout_plans p JOIN framework_rollout_targets t ON t.plan_id=p.plan_id
  WHERE p.plan_id=:'plan' GROUP BY p.plan_id
), updated AS (
  UPDATE framework_rollout_plans p SET
    state=CASE
      WHEN f.failed_count>0 THEN CASE WHEN f.converged_count>0 THEN 'partial' ELSE 'failed' END
      WHEN f.converged_count=f.target_count THEN 'succeeded'
      WHEN f.operation_kind='release' AND f.promotion_count>0 AND f.converged_count>0 THEN 'observing'
      ELSE p.state END,
    observation_started_at=CASE
      WHEN f.operation_kind='release' AND f.promotion_count>0 AND f.converged_count>0
        THEN coalesce(p.observation_started_at,now()) ELSE p.observation_started_at END,
    observation_deadline_at=CASE
      WHEN f.operation_kind='release' AND f.promotion_count>0 AND f.converged_count>0
        THEN coalesce(p.observation_deadline_at,now()+make_interval(secs=>(p.policy_snapshot->>'observationWindowSeconds')::integer))
      ELSE p.observation_deadline_at END,
    finished_at=CASE WHEN f.failed_count>0 OR f.converged_count=f.target_count THEN now() ELSE p.finished_at END,
    failure_code=CASE WHEN f.failed_count>0
      THEN (SELECT t.safe_error_code FROM framework_rollout_targets t WHERE t.plan_id=p.plan_id AND t.state='failed' ORDER BY t.ordinal LIMIT 1)
      ELSE NULL END,
    failure_reason=CASE WHEN f.failed_count>0
      THEN (SELECT t.safe_error_reason FROM framework_rollout_targets t WHERE t.plan_id=p.plan_id AND t.state='failed' ORDER BY t.ordinal LIMIT 1)
      ELSE NULL END
  FROM facts f WHERE p.plan_id=f.plan_id RETURNING p.*
)
INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message,details)
SELECT p.plan_id,p.state,
  CASE WHEN p.state='succeeded' THEN 100 WHEN p.state IN ('partial','failed') THEN 100
       WHEN p.state='observing' THEN 60 ELSE 80 END,
  CASE WHEN p.state='succeeded' AND p.operation_kind='rollback' THEN 'Governed rollback converged on every target'
       WHEN p.state='succeeded' THEN 'Every selected target converged automatically'
       WHEN p.state='observing' THEN 'Canary converged; policy observation window started'
       WHEN p.state='partial' THEN 'Rollout stopped after a target failure; converged targets were preserved'
       WHEN p.state='failed' THEN 'Rollout failed before any target converged'
       ELSE 'Target converged; next independent target is eligible' END,
  CASE WHEN p.state='observing' THEN jsonb_build_object(
    'observationStartedAt',p.observation_started_at,'observationDeadlineAt',p.observation_deadline_at,
    'policy',p.policy_snapshot) ELSE '{}'::jsonb END
FROM updated p;
SQL
}

observe_once() {
  local row plan framework image version commit previous previous_release previous_digest previous_version previous_commit
  row=$(db -At -F $'\t' <<'SQL'
SELECT p.plan_id,t.framework_id,t.target_image_reference,t.target_framework_version,t.target_framework_commit,
       t.previous_image_reference,t.previous_release_id,t.previous_image_digest,t.previous_framework_version,t.previous_framework_commit
FROM framework_rollout_plans p JOIN framework_rollout_targets t ON t.plan_id=p.plan_id
WHERE p.state='observing' AND t.ordinal=1 AND t.state='converged'
ORDER BY p.observation_started_at LIMIT 1;
SQL
)
  [[ -z $row ]] && return 1
  IFS=$'\t' read -r plan framework image version commit previous previous_release previous_digest previous_version previous_commit <<<"$row"
  local service=${framework#hermes-} variable container health actual_image expected_image actual_commit actual_release healthy=false
  if [[ $service == alica ]]; then variable=ALICA_HERMES_RUNTIME_IMAGE; else variable=HERMAN_HERMES_RUNTIME_IMAGE; fi
  container=$(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)
  if [[ -n $container ]]; then
    health=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    actual_image=$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null || true)
    expected_image=$(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null || true)
    actual_commit=$(docker image inspect "$image" --format '{{index .Config.Labels "com.aquiero.hermes.commit"}}' 2>/dev/null || true)
    actual_release=$(docker image inspect "$image" --format '{{index .Config.Labels "com.aquiero.hermes.release"}}' 2>/dev/null || true)
    [[ $health == healthy && -n $expected_image && $actual_image == "$expected_image" && $actual_commit == "$commit" && $actual_release == "$version" ]] && healthy=true
  fi
  if [[ $healthy == true ]]; then
    db -v plan="$plan" -v framework="$framework" <<'SQL'
BEGIN;
INSERT INTO framework_rollout_observations(plan_id,framework_id,healthy,image_identity,release_identity,commit_identity,details)
VALUES(:'plan',:'framework',true,true,true,true,jsonb_build_object('health','healthy','checkedAt',now()));
UPDATE framework_rollout_targets SET observation_checks=jsonb_build_object(
  'healthy',true,'lastCheckedAt',now(),'sampleCount',
  (SELECT count(*) FROM framework_rollout_observations WHERE plan_id=:'plan' AND framework_id=:'framework'))
WHERE plan_id=:'plan' AND framework_id=:'framework';
WITH changed AS (
  UPDATE framework_rollout_plans p SET
    state=CASE WHEN now()>=p.observation_deadline_at AND
      (SELECT count(*) FROM framework_rollout_observations o WHERE o.plan_id=p.plan_id AND o.healthy)
        >=(p.policy_snapshot->>'requiredHealthySamples')::integer
      THEN 'awaiting_promotion' ELSE p.state END,
    observation_completed_at=CASE WHEN now()>=p.observation_deadline_at AND
      (SELECT count(*) FROM framework_rollout_observations o WHERE o.plan_id=p.plan_id AND o.healthy)
        >=(p.policy_snapshot->>'requiredHealthySamples')::integer
      THEN now() ELSE p.observation_completed_at END
  WHERE p.plan_id=:'plan' AND p.state='observing' RETURNING p.*
)
INSERT INTO framework_rollout_events(plan_id,framework_id,state,progress,safe_message,details)
SELECT plan_id,:'framework',state,CASE WHEN state='awaiting_promotion' THEN 70 ELSE 65 END,
  CASE WHEN state='awaiting_promotion' THEN 'Observation policy passed; governed promotion is now available'
       ELSE 'Canary observation sample passed' END,
  jsonb_build_object('healthySamples',(SELECT count(*) FROM framework_rollout_observations WHERE plan_id=:'plan' AND healthy),
    'requiredHealthySamples',(policy_snapshot->>'requiredHealthySamples')::integer,
    'observationDeadlineAt',observation_deadline_at)
FROM changed;
COMMIT;
SQL
    return 0
  fi

  local backup_file="$ENV_FILE.rollout-backup-$plan-$service" rolled_back=false
  if [[ -f $backup_file ]] && cp --preserve=mode,ownership,timestamps "$backup_file" "$ENV_FILE" &&
     docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps "$service" >/dev/null 2>&1; then
    container=$(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)
    for _ in $(seq 1 "$CONVERGENCE_ATTEMPTS"); do
      [[ -n $container && $(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null) == healthy ]] && break
      sleep "$CONVERGENCE_INTERVAL"
    done
    if [[ -n $container ]] &&
       [[ $(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null) == healthy ]] &&
       [[ $(docker inspect "$container" --format '{{.Image}}' 2>/dev/null) == $(docker image inspect "$previous" --format '{{.Id}}' 2>/dev/null) ]]; then rolled_back=true; fi
  fi
  db -v plan="$plan" -v framework="$framework" -v rolled_back="$rolled_back" -v previous_release="$previous_release" -v previous="$previous" -v previous_digest="$previous_digest" -v previous_version="$previous_version" -v previous_commit="$previous_commit" <<'SQL'
BEGIN;
INSERT INTO framework_rollout_observations(plan_id,framework_id,healthy,image_identity,release_identity,commit_identity,details)
VALUES(:'plan',:'framework',false,false,false,false,jsonb_build_object('health','unhealthy','rollbackVerified',:'rolled_back'::boolean,'checkedAt',now()));
UPDATE framework_rollout_targets SET state='failed',progress=100,finished_at=now(),
 safe_error_code='OBSERVATION_FAILED',safe_error_reason=CASE WHEN :'rolled_back'::boolean
  THEN 'Canary violated the observation policy; previous image restoration was verified'
  ELSE 'Canary violated the observation policy; previous image restoration could not be verified' END,
 observation_checks=jsonb_build_object('healthy',false,'rollbackVerified',:'rolled_back'::boolean,'checkedAt',now())
WHERE plan_id=:'plan' AND framework_id=:'framework';
UPDATE framework_rollout_targets SET state='cancelled',progress=100,finished_at=now(),
 safe_error_code='CANARY_OBSERVATION_FAILED',safe_error_reason='Promotion cancelled because the canary failed its observation policy'
WHERE plan_id=:'plan' AND state='awaiting_promotion';
UPDATE framework_deployments SET release_id=:'previous_release',image_reference=:'previous',image_digest=:'previous_digest',
 framework_version=:'previous_version',framework_commit=:'previous_commit',recorded_at=now()
WHERE framework_id=:'framework' AND :'rolled_back'::boolean;
UPDATE framework_rollout_plans SET state='failed',finished_at=now(),failure_code='OBSERVATION_FAILED',
 failure_reason=CASE WHEN :'rolled_back'::boolean THEN 'Canary observation failed; automatic rollback verified'
 ELSE 'Canary observation failed; automatic rollback unverified' END
WHERE plan_id=:'plan' AND state='observing';
INSERT INTO framework_rollout_events(plan_id,framework_id,state,progress,safe_message,details)
VALUES(:'plan',:'framework','failed',100,CASE WHEN :'rolled_back'::boolean
 THEN 'Canary observation failed; automatic rollback verified'
 ELSE 'Canary observation failed; automatic rollback unverified' END,
 jsonb_build_object('rollbackVerified',:'rolled_back'::boolean));
COMMIT;
SQL
  [[ $rolled_back == true ]] && rm -f "$backup_file"
  return 0
}

execute_target() {
  local row=$1
  IFS=$'\t' read -r plan framework image digest release version commit previous <<<"$row"
  [[ $plan =~ ^[0-9a-f-]{36}$ ]]
  [[ $framework == hermes-alica || $framework == hermes-herman ]]
  [[ $image =~ @sha256:[a-f0-9]{64}$ ]]
  [[ $digest =~ ^sha256:[a-f0-9]{64}$ ]]
  [[ $commit =~ ^[a-f0-9]{40}$ ]]
  local service variable container env_file compose_file
  service=${framework#hermes-}
  if [[ $service == alica ]]; then variable=ALICA_HERMES_RUNTIME_IMAGE; else variable=HERMAN_HERMES_RUNTIME_IMAGE; fi
  env_file=$ROOT/current/compose.env
  compose_file=$ROOT/current/deploy/five-service/compose.yaml
  if [[ ! -f $env_file || ! -f $compose_file || ${image##*@} != "$digest" ]] ||
     ! docker image inspect "$image" >/dev/null 2>&1; then
    db -v plan="$plan" -v framework="$framework" <<'SQL'
UPDATE framework_rollout_targets SET state='failed',progress=100,finished_at=now(),lease_expires_at=NULL,
 safe_error_code='TARGET_PREFLIGHT_FAILED',safe_error_reason='Installation files or the digest-pinned target image were unavailable or inconsistent with the approved plan',
 convergence_checks=jsonb_build_object('imageAvailable',false,'mutated',false,'rolledBack',false,'checkedAt',now())
WHERE plan_id=:'plan' AND framework_id=:'framework' AND state='executing';
UPDATE framework_rollout_targets SET state='cancelled',progress=100,finished_at=now(),
 safe_error_code='PREDECESSOR_FAILED',safe_error_reason='A prior independent target failed; execution stopped'
WHERE plan_id=:'plan' AND state='pending';
INSERT INTO framework_rollout_events(plan_id,framework_id,state,progress,safe_message)
VALUES(:'plan',:'framework','failed',100,'Image preflight failed before the target was changed');
SQL
    finish_plan "$plan"
    return 1
  fi

  local backup_file="$env_file.rollout-backup-$plan-$service"
  [[ -f $backup_file ]] || cp --preserve=mode,ownership,timestamps "$env_file" "$backup_file"
  if ! {
    set_env_image "$env_file" "$variable" "$image"
    docker compose --project-name "$PROJECT" --env-file "$env_file" -f "$compose_file" config -q
    docker compose --project-name "$PROJECT" --env-file "$env_file" -f "$compose_file" up -d --no-deps "$service"
    container=$(docker compose --project-name "$PROJECT" --env-file "$env_file" -f "$compose_file" ps -q "$service")
    [[ -n $container ]]
    for _ in $(seq 1 "$CONVERGENCE_ATTEMPTS"); do
      [[ $(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}') == healthy ]] && break
      sleep "$CONVERGENCE_INTERVAL"
    done
    health=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
    actual_image=$(docker inspect "$container" --format '{{.Image}}')
    expected_image=$(docker image inspect "$image" --format '{{.Id}}')
    actual_commit=$(docker image inspect "$image" --format '{{index .Config.Labels "com.aquiero.hermes.commit"}}')
    actual_release=$(docker image inspect "$image" --format '{{index .Config.Labels "com.aquiero.hermes.release"}}')
    [[ $health == healthy && $actual_image == "$expected_image" && $actual_commit == "$commit" && $actual_release == "$version" ]]
  }; then
    rolled_back=false
    if cp --preserve=mode,ownership,timestamps "$backup_file" "$env_file" &&
       docker compose --project-name "$PROJECT" --env-file "$env_file" -f "$compose_file" up -d --no-deps "$service" >/dev/null 2>&1; then
      rollback_container=$(docker compose --project-name "$PROJECT" --env-file "$env_file" -f "$compose_file" ps -q "$service" 2>/dev/null || true)
      for _ in $(seq 1 "$CONVERGENCE_ATTEMPTS"); do
        [[ -n $rollback_container && $(docker inspect "$rollback_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null) == healthy ]] && break
        sleep "$CONVERGENCE_INTERVAL"
      done
      if [[ -n $rollback_container ]] &&
         [[ $(docker inspect "$rollback_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null) == healthy ]] &&
         [[ $(docker inspect "$rollback_container" --format '{{.Image}}' 2>/dev/null) == $(docker image inspect "$previous" --format '{{.Id}}' 2>/dev/null) ]]; then
        rolled_back=true
      fi
    fi
    db -v plan="$plan" -v framework="$framework" -v rolled_back="$rolled_back" <<'SQL'
UPDATE framework_rollout_targets SET state='failed',progress=100,finished_at=now(),lease_expires_at=NULL,
 safe_error_code='CONVERGENCE_FAILED',safe_error_reason=CASE WHEN :'rolled_back'::boolean
   THEN 'Target failed automatic convergence checks; restoration of the previous image was verified'
   ELSE 'Target failed automatic convergence checks; restoration of the previous image could not be verified' END,
 convergence_checks=jsonb_build_object('healthy',false,'rolledBack',:'rolled_back'::boolean,'checkedAt',now())
WHERE plan_id=:'plan' AND framework_id=:'framework';
UPDATE framework_rollout_targets SET state='cancelled',progress=100,finished_at=now(),
 safe_error_code='PREDECESSOR_FAILED',safe_error_reason='A prior independent target failed; execution stopped'
WHERE plan_id=:'plan' AND state='pending';
INSERT INTO framework_rollout_events(plan_id,framework_id,state,progress,safe_message)
VALUES(:'plan',:'framework','failed',100,CASE WHEN :'rolled_back'::boolean
  THEN 'Automatic convergence failed; previous image restoration verified'
  ELSE 'Automatic convergence failed; previous image restoration unverified' END);
SQL
    if [[ $rolled_back == true ]]; then rm -f "$backup_file"; fi
    finish_plan "$plan"
    return 1
  fi

  db -v plan="$plan" -v framework="$framework" -v release="$release" -v image="$image" -v digest="$digest" -v version="$version" -v commit="$commit" <<'SQL'
BEGIN;
UPDATE framework_rollout_targets SET state='converged',progress=100,finished_at=now(),lease_expires_at=NULL,
 convergence_checks=jsonb_build_object('healthy',true,'imageIdentity',true,'releaseLabel',true,'commitLabel',true,'checkedAt',now())
WHERE plan_id=:'plan' AND framework_id=:'framework' AND state='executing';
UPDATE framework_deployments SET release_id=:'release',image_reference=:'image',image_digest=:'digest',
 framework_version=:'version',framework_commit=:'commit',recorded_at=now()
WHERE framework_id=:'framework';
INSERT INTO framework_rollout_events(plan_id,framework_id,state,progress,safe_message)
VALUES(:'plan',:'framework','converged',100,'Target passed automatic convergence checks');
COMMIT;
SQL
  finish_plan "$plan"
  plan_state=$(db -At -v plan="$plan" -c "SELECT state FROM framework_rollout_plans WHERE plan_id=:'plan'")
  if [[ $plan_state == succeeded ]]; then
    rm -f "$ENV_FILE.rollout-backup-$plan-alica" "$ENV_FILE.rollout-backup-$plan-herman"
  fi
}

while true; do
  if observe_once; then
    [[ $MODE == --once ]] && exit 0
  fi
  row=$(claim)
  [[ -z $row ]] && { [[ $MODE == --once ]] && exit 0; sleep 5; continue; }
  execute_target "$row" || true
  [[ $MODE == --once ]] && exit 0
done
