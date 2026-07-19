export { buildApp, type AppOptions } from './app.js';
export { AuthService, AuthError } from './auth/service.js';
export { hashPassword, verifyPassword } from './auth/crypto.js';
export { PostgresAuthStore } from './auth/postgres-store.js';
export type * from './auth/types.js';
