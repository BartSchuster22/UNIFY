import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoreV1OpenApi } from "../dist/contracts/v1/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../contracts/v1/openapi.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(buildCoreV1OpenApi(), null, 2)}\n`, "utf8");
console.log(target);
