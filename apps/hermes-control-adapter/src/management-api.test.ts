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

  it('uses existing model and environment APIs without returning or logging credential values', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), ...(init ? { init } : {}) });
      if (String(input).endsWith('/api/model/set')) return Response.json({ ok: true });
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
