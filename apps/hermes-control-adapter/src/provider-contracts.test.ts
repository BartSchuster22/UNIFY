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
