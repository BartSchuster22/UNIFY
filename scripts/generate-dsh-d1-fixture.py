#!/usr/bin/env python3
"""Generate deterministic, non-installable D1 contract and observation fixtures."""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dsh/alicactl/testdata"


def digest(label: str) -> str:
    return "sha256:" + hashlib.sha256(label.encode()).hexdigest()


def artifact(identifier: str, label: str) -> dict[str, str]:
    value = digest(label)
    return {
        "id": identifier,
        "artifact": f"oci://registry.fixture.invalid/alica-evidence/{identifier}@{value}",
        "digest": value,
    }


def source(repository: str, commit: str) -> dict[str, str]:
    return {
        "repository": repository,
        "commit": commit,
        "treeDigest": digest(f"tree:{repository}:{commit}"),
    }


component_rows = [
    ("caddy", "edge", "2.8.4", "oci-image", "oci-container", ["alica-https/v1"], [], "caddy-config/v1", "caddy-config/v1"),
    ("uniui", "uniui", "1.0.0", "oci-image", "oci-container", ["uniui-web/v1"], ["unify-api/v1"], "uniui-config/v1", "stateless/v1"),
    ("unify-core", "unify", "1.0.0", "oci-image", "oci-container", ["unify-api/v1"], ["postgresql/v16", "keycloak-oidc/v1", "memory-v4-api/v1"], "unify-core-config/v1", "core-migrations/d1"),
    ("keycloak", "identity", "26.0.8", "oci-image", "oci-container", ["keycloak-oidc/v1"], ["postgresql/v16"], "keycloak-config/v1", "keycloak-schema/d1"),
    ("postgresql", "postgresql", "16.10.0", "oci-image", "oci-container", ["postgresql/v16"], [], "postgresql-config/v1", "postgresql-schema/d1"),
    ("alica-runtime", "alica", "1.0.0", "oci-image", "oci-container", ["framework-agent/v1"], ["unify-api/v1", "memory-v4-api/v1"], "alica-runtime-config/v1", "alica-state/d1"),
    ("herman-runtime", "herman", "1.0.0", "oci-image", "oci-container", ["framework-agent/v1"], ["unify-api/v1", "memory-v4-api/v1"], "herman-runtime-config/v1", "herman-state/d1"),
    ("memory-v4", "memory-v4", "1.0.0", "oci-image", "oci-container", ["memory-v4-api/v1"], ["postgresql/v16"], "memory-v4-config/v1", "memory-v4-schema/d1"),
    ("ainba-anchor", "ainba", "1.0.0", "oci-image", "oci-container", ["ainba-workload/v1"], ["framework-agent/v1", "memory-v4-api/v1"], "ainba-anchor-config/v1", "ainba-data/d1"),
    ("doghouse-node", "doghouse", "1.0.0", "oci-image", "oci-container", ["doghouse-report/v1"], ["unify-api/v1"], "doghouse-report-config/v1", "doghouse-state/d1"),
    ("alicactl", "lifecycle", "1.0.0", "host-binary", "host-binary", ["alica-lifecycle-readonly/v1"], [], "alicactl-config/v1", "lifecycle-state/v1"),
    ("operations-jobs", "operations", "1.0.0", "host-unit-bundle", "systemd-units", ["alica-operations-jobs/v1"], ["alica-lifecycle-readonly/v1"], "operations-jobs-config/v1", "operations-jobs-state/v1"),
]
components = []
for cid, authority, version, kind, realization, provides, requires, config, data in component_rows:
    component_digest = digest(f"artifact:{cid}")
    prefix = "oci://registry.fixture.invalid/alica/" if kind == "oci-image" else "file://bundle/"
    components.append(
        {
            "componentId": cid,
            "authority": authority,
            "version": version,
            "kind": kind,
            "realization": realization,
            "artifact": f"{prefix}{cid}@{component_digest}",
            "digest": component_digest,
            "signaturePolicy": "alica-executable/v1",
            "sbom": artifact(f"{cid}-sbom-cyclonedx-1.6", f"sbom:{cid}"),
            "provenance": artifact(f"{cid}-provenance-slsa-v1", f"provenance:{cid}"),
            "componentContract": f"{cid}/v1",
            "provides": provides,
            "requires": requires,
            "configSchema": {"id": config, "digest": digest(f"config:{cid}")},
            "dataSchema": {"authority": authority, "target": data},
        }
    )

networks = [
    {"id": "edge", "internal": False},
    {"id": "app", "internal": True},
    {"id": "data", "internal": True},
    {"id": "frameworks", "internal": True},
    {"id": "assurance", "internal": True},
]
volumes = [
    {"id": "caddy-config", "authority": "edge"},
    {"id": "postgres-data", "authority": "postgresql"},
    {"id": "memory-data", "authority": "memory-v4"},
    {"id": "alica-state", "authority": "alica"},
    {"id": "herman-state", "authority": "herman"},
    {"id": "ainba-data", "authority": "ainba"},
    {"id": "doghouse-state", "authority": "doghouse"},
]
container_rows = {
    "caddy": (["edge", "app"], ["caddy-config"], [{"hostIp": "0.0.0.0", "published": 80, "target": 80, "protocol": "tcp"}, {"hostIp": "0.0.0.0", "published": 443, "target": 443, "protocol": "tcp"}]),
    "uniui": (["app"], [], []),
    "unify-core": (["app", "data", "frameworks", "assurance"], [], []),
    "keycloak": (["app", "data"], [], []),
    "postgresql": (["data"], ["postgres-data"], []),
    "alica-runtime": (["frameworks", "app"], ["alica-state"], []),
    "herman-runtime": (["frameworks", "app"], ["herman-state"], []),
    "memory-v4": (["data", "frameworks"], ["memory-data"], []),
    "ainba-anchor": (["frameworks"], ["ainba-data"], []),
    "doghouse-node": (["assurance", "app"], ["doghouse-state"], []),
}
containers = [
    {
        "componentId": cid,
        "service": cid,
        "networks": row[0],
        "volumes": row[1],
        "publishedPorts": row[2],
        "healthRequired": True,
    }
    for cid, row in container_rows.items()
]
release_id = "rel_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b90"
manifest = {
    "schemaVersion": "alica-release/v1",
    "canonicalEncoding": "alica-canonical-json/v1",
    "releaseId": release_id,
    "releaseVersion": "1.0.0-d1.fixture.1",
    "createdAt": "2026-08-27T20:00:00Z",
    "cellContract": "alica-cell/v0.1",
    "releaseClass": "development",
    "installable": False,
    "product": {
        "productId": "com.alica.community-dsh",
        "releaseLine": "1.0",
        "profile": "dsh-minimal/v1",
        "freezeDigest": "sha256:084ee1cfe6a16afcfac7178484afd359c7f9012d69552ce37839594a39c4b3b1",
        "binaryLicense": "ALICA-Community-DSH-EULA-1.0",
        "eulaDigest": "sha256:3b172e3850816750ff7b5a7d6d4b9f311f5c745159e201f42fea647c4dad1f3c",
        "centralRuntimeDependencies": [],
    },
    "profiles": ["dsh-minimal/v1"],
    "platforms": [{"osId": "debian", "osVersion": "13", "architecture": "amd64", "init": "systemd", "docker": {"minimumInclusive": "28.4.0", "maximumExclusive": "29.0.0"}, "compose": {"minimumInclusive": "2.39.4", "maximumExclusive": "3.0.0"}, "minimum": {"vcpu": 4, "memoryBytes": 8589934592, "freeDiskBytes": 107374182400}, "upgradeHeadroomBytes": 21474836480}],
    "sources": [
        source("BartSchuster22/UNIFY", "8aaa8ce6c738138e4b484cd6be43a5545263394b"),
        source("BartSchuster22/memory-v4", "6111107fa709826c0642651f7f256c0c7fe3116a"),
        source("BartSchuster22/doghouse", "8ce1b1c09c0a7f2b91d8c65a9c820a64e4cea271"),
        source("NousResearch/hermes-agent", "9e54eee44f1cbbe62247a36546e51ff8940373c6"),
    ],
    "components": components,
    "topology": {
        "project": "alica",
        "labels": {"cellId": "com.alica.cell.id", "releaseId": "com.alica.release.id", "componentId": "com.alica.component.id", "managed": "com.alica.managed"},
        "containers": containers,
        "networks": networks,
        "volumes": volumes,
        "hostUnits": [
            {"componentId": "operations-jobs", "unit": "alica-backup.service", "required": True},
            {"componentId": "operations-jobs", "unit": "alica-canary.timer", "required": True},
            {"componentId": "operations-jobs", "unit": "alica-update-check.timer", "required": True},
        ],
    },
    "compatibility": {"freshInstall": True, "supportedOrigins": []},
    "migrationPlan": {"planId": "migration-plan/d1-contract-fixture", "steps": []},
    "rollback": {"supportedTargets": [], "forwardRecovery": "runbook:alica-dsh-forward-recovery/v1"},
    "dataUnits": [
        {"authority": "identity-postgres", "backupContract": "postgresql-native-backup/v1", "restoreOrder": 10},
        {"authority": "unify-postgres", "backupContract": "postgresql-native-backup/v1", "restoreOrder": 20},
        {"authority": "memory-v4", "backupContract": "memory-v4-backup/v1", "restoreOrder": 30},
        {"authority": "alica-state", "backupContract": "framework-state-backup/v1", "restoreOrder": 40},
        {"authority": "herman-state", "backupContract": "framework-state-backup/v1", "restoreOrder": 50},
        {"authority": "ainba-data", "backupContract": "ainba-backup/v1", "restoreOrder": 60},
        {"authority": "doghouse-state", "backupContract": "doghouse-backup/v1", "restoreOrder": 70},
        {"authority": "lifecycle-state", "backupContract": "alicactl-state-backup/v1", "restoreOrder": 80},
    ],
    "endpoints": [
        {"id": "alica-http-redirect", "exposure": "public", "protocol": "http", "port": 80, "owner": "caddy"},
        {"id": "alica-https", "exposure": "public", "protocol": "https", "port": 443, "owner": "caddy"},
    ],
    "secretRequirements": [
        {"reference": "secret://cell/postgresql/admin", "class": "database-password", "consumers": ["postgresql"]},
        {"reference": "secret://cell/keycloak/admin", "class": "identity-bootstrap", "consumers": ["keycloak"]},
        {"reference": "secret://cell/unify/oidc-client", "class": "oidc-client-secret", "consumers": ["unify-core"]},
        {"reference": "secret://cell/providers/byok", "class": "provider-credentials", "consumers": ["alica-runtime", "herman-runtime"]},
    ],
    "acceptanceSuite": artifact("alica-cell-acceptance/v1", "acceptance"),
    "releaseNotes": artifact("alica-dsh-release-notes/v1", "release-notes"),
    "knownRisks": ["D1 fixture artifacts are contract-only and cannot be installed.", "D5 must replace direct pinned-key verification with accepted TUF and executable artifact trust."],
    "irreversibleChanges": [],
}
canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
manifest_digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
component_map = {item["componentId"]: item for item in components}
cell_id = "ins_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b91"
operation_id = "op_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b92"
declaration = {
    "schemaVersion": "alica-cell-declaration/v1",
    "cellId": cell_id,
    "createdAt": "2026-08-27T20:00:00Z",
    "productId": "com.alica.community-dsh",
    "profile": "dsh-minimal/v1",
    "deploymentMode": "single-host",
}
journal_entries = []
previous_entry_digest = "sha256:" + "0" * 64
for sequence, phase, result, mutation_authorized in [
    (1, "planned", "pending", False),
    (2, "preflight", "pending", False),
    (3, "running", "pending", True),
    (4, "verify", "pending", True),
    (5, "accepted", "succeeded", True),
]:
    entry = {
        "operationId": operation_id,
        "sequence": sequence,
        "kind": "install",
        "occurredAt": f"2026-08-27T20:{sequence:02d}:00Z",
        "sourceReleaseId": "none",
        "targetReleaseId": release_id,
        "targetManifestDigest": manifest_digest,
        "phase": phase,
        "result": result,
        "mutationAuthorized": mutation_authorized,
        "evidenceDigests": [digest("fixture:acceptance"), digest("fixture:restore")] if phase == "accepted" else [],
        "previousEntryDigest": previous_entry_digest,
        "entryDigest": "",
    }
    canonical_entry = json.dumps(entry, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    entry["entryDigest"] = "sha256:" + hashlib.sha256(canonical_entry).hexdigest()
    previous_entry_digest = entry["entryDigest"]
    journal_entries.append(entry)
operation_journal = {"schemaVersion": "alica-operation-journal/v1", "entries": journal_entries}
observation = {
    "schemaVersion": "alica-observed-state/v1",
    "source": "test-fixture",
    "host": {"osId": "debian", "osVersion": "13", "architecture": "amd64", "init": "systemd", "vcpu": 8, "memoryBytes": 17179869184, "freeDiskBytes": 214748364800, "dockerVersion": "28.4.0", "composeVersion": "2.39.4", "dockerAvailable": True},
    "state": {"schemaVersion": "alica-lifecycle-state/v1", "cellId": cell_id, "phase": "accepted", "acceptedCurrent": {"releaseId": release_id, "manifestDigest": manifest_digest, "profile": "dsh-minimal/v1", "acceptedAt": "2026-08-27T20:10:00Z"}},
    "declaration": declaration,
    "journal": operation_journal,
    "containers": [{"componentId": row["componentId"], "name": f"alica-{row['service']}-1", "imageDigest": component_map[row["componentId"]]["digest"], "releaseId": release_id, "managed": "true", "state": "running", "health": "healthy", "networks": row["networks"], "volumes": row["volumes"], "publishedPorts": row["publishedPorts"]} for row in containers],
    "networks": networks,
    "volumes": volumes,
    "hostUnits": [
        {"componentId": "operations-jobs", "unit": "alica-backup.service", "loadState": "loaded", "activeState": "active"},
        {"componentId": "operations-jobs", "unit": "alica-canary.timer", "loadState": "loaded", "activeState": "active"},
        {"componentId": "operations-jobs", "unit": "alica-update-check.timer", "loadState": "loaded", "activeState": "active"},
    ],
}
OUT.mkdir(parents=True, exist_ok=True)
outputs = {
    OUT / "d1-contract.manifest.json": json.dumps(manifest, indent=2) + "\n",
    OUT / "observed-conformant.json": json.dumps(observation, indent=2) + "\n",
}
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.check:
    stale = [str(path.relative_to(ROOT)) for path, expected in outputs.items() if not path.exists() or path.read_text() != expected]
    if stale:
        raise SystemExit("stale D1 fixture(s): " + ", ".join(stale))
else:
    for path, content in outputs.items():
        path.write_text(content)
print(manifest_digest)
