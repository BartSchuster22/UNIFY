# DSH Stage 1 engineering baseline

This is a **bounded engineering qualification harness**, not the public product installer and not a production-ready deployment. The product installer remains `dsh/alicactl`; Stage 2 must turn the selected topology into secure transactional installation.

## Scope

- One native Hermes installation, profiles/SQLite/workspaces and upstream per-profile s6 supervision; the UNIFY adapter is colocated, not another framework.
- Seven steady services: Hermes, UNIFY Core, UNIUI, PostgreSQL, Keycloak, MemoryV4, Caddy. Three serialized, non-restarting Core setup jobs.
- Core owns registry/auth/governance and its event projection; Hermes owns native work; MemoryV4 uses its own SQLite volume, reachable only by Core (including its setup job).
- Keycloak is selected and starts its own database, but ordinary-user OIDC binding is **not yet implemented**. The inherited local bootstrap administrator is for isolated diagnostics only. Do not expose it as a secure finished product.
- No global services, provider/channel credentials, production mounts, imported data, Docker socket, public bindings or external networks.
- All steady services have read-only roots, bounded resources, no swap allowance, bounded logs and explicit writable volumes/tmpfs. The candidate is stopped after exercise, including failure.

## Files

- `render.py`: renders the one-runtime topology from the retained installer assets, removes optional/global services, enforces isolated networks/mounts/loopback ingress and caps.
- `admission.py`: fresh Ubuntu 26.04/amd64, Docker 29, Compose v2/cgroup v2 and measured placement check. Memory is total candidate caps including one job plus 1 GiB reserve. Disk uses conservative image-handling allowance plus 2 GiB test data and 8 GiB reserve. These are **not universal DSH minimums**.
- `check_native_source.py`: compares selected packaged native Python files to pinned upstream Git, reproducing declared overlays rather than silently exempting modified files.
- `export_images.py`: saves a complete offline OCI/Docker archive, hashes it, extracts and verifies portable config identities and ordered rootfs diffIDs. OCI index IDs and Docker classic config IDs are distinct; never substitute one for the other.
- `sync_target.py`: explicitly scoped ALICA-v1 engineering transfer. Rechecks admission before import and verifies all config digests and rootfs chains after loading. No runtime starts here.
- `exercise.py`: fresh namespace/credentials/private TLS; migration, bootstrap, native startup, registry reconciliation, full baseline health, real native API fixture, loopback HTTPS, stop/restart persistence, resource/production-UI guard, final stop and exact existing-container comparison.
- `reset_failed.py`: only discards stopped **failed** candidate test volumes after ownership and preservation assertions; retains root-private failure evidence. Refuses successful candidates.
- `test_stage1.py`: isolation, placement, native supervision wiring and fail-closed guard regressions. Unit fixtures are not live evidence.

## Operation and evidence

The selected engineering target is ALICA-v1. Candidate project: `dsh-stage1`; root: `/srv/dsh-stage1-candidate`; ingress: `127.0.0.1:18443` with private CA. No public DNS/ingress changes are made. Secret files are readable inside their explicitly mounted containers; the host parent directory is root-only. Private CA/bootstrap credentials are not release artifacts.

A package contains `images.lock.json`, `compose.template.json`, a single-entry `frameworks.json`, the acceptance client and harness scripts. It must be assembled from the corresponding published source revisions; image archive hashes and config identities are recorded separately. Exact source/build/target evidence is in PROJECT-ALICA's Stage 1 report. The retained `hermes-alica` registration ID is a compatibility identifier in the fresh candidate database, not a second runtime or a connection to production ALICA.

```sh
python3 -m unittest discover -s dsh/rebuild/stage1 -p 'test_*.py' -v
python3 dsh/rebuild/stage1/export_images.py PACKAGE EXPLICIT_HERMES_IMAGE_REF PINNED_NATIVE_GIT_REPOSITORY
python3 dsh/rebuild/stage1/sync_target.py PACKAGE
# On the selected host, after fresh admission and image identity verification:
sudo python3 /home/deploy/dsh-stage1-package/exercise.py /home/deploy/dsh-stage1-package
```

The runner deliberately refuses an occupied namespace/root. Do not rerun by weakening those checks. To reset a failed engineering attempt, preserve `exercise-result.json` then run `reset_failed.py`; it checks the marker, stopped state, preservation verdict, volume labels and namespace before deleting only its own test data. Successful candidate data is retained for inspection; stopping is not deletion.

Emergency stop, limited to the candidate:

```sh
sudo docker compose --project-name dsh-stage1 --project-directory /srv/dsh-stage1-candidate -f /srv/dsh-stage1-candidate/compose.json stop --timeout 30
```

Do not run this harness against existing product directories or make image-only rollback claims about database migrations. This baseline verifies digest-locked artifact loading and lifecycle; it does not certify independent bit-for-bit clean rebuilds, load capacity, OIDC security, inference, global services, restore integrity, public distribution/signing or unattended production operation. Those remain explicitly scoped later-stage gates.
