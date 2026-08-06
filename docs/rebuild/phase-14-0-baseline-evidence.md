# Phase 14.0 — Frozen Baseline and Verified Rollback Assets

## Decision

**PASS.** The pre-rebuild ALICA-v1 production baseline was frozen on 2026-08-06 UTC. Production QA10 passed before and after the application-consistent framework-data freeze. Fresh encrypted PostgreSQL, Alica, Herman, configuration, and Caddy-state rollback artifacts were checksum-verified and restore-tested.

No architecture change has started. Production returned to the unchanged eight-container topology and release after the freeze.

## Accepted baseline

| Attribute | Value |
|---|---|
| Baseline ID | `phase14-baseline-20260806T070537Z` |
| Production release | `03cc758b31f85cdf891b3f88685064e43205a30f` |
| Baseline tooling/source commit | `be14933b65a1365ef8542315bd1f0afc44df31cf` |
| Public origin | `https://unify.167-233-135-142.sslip.io` |
| Production path | `/opt/unify/rollback/phase14-baseline-20260806T070537Z` |
| Stable pointer | `/opt/unify/rollback/phase14-current` |
| Baseline manifest schema | 1 |
| Checksummed baseline files | 41 |
| Failed marker | Absent |

The stable pointer resolves to the accepted baseline directory. Future baseline attempts must not replace it unless every Phase 14.0 gate passes.

## Captured inventory

The baseline contains a secret-safe live record of:

- capture time, source commit, public origin, hostname, kernel, boot ID, Docker version, and Compose version;
- host time, synchronization, uptime, memory, filesystems, inodes, and block devices;
- all containers, statuses, immutable image references, image IDs, and disk use;
- sanitized container inspections;
- image inspections;
- Docker network inspections;
- Docker volume inspections;
- bind-mount source, destination, mode, and read/write state;
- secret file checksums and owner/group/mode/size metadata, without secret values;
- public IPv4/IPv6 resolution;
- public TLS subject, issuer, serial, validity, and SHA-256 fingerprint;
- public readiness response headers;
- Caddy, backup timer, and Docker firewall unit state;
- UFW, iptables, ip6tables, and listening socket state; and
- exact configuration and service files required to restore the old topology.

Inventory path:

```text
/opt/unify/rollback/phase14-current/inventory
```

## Rollback artifacts

All artifacts are encrypted to the deployment-specific age recipient except the checksum sidecar. The matching identity remains at `/opt/unify/secrets/backup-age.key` and is a declared rollback dependency.

| Artifact | Size | SHA-256 |
|---|---:|---|
| `alica-data.tar.gz.age` | 21,316,993 bytes | `765ab46496e03db85f68c77c2ee9e5dfc5f64e17cc856fb1809568a8cd7263ef` |
| `herman-data.tar.gz.age` | 21,314,626 bytes | `e2396981c7d2b8f9ea0a7881d53cc4e23669b55a15e6722f6158e451dec01cd2` |
| `config-bundle.tar.gz.age` | 9,476 bytes | `150094dc3de7dec38f5ab1804164878c2a8024eee446e60e0828c405aac5e98f` |
| `caddy-state.tar.gz.age` | 8,102 bytes | `3849f7e2f1a664f94845cd377988ed5886a4992cdf65747d767c49e58d427684` |
| `unify-20260806T070612Z.dump.age` | 90,026 bytes | `6e854457fda0c3846caa64f5dfee49277c3dfb0ca147bbfb6e3e355761c687c8` |

Artifact path:

```text
/opt/unify/rollback/phase14-current/artifacts
```

The accepted baseline intentionally does not embed plaintext secret values. Rollback requires the retained `/opt/unify/secrets` directory, especially the age identity.

## Application-consistent freeze

The framework-data snapshots were created with this stop order:

1. `unify-core`;
2. `unify-alica-adapter` and `unify-herman-adapter`;
3. `alica` and `herman`.

After all five writers/readers were confirmed exited, the script:

1. generated canonical filesystem manifests for Alica and Herman;
2. archived each data directory with numeric ownership, ACL, xattr, mode, timestamp, symlink, and file-content preservation;
3. encrypted each archive with age;
4. decrypted each archive into an isolated temporary directory;
5. generated a second filesystem manifest from the restored copy; and
6. required byte-identical source/restored manifests.

The unchanged current runtime was then recovered in dependency order:

1. Alica and Herman, both required healthy;
2. both adapters, both required healthy;
3. Core, required healthy.

A fail-closed trap in the capture script also attempts this recovery sequence if any snapshot step is interrupted.

## Restore verification

| Gate | Result | Evidence |
|---|---|---|
| Configuration bundle decrypt/extract/manifest comparison | PASS | `config-bundle_restore_test=passed` |
| Caddy state decrypt/extract/manifest comparison | PASS | `caddy-state_restore_test=passed` |
| Alica data decrypt/extract/manifest comparison | PASS | `alica-data_restore_test=passed` |
| Herman data decrypt/extract/manifest comparison | PASS | `herman-data_restore_test=passed` |
| PostgreSQL encrypted archive checksum | PASS | `unify-20260806T070612Z.dump.age: OK` |
| PostgreSQL isolated restore | PASS | 26 tables, 7 migrations |
| Complete baseline checksum manifest | PASS | All 41 listed files verified |
| Independent encrypted archive listing | PASS | Config 31 entries; Caddy 27; Alica 1,662; Herman 1,662 |

Restore evidence path:

```text
/opt/unify/rollback/phase14-current/evidence
```

## QA10

| Run | Result | Stages |
|---|---|---:|
| Before baseline capture | PASS | 22 |
| After freeze, restoration tests, and runtime recovery | PASS | 22 |

Both runs exercised:

- authentication and session revocation;
- authorization and unauthenticated rejection;
- idempotent Alica/Herman registration;
- health, capabilities, profiles, providers, projects, boards, cronjobs, conversations, and events for both frameworks;
- concurrent registry reads;
- audit evidence and secret-value scanning; and
- logout and revoked-session rejection.

Evidence:

```text
/opt/unify/rollback/phase14-current/evidence/pre-freeze-qa10.log
/opt/unify/rollback/phase14-current/evidence/post-freeze-qa10.log
```

## Recovered production state

After the freeze:

- all eight expected steady-state containers were running;
- Alica, Herman, both adapters, Core, and PostgreSQL were healthy;
- both private Caddy proxy containers were running;
- Core loopback readiness returned release `03cc758b31f85cdf891b3f88685064e43205a30f`;
- public HTTPS readiness returned the same release; and
- the old topology remained unchanged.

Independent public TCP probes from the deployment management host observed:

| Port | Result |
|---:|---|
| 22 | Open — management SSH |
| 80 | Open — HTTP redirect/ACME |
| 443 | Open — HTTPS |
| 5432 | Closed |
| 8080 | Closed |
| 8642 | Closed |
| 18080 | Closed |
| 28082 | Closed |
| 2019 | Closed |

## Initial fail-closed attempt

The first capture attempt, `phase14-baseline-20260806T065943Z`, was correctly marked `FAILED` and was not assigned to `phase14-current`.

Cause:

- the production copy of `qa10-production.sh` was older than the repository copy;
- its invalid-login assertion accepted HTTP 401 only;
- the persisted authentication throttle truthfully returned HTTP 429 for the repeated deliberately invalid QA identity; and
- the post-freeze acceptance therefore stopped before emitting its first stage.

Corrective action:

- preserved the old production QA script as `/opt/unify/qa10-production.sh.pre-phase14`;
- installed the current repository QA runner with SHA-256 `f27421f8ea11e42545302732febe85da24819cfa8b92a45849855ea7bd364fed`;
- verified that it accepts the specified 401-or-429 invalid-login outcome;
- ran QA10 successfully; and
- reran the complete baseline workflow from the beginning.

The failed directory is diagnostic evidence only. It has a `FAILED` marker, no accepted baseline manifest, and is not a rollback pointer target.

## Rollback use

Rollback remains available until explicit retirement approval.

### Preferred topology rollback

If the five-container cutover fails but data remains valid:

1. stop the new project without deleting volumes or bind-mounted data;
2. preserve failure evidence;
3. restore the archived old configuration files if active definitions changed;
4. retain existing `/opt/unify/secrets`, framework data directories, database volume, old image tags, and Caddy state;
5. start the old Alica/Herman Compose project;
6. start the old UNIFY Compose project;
7. restore the old framework registration endpoints;
8. restore/enable host Caddy if it was disabled;
9. verify public and local readiness; and
10. run production QA10.

### Data restoration

Restore Alica/Herman snapshots only if existing bind-mounted data is invalid or was changed incompatibly. Never extract over a running framework. Stop Core, adapters, and frameworks first, preserve the failed current data separately, decrypt into a temporary directory, verify its manifest, and then perform an explicit atomic replacement.

Restore the database dump only when the existing volume cannot be safely reused or forward migrations cannot be rolled back. Restore into an isolated database first and verify 26 tables and 7 baseline migrations before any production switch.

### Required retained dependencies

- `/opt/unify/secrets`, including `backup-age.key`;
- current Docker images or exact reproducible source plus pinned bases;
- `unify-postgres-data-v1` unless restoring the encrypted dump;
- `/srv/alica-stack/data/alica` and `/srv/alica-stack/data/herman` unless restoring their archives;
- host Docker, systemd, Caddy, age, tar, and OpenSSL tooling; and
- accepted baseline manifests and checksums.

No retirement or pruning of those dependencies is authorized by Phase 14.0.

## Verification commands

```bash
BASELINE=$(readlink -f /opt/unify/rollback/phase14-current)
cd "$BASELINE"
sudo sha256sum -c SHA256SUMS
sudo test ! -e FAILED
```

Encrypted archive structure can be checked without writing plaintext to disk:

```bash
sudo age --decrypt \
  --identity /opt/unify/secrets/backup-age.key \
  "$BASELINE/artifacts/alica-data.tar.gz.age" |
  tar -tzf - >/dev/null
```

The same pattern applies to Herman, configuration, and Caddy-state artifacts.

## Exit gate

Phase 14.0 exit requirements are satisfied:

- [x] Current repository/tooling commit recorded.
- [x] Current production release and image identities recorded.
- [x] Compose configurations and container inspections recorded.
- [x] Networks, volumes, bind mounts, secret checksums, systemd units, DNS, and TLS state recorded.
- [x] Pre-change production QA10 passed.
- [x] Fresh encrypted PostgreSQL backup created and checksum-verified.
- [x] PostgreSQL backup restored into isolation with matching tables and migrations.
- [x] Alica snapshot created under an application-consistent freeze and restore-tested.
- [x] Herman snapshot created under an application-consistent freeze and restore-tested.
- [x] Existing configurations and Caddy state archived and restore-tested.
- [x] Complete baseline manifest checksum-verified.
- [x] Existing runtime recovered and post-freeze QA10 passed.
- [x] Public exposure remained correct.

**Phase 14.1 may begin.**
