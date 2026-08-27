# ALICA Community DSH 1.0 — D0 Product and License Freeze

- **Status:** Frozen
- **Effective date:** 2026-08-27
- **Decision owner/licensor:** ALICA Ltd, Hong Kong Special Administrative Region
- **Machine authority:** `dsh/product/alica-community-dsh-1.0.freeze.json`
- **Validator:** `node scripts/verify-dsh-d0-freeze.mjs`

## Product identity

| Field | Frozen value |
|---|---|
| Product | ALICA Community DSH |
| Product ID | `com.alica.community-dsh` |
| Product line | `1.0` |
| Initial candidate | `1.0.0` |
| Cell contract | `alica-cell/v0.1` |
| Conformance profile | `dsh-minimal/v1` |
| Origin | `dsh` |
| Management | `local-only` |
| Price model | Free of charge |
| Source policy | Proprietary/closed source |
| Binary license | ALICA Community DSH EULA 1.0 |
| Central runtime dependencies | None |

“Community” identifies the free self-hosted edition; it does not mean open source. The first-party source remains proprietary. The distribution may include open-source components under their own licenses.

## Frozen customer promise

An authorized operator can obtain, verify, install, configure, operate, back up, restore, update, roll back and remove the product on supported self-owned infrastructure without private ALICA Ltd repository access and without PSI, UPRM, Fleet, Modelm8 or another ALICA Ltd service being available.

The license permits personal, educational, evaluation and internal commercial self-hosting, including multiple instances. It prohibits redistribution, resale and providing the proprietary product as a third-party hosted/managed service unless ALICA Ltd separately authorizes it.

No paid support, hosted service or SLA is included.

## Included logical capabilities

The 1.0 release must include and govern as one Cell:

1. Caddy ingress;
2. UNIUI operator/application UI;
3. UNIFY Gateway/Core;
4. pinned Keycloak Identity Authority;
5. pinned PostgreSQL data service with separated authority credentials/data;
6. Alica framework runtime;
7. Herman framework runtime with separate durable identity/state;
8. MemoryV4;
9. one governed anchor AInbA lifecycle;
10. Doghouse Node in report-only mode;
11. `alicactl` local lifecycle authority;
12. backup, restore, canary, alert and update-check jobs required by the profile.

Only UNIFY/Identity user endpoints and UNIUI are exposed through declared ingress routes. Databases, framework APIs, MemoryV4, Doghouse administration/execution and Identity administration/metrics remain private.

## Explicit exclusions from 1.0

- PSI enrollment or dependency;
- UPRM licensing/payment dependency;
- Fleet enrollment/control plane;
- Modelm8 dependency;
- Aquiero-hosted identity, telemetry, backup or release requirement;
- Kubernetes, k3s, Helm or a Kubernetes Operator;
- multi-node high availability;
- public marketplace/catalog;
- third-party managed hosting/resale rights;
- automatic Doghouse repair beyond report-only observation;
- `dsh-standard/v1` or managed-profile conformance claims;
- arm64, RPM-family distributions, macOS and Windows hosts.

Exclusions cannot silently become runtime dependencies. Adding a capability or platform requires a versioned product-freeze amendment and conformance evidence.

## Frozen distribution format

### Online

- signed statically linked `alicactl` for Linux x86-64;
- TUF-protected stable/candidate metadata;
- OCI registry artifacts identified by digest;
- Cosign signatures;
- SBOMs, provenance, notices, schemas and release notes.

### Offline

One complete file:

```text
alica-community-dsh-<version>-linux-amd64.bundle.tar.zst
```

It contains `alicactl`, trusted update metadata, an OCI image layout, complete Cell manifest, schemas, signatures, checksums, SBOMs, provenance, notices, migrations, backup/restore contracts, acceptance definitions and operator documentation. Offline installation applies the same trust policy as online installation.

Source checkout, Node, pnpm and private ALICA credentials are forbidden end-user prerequisites.

## Supported MVP platform

The first qualification target is intentionally narrow:

| Boundary | Frozen target |
|---|---|
| Host OS | Debian GNU/Linux 13 (`trixie`), clean supported server installation |
| Architecture | `linux/amd64` only |
| Container runtime | Docker Engine Community `>=28.4.0 <29.0.0` |
| Compose | Docker Compose plugin `>=2.39.4 <3.0.0` |
| Init/service manager | systemd |
| Filesystem | local Linux filesystem with POSIX ownership/mode and atomic rename semantics |
| Network | IPv4 required; outbound HTTPS/DNS/time needed only for configured online services; offline install supported |
| Capacity qualification target | minimum 4 vCPU, 8 GiB RAM and 100 GiB free SSD; recommended 8 vCPU, 16 GiB RAM and 200 GiB free SSD |

Resource values are D6 qualification targets, not performance claims. Publication is blocked until the exact candidate passes measured load, backup, restore and disk-headroom gates at the minimum target.

## Authorities

| Concern | Frozen owner |
|---|---|
| Product contract/governance | PROJECT-ALICA |
| First-party implementation | UNIFY repository plus exact component repositories referenced by release provenance |
| Cell release truth | Signed whole-Cell release manifest |
| Local desired/observed lifecycle | `alicactl` |
| Container realization | Generated Compose project; never release authority |
| Identity | Local pinned Keycloak |
| UNIFY authorization/application/framework governance | UNIFY Core |
| Framework native state | Exact Alica/Herman runtime respectively |
| Knowledge | MemoryV4 through UNIFY governance |
| Assurance/incidents | Doghouse Node |
| Update trust | Pinned TUF root and signed metadata; OCI digests/signatures |
| Local operator | Final authority for install/update/recovery/decommission |

## Data and privacy promise

- Customer content and operational telemetry are not transmitted to ALICA Ltd by default.
- Optional outbound integrations are disclosed, disabled by default and require operator action.
- BYOK provider, certificate, DNS, time, update and off-host backup traffic is destination-specific and not described as ALICA telemetry.
- A support bundle is explicit, locally generated, redacted and never uploaded automatically.
- Complete data inventory, export, backup and deletion behavior must be documented before D6.

## License and notice policy

- First-party source/material is proprietary and all rights reserved.
- First-party distributed binaries are licensed only under `licenses/ALICA-COMMUNITY-DSH-EULA-1.0.md`.
- Install requires explicit EULA acceptance tied to the exact EULA SHA-256; unattended acceptance must supply that digest and is auditable.
- Third-party components retain their own licenses.
- Every release bundles exact third-party notices and SBOMs.
- Unknown/incompatible license findings block publication.
- ALICA names/marks are not granted except to identify authorized unmodified use.

This product freeze is an engineering and distribution decision record, not legal advice. ALICA Ltd remains responsible for obtaining professional Hong Kong legal review before public publication; such review may tighten wording but cannot silently change the frozen commercial model or customer rights.

## D0 acceptance

D0 is complete only when:

- [x] product/edition/version/profile/origin/management are exact;
- [x] included and excluded capabilities are exact;
- [x] platform and distribution formats are exact;
- [x] central dependencies are forbidden;
- [x] release and lifecycle authorities are exact;
- [x] licensor, governing law, source policy and binary-use rights are exact;
- [x] EULA, proprietary notice and third-party policy exist;
- [x] the EULA digest is bound by the machine-readable freeze;
- [x] executable validation passes;
- [x] D1–D6 work can consume the freeze without making an unresolved product decision.
