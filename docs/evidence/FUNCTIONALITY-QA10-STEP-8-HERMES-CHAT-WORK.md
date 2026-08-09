# Functionality QA10 — Step 8 Hermes Chat and Work

- Date: `2026-08-09T19:26:58Z`
- Branch: `feature/unify-functionality-qa10`
- Step 7 base revision: `aba1252fe089c5decfbe0a1163dc2a2e9655ceba`

## Scope

Step 8 completes the UNIUI surfaces that operate the exact URL-selected Hermes framework's internal conversations and native Work resources. Reads and writes remain owner-routed through the governed Gateway and Hermes control adapter; there is no second writer, fallback inventory, browser-owned operational state, or cross-framework fan-out.

## Internal Chat

The Chat surface now:

- reads profiles, internal sessions, messages, and capabilities from the exact selected framework;
- excludes external-channel sessions and fails closed if Hermes returns mixed or unsafe provenance;
- permits explicit Hermes profile selection for a new internal session and forwards the profile and its authoritative model;
- creates sessions and sends messages only when `chat.use` and `conversations.execute=supported` are both true;
- pins creation to the session collection source version and sends to the selected session message source version;
- uses independent idempotency keys and requires the governed operation to return `verified`;
- rejects stale framework/session responses and reports verified replay separately;
- supports text and bounded inline image blocks without introducing a file or attachment owner;
- allows PNG, JPEG, WebP, and GIF images up to 1.5 MB in UNIUI;
- revalidates bounded multimodal blocks in the Gateway and rechecks internal-session ownership in the adapter before sending.

Telegram, WhatsApp, Signal, and other externally owned threads are not surfaced or mutated by this internal Chat view.

## Hermes Work

The Work surface provides authoritative Hermes project, board, task, and cronjob views and governed owner mutations. It now:

- reads all collections and `work.execute` capability from the exact selected framework;
- requires both `work.manage` and `work.execute=supported` before exposing mutation controls;
- pins update/transition operations to authoritative project, task, or cron source versions;
- captures the selected framework before execution and discards stale asynchronous results;
- requires the governed operation to return `verified` and reports idempotent replay truthfully;
- confirms destructive project archive and cron deletion intent;
- validates one-shot cron timestamps before mutation;
- refreshes owner snapshots after successful operations;
- keeps unsupported, unavailable, forbidden, and read-only states explicit.

The prior browser-local notification-rule form was removed. Hermes currently exposes no authoritative notification-rule inventory or mutation through this Work contract, so UNIUI displays that boundary rather than creating localStorage truth or accepting raw Telegram targets.

## Gateway and adapter guarantees

- `expectedSourceVersion` is promoted from governed Work/Chat mutation payloads into the Hermes command envelope and removed from the native owner payload.
- The adapter resolves the matching projects, tasks, cronjobs, sessions, or messages snapshot and rejects stale commands with `source_version_mismatch` before execution.
- Work and Chat commands remain scoped to one registered framework and one exact native target.
- Conversation validation accepts only non-empty bounded text or supported bounded image data URLs.
- Profile-bound session creation forwards `profile` and `model` to the existing Hermes API.
- Message send reads and verifies the target session as internal before invoking Hermes chat.
- Verified/replayed evidence is propagated through the existing governed mutation contract.

## Regression coverage

Coverage added or extended for:

- exact URL-selected framework routing for every Chat and Work read;
- zero reads and writes to a different registered framework;
- internal-session provenance and external-session exclusion;
- explicit Hermes profile/model session routing;
- verified session creation and message send;
- exact framework/session/source-version mutation targets;
- replay-aware success and unverified-operation failure;
- bounded multimodal validation;
- exact task source-version transitions;
- Work permission and capability denial;
- authoritative project creation behavior;
- truthful removal of browser-owned notification settings;
- Gateway source-precondition envelope promotion without owner-payload leakage;
- adapter rejection of stale Work and Chat commands;
- native API profile-bound session creation and multimodal message routing.

## Verification

Focused checks passed:

```text
UNIUI Chat + Work tests = 12 passed
Gateway mutation + Hermes control tests = 14 passed
Hermes control adapter app + source tests = 25 passed
Affected package typechecks = PASS
git diff --check = PASS
```

The final repository gate passed:

```text
pnpm qa = PASS (exit 0)
```

Observed workspace test groups were `3`, `9`, `2`, `88`, `30`, `1`, `2`, and `57` passing tests, with `2` explicitly expected failures in the UNIUI suite. The gate also passed workspace linting and boundaries, all TypeScript typechecks, production builds, reproducible contract generation, standalone-runtime verification, backup-retention self-test, identity-capacity self-test, production-canary self-test, and Prettier formatting.

## Operational boundary

No live Hermes session, message, project, task, or cronjob was changed. Mutation regressions used mocked owner endpoints and fixture adapters. No external-channel session was claimed by UNIUI, and no browser-local notification configuration was retained.
