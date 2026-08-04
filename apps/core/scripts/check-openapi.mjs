import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoreV1OpenApi } from "../dist/contracts/v1/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../contracts/v1/openapi.json");
const expected = `${JSON.stringify(buildCoreV1OpenApi(), null, 2)}\n`;
const actual = await readFile(target, "utf8");
if (actual !== expected) {
  console.error("Generated OpenAPI is stale. Run pnpm --filter @unify/core generate:contracts.");
  process.exitCode = 1;
} else {
  console.log("Core v1 OpenAPI is current.");
}
