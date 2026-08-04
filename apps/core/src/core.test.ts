import assert from "node:assert/strict";
import test from "node:test";
import { CORE_MODULES, createCoreManifest } from "./index.js";

test("declares a standalone core manifest", () => {
  const manifest = createCoreManifest();

  assert.equal(manifest.service, "unify-core");
  assert.equal(manifest.contractVersion, "v1");
  assert.equal(manifest.mode, "standalone");
  assert.deepEqual(manifest.modules, CORE_MODULES);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.modules));
});

test("declares each native control-plane boundary exactly once", () => {
  assert.deepEqual(CORE_MODULES, [
    "identity",
    "frameworks",
    "profiles",
    "models",
    "work",
    "conversations",
    "notifications",
    "operations",
    "audit",
  ]);
  assert.equal(new Set(CORE_MODULES).size, CORE_MODULES.length);
});
