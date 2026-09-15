# Signed DSH2 maintenance — sequence 3

## Installed release

- Public origin: `https://dsh-next.aquiero.com` (HTTPS 200; certificate verification 0).
- Cell: `dsh2-internal-onboarding1`.
- Deployed application/source revision: `ee213eb0`.
- Release SHA-256: `5a8a7f4cfa818172d637492da81a64a9fbfac3dd212c43ea5609713c5a772971`.
- Authority: sequence 3, highest attempted sequence 3; seven healthy, ownership-verified services.
- Changed application images: Hermes adapter, Core and UniUI. Persistent mounts were preserved.
- This is internal maintenance, not licensing completion or a fresh installation. Licensing review remains paused.

## Actual execution and recovery

Sequence 2 encountered a collision between the existing application `user_preferences` table and the proposed timezone table. Recovery restored the predecessor and healthy services. Its consumed sequence, checkpoint and failed-state artifacts were retained. Two rejected trees were renamed with a sequence-2 suffix and reverified, not deleted.

Timezone storage was moved to `user_time_preferences`. Before retrying, the corrected migration was run against an isolated PostgreSQL copy of the real checkpoint with networking disabled. Migration 020 applied; existing users were preserved; Core had access and the adapter did not. The live database was not used for this test.

Sequence 3 used a fresh cold checkpoint. The encrypted archive was stored on ElioHermes1 and decrypted for verification of all ten cold trees before apply. Only its size and ciphertext digest are recorded in `backup.json`; neither recovery keys nor archive contents are committed.

The signed sequence-3 capsule was applied successfully. Its immutable contents were not edited afterward.

## Final ingress fingerprint correction

Final Caddy recreation changed `com.docker.compose.depends_on` and `com.docker.compose.replace` after the initial broker attestation. Reconstructing those two prior labels reproduced the exact previous canonical fingerprint. Execution configuration, actual image, container identity and mounts were unchanged. The Caddy fingerprint was updated, broker/observer services restarted, and all seven services reverified.

The accompanying source change captures this final re-attestation and rejects changes outside those two bookkeeping labels. It also makes `verify` fail on unverified ownership, unhealthy services or an incomplete service inventory. The updated verifier was executed from stdin against the live release and passed. These are source/operator improvements: they do **not** mean the already signed capsule was rewritten or a fourth application release was deployed.

## Live browser evidence

`browser.json` records real Playwright execution with a disposable IdP user granted the application's owner role:

- Secure browser login and first-login timezone confirmation.
- Saved `Atlantic/Canary` read back through `/api/v1/auth/preferences`.
- Settings changed to UTC, persisted across reload, then restored to Atlantic/Canary.
- Browser Back returned to Work & Kanban.
- Workspace creation and selection through the folder browser.
- Small text and 1,228,800-byte binary uploads, with server verification.
- Overwrite disabled until explicit confirmation; confirmed replacement succeeded.
- Memory ingestion disabled when no project was selected.
- No JavaScript page errors in the upload/settings run.
- Logout returned 204; a subsequent protected preferences request returned 401.

The earlier supplemental `/api/auth/preferences` 404 was a test-path mistake, corrected to `/api/v1/auth/preferences`; it was not counted as successful verification. Initial locator errors were corrected in the test harness, not treated as application failures.

## Cleanup and protection

`cleanup.json` records deletion of the disposable workspace only after verifying the exact current upload bytes and retained prior-version bytes. The matching IdP identity was deleted through the supported admin API, and its absence was subsequently checked. Local QA password, cookie/storage-state and resource-tracking files were removed. Server audit/user-history rows were not manually purged.

`protection.json` records that owner/transport secrets still matched the checkpoint, two provider configuration/auth files still matched their checkpoint bytes, and the predecessor manifest was unchanged. No personal owner identity or provider credentials were reset. Protected recovery/licensing artifacts were not part of QA cleanup.

`runtime.json` is the final live observation after cleanup. Native work was observed with zero active work.

## Reproduction boundaries

The QA scripts are scoped to this installation and use private local state under `~/.config/dsh-maintenance-recovery`. They require the existing pinned SSH configuration and browser environment. The intended one-run order is:

1. `python3 -B scripts/dsh-maintenance-qa-identity.py create`
2. `/home/herman/stage7-browser-venv/bin/python -B scripts/test-dsh-maintenance-live-browser.py`
3. `/home/herman/stage7-browser-venv/bin/python -B scripts/test-dsh-maintenance-selection-logout.py`
4. `python3 -B scripts/cleanup-dsh-maintenance-qa.py`

They are not unattended cron jobs. Inspect partial-state receipts before retrying a failed run. Do not rerun maintenance backup/apply against the committed cell or reuse sequence 2/3 as a new admission.

## Acceptance boundary

The maintenance deployment, timezone persistence/editing, workspace upload/selection checks and disposable QA cleanup are verified. These browser scripts did not perform a fresh post-upgrade model/terminal conversation, explicit project-memory ingestion, or personal-owner acceptance. Earlier owner/provider/model/tool checks remain earlier evidence, not newly rerun checks. Broader whole-owner-journey sign-off remains separate.

Regression result: 83 internal installation/maintenance tests passed, including final-ingress identity and strict runtime-verification rejection cases. The four QA scripts passed syntax validation; the browser and cleanup execution results are recorded separately above.
