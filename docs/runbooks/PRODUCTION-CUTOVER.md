# Production Rollout, Capability Canary, and Rollback

## Safety model

Production execution is permitted only for a verified Hermes-native operation when all of these controls agree:

1. `DEPLOYMENT_MODE=mutation-canary`;
2. the native mutation domain is listed in `MUTATION_DOMAINS`;
3. `MUTATION_ACCEPTANCE_REFS` contains a written evidence reference;
4. the operation targets `owner=hermes` and the exact registered `frameworkId`;
5. the Hermes capability manifest reports the capability as supported;
6. named-user RBAC, CSRF, idempotency, validation, and mutation governance pass.

Legacy-owner writes remain contained even when a similarly named native domain is enabled. Hermes remains source of truth during rollback; rollback never restores a legacy writer.

Current accepted execute domains:

- `work` → `phase6/hermes-work`;
- `chat` → `task8/hermes-internal-conversations`.

Profiles and providers are Hermes-native reads. Their execute capabilities remain visibly unsupported where Hermes has no safe idempotent non-interactive interface. External conversation delivery remains excluded with `SECOND_CONSUMER_FORBIDDEN` so UNIFY never becomes a second channel consumer.

## Deployment

```bash
pnpm compose:secrets
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml build gateway uniui
docker compose -f compose.yaml -f compose.production.yaml \
  up -d --wait postgres gateway uniui

sudo install -o root -g root -m 0644 \
  deploy/unify-hermes-control-adapter.service \
  /etc/systemd/system/unify-hermes-control-adapter.service
sudo systemctl daemon-reload
sudo systemctl restart unify-hermes-control-adapter
```

Validate the tracked edge configuration before any Caddy reload:

```bash
sudo install -o root -g root -m 0644 deploy/caddy/uniui-aquiero.caddy \
  /etc/caddy/Caddyfile.d/uniui.caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Written acceptance

Every enabled execute domain must resolve to retained evidence recording:

- activation timestamp and approver;
- Hermes framework ID, release, and commit;
- readback, provenance, and known differences;
- authentication, authorization, validate/dry-run, idempotency, and audit results;
- outage and recovery behavior;
- rollback rehearsal;
- external consumers that remain independently active;
- monitoring owner and abort thresholds.

A generic milestone or verbal claim is not an acceptance reference.

## Capability-level production canaries

The tracked policy is `config/production-canary-policy.json`. It defines accepted families, exact Hermes commit, evidence references, abort thresholds, rollback procedures, a 15-minute probe interval, and the mandatory 14-day stable window.

Run a one-shot probe without recording:

```bash
sudo CANARY_STATE_DIR=/var/lib/unify-production-canary \
  node scripts/production-canary.mjs --verify-local
```

Install continuous monitoring:

```bash
sudo install -o root -g root -m 0644 deploy/unify-production-canary.service \
  /etc/systemd/system/unify-production-canary.service
sudo install -o root -g root -m 0644 deploy/unify-production-canary.timer \
  /etc/systemd/system/unify-production-canary.timer
sudo systemctl daemon-reload
sudo systemctl enable --now unify-production-canary.timer
sudo systemctl start unify-production-canary.service
```

Inspect retained evidence:

```bash
systemctl list-timers unify-production-canary.timer
sudo journalctl -u unify-production-canary.service
sudo jq . /var/lib/unify-production-canary/state.json
sudo tail -n 1 /var/lib/unify-production-canary/observations.jsonl | jq .
```

Each run checks capabilities serially and records:

- public and authenticated readiness;
- exact framework provenance and freshness;
- capability status and unsupported boundaries;
- profile, provider, work, conversation, and event reads;
- execute-domain acceptance state;
- external-session exclusion;
- replay-gap and duplicate-event counts;
- request error rate and latency;
- authenticated logout so the monitor does not accumulate sessions.

A failed capability observation resets that capability's stable-window start. The stable window passes only after every accepted family has 14 uninterrupted days with zero probe failures.

## Rollback rehearsal

For the capability under rehearsal:

1. stop the canary timer so the intentional disablement does not count as an outage;
2. remove only that execute domain and acceptance reference from a temporary Compose override;
3. recreate Gateway;
4. prove Hermes-native reads remain HTTP `200`;
5. prove representative execute returns HTTP `403` with `MUTATION_DOMAIN_DISABLED`;
6. restore production Compose without the temporary override;
7. verify readiness and authenticated cutover state;
8. restart the stable window only after all rehearsals are complete.

Rollback does not stop Hermes, mutate Hermes state, enable a legacy writer, or start a second external-channel consumer.

## Abort procedure

At the first abort signal:

1. disable only the affected execute domain;
2. preserve Hermes reads or show truthful unavailable/stale state;
3. recreate Gateway and confirm execution is rejected;
4. repair or restore Hermes, or revert the UNIFY Hermes adapter;
5. reconcile and read back Hermes state;
6. restart that capability's 14-day stable window only after the fault is resolved.

Do not reactivate Agency, DMM, Worker, or CHAT as source of truth.

## Legacy retirement dependency

Task 9 does not authorize legacy retirement. Retirement still requires:

- completed 14-day stable windows;
- zero UNIFY runtime calls to legacy APIs for accepted domains;
- final backup/restore evidence;
- credential and edge-route revocation;
- explicit Task 10 retirement approval.
