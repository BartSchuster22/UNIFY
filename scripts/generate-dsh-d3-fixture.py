#!/usr/bin/env python3
"""Generate deterministic, signed, test-only D3 minimum-Cell fixtures."""
import argparse, base64, hashlib, json
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dsh/alicactl/testdata"
SOURCE = OUT / "d2-contract.manifest.json"
CORE_REPOSITORY = "ghcr.io/bartschuster22/alica-community-dsh/unify-core"
CORE_DIGEST = "114a16a81ef07ca0a34e7d94e92d1d253ef1c6440950a906e9f326a095862c5e"
UNIFY_COMMIT = "d769c5e5e15df423ce0786753ede94d7f9a6450d"

manifest = json.loads(SOURCE.read_text())
manifest.update(
    releaseId="rel_0199a000-1000-7a11-8c21-4f5d6e7a8b93",
    releaseVersion="1.0.0-d3.fixture.1",
    createdAt="2026-09-01T11:40:00Z",
    releaseClass="development",
    installable=True,
)
manifest["sources"][0]["commit"] = UNIFY_COMMIT
manifest["sources"][0]["treeDigest"] = "sha256:" + hashlib.sha256(b"d3-minimum-cell-unify-tree-d769c5e5").hexdigest()
for component in manifest["components"]:
    if component["componentId"] in {"ainba-anchor", "doghouse-node"}:
        component["digest"] = "sha256:" + CORE_DIGEST
        component["artifact"] = f"oci://{CORE_REPOSITORY}@sha256:{CORE_DIGEST}"
for container in manifest["topology"]["containers"]:
    if container["componentId"] == "ainba-anchor" and "app" not in container["networks"]:
        container["networks"].append("app")
manifest["migrationPlan"]["planId"] = "migration-plan/d3-minimum-complete-cell-fixture"
manifest["knownRisks"] = [
    "D3 fixture trust material is test-only and is forbidden for production installation.",
    "The anchor AInbA and Doghouse node use the immutable UNIFY Core execution image with signed alicactl-embedded workloads.",
]
canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
seed = hashlib.sha256(b"ALICA D3 FIXTURE KEY - TEST ONLY - 2026").digest()
private_key = Ed25519PrivateKey.from_private_bytes(seed)
public_key = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
key_id = "d3-fixture-ed25519-2026"
signature = private_key.sign(canonical)
envelope = {"schemaVersion":"alica-manifest-signature/v1","algorithm":"ed25519","keyId":key_id,"manifestDigest":digest,"signature":base64.b64encode(signature).decode()}
trust_key = {"schemaVersion":"alica-trust-key/v1","algorithm":"ed25519","keyId":key_id,"publicKey":base64.b64encode(public_key).decode()}
request = {
    "schemaVersion":"alica-clean-install/v1",
    "cellId":"ins_0199a000-1000-7a11-8c21-4f5d6e7a8b94",
    "installationRoot":"/tmp/alica-d3-fixture-cell",
    "publicHost":"localhost","publicOrigin":"https://localhost","project":"alica-d3-fixture","adminUsername":"admin",
    "eulaDigest":manifest["product"]["eulaDigest"],"eulaAccepted":True,
    "provider":{"mode":"byok","providerId":"openai-compatible","baseUrl":"https://provider.invalid/v1","credentialFile":"/tmp/alica-d3-provider-api-key"},
}
outputs = {
    OUT/"d3-contract.manifest.json": json.dumps(manifest, indent=2)+"\n",
    OUT/"d3-contract.manifest.signature.json": json.dumps(envelope, indent=2)+"\n",
    OUT/"d3-test-public-key.json": json.dumps(trust_key, indent=2)+"\n",
    OUT/"d3-clean-install.request.json": json.dumps(request, indent=2)+"\n",
}
parser=argparse.ArgumentParser(); parser.add_argument("--check",action="store_true"); args=parser.parse_args()
if args.check:
    stale=[str(p.relative_to(ROOT)) for p,v in outputs.items() if not p.exists() or p.read_text()!=v]
    if stale: raise SystemExit("stale D3 fixture(s): "+", ".join(stale))
else:
    for p,v in outputs.items(): p.write_text(v)
print(digest)
