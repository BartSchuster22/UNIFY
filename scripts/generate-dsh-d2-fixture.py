#!/usr/bin/env python3
"""Generate deterministic, signed, test-only D2 install fixtures.

The fixture's first-party OCI references name the intended public candidate
locations but are not release artifacts. Production installation is forbidden;
this key exists only for focused contract and failure-injection verification.
"""

import argparse
import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dsh/alicactl/testdata"
SOURCE = OUT / "d1-contract.manifest.json"

IMAGES = {
    "caddy": ("ghcr.io/bartschuster22/alica-community-dsh/caddy", "108a242cdaa59e995eaff1dbeb2e5435a1203985f345115d35127f2a63c771ab"),
    "uniui": ("ghcr.io/bartschuster22/alica-community-dsh/uniui", "5e9ef7d61f91e9c22eb2640028f32247174c25a0e987185e5bbad17fede0de58"),
    "unify-core": ("ghcr.io/bartschuster22/alica-community-dsh/unify-core", "114a16a81ef07ca0a34e7d94e92d1d253ef1c6440950a906e9f326a095862c5e"),
    "keycloak": ("ghcr.io/bartschuster22/alica-community-dsh/keycloak", "840aa7366bda8b9b194646580ee11f0f6fec0f01d1c2500be5298059e1893f25"),
    "postgresql": ("docker.io/library/postgres", "1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef"),
    "alica-runtime": ("ghcr.io/bartschuster22/alica-community-dsh/hermes-runtime", "c8a170cf00d9bd598e45fd317d244d0cb949920c5eb5ee68346918c261755a6c"),
    "herman-runtime": ("ghcr.io/bartschuster22/alica-community-dsh/hermes-runtime", "c8a170cf00d9bd598e45fd317d244d0cb949920c5eb5ee68346918c261755a6c"),
    "memory-v4": ("ghcr.io/bartschuster22/alica-community-dsh/memory-v4", "f3d6eb63447520298890c9f224dea7f86777f085f8ec1c51b79fb322eed512f8"),
}

manifest = json.loads(SOURCE.read_text())
manifest.update(
    releaseId="rel_0198f8e0-6200-7a11-8c21-4f5d6e7a8b90",
    releaseVersion="1.0.0-d2.fixture.1",
    createdAt="2026-08-27T22:00:00Z",
    releaseClass="development",
    installable=True,
)
manifest["sources"][0]["commit"] = "70584d03f7a24ef1bfa303d5c8c82c03ceedbde7"
manifest["sources"][0]["treeDigest"] = "sha256:" + hashlib.sha256(b"d2-fixture-unify-tree").hexdigest()
for component in manifest["components"]:
    if component["componentId"] in IMAGES:
        repository, digest = IMAGES[component["componentId"]]
        component["digest"] = "sha256:" + digest
        component["artifact"] = f"oci://{repository}@sha256:{digest}"
manifest["migrationPlan"]["planId"] = "migration-plan/d2-unified-clean-install-fixture"
manifest["knownRisks"] = [
    "D2 fixture trust material is test-only and is forbidden for production installation.",
    "First-party candidate packages must be published without private Aquiero credentials before clean-host acceptance.",
]
canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
seed = hashlib.sha256(b"ALICA D2 FIXTURE KEY - TEST ONLY - 2026").digest()
private_key = Ed25519PrivateKey.from_private_bytes(seed)
public_key = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
key_id = "d2-fixture-ed25519-2026"
signature = private_key.sign(canonical)
envelope = {
    "schemaVersion": "alica-manifest-signature/v1",
    "algorithm": "ed25519",
    "keyId": key_id,
    "manifestDigest": digest,
    "signature": base64.b64encode(signature).decode(),
}
trust_key = {
    "schemaVersion": "alica-trust-key/v1",
    "algorithm": "ed25519",
    "keyId": key_id,
    "publicKey": base64.b64encode(public_key).decode(),
}
request = {
    "schemaVersion": "alica-clean-install/v1",
    "cellId": "ins_0198f8e0-6200-7a11-8c21-4f5d6e7a8b91",
    "installationRoot": "/tmp/alica-d2-fixture-cell",
    "publicHost": "localhost",
    "publicOrigin": "https://localhost",
    "project": "alica-d2-fixture",
    "adminUsername": "admin",
    "eulaDigest": manifest["product"]["eulaDigest"],
    "eulaAccepted": True,
}
outputs = {
    OUT / "d2-contract.manifest.json": json.dumps(manifest, indent=2) + "\n",
    OUT / "d2-contract.manifest.signature.json": json.dumps(envelope, indent=2) + "\n",
    OUT / "d2-test-public-key.json": json.dumps(trust_key, indent=2) + "\n",
    OUT / "d2-clean-install.request.json": json.dumps(request, indent=2) + "\n",
}
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.check:
    stale = [str(path.relative_to(ROOT)) for path, expected in outputs.items() if not path.exists() or path.read_text() != expected]
    if stale:
        raise SystemExit("stale D2 fixture(s): " + ", ".join(stale))
else:
    OUT.mkdir(parents=True, exist_ok=True)
    for path, content in outputs.items():
        path.write_text(content)
print(digest)
