import { describe, expect, it } from 'vitest';
import { STANDARD_API_KEY_PROVIDER_IDS, truthfulProviderContract } from './provider-contracts.js';

describe('standard API-key provider matrix', () => {
  it('pins exactly 22 distinct providers to the safe one-secret workflow', () => {
    expect(STANDARD_API_KEY_PROVIDER_IDS).toHaveLength(22);
    expect(new Set(STANDARD_API_KEY_PROVIDER_IDS).size).toBe(22);
    for (const id of STANDARD_API_KEY_PROVIDER_IDS) {
      const contract = truthfulProviderContract({
        id,
        authenticated: false,
        selected: false,
        modelCount: 0,
      });
      expect(contract).toMatchObject({
        authMethod: 'api_key',
        credentialMutable: true,
        setupSupported: true,
        connectionState: 'disconnected',
        deploymentReadiness: 'needs_configuration',
      });
      expect(contract.setupFields?.filter((field) => field.required && field.secret)).toHaveLength(
        1,
      );
      expect(contract.setupFields?.filter((field) => field.required && !field.secret)).toHaveLength(
        0,
      );
    }
  });

  it('supports advanced key and endpoint provider contracts without exposing environment names', () => {
    const expected = {
      anthropic: ['credentialType', 'credential', 'baseUrl'],
      gemini: ['credentialType', 'credential', 'baseUrl'],
      zai: ['credentialType', 'credential', 'baseUrl'],
      'kimi-coding': ['credentialType', 'credential', 'baseUrl'],
      alibaba: ['credential', 'baseUrl'],
      'alibaba-coding-plan': ['credential', 'baseUrl'],
      'azure-foundry': ['baseUrl', 'credential'],
    };
    for (const [id, fields] of Object.entries(expected)) {
      const contract = truthfulProviderContract({
        id,
        authenticated: false,
        selected: false,
        modelCount: 0,
      });
      expect(contract).toMatchObject({
        authMethod: 'api_key',
        setupSupported: true,
        credentialMutable: true,
      });
      expect(contract.setupFields?.map((field) => field.id)).toEqual(fields);
      expect(JSON.stringify(contract)).not.toMatch(/API_KEY|_BASE_URL|TOKEN/);
    }
    expect(
      truthfulProviderContract({
        id: 'anthropic',
        authenticated: false,
        selected: false,
        modelCount: 0,
      }).setupFields?.[0]?.choices,
    ).toHaveLength(3);
  });

  it('advances truthful readiness through discovery and selection', () => {
    for (const id of STANDARD_API_KEY_PROVIDER_IDS) {
      expect(
        truthfulProviderContract({ id, authenticated: true, selected: false, modelCount: 0 })
          .deploymentReadiness,
      ).toBe('needs_model');
      expect(
        truthfulProviderContract({ id, authenticated: true, selected: false, modelCount: 1 })
          .deploymentReadiness,
      ).toBe('needs_selection');
      expect(
        truthfulProviderContract({ id, authenticated: true, selected: true, modelCount: 1 })
          .deploymentReadiness,
      ).toBe('ready');
    }
  });
});
