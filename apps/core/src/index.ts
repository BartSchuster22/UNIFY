export * from "./contracts/v1/index.js";
export * from "./auth/index.js";
export * from "./database/migrations.js";

export const CORE_MODULES = [
  "identity",
  "frameworks",
  "profiles",
  "models",
  "work",
  "conversations",
  "notifications",
  "operations",
  "audit",
] as const;

export type CoreModule = (typeof CORE_MODULES)[number];

export interface CoreManifest {
  readonly service: "unify-core";
  readonly contractVersion: "v1";
  readonly mode: "standalone";
  readonly modules: readonly CoreModule[];
}

export function createCoreManifest(): CoreManifest {
  return Object.freeze({
    service: "unify-core",
    contractVersion: "v1",
    mode: "standalone",
    modules: Object.freeze([...CORE_MODULES]),
  });
}
