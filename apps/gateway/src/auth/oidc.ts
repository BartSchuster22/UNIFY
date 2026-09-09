import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AuthError, type AuthService, type LoginContext } from './service.js';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  publicOrigin: string;
  transportIssuer?: string;
}
export interface OidcFlow {
  verifier: string;
  nonce: string;
}
export interface OidcIdentity {
  issuer: string;
  subject: string;
  displayName: string;
  roles: string[];
}
export interface OidcStore {
  putFlow(hash: string, sealed: string, expiresAt: Date): Promise<void>;
  consumeFlow(hash: string): Promise<string | null>;
  resolveIdentity(identity: OidcIdentity): Promise<string>;
  bindSession(sessionId: string, subject: string, sealed: string): Promise<void>;
  sessionBinding(sessionId: string): Promise<{ subject: string; sealed: string } | null>;
}
export interface OidcProvider {
  config: OidcConfig;
  exchange(
    code: string,
    flow: OidcFlow,
  ): Promise<{ identity: OidcIdentity; accessToken: string; expiresAt: Date }>;
  checkAccess(accessToken: string, subject: string): Promise<void>;
}
const roles = new Map([
  ['dsh-owner', 'Administrator'],
  ['dsh-operator', 'Operator'],
  ['dsh-viewer', 'Viewer'],
  ['dsh-auditor', 'Auditor/Security'],
]);
export function admittedRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((r: unknown) => (typeof r === 'string' && roles.has(r) ? [roles.get(r)!] : [])),
    ),
  ];
}
export function validateOidcConfig(c: OidcConfig): void {
  const issuer = new URL(c.issuer);
  const origin = new URL(c.publicOrigin);
  if (
    issuer.protocol !== 'https:' ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    c.issuer.endsWith('/')
  )
    throw new Error('OIDC issuer must be a canonical HTTPS URL');
  if (origin.protocol !== 'https:' || origin.origin !== c.publicOrigin)
    throw new Error('OIDC public origin must be an exact HTTPS origin');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(c.clientId) || c.clientSecret.length < 32)
    throw new Error('OIDC confidential client configuration is required');
  if (c.transportIssuer && c.transportIssuer !== c.issuer) {
    const transport = new URL(c.transportIssuer);
    // The only cleartext exception is this fixed, isolated Keycloak service.
    if (
      transport.origin !== 'http://keycloak:8080' ||
      transport.pathname !== issuer.pathname ||
      transport.search ||
      transport.hash ||
      transport.username ||
      transport.password
    )
      throw new Error('OIDC internal transport is not the isolated Keycloak issuer');
  }
}
const invalid = () =>
  new AuthError('OIDC_INVALID', 401, 'OIDC authentication is invalid or expired');
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 65536) throw invalid();
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
  } finally {
    await reader.cancel();
  }
}
export class KeycloakOidcProvider implements OidcProvider {
  private readonly keys: JWTVerifyGetKey;
  private readonly transport: string;
  constructor(
    readonly config: OidcConfig,
    verificationKeys?: JWTVerifyGetKey,
  ) {
    validateOidcConfig(config);
    this.transport = config.transportIssuer ?? config.issuer;
    this.keys =
      verificationKeys ??
      createRemoteJWKSet(new URL(this.transport + '/protocol/openid-connect/certs'), {
        timeoutDuration: 5000,
        cacheMaxAge: 300000,
      });
  }
  async exchange(code: string, flow: OidcFlow) {
    try {
      const result = await boundedJson(
        await fetch(this.transport + '/protocol/openid-connect/token', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            redirect_uri: this.config.publicOrigin + '/api/v1/auth/oidc/callback',
            code_verifier: flow.verifier,
          }),
        }),
      );
      if (typeof result.id_token !== 'string' || typeof result.access_token !== 'string')
        throw invalid();
      const { payload } = await jwtVerify(result.id_token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'iat', 'exp', 'nonce'],
        maxTokenAge: 300,
      });
      if (
        payload.nonce !== flow.nonce ||
        !payload.sub ||
        payload.sub.length > 255 ||
        !payload.exp ||
        (payload.azp !== undefined && payload.azp !== this.config.clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== this.config.clientId)
      )
        throw invalid();
      const access = await jwtVerify(result.access_token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'iat', 'exp'],
        maxTokenAge: 300,
      });
      if (
        access.payload.sub !== payload.sub ||
        access.payload.azp !== this.config.clientId ||
        !access.payload.exp
      )
        throw invalid();
      const resources = access.payload.resource_access as
        Record<string, { roles?: unknown }> | undefined;
      const granted = admittedRoles(resources?.[this.config.clientId]?.roles);
      if (!granted.length)
        throw new AuthError('OIDC_NOT_ADMITTED', 403, 'Identity has no admitted DSH role');
      await this.checkAccess(result.access_token, payload.sub);
      return {
        identity: {
          issuer: this.config.issuer,
          subject: payload.sub,
          displayName:
            typeof payload.preferred_username === 'string'
              ? payload.preferred_username.slice(0, 200)
              : 'DSH user',
          roles: granted,
        },
        accessToken: result.access_token,
        expiresAt: new Date(
          Math.min(payload.exp, access.payload.exp, Math.floor(Date.now() / 1000) + 300) * 1000,
        ),
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw invalid();
    }
  }
  async checkAccess(accessToken: string, subject: string): Promise<void> {
    try {
      const body = await boundedJson(
        await fetch(this.transport + '/protocol/openid-connect/userinfo', {
          headers: { authorization: 'Bearer ' + accessToken },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        }),
      );
      if (body.sub !== subject) throw invalid();
    } catch {
      throw invalid();
    }
  }
}
export class OidcService {
  private readonly key: Buffer;
  constructor(
    readonly provider: OidcProvider,
    private readonly store: OidcStore,
    secret: string,
  ) {
    validateOidcConfig(provider.config);
    if (secret.length < 32) throw new Error('OIDC sealing secret is too short');
    this.key = createHash('sha256')
      .update('dsh-oidc-v1\0' + secret)
      .digest();
  }
  private seal(value: string, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }
  private open(value: string, purpose: string): string {
    try {
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(purpose));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
    } catch {
      throw invalid();
    }
  }
  async begin(): Promise<{ state: string; url: string }> {
    const state = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(state).digest('hex');
    const flow = {
      verifier: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
    };
    await this.store.putFlow(
      hash,
      this.seal(JSON.stringify(flow), 'flow:' + hash),
      new Date(Date.now() + 300000),
    );
    const url = new URL(this.provider.config.issuer + '/protocol/openid-connect/auth');
    url.search = new URLSearchParams({
      client_id: this.provider.config.clientId,
      response_type: 'code',
      scope: 'openid profile',
      redirect_uri: this.provider.config.publicOrigin + '/api/v1/auth/oidc/callback',
      state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { state, url: url.toString() };
  }
  async callback(
    state: unknown,
    cookie: unknown,
    code: unknown,
    auth: AuthService,
    context: LoginContext,
  ) {
    if (
      typeof state !== 'string' ||
      typeof cookie !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(cookie) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(cookie)) ||
      typeof code !== 'string' ||
      !code ||
      code.length > 4096
    )
      throw invalid();
    const hash = createHash('sha256').update(state).digest('hex');
    const sealed = await this.store.consumeFlow(hash);
    if (!sealed) throw invalid();
    const result = await this.provider.exchange(
      code,
      JSON.parse(this.open(sealed, 'flow:' + hash)) as OidcFlow,
    );
    if (result.expiresAt.getTime() <= Date.now()) throw invalid();
    const userId = await this.store.resolveIdentity(result.identity);
    const session = await auth.issuePrincipalSession(userId, context, result.expiresAt);
    try {
      await this.store.bindSession(
        session.sessionId,
        result.identity.subject,
        this.seal(result.accessToken, 'session:' + session.sessionId),
      );
    } catch {
      await auth.revokeSession(session.sessionId, 'oidc_binding_failed');
      throw invalid();
    }
    return session;
  }
  async validateSession(sessionId: string): Promise<void> {
    const binding = await this.store.sessionBinding(sessionId);
    if (!binding) throw invalid();
    await this.provider.checkAccess(
      this.open(binding.sealed, 'session:' + sessionId),
      binding.subject,
    );
  }
}
