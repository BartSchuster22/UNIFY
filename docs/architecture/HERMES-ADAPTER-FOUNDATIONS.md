# UNIFY Hermes Adapter Foundations

**Status:** Phase 2 complete
**Owner:** UNIFY
**Framework authority:** unchanged Hermes Agent `0.18.0` at `9e54eee44f1cbbe62247a36546e51ff8940373c6`

## Immutable boundary

`apps/hermes-control-adapter` is an access-plane service owned by UNIFY. It invokes existing Hermes CLI and API interfaces and never imports, patches, vendors, or writes the Hermes repository. The adapter startup fails closed unless the configured Hermes checkout is at the pinned commit with no tracked or staged changes. Existing untracked files are ignored because they are not framework code consumed by the adapter.

Hermes remains authoritative for profiles, provider/model configuration, Kanban work, sessions, messages, runs, and delivery. Adapter event and idempotency tables are UNIFY access-plane evidence only. They are not parallel domain ledgers.

## Supported reads

| Family | Existing Hermes interface | Adapter route | Truth behavior |
| --- | --- | --- | --- |
| Profiles | `hermes profile list` | `GET /control/v1/profiles` | Parses identity, active profile, model and gateway state |
| Providers | `hermes status --all` | `GET /control/v1/providers` | Emits provider identity and configured/missing/unknown only; never credential fragments or paths |
| Boards | `hermes kanban boards list --json --all` | `GET /control/v1/work/boards` | Preserves native board IDs and state |
| Tasks | `hermes kanban --board ID list --json --archived` | `GET /control/v1/work/boards/{boardId}/tasks` | Rejects unsafe native IDs before process execution |
| Sessions | Existing Hermes API `/api/sessions` | `GET /control/v1/conversations/sessions` | Returns `503 capability_unavailable`, never false-empty truth, when API is absent |
| Messages | Existing Hermes API session messages route | `GET /control/v1/conversations/sessions/{sessionId}/messages` | Read-only; does not start a channel consumer |

All collection responses carry exact framework provenance, an adapter-derived SHA-256 source version, observation time, and a cursor bound to that source version. A cursor is rejected with `source_version_mismatch` when the underlying snapshot changes.

## Explicitly unsupported operations

The adapter does not claim write support where no accepted existing Hermes interface has been verified:

- profile mutation
- provider credential mutation
- work mutation before Phase 3 acceptance
- conversation mutation before Phase 3 acceptance
- conversation delivery or channel consumption

Capability discovery reports these as `unsupported`, `unavailable`, or `forbidden`; it never silently substitutes Agency, DMM, Worker, or CHAT.

## Reconciliation and events

`POST /control/v1/commands/reconcile` supports `validate`, `dry-run`, and `execute` modes. Execute mode:

1. observes requested Hermes families through existing interfaces;
2. derives a deterministic aggregate source version;
3. checks optional `expectedSourceVersion`;
4. scopes idempotency by framework, capability, and caller key;
5. rejects key reuse with a different request hash;
6. emits at most one durable snapshot-observed event per family/source version;
7. persists correlation and operation IDs; and
8. returns replayed results for exact idempotent retries.

`GET /control/v1/events` replays adapter-derived events by monotonic sequence and cursor. Event payloads contain observation counts, not copied domain records. Migration `003_hermes_adapter_foundations` creates only the event and idempotency access-plane tables.

## Security and operation

- Every `/control/v1/*` route requires an opaque bearer token.
- The token, database URL, and optional Hermes API token support file-backed secret loading.
- Configured adapter scopes are enforced independently for reads, commands, and events.
- CLI invocation uses `execFile` without a shell, a bounded timeout, and a bounded output buffer.
- Hermes API URLs require HTTPS except on loopback and reject credentials, paths, queries, and fragments.
- Hermes API calls use a timeout, reject redirects, and fail unavailable.
- Public provider responses never include token values, masked fragments, auth-file paths, or environment-variable names.
- The adapter is intended to run host-local and listen on loopback so it can approach an existing local Hermes installation without modifying or packaging Hermes.

## Host-local production service

The checked-in `deploy/unify-hermes-control-adapter.service` runs the adapter independently of Compose on `127.0.0.1:28082`. This is intentional: the adapter invokes the existing host Hermes CLI and does not package or mount a second Hermes implementation. Install or refresh it after building the workspace:

```bash
sudo install -m 0644 deploy/unify-hermes-control-adapter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now unify-hermes-control-adapter.service
```

The service reads the database URL and bearer token through file-backed secrets, runs as the unprivileged `herman` user, starts only from the pinned immutable Hermes checkout, and is reachable only through loopback. The Gateway registration uses `http://127.0.0.1:28082` and `env:HERMES_MAIN_CONTROL_TOKEN`; both services must receive the same `.secrets/hermes_main_control_token` value.

## Verification

Unit and integration tests cover typed envelopes, authentication, scope denial, safe parsing, provider redaction, malformed native IDs, truthful outages, source-bound pagination, validation/dry-run/execute modes, stale-version rejection, idempotency conflicts/replay, event deduplication/replay, and explicit legacy independence. Live verification reads the pinned Hermes checkout before and after adapter probes and requires zero tracked changes.
