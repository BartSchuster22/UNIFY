# DSH2 isolated installation — Step 3 completed (2026-09-15)

**Installed, seven services healthy, public standalone HTTPS verified.** Private
owner sign-in, password change, provider authorization and a real task are still
pending; they were not impersonated or claimed complete.

## Live installation

- URL: **https://dsh-next.aquiero.com**.
- Runtime root: `/opt/dsh2-internal-onboarding1` (now exists).
- Candidate: `/var/lib/alica/dsh2-internal-onboarding1/candidate`.
- Owner username: `owner`; enabled and requires `UPDATE_PASSWORD`.
- Initial password remains unclaimed and available through the interactive
  operator handoff; it was neither retrieved nor entered in the browser.
- Signed release: `8fecaecb87f92a47a9ea427965f79525095f9b9567e92dedf6d03d403147b204`.
- Runtime image pins and signed members remain those verified in Step 1/2.

The supported bootstrap installer exited **0** using the prepared candidate,
canonical origin, new root/cell, port 443, bind 0.0.0.0 and `--tls-mode acme`.
No old cell was used as an upgrade source. Fresh owner/secrets were generated
by the installer; no old owner/provider state was copied.

## Verified behavior

- Caddy, UniUI, UNIFY Core, Hermes, Keycloak, MemoryV4 and PostgreSQL are all
  running and Docker-healthy, match all seven pins, and have zero restarts.
- Only the new cell is running. Only Caddy publishes host ports (80/443);
  application, database, private adapter and management ports are not published.
- Cell lifecycle, broker, observer and private-TLS timer are active and enabled.
  No reboot or Docker-daemon interruption test was performed in this step.
- External normal-system-trust TLS handshake succeeds with TLS 1.3 and a
  Let's Encrypt YE1 certificate for `dsh-next.aquiero.com`, valid until
  **2026-12-14 12:57:37 UTC**. Public renewal is Caddy-managed; renewal over time
  is not claimed tested.
- HTTP redirects with **308** to canonical HTTPS (no internal port in Location).
- UI and canonical OIDC discovery return 200. Discovery's issuer matches the
  public identity origin. Identity administration/master paths return 404.
- Fresh Chromium context with HTTPS errors NOT ignored renders the sign-in page.
  Its secure-sign-in link reaches the same-origin identity form, with both
  credential inputs empty and no JavaScript page errors. No owner login occurred.
- 9,251 protected entries matched the licensing-preserving baseline before and
  after installation. All eight old containers, sixteen old image IDs and five
  old volumes were preserved. All three relocated archive hashes reverified.
- Final checked disk availability: **32.337 GiB**.

See `dsh2-install-evidence/` for actual runtime, browser, HTTPS and correction
receipts. Installer output is retained privately on DSH2 as
`/var/lib/alica/dsh2-internal-onboarding1/bootstrap-install.log`; no credentials
were copied into evidence or Git.

## Bytecode inventory issue — diagnosed, fixed and reverified

Post-install admission correctly rejected four generated CPython 3.14 `.pyc`
files in the signed bundle's `__pycache__` directory. Signed source files were
unchanged. No signature or inventory rule was relaxed.

The bootstrap was corrected to suppress bytecode in its own interpreter and
lifecycle subprocesses, including when the bootstrap itself uses isolated mode.
Future generated lifecycle/TLS units receive the same environment setting.
All **54 tests passed as root on ALICA-v1**, including two new actual-interpreter
regressions for parent and child imports (no skips).

A new bootstrap kit was built on ALICA-v1 from clean commit
`7843dee6f9c5b81e7aefb7cf1f3dbf8d757b9073`, its five members checked against local
pinned source, and staged on DSH2 after backing up the old kit. The release
verifier and release trust remained unchanged. Current bootstrap SHA-256:
`ebcf54e7a821a03275abed1ffd0f4c692b49b12e0e50a980e4d381321afd97a2`.

For the already-installed cell only, root-owned systemd drop-ins set
`PYTHONDONTWRITEBYTECODE=1` for its lifecycle and private-TLS services. No signed
runtime member or old unit was changed. Only the four identified compiler caches
were removed, with their hashes retained. The actual TLS service then ran without
recreating caches. Candidate authentication passed before and after real owner
status inspection, with the full twenty-member inventory restored.

Use the corrected bootstrap for user handoff. If manually invoking the original
signed runtime's Python/alicactl tools outside that bootstrap or the configured
units, use `PYTHONDONTWRITEBYTECODE=1` (or Python `-B`) to preserve its strict
inventory. Raw unguarded imports into this original signed bundle remain unsafe
for inventory. The signed runtime was NOT silently replaced with updated source.

## Remaining boundary

Private owner onboarding and a real authorized task remain pending. The scoped
QA signature expires **2026-09-22 13:28:37 UTC**; later authenticated bootstrap
operations need valid admission metadata, not a clock/scope bypass. Production,
licensing, full source-reproducibility and broad workload acceptance are not
implied by this successful internal deployment.

Stage 7.4 licensing work remains paused, protected and separate.
