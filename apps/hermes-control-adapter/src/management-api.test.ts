import { describe, expect, it, vi } from 'vitest';
import { HermesManagementApi, validateManagementBaseUrl } from './management-api.js';

describe('HermesManagementApi', () => {
  it('allows only loopback HTTP management endpoints', () => {
    expect(validateManagementBaseUrl('http://127.0.0.1:29119/')).toBe('http://127.0.0.1:29119');
    expect(validateManagementBaseUrl('http://localhost:29119')).toBe('http://localhost:29119');
    for (const endpoint of [
      'https://127.0.0.1:29119',
      'http://hermes.example:29119',
      'http://user:secret@127.0.0.1:29119',
      'http://127.0.0.1:29119/api',
    ])
      expect(() => validateManagementBaseUrl(endpoint)).toThrow();
  });

  it('authenticates with the private dashboard token and maps its live inventory', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        provider: 'openrouter',
        model: 'openai/gpt-5',
        providers: [
          {
            slug: 'openrouter',
            name: 'OpenRouter',
            auth_type: 'api_key',
            authenticated: true,
            key_env: 'OPENROUTER_API_KEY',
            models: ['openai/gpt-5'],
          },
        ],
      }),
    );
    const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl, 'private-token');
    const inventory = await api.inventory(true);
    expect(inventory.providers).toHaveLength(1);
    expect(inventory.provider).toBe('openrouter');
    expect(inventory.model).toBe('openai/gpt-5');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:29119/api/model/options?include_unconfigured=true&refresh=true',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-hermes-session-token': 'private-token' }),
      }),
    );
  });

  it('maps the complete OAuth lifecycle to pinned Hermes routes without exposing tokens', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ url, method });
      if (url.endsWith('/start'))
        return Response.json({
          session_id: 'session-1',
          user_code: 'ABCD-EFGH',
          verification_url: 'https://provider.example/device',
          expires_in: 900,
        });
      if (url.includes('/poll/'))
        return Response.json({ status: 'expired', error_message: 'expired' });
      if (method === 'DELETE') return Response.json({ ok: true });
      return Response.json({
        providers: [{ id: 'nous', status: { authenticated: true, expires_at: 12345 } }],
      });
    };
    const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl, 'private-token');
    expect(await api.oauthStart('nous')).toMatchObject({
      providerId: 'nous',
      status: 'pending',
      session_id: 'session-1',
      user_code: 'ABCD-EFGH',
    });
    expect(await api.oauthStatus('nous', 'session-1')).toMatchObject({ status: 'expired' });
    expect(await api.oauthStatus('nous')).toMatchObject({ authenticated: true, expires_at: 12345 });
    expect(await api.oauthDisconnect('nous')).toMatchObject({
      providerId: 'nous',
      disconnected: true,
    });
    expect(requests).toEqual([
      { url: 'http://127.0.0.1:29119/api/providers/oauth/nous/start', method: 'POST' },
      { url: 'http://127.0.0.1:29119/api/providers/oauth/nous/poll/session-1', method: 'GET' },
      { url: 'http://127.0.0.1:29119/api/providers/oauth', method: 'GET' },
      { url: 'http://127.0.0.1:29119/api/providers/oauth/nous', method: 'DELETE' },
    ]);
  });

  it('fails closed and never persists rejected or unreachable credentials', async () => {
    for (const validation of [
      { ok: false, reachable: true, expectedStatus: 422 },
      { ok: true, reachable: false, expectedStatus: 503 },
    ]) {
      const writes: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        if (String(input).endsWith('/api/providers/validate'))
          return Response.json({ ok: validation.ok, reachable: validation.reachable });
        if (init?.method === 'PUT') writes.push(String(input));
        return Response.json({
          FIREWORKS_API_KEY: { provider: 'fireworks', is_set: false, is_password: true },
        });
      };
      const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl);
      await expect(api.setCredential('fireworks', 'candidate-secret')).rejects.toMatchObject({
        statusCode: validation.expectedStatus,
      });
      expect(writes).toEqual([]);
    }
  });

  it('writes an exact advanced credential choice and endpoint only after validation', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const env = {
      ANTHROPIC_API_KEY: { provider: 'anthropic', is_password: true, is_set: false },
      ANTHROPIC_TOKEN: { provider: 'anthropic', is_password: true, is_set: false },
      CLAUDE_CODE_OAUTH_TOKEN: { provider: 'anthropic', is_password: true, is_set: false },
      ANTHROPIC_BASE_URL: { provider: 'anthropic', is_password: false, is_set: false },
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), ...(init ? { init } : {}) });
      if (String(input).endsWith('/api/providers/validate'))
        return Response.json({ ok: true, reachable: true });
      if (init?.method === 'PUT') return Response.json({ changed: true });
      return Response.json(env);
    };
    const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl);
    const result = await api.setProviderSetup('anthropic', {
      credentialType: 'token',
      credential: 'candidate-secret',
      baseUrl: 'https://proxy.example/v1',
    });
    expect(result).toMatchObject({
      providerId: 'anthropic',
      credentialType: 'token',
      configuredFields: ['baseUrl'],
    });
    const bodies = requests
      .filter((request) => request.init?.body)
      .map((request) => JSON.parse(String(request.init?.body)));
    expect(bodies).toContainEqual({
      key: 'ANTHROPIC_TOKEN',
      value: 'candidate-secret',
      base_url: 'https://proxy.example/v1',
    });
    expect(bodies).toContainEqual({
      entries: [
        { key: 'ANTHROPIC_BASE_URL', value: 'https://proxy.example/v1' },
        { key: 'ANTHROPIC_TOKEN', value: 'candidate-secret' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('candidate-secret');
  });

  it('rejects unadvertised choices and unsafe endpoints before persistence', async () => {
    const writes: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      if (init?.method === 'PUT') writes.push(String(input));
      if (String(input).endsWith('/api/providers/validate'))
        return Response.json({ ok: true, reachable: true });
      return Response.json({
        GOOGLE_API_KEY: { provider: 'gemini', is_password: true },
        GEMINI_API_KEY: { provider: 'gemini', is_password: true },
        GEMINI_BASE_URL: { provider: 'gemini', is_password: false },
      });
    };
    const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl);
    await expect(
      api.setProviderSetup('gemini', { credentialType: 'unknown', credential: 'secret' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      api.setProviderSetup('gemini', {
        credentialType: 'google',
        credential: 'secret',
        baseUrl: 'http://user:pass@example.test',
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(writes).toEqual([]);
  });

  it('persists Vertex routing atomically without accepting cloud credential contents', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), ...(init ? { init } : {}) });
      if (String(input).endsWith('/api/config'))
        return Response.json({ vertex: { region: 'global' } });
      if (String(input).endsWith('/api/provider-setup/batch'))
        return Response.json({ ok: true, changed: true, configured: false });
      if (String(input).endsWith('/api/env'))
        return Response.json({
          VERTEX_CREDENTIALS_PATH: { provider: 'vertex', is_password: false, is_set: false },
        });
      return Response.json({}, { status: 404 });
    };
    const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl);
    const result = await api.setProviderSetup('vertex', {
      credentialType: 'service_account',
      credentials: '/run/secrets/vertex-service-account.json',
      project: 'project-1',
      region: 'europe-west1',
    });
    expect(result).toMatchObject({
      providerId: 'vertex',
      configured: false,
      changed: true,
      credentialType: 'service_account',
      validation: { verified: false, reachable: false },
    });
    const batch = requests.find((request) => request.url.endsWith('/api/provider-setup/batch'));
    expect(JSON.parse(String(batch?.init?.body))).toEqual({
      env: [{ key: 'VERTEX_CREDENTIALS_PATH', value: '/run/secrets/vertex-service-account.json' }],
      config: { vertex: { region: 'europe-west1', project_id: 'project-1' } },
    });
    await expect(
      api.setProviderSetup('vertex', {
        credentialType: 'service_account',
        credentials: '../secret.json',
        region: 'global',
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('uses existing model and environment APIs without returning or logging credential values', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), ...(init ? { init } : {}) });
      if (String(input).endsWith('/api/model/set')) return Response.json({ ok: true });
      if (String(input).endsWith('/api/providers/validate'))
        return Response.json({ ok: true, reachable: true });
      if (init?.method === 'GET')
        return Response.json({
          OPENROUTER_API_KEY: {
            provider: 'openrouter',
            is_set: false,
            redacted_value: null,
          },
        });
      if (init?.method === 'PUT') return Response.json({ ok: true, key: 'OPENROUTER_API_KEY' });
      return Response.json({ ok: true, key: 'OPENROUTER_API_KEY', removed: true });
    };
    const api = new HermesManagementApi('http://127.0.0.1:29119', fetchImpl, 'private-token');
    await expect(api.selectModel('openrouter', 'openai/gpt-5', true)).resolves.toMatchObject({
      ok: true,
    });
    const setResult = await api.setCredential('openrouter', 'secret-value');
    const removeResult = await api.removeCredential('openrouter');
    expect(setResult).toMatchObject({
      changed: true,
      configured: true,
      providerId: 'openrouter',
      validation: { accepted: true },
    });
    expect(removeResult).toMatchObject({
      changed: true,
      configured: false,
      providerId: 'openrouter',
    });

    expect(JSON.stringify(requests)).toContain('secret-value');
    expect(JSON.stringify({ setResult, removeResult })).not.toContain('secret-value');
    expect(
      JSON.parse(
        String(requests.find((request) => request.url.endsWith('/api/model/set'))?.init?.body),
      ),
    ).toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-5',
      scope: 'main',
      confirm_expensive_model: true,
    });
  });
});
