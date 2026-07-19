export { buildApp, type AppOptions } from './app.js';
export { AuthService, AuthError } from './auth/service.js';
export { hashPassword, verifyPassword } from './auth/crypto.js';
export { PostgresAuthStore } from './auth/postgres-store.js';
export { GovernanceService, GovernanceError } from './governance/service.js';
export { PostgresGovernanceStore } from './governance/postgres-store.js';
export { canonicalHash, canonicalJson, redactEvidence } from './governance/canonical.js';
export type * from './governance/types.js';
export type * from './auth/types.js';
