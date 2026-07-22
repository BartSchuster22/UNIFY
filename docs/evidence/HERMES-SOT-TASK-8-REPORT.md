# Hermes Source-of-Truth Task 8 Verification

Date: 2026-07-22
Release: `unify-task8-internal-conversations`

## Scope

Task 8 makes Hermes-native internal conversations operable through UNIFY without turning UNIFY into a second consumer for external channels:

- Hermes remains the source of truth for sessions and messages.
- Only internal Hermes session sources (`api_server`, `cli`, `tui`, `terminal`, `acp`, and `local`) are exposed.
- Telegram and other externally owned delivery sessions are excluded from reads and writes.
- UNIUI reads and executes internal conversations only through the authenticated Gateway, mutation governance, and Hermes Control adapter.
- The immutable pinned Hermes checkout is not patched or written by UNIFY.

## Implemented boundary

The Hermes Control contract now exposes typed conversation sessions, messages, and governed `session.create` and `message.send` commands. The adapter uses Hermes' existing session HTTP API, enforces internal-session ownership before returning messages or sending, and preserves command idempotency and audit evidence.

The Gateway exposes authenticated conversation reads and routes Hermes-owned `chat.session.create` and `chat.message.send` mutations to `HermesGatewayService`. Cutover policy enables the `chat` domain only for operations whose target owner is `hermes`; migration-only legacy Chat operations remain contained.

UNIUI now provides:

- a Hermes-native Frameworks view with capability and provenance evidence;
- an internal-conversation view with session creation, message history, and message execution;
- permission-aware controls using `chat.use`;
- explicit unsupported evidence for external-channel delivery (`SECOND_CONSUMER_FORBIDDEN`);
- no fallback writer to legacy Chat.

Generated OpenAPI and TypeScript SDK artifacts were regenerated from the updated contract.

## OSError recovery

The earlier stop was environmental rather than an application implementation failure. Docker builder cache and constrained filesystem capacity were inspected; stale builder cache was pruned and free capacity recovered. The Gateway was restarted, contract artifacts were regenerated, and the full QA/deployment path subsequently completed without another OSError.

## Verification

The final `pnpm qa` run passed all gates:

- ESLint, workspace-boundary, and Hermes source-of-truth policy checks;
- TypeScript typechecks for every workspace;
- unit and integration tests;
- production builds;
- reproducible OpenAPI and TypeScript SDK generation;
- legacy-route inventory enforcement;
- Prettier formatting.

Relevant final suites passed:

- Hermes Control adapter: 15 tests;
- Gateway: 85 tests;
- UNIUI: 19 tests;
- Contracts: 8 tests.

Regression coverage includes internal-session filtering, governed conversation execution, mutation cutover, no legacy fallback, truthful unsupported capability presentation, and a typed `SECOND_CONSUMER_FORBIDDEN` response for attempted external-session execution.

## Production deployment

Gateway and UNIUI were rebuilt from the final source and recreated through the production Compose overlay. Both became healthy. The systemd-managed Hermes Control adapter was rebuilt, its updated unit installed, and the service restarted successfully.

Production configuration now reports:

- release `unify-task8-internal-conversations`;
- deployment mode `mutation-canary`;
- enabled domains `work,chat`;
- written acceptance references `work=phase6/hermes-work` and `chat=task8/hermes-internal-conversations`.

The public root and readiness endpoint both returned HTTP 200. Readiness returned:

```json
{"status":"ready","release":"unify-task8-internal-conversations"}
```

## Live authenticated evidence

Authenticated production checks used the named administrator account, secure HttpOnly session cookies, CSRF protection, and unique idempotency keys. No credential was recorded in this report.

Observed results:

- cutover mode: `mutation-canary`;
- execute-enabled domains: `work` and `chat`, each with its written acceptance reference;
- `conversations.execute`: supported for `validate`, `dry-run`, and `execute`, constrained to `authority=hermes-native` and `externalChannels=false`;
- `conversations.delivery.execute`: unsupported with reason `SECOND_CONSUMER_FORBIDDEN`;
- conversation listings contained only internal sources (`api_server` and `cli` in the live snapshot), with no Telegram session exposed;
- governed session creation succeeded for `api_1784721297_0682bcdb`;
- governed message execution sent `Production Task 8 verification. Reply exactly TASK8_ACK.`;
- the authenticated message read returned exactly two messages with roles `user` and `assistant`;
- the live Hermes assistant response was exactly `TASK8_ACK`;
- an attempted governed write to a live Telegram-owned session returned HTTP 403, code `SECOND_CONSUMER_FORBIDDEN`, `retryable=false`;
- the attempted external message was rejected before any Hermes chat execution.

## Pinned Hermes integrity

The pinned Hermes commit remained `9e54eee44f1cbbe62247a36546e51ff8940373c6`. Its tracked and staged trees remained unchanged. The pre-existing untracked backup `gateway/run.py.before-cron-runtime-bridge-20260501` remains outside this change and was not modified.

## Rollback

Remove `chat` from `MUTATION_DOMAINS`, remove `chat=task8/hermes-internal-conversations` from `MUTATION_ACCEPTANCE_REFS`, and redeploy the Gateway. This disables internal conversation execution while retaining the adapter and read path for diagnosis. External-channel writes remain forbidden in either state.
