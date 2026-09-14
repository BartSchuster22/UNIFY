import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import {
  admittedRoles,
  KeycloakOidcProvider,
  OidcService,
  validateOidcConfig,
  type OidcStore,
  type OidcProvider,
} from './oidc.js';
import { AuthError, AuthService } from './service.js';
import type { AuthStore, NewSession } from './types.js';
import { buildApp } from '../app.js';
const config = {
  issuer: 'https://dsh.example/identity/realms/dsh',
  publicOrigin: 'https://dsh.example',
  clientId: 'dsh-core',
  clientSecret: 's'.repeat(40),
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'one', alg: 'RS256' }],
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function jwt(overrides: Record<string, unknown> = {}, key = keys.privateKey) {
  return new SignJWT({
    iss: config.issuer,
    sub: 'subject-one',
    aud: config.clientId,
    azp: config.clientId,
    nonce: 'nonce',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 240,
    resource_access: { [config.clientId]: { roles: ['dsh-owner'] } },
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'one' })
    .sign(key);
}
function exchangeFetch(id: string, access: string, userSubject = 'subject-one') {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/token') ? { id_token: id, access_token: access, refresh_token: 'fixture-refresh', refresh_expires_in: 1800 } : { sub: userSubject },
          ),
          { status: 200 },
        ),
    ),
  );
}
describe('OIDC verified identity boundary', () => {
  it.each([
    { issuer: 'http://identity.example/realm' },
    { publicOrigin: 'https://dsh.example/path' },
    { clientSecret: 'short' },
    { transportIssuer: 'http://169.254.169.254/identity/realms/dsh' },
    { transportIssuer: 'http://keycloak:8080/wrong-realm' },
    { issuer: 'https://user:password@dsh.example/realm' },
  ])('rejects unsafe configuration %j', (bad) =>
    expect(() => validateOidcConfig({ ...config, ...bad })).toThrow(),
  );
  it('admits only explicit client roles, not arbitrary claims', () => {
    expect(
      admittedRoles(['admin', 'Administrator', 'dsh-owner', 'dsh-owner', 'dsh-viewer']),
    ).toEqual(['Administrator', 'Viewer']);
    expect(admittedRoles('dsh-owner')).toEqual([]);
  });
  it('verifies real RSA signatures and bounds the local session', async () => {
    exchangeFetch(await jwt(), await jwt());
    const p = new KeycloakOidcProvider(config, jwks);
    const result = await p.exchange('code', { verifier: 'v', nonce: 'nonce' });
    expect(result.identity).toMatchObject({
      issuer: config.issuer,
      subject: 'subject-one',
      roles: ['Administrator'],
    });
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300000);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect((init?.body as URLSearchParams).get('code_verifier')).toBe('v');
    expect((init?.body as URLSearchParams).get('redirect_uri')).toBe(
      'https://dsh.example/api/v1/auth/oidc/callback',
    );
  });
  it.each([
    { iss: 'https://evil.example' },
    { aud: 'another-client' },
    { azp: 'another-client' },
    { nonce: 'wrong' },
    { exp: 1 },
    { iat: 1 },
    { sub: '' },
    { nbf: 9999999999 },
  ])('rejects invalid ID claims %j', async (bad) => {
    exchangeFetch(await jwt(bad), await jwt());
    await expect(
      new KeycloakOidcProvider(config, jwks).exchange('code', { verifier: 'v', nonce: 'nonce' }),
    ).rejects.toBeInstanceOf(AuthError);
  });
  it.each([
    { aud: 'other' },
    { sub: 'different' },
    { azp: 'other' },
    { exp: 1 },
    { resource_access: {} },
  ])('rejects invalid access claims %j', async (bad) => {
    exchangeFetch(await jwt(), await jwt(bad));
    await expect(
      new KeycloakOidcProvider(config, jwks).exchange('code', { verifier: 'v', nonce: 'nonce' }),
    ).rejects.toBeInstanceOf(AuthError);
  });
  it('rejects a substituted signing key', async () => {
    const other = await generateKeyPair('RS256');
    exchangeFetch(await jwt({}, other.privateKey), await jwt());
    await expect(
      new KeycloakOidcProvider(config, jwks).exchange('code', { verifier: 'v', nonce: 'nonce' }),
    ).rejects.toBeInstanceOf(AuthError);
  });
  it('fails closed on provider outage and userinfo subject mismatch', async () => {
    exchangeFetch(await jwt(), await jwt(), 'wrong');
    const p = new KeycloakOidcProvider(config, jwks);
    await expect(p.exchange('code', { verifier: 'v', nonce: 'nonce' })).rejects.toBeInstanceOf(
      AuthError,
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-provider-error')));
    await expect(p.checkAccess('private-access-token', 'subject-one')).rejects.toMatchObject({
      code: 'OIDC_INVALID',
    });
  });
});
function fixture() {
  const flows = new Map<string, { sealed: string; expiresAt: Date }>();
  const bindings = new Map<string, { subject: string; sealed: string }>();
  const sessions = new Map<string, NewSession>();
  const revoked = new Set<string>();
  const principal = {
    userId: 'user-one',
    username: 'oidc-user',
    displayName: 'Owner',
    roles: ['Administrator'],
    permissions: ['users.manage', 'frameworks.read'],
  };
  let pending = Promise.resolve();
  const store: OidcStore = {
    async putFlow(h, sealed, expiresAt) {
      flows.set(h, { sealed, expiresAt });
    },
    async consumeFlow(h) {
      const v = flows.get(h);
      flows.delete(h);
      return v && v.expiresAt.getTime() > Date.now() ? v.sealed : null;
    },
    async resolveIdentity() {
      return principal.userId;
    },
    async bindSession(id, subject, sealed) {
      bindings.set(id, { subject, sealed });
    },
    async updateBinding(id, work) {
      const previous = pending;
      let release!: () => void;
      pending = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const binding = bindings.get(id);
        if (!binding || revoked.has(id)) throw new AuthError('OIDC_INVALID', 401, 'Invalid session');
        bindings.set(id, { ...binding, sealed: await work(binding) });
      } finally { release(); }
    },
    async sessionBinding(id) {
      return bindings.get(id) ?? null;
    },
  };
  const provider: OidcProvider = {
    config,
    exchange: vi.fn(async () => ({
      identity: {
        issuer: config.issuer,
        subject: 'subject-one',
        displayName: 'Owner',
        roles: ['Administrator'],
      },
      accessToken: 'private-access-token',
      refreshToken: 'private-refresh-token',
      refreshExpiresAt: new Date(Date.now() + 1800000),
      roles: ['Administrator'],
      expiresAt: new Date(Date.now() + 240000),
    })),
    refresh: vi.fn(async () => ({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh',
      expiresAt: new Date(Date.now() + 240000), refreshExpiresAt: new Date(Date.now() + 1800000), roles: ['Administrator'] })),
    checkAccess: vi.fn(async () => {}),
  };
  const authStore = {
    ready: async () => true,
    getPrincipal: async () => principal,
    createSession: async (s: NewSession) => {
      const id = 'session-' + sessions.size;
      sessions.set(id, s);
      return id;
    },
    findActiveSession: async (h: string) => {
      const hit = [...sessions].find(
        ([id, s]) => s.tokenHash === h && !revoked.has(id) && s.expiresAt.getTime() > Date.now(),
      );
      return hit
        ? {
            ...principal,
            sessionId: hit[0],
            csrfHash: hit[1].csrfHash,
            expiresAt: hit[1].expiresAt,
          }
        : null;
    },
    touchSession: async () => {},
    revokeSession: async (id: string) => {
      revoked.add(id);
      return true;
    },
    listSessions: async () => [],
    findUserByUsername: vi.fn(async () => null),
  } as unknown as AuthStore;
  return {
    flows,
    bindings,
    store,
    provider,
    authStore,
    oidc: new OidcService(provider, store, 'p'.repeat(40)),
    auth: new AuthService({ store: authStore, pepper: 'p'.repeat(40) }),
  };
}
describe('OIDC refresh lifecycle', () => {
  async function login(f: ReturnType<typeof fixture>) {
    const b = await f.oidc.begin();
    return f.oidc.callback(b.state, b.state, 'code', f.auth, { ip: 'local', userAgent: undefined });
  }
  it('keeps session lifetime separate from access-token expiry and seals refresh credentials', async () => {
    const f = fixture(); const s = await login(f);
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() + 300000);
    expect(JSON.stringify([...f.bindings])).not.toContain('private-refresh-token');
    expect(JSON.stringify(s)).not.toContain('private-refresh-token');
  });
  it('refreshes once across concurrent callers, survives recreation, and retains the cookie', async () => {
    vi.useFakeTimers(); const f = fixture(); const s = await login(f);
    vi.advanceTimersByTime(310000);
    const recovered = new OidcService(f.provider, f.store, 'p'.repeat(40));
    await Promise.all([recovered.validateSession(s.sessionId), recovered.validateSession(s.sessionId)]);
    expect(f.provider.refresh).toHaveBeenCalledTimes(1);
    expect(f.provider.refresh).toHaveBeenCalledWith('private-refresh-token', 'subject-one');
    await expect(f.auth.authenticate(s.sessionToken)).resolves.toMatchObject({ sessionId: s.sessionId });
    expect(f.provider.checkAccess).toHaveBeenLastCalledWith('rotated-access', 'subject-one');
  });
  it('fails closed when refresh is rejected, expires, or changes roles', async () => {
    vi.useFakeTimers(); const f = fixture(); const s = await login(f);
    vi.advanceTimersByTime(310000);
    vi.mocked(f.provider.refresh).mockRejectedValueOnce(new AuthError('OIDC_INVALID', 401, 'invalid'));
    await expect(f.oidc.validateSession(s.sessionId)).rejects.toBeInstanceOf(AuthError);
    vi.mocked(f.provider.refresh).mockResolvedValueOnce({ accessToken: 'other', refreshToken: 'other', expiresAt: new Date(Date.now()+240000), refreshExpiresAt: new Date(Date.now()+1800000), roles: ['Viewer'] });
    await expect(f.oidc.validateSession(s.sessionId)).rejects.toBeInstanceOf(AuthError);
    vi.advanceTimersByTime(1800000);
    await expect(f.oidc.validateSession(s.sessionId)).rejects.toBeInstanceOf(AuthError);
    expect(f.provider.refresh).toHaveBeenCalledTimes(2);
  });
  it('does not refresh a revoked local session', async () => {
    vi.useFakeTimers(); const f = fixture(); const s = await login(f);
    await f.auth.revokeSession(s.sessionId, 'test'); vi.advanceTimersByTime(310000);
    await expect(f.oidc.validateSession(s.sessionId)).rejects.toBeInstanceOf(AuthError);
    expect(f.provider.refresh).not.toHaveBeenCalled();
  });
  it('checks signed refresh access claims and rotates refresh credentials', async () => {
    exchangeFetch(await jwt(), await jwt());
    const result = await new KeycloakOidcProvider(config, jwks).refresh('previous-refresh', 'subject-one');
    expect(result.refreshToken).toBe('fixture-refresh');
    expect((vi.mocked(fetch).mock.calls[0]?.[1]?.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
  });
  it.each([{ sub: 'other' }, { aud: 'other' }, { azp: 'other' }, { iss: 'https://evil.example' }, { exp: 1 }, { resource_access: {} }])('rejects invalid refreshed claims %j', async (bad) => {
    exchangeFetch(await jwt(), await jwt(bad));
    await expect(new KeycloakOidcProvider(config, jwks).refresh('refresh', 'subject-one')).rejects.toBeInstanceOf(AuthError);
  });
});
describe('OIDC flow, session and browser integration', () => {
  it('seals PKCE material, uses S256, binds cookies and consumes each state once', async () => {
    const f = fixture();
    const b = await f.oidc.begin();
    const url = new URL(b.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const stored = JSON.stringify([...f.flows.values()]);
    expect(stored).not.toContain(url.searchParams.get('nonce'));
    await expect(
      f.oidc.callback(b.state, 'a'.repeat(43), 'code', f.auth, {
        ip: 'local',
        userAgent: undefined,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    const result = await f.oidc.callback(b.state, b.state, 'code', f.auth, {
      ip: 'local',
      userAgent: undefined,
    });
    expect(JSON.stringify([...f.bindings])).not.toContain('private-access-token');
    await f.oidc.validateSession(result.sessionId);
    expect(f.provider.checkAccess).toHaveBeenCalledWith('private-access-token', 'subject-one');
    await expect(
      f.oidc.callback(b.state, b.state, 'code', f.auth, { ip: 'local', userAgent: undefined }),
    ).rejects.toBeInstanceOf(AuthError);
  });
  it('survives service recreation without accepting expired flows or transplanted token rows', async () => {
    const f = fixture();
    const b = await f.oidc.begin();
    const recovered = new OidcService(f.provider, f.store, 'p'.repeat(40));
    const result = await recovered.callback(b.state, b.state, 'code', f.auth, {
      ip: 'local',
      userAgent: undefined,
    });
    f.bindings.set('other-session', f.bindings.get(result.sessionId)!);
    await expect(recovered.validateSession('other-session')).rejects.toBeInstanceOf(AuthError);
    const expired = await recovered.begin();
    f.flows.get(createHash('sha256').update(expired.state).digest('hex'))!.expiresAt = new Date(1);
    await expect(
      recovered.callback(expired.state, expired.state, 'code', f.auth, {
        ip: 'local',
        userAgent: undefined,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
  it('disables password login and exposes only a same-origin browser login entry', async () => {
    const f = fixture();
    const app = buildApp({ authStore: f.authStore, authPepper: 'p'.repeat(40), oidc: f.oidc });
    try {
      expect((await app.inject('/api/v1/auth/method')).json()).toEqual({
        method: 'oidc',
        loginPath: '/api/v1/auth/oidc/login',
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { username: 'admin', password: 'arbitrary-long-password' },
          })
        ).statusCode,
      ).toBe(403);
      expect(f.authStore.findUserByUsername).not.toHaveBeenCalled();
      const b = await app.inject('/api/v1/auth/oidc/login');
      expect(b.statusCode).toBe(302);
      expect(String(b.headers['set-cookie'])).toContain('HttpOnly');
      expect(String(b.headers['set-cookie'])).toContain('Secure');
      const state = new URL(String(b.headers.location)).searchParams.get('state')!;
      const callback = await app.inject({
        url: '/api/v1/auth/oidc/callback?state=' + state + '&code=code',
        headers: { cookie: '__Host-dsh_oidc=' + state },
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe('/');
      expect(callback.body).not.toContain('private-access-token');
      const cookies = (callback.headers['set-cookie'] as string[])
        .filter((c) => !c.startsWith('__Host-'))
        .map((c) => c.split(';')[0])
        .join('; ');
      expect(
        (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: cookies } })).statusCode,
      ).toBe(200);
      vi.mocked(f.provider.checkAccess).mockRejectedValue(
        new AuthError('OIDC_INVALID', 401, 'expired'),
      );
      expect(
        (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: cookies } })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('rejects insecure cookie mode', () => {
    const f = fixture();
    expect(() =>
      buildApp({
        authStore: f.authStore,
        authPepper: 'p'.repeat(40),
        oidc: f.oidc,
        secureCookies: false,
      }),
    ).toThrow();
  });
});
