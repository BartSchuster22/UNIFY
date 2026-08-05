# Phase 12 — Fresh ALICA-v1 Deployment

## Production topology

ALICA-v1 runs a fresh `unify-postgres` database and the hardened Gateway runtime under the production service name `unify-core`. The application binds only to `127.0.0.1:18080`; Caddy is the sole public ingress and terminates HTTPS for `unify.167-233-135-142.sslip.io`.

PostgreSQL has no published port. Core, PostgreSQL, and each framework adapter communicate on internal Docker networks. Alica and Herman have independent adapter endpoints, TLS certificates, bearer credentials, identities, and private networks. Neither adapter publishes a host port.

## Immutable baselines

- UNIFY release: the deployed Git commit and locally built image digest.
- PostgreSQL: pinned PostgreSQL 16.6 Alpine digest.
- Hermes: pinned 0.20.0 image digest and upstream commit `b8b17b8cee50b85adb7fba6ea332dc06731b86f4`.
- The adapter verifies the installed Hermes release/commit before listening.

## Secret handling

`prepare-secrets.sh` is fail-closed and refuses to overwrite an existing secret directory. It creates new independent values for:

- PostgreSQL authentication;
- Core database URL and authentication pepper;
- bootstrap administrator password;
- Alica and Herman bearer credentials;
- a private framework CA and independent server certificates;
- an age backup-encryption identity.

Secrets remain in `/opt/unify/secrets` with mode 0600 and never enter source control, database registration rows, image layers, command output, or this document.

## Deployment

```bash
cd /opt/unify
export RELEASE_ID=<git-commit>
export UNIFY_PUBLIC_ORIGIN=https://unify.167-233-135-142.sslip.io
./prepare-secrets.sh /opt/unify
docker build -f Dockerfile.gateway -t "unify-core:$RELEASE_ID" .
docker build -f Dockerfile.hermes-control-adapter -t "unify-hermes-control-adapter:$RELEASE_ID" .
docker compose -f compose.yaml up -d
```

The one-shot migration and bootstrap services must complete successfully before Core starts. Framework registration is performed through the authenticated HTTPS API with `register-frameworks.sh`; registration probes must verify both adapters before database rows are accepted.

## Backups and restoration

`unify-backup.timer` creates a compressed PostgreSQL custom archive every day, encrypts it to a deployment-specific age recipient, records a SHA-256 checksum, removes plaintext temporary data, and retains 14 days.

A release is not accepted until `test-restore.sh` decrypts the latest archive, restores it into an isolated temporary database, compares table and migration counts to production, and removes the test database.

## Acceptance checks

- Core and PostgreSQL healthy after a fresh-volume start.
- One-shot migration and bootstrap jobs exit zero.
- Alica and Herman registrations report `verified` through private HTTPS endpoints.
- Public HTTPS readiness succeeds with a trusted certificate.
- Ports 8080, 18080, 28082, and 5432 are not publicly reachable.
- Restricted-container controls remain active.
- Encrypted backup and real isolated restoration both succeed.
- Full repository QA passes and the deployment commit is pushed.

## Verified production result

ALICA-v1 is running release `f772b1134a96d530e155a4f4bd1cb5cb0d156b52` with the following observed evidence:

- `unify-core`, `unify-postgres`, `unify-alica-adapter`, and `unify-herman-adapter` remained healthy after an explicit restart.
- Seven migrations were applied against the fresh `unify-postgres-data-v1` volume.
- Alica and Herman are independently enabled and `verified` against Hermes `0.20.0` commit `b8b17b8cee50b85adb7fba6ea332dc06731b86f4`.
- Core reaches the adapters through separate internal networks; the adapters and PostgreSQL publish no host ports.
- Core publishes only `127.0.0.1:18080` for Caddy. External probes found ports 5432, 8080, 18080, and 28082 closed.
- Public HTTPS readiness returns HTTP 200 with a trusted Let's Encrypt certificate.
- The encrypted backup timer is active. A real age-encrypted custom-format dump restored into an isolated temporary database with matching table and migration counts.
