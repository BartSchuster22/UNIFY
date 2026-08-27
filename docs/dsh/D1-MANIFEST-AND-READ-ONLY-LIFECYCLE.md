# ALICA Community DSH D1 — Whole-Cell Manifest and Read-Only Lifecycle

- **Status:** Implemented
- **Contract:** `alica-release/v1`
- **Lifecycle binary:** `alicactl 1.0.0-d1`
- **Commands:** `preflight`, `status`, `verify`
- **Mutation authority:** none in D1

## 1. D1 boundary

D1 establishes release truth and truthful read-only inspection. It does not install, render Compose, create files, pull images, create containers, change systemd, write lifecycle state, accept a release, or update anything. Those mutation paths start in later build stages.

The D1 implementation is a dependency-free Go module producing a statically linked Linux/amd64 executable. The customer artifact is the compiled executable; Go, Node, pnpm and source checkout are not customer-host dependencies.

## 2. Release truth

The canonical whole-Cell release manifest is governed by:

- schema: `dsh/contracts/alica-release-v1.schema.json`;
- executable validator: `dsh/alicactl/internal/contract`;
- canonical encoding: `alica-canonical-json/v1`;
- signature envelope: `alica-manifest-signature/v1`;
- pinned key envelope: `alica-trust-key/v1`;
- digest: SHA-256 over canonical manifest bytes;
- signature: Ed25519 over the same canonical bytes.

`alica-canonical-json/v1` is deliberately restricted: UTF-8 JSON, lexicographically sorted object keys, compact separators, deterministic JSON string encoding, bounded signed 64-bit integer values, and no floating-point/exponent numbers. Duplicate keys, BOMs, trailing JSON, unknown fields and oversized inputs fail closed.

The signed manifest is release truth. Compose remains generated runtime input and cannot change release identity.

## 3. Manifest closure

The manifest binds all of the following:

1. immutable UUIDv7 release identity, SemVer, creation time and release class;
2. D0 product, release line, profile, product-freeze digest, EULA ID/digest and zero central runtime dependencies;
3. exact Debian 13/amd64/systemd, Docker, Compose and resource envelope;
4. source repositories, commits and tree digests;
5. the exact 12-component `dsh-minimal/v1` set;
6. immutable component artifact, SBOM, provenance and configuration-schema digests;
7. component authorities, provides/requires contracts and data targets;
8. exact container, network, volume, host-unit and public-port topology;
9. fresh-install and exact-origin compatibility declarations;
10. migration DAG and failure dispositions;
11. rollback/forward-recovery declarations;
12. all eight durable data authorities and backup/restore contracts;
13. exact public/private endpoint declarations;
14. secret references and classes without values;
15. exact acceptance-suite and release-note artifacts;
16. known risks and irreversible changes.

Artifact tags, embedded URI credentials, unsupported schemes, unknown topology references, secret values, duplicate IDs, migration cycles and incomplete DSH component/data sets are rejected.

## 4. D1 trust scope

D1 verifies a detached Ed25519 manifest signature against an explicitly supplied pinned public key. This proves the local cryptographic contract and prevents manifest tampering.

It is not the final distribution trust system. D5 must add accepted TUF root/targets metadata, threshold/rotation/expiry policy, executable artifact signatures, SBOM/provenance subject verification and offline-bundle trust. The D1 fixture key is public test material and is never a release trust root.

## 5. Cell identity and operation evidence

An installed Cell has three separate closed records under `/var/lib/alica`:

- `cell-declaration.json` (`alica-cell-declaration/v1`) — immutable Cell identity, product, profile and deployment mode;
- `lifecycle-state.json` (`alica-lifecycle-state/v1`) — the current accepted release pointer;
- `operation-journal.json` (`alica-operation-journal/v1`) — bounded append-only operation events.

Journal events are sequential and SHA-256 hash chained. Each binds one operation ID, operation kind, event phase/time, source and target release, target manifest digest, explicit mutation authorization, result and evidence digests. `alicactl` only reads and verifies these records in D1; it has no journal writer or mutation authority. An accepted-current pointer without a matching terminal `accepted/succeeded` journal event fails closed.

## 6. Read-only commands

### `alicactl preflight`

Reads and verifies the manifest/signature/key, then observes:

- `/etc/os-release`;
- architecture and CPU count;
- `/proc/meminfo`;
- free filesystem capacity;
- systemd presence;
- Docker server version;
- Docker Compose plugin version.

It compares those facts to the signed platform/resource envelope. It does not require an installed Cell.

### `alicactl status`

Performs preflight and then reads the closed Cell declaration, lifecycle accepted-current state and append-only operation journal under `/var/lib/alica`.

- Missing accepted-current state returns truthful `NOT_INSTALLED` rather than inventing an installation.
- Existing state is compared to signed release ID, manifest digest and profile.
- Docker containers, networks and volumes are inventoried through read-only `list` and `inspect` operations.
- Candidate inventory is the deterministic union of exact Cell labels, the reserved `alica` Compose project and reserved `alica-`/`alica_` names, so unlabeled but ALICA-named rogue resources reach unknown-resource drift checks.
- Declared systemd units are read with `systemctl show`.
- Drift is reported; nothing is repaired.

### `alicactl verify`

Performs complete signed desired-versus-observed conformance across:

- accepted-current release, manifest and profile;
- exact managed container set;
- image digests and release/ownership labels;
- running and health states;
- network membership and internal flags;
- volume set and authority labels;
- published ports;
- required host units;
- host/runtime/resources.

Missing, extra, duplicate or inconsistent resources fail closed.

## 7. Reports and exits

Every successful command invocation emits `alica-readonly-report/v1` in human or JSON form.

Invariant:

```json
{"mutationPerformed": false}
```

| Exit | Meaning |
|---:|---|
| `0` | PASS, or truthful `NOT_INSTALLED` status without another failing gate |
| `2` | input, schema, trust, signature, state-read or observation failure |
| `3` | platform, resource or conformance failure/drift |

Status values are `PASS`, `FAIL` or `NOT_INSTALLED`. No warning can silently downgrade an unknown or incompatible state to success.

## 8. Observation fixtures

`--observation FILE` is denied unless `ALICACTL_TEST_MODE=1`. It exists only for deterministic acceptance tests and cannot spoof production observation. Test fixtures are explicitly `source: test-fixture`, use an invalid registry domain, and bind a manifest with `installable: false`.

The fixture private key is not stored. Only the public key and detached fixture signature are committed.

## 9. Read-only enforcement

Production lifecycle source contains no file-write/create API and no Docker mutation command. Live D1 inspection invokes only:

- `docker version`;
- `docker compose version`;
- `docker ps`;
- `docker inspect` and `docker image inspect`;
- `docker network ls/inspect`;
- `docker volume ls/inspect`;
- `systemctl show`.

D1 acceptance fingerprints protected contract/source files, `/var/lib/alica`, and Docker container/network/volume inventories before and after binary execution. Any change fails acceptance.

## 10. Build and verify

```bash
ALICA_GO_BIN=/path/to/go pnpm dsh:d1:verify
```

The verifier requires Go 1.24 or newer, builds twice with:

```text
CGO_ENABLED=0 GOOS=linux GOARCH=amd64
-trimpath -ldflags="-s -w -buildid="
```

The two binary hashes must match. D1 verification is included in the repository-wide `pnpm qa` gate.

## 11. D1 acceptance boundary

D1 is accepted only when:

- the fixture remains deterministically generated;
- strict/closed/canonical manifest validation passes;
- cryptographic tampering and wrong-key tests fail closed;
- all three commands pass against exact conformant observation;
- platform, release, manifest, profile, artifact, health, topology, storage, exposure and unit drift fail closed;
- the binary is static and reproducible;
- real-host preflight remains truthful even when the engineering host is outside the frozen Debian 13/Docker 28 support envelope;
- no runtime or lifecycle mutation occurs.

D2 may add mutation only through a separately accepted install design. It must not weaken these D1 read-only/trust gates.
