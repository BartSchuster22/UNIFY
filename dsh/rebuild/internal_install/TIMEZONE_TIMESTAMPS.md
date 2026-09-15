# User timezone and chat timestamp correction

## Status

Implemented and tested in source. **Not yet deployed to DSH2.** These changes
must ship together in a signed maintenance release; deploying the UI alone
would require a preferences endpoint and database table absent from the old
runtime. No live owner preference has been chosen or overwritten.

## Root cause and behavior

The live session `api_1789484705_62162e5f` exposes `started_at` as Unix seconds.
Its six messages expose fractional Unix seconds under `timestamp`. The adapter
previously accepted only string dates under `created_at`/`createdAt` and omitted
these native fields. The correction preserves actual native timestamps and
converts Unix seconds/milliseconds to UTC ISO timestamps. No current-time
fallback or fabricated history is introduced. Session display falls back to its
real creation time if no updated time is supplied.

Account timezone is stored in PostgreSQL `user_preferences`, keyed by the
session's authenticated user ID. GET/PUT `/api/v1/auth/preferences` is self-service;
PUT uses the existing session/CSRF checks and validates a named timezone with
Intl. Invalid zones and numeric UTC offsets are rejected. Migration 020 adds
only this table; no owner/provider credentials are migrated or reset.

After sign-in, an account without a saved timezone receives an undismissable
confirmation dialog with the browser timezone suggested, not silently saved.
Existing accounts receive the same first-use confirmation. Settings now has a
Date & time card with an editable timezone. Named zones account for DST.
The UI date-formatting paths use this preference; source timestamps remain UTC.

## Execution evidence

- Gateway: 255 tests passed, including self-service authentication/CSRF/account isolation.
- Hermes adapter: 111 tests passed, including native field names and numeric timestamps.
- UniUI: 122 tests passed, one pre-existing expected failure. Includes first-use
  confirmation, saved settings across remounts, edit, retry, and DST formatting.
- All three TypeScript checks and production builds passed.
- The compiled PostgresAuthStore was exercised against real PostgreSQL on DSH2,
  using a separately created disposable database. Verified initial unset state,
  account isolation, persistence through a new store instance, and updates.
  The disposable database was dropped; production application tables were not changed.

## Deployment boundary

The installed cell has a signed image inventory and release-bound owner record.
Its existing bootstrap requires a fresh root, and the lifecycle transaction
rejects a mismatched release. A raw dist-file copy, image-tag substitution or
owner-record rewrite would not be a supported upgrade. Do not deploy these as
an untracked hot patch or weaken admission checks.

Remaining work: authenticated maintenance-upgrade packaging and verified rollback,
backup the live cell, apply migration 020 and its runtime grants, replace only
Core/UniUI/Hermes-adapter runtime images, update lifecycle/broker identities
through the admitted upgrade, then verify current-session timestamps, first-use
UI, saved timezone persistence, health and protected originals. A short runtime
maintenance window is required. Stage 7.4 licensing remains paused and untouched.
