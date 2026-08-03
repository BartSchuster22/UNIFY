# Authentication Registry Capacity Gate — 2026-08-03

- **Branch:** `feat/qa10-auth-registry`
- **Observed at:** 2026-08-03T14:41:36.933Z
- **Command:** `pnpm identity:capacity`
- **Policy:** [`../../config/identity-capacity-policy.json`](../../config/identity-capacity-policy.json)
- **Implementation:** [`../../scripts/identity-capacity-gate.mjs`](../../scripts/identity-capacity-gate.mjs)
- **Overall verdict:** **STOP**
- **Binding effect:** Do not pull or deploy the Identity Authority until the disk gate passes.

## Result

| Domain | Result | Evidence |
|---|---|---|
| Root disk and inodes | **FAIL** | 17.71 GiB available; 24.00 GiB reserved requirement; 6.29 GiB deficit; 77% inodes free |
| Memory and pressure | **PASS** | 2.76 GiB available against 2.50 GiB requirement; full memory PSI avg60 0.08 |
| PostgreSQL | **PASS** | Healthy; 8/100 connections used; 92 free against 40 required; UNIFY database 11.70 MiB |
| Backup freshness and bounded UNIFY retention | **PASS** | Fresh encrypted/checksummed backup; enabled daily timer; seven daily plus four older Sunday copies |

The command intentionally exited with code `2` because a `STOP` verdict is a failing deployment gate.

## Candidate Identity Authority envelope

The policy records Keycloak 26.7.0 as a candidate, not an approved production image:

- amd64 manifest digest: `sha256:26939e1318d6f008fc2ee6e10cec1cf8f1ba8a21846c1bc81b91ed0506bc2a7a`;
- compressed manifest payload measured from the official registry: 267,202,025 bytes;
- hard memory budget: 1 GiB;
- current and rollback image reservation: 2 GiB.

No Keycloak image was pulled because disk capacity must pass first.

## Disk reservation

| Reservation | Bytes | GiB |
|---|---:|---:|
| Root operational safety floor | 8,589,934,592 | 8 |
| Current and rollback Identity Authority images | 2,147,483,648 | 2 |
| Identity database and WAL | 3,221,225,472 | 3 |
| Identity backup retention | 3,221,225,472 | 3 |
| Existing host backup growth before steady retention | 8,589,934,592 | 8 |
| **Required free space** | **25,769,803,776** | **24** |
| **Observed free space** | **19,012,423,680** | **17.71** |
| **Deficit** | **6,757,380,096** | **6.29** |

The reservation is deliberately based on `bavail`, not nominal filesystem size. It includes an operational floor rather than treating every currently free byte as deployable capacity.

## Memory assessment

Observed:

- physical memory: approximately 8 GiB;
- available memory at gate: 2.76 GiB;
- required available memory: 2.50 GiB, consisting of a 1 GiB Identity Authority hard limit plus a 1.5 GiB host reserve;
- swap used: 6.71 GiB;
- full memory PSI avg60: 0.08;
- 15-second `vmstat` sampling showed effectively no sustained swap-in/swap-out activity;
- no kernel OOM event was found in the preceding 30 days;
- Docker service cgroup reported zero OOM kills.

Memory therefore passes the pre-deployment gate, but the high amount of occupied swap is a warning. Keycloak must still pass the measured steady-state and load limits after deployment; this gate is not a substitute for that load test.

## PostgreSQL assessment

The live `unify-postgres-1` container was healthy. Measurements:

- `max_connections`: 100;
- current connections: 8;
- active connections at the initial measurement: 1;
- free connection slots: 92;
- capacity requirement: at least 40 free slots;
- UNIFY database size: 12,268,003 bytes;
- PostgreSQL volume usage: approximately 69 MiB;
- configured `max_wal_size`: 1 GiB.

The future Identity Authority must receive a separate database/schema and separate credentials. This gate does not authorize sharing UNIFY's database user.

## Backup retention remediation completed

Before this gate, UNIFY had only a stale encrypted rehearsal artifact and no recurring backup timer. The following controls are now implemented and live:

- `deploy/unify-backup.service`;
- `deploy/unify-backup.timer`;
- daily encrypted Gateway backup;
- paired SHA-256 checksum;
- bounded retention: latest backup from seven UTC days plus four older Sundays;
- retention deletes only exact `gateway-YYYYMMDDTHHMMSSZ.tar.enc` artifacts and paired checksums;
- unrelated evidence artifacts are ignored;
- retention self-test added to `pnpm qa`;
- capacity-policy self-test added to `pnpm qa`.

Live verification:

- timer enabled: yes;
- timer active: yes;
- next run scheduled for 2026-08-04 around 01:30 UTC with randomized delay;
- manual systemd service run: success;
- latest backup: `gateway-20260803T143940Z.tar.enc`;
- size: 471,072 bytes;
- checksum verification: pass.

Local encrypted retention does not constitute off-host durability. Off-host copies and Identity Authority backup/restore remain required in the later operations phase.

## Host-wide retention risk

The unrelated host-level agent configuration backup currently produces an approximately 3.83 GiB retained set and its policy keeps the latest three daily copies plus older Sunday archives without a maximum weekly count. That policy can grow without a fixed bound and is the reason the capacity policy reserves 8 GiB of near-term growth while still stopping deployment.

UNIFY must not silently delete or weaken another service's backup history. This requires a host-level decision: move those encrypted/config backups off-host, exclude reproducible runtime/cache data from that backup, or impose an explicitly approved bounded weekly retention.

## Required remediation

Before continuing to Identity Authority image selection/deployment:

1. expand the root filesystem from approximately 75 GiB to at least 100 GiB **or** free equivalent durable capacity without deleting required backup/rollback evidence;
2. bound or offload the host agent-configuration weekly backup retention;
3. retain at least 24 GiB `bavail` after the host backup policy reaches its steady state;
4. rerun `pnpm identity:capacity` and require `PASS` with exit code `0`;
5. commit and push the new passing evidence before pulling the Keycloak image.

A temporary cleanup that passes for one day but fails after the next large agent backup is not acceptable remediation.

## Verification commands

```bash
pnpm backup:prune:self-test
pnpm identity:capacity:self-test
pnpm backup:prune:dry-run
pnpm identity:capacity
systemctl is-enabled unify-backup.timer
systemctl is-active unify-backup.timer
systemctl list-timers unify-backup.timer --all
```

## Conclusion

The capacity gate has been implemented and executed completely. Memory, PostgreSQL and UNIFY backup retention pass. Root storage does not provide the approved reservation, so Phase A0 remains stopped. The result is truthful and fail-closed: no Identity Authority image or database has been deployed.
