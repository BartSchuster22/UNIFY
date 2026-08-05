import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type HermesModel,
  type HermesProvider,
} from '@aquiero/contracts';
import { Pool } from 'pg';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal } from '../auth/types.js';
import { migrateDatabase, verifyDatabase } from '../database/migrations.js';
import type { FrameworkGatewayService } from '../frameworks/service.js';
import { NativeModelError, NativeModelService } from './service.js';

const integrationUrl = process.env.CORE_MODEL_TEST_DATABASE_URL;
const FRAMEWORK_ID = 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PROFILE_ID = 'prf_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const actor = {
  kind: 'service',
  id: 'svc_01ARZ3NDEKTSV4RRFFQ69G5FAX',
  name: 'model-integration-test',
  roles: ['core.admin'],
  permissions: ['models.read', 'models.manage'],
  credentialId: 'crd_01ARZ3NDEKTSV4RRFFQ69G5FAY',
  credentialScopes: ['*'],
} satisfies AuthenticatedPrincipal;
const context = {
  remoteAddress: '127.0.0.1',
  requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  correlationId: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FB0',
} as const;

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof NativeModelError && error.code === code;
}

test(
  'persists Hermes-native provider/model projections, routing, validation and reconciliation evidence',
  { skip: !integrationUrl },
  async () => {
    const parsed = new URL(integrationUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_model_test(?:_|$)/,
      'integration database name must start with unify_core_model_test',
    );
    const pool = new Pool({ connectionString: integrationUrl, max: 8 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      const migration = await migrateDatabase(pool);
      assert.deepEqual(migration.applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      await verifyDatabase(pool);
      await pool.query(
        `INSERT INTO core.frameworks
           (id,name,endpoint,credential_reference,desired_state,version)
         VALUES ($1,'Model Test','https://10.70.0.2','secret://frameworks/model-test','active',1)`,
        [FRAMEWORK_ID],
      );
      await pool.query(
        `INSERT INTO core.profiles
           (id,framework_id,native_reference,name,desired_state,observed_state)
         VALUES ($1,$2,'herman','Herman','active','active')`,
        [PROFILE_ID, FRAMEWORK_ID],
      );

      let providerSourceVersion = 'sha256:providers-1';
      let modelSourceVersion = 'sha256:models-1';
      let providers: HermesProvider[] = [
        { id: 'openai', displayName: 'OpenAI', credentialStatus: 'configured', selected: true },
        {
          id: 'anthropic',
          displayName: 'Anthropic',
          credentialStatus: 'missing',
          selected: false,
        },
      ];
      let models: HermesModel[] = [
        {
          id: 'gpt-5.6',
          providerId: 'openai',
          displayName: 'GPT-5.6',
          capabilities: ['text', 'tool-use', 'reasoning'],
          contextWindow: 400_000,
          maximumOutputTokens: 128_000,
          selected: true,
        },
        {
          id: 'claude-opus-4.1',
          providerId: 'anthropic',
          displayName: 'Claude Opus 4.1',
          capabilities: ['text', 'vision', 'tool-use'],
          contextWindow: 200_000,
          selected: false,
          fallbackPriority: 1,
        },
      ];
      const metadata = (sourceVersion: string) => ({
        contractVersion: HERMES_CONTROL_VERSION,
        frameworkId: 'hermes-model-test',
        frameworkVersion: PINNED_HERMES_RELEASE,
        frameworkCommit: PINNED_HERMES_COMMIT,
        sourceVersion,
        observedAt: '2026-08-05T10:00:00.000Z',
      });
      const frameworks = {
        listNativeProviders: async () => ({
          ...metadata(providerSourceVersion),
          data: { items: providers, page: { hasMore: false } },
        }),
        listNativeModels: async () => ({
          ...metadata(modelSourceVersion),
          data: { items: models, page: { hasMore: false } },
        }),
      } as unknown as FrameworkGatewayService;
      const authentication = {
        authorize: async () => undefined,
      } as unknown as AuthenticationService;
      const service = new NativeModelService(pool, authentication, frameworks);

      const initial = await service.reconcile(FRAMEWORK_ID, actor, context);
      assert.equal(initial.status, 'drifted');
      assert.deepEqual(initial.changes.slice(0, 2), [
        { kind: 'providers', observed: 2 },
        { kind: 'models', observed: 2 },
      ]);
      assert.equal(initial.providerSourceVersion, providerSourceVersion);
      assert.equal(initial.modelSourceVersion, modelSourceVersion);

      const inventory = await service.inventory(actor, context, FRAMEWORK_ID);
      assert.equal(inventory.providers.length, 2);
      assert.equal(inventory.models.length, 2);
      assert.equal(
        inventory.selectedModelId,
        inventory.models.find((item) => item.nativeReference === 'gpt-5.6')?.id,
      );
      assert.deepEqual(inventory.fallbackModelIds, [
        inventory.models.find((item) => item.nativeReference === 'claude-opus-4.1')?.id,
      ]);
      assert.deepEqual(inventory.provenance, [
        { frameworkId: FRAMEWORK_ID, providerSourceVersion, modelSourceVersion },
      ]);

      const importedPolicy = await service.routingPolicy(PROFILE_ID, actor, context);
      assert.equal(importedPolicy.candidates.length, 2);
      const selectedModel = inventory.models.find((item) => item.selectedDefault)!;
      const fallbackModel = inventory.models.find(
        (item) => item.nativeReference === 'claude-opus-4.1',
      )!;
      const resolved = await service.resolve(PROFILE_ID, ['text'], actor, context);
      assert.equal(resolved.selected?.id, selectedModel.id);
      assert.deepEqual(resolved.rejections, []);

      const policy = await service.setRoutingPolicy(
        PROFILE_ID,
        [
          { modelId: selectedModel.id, requiredCapabilities: ['vision'] },
          { modelId: fallbackModel.id, requiredCapabilities: ['vision'] },
        ],
        importedPolicy.version,
        actor,
        context,
      );
      assert.equal(policy.version, importedPolicy.version + 1);
      const unavailable = await service.resolve(PROFILE_ID, ['vision'], actor, context);
      assert.equal(unavailable.selected, null);
      assert.deepEqual(
        unavailable.rejections.map((item) => item.reasons),
        [
          ['capability_mismatch'],
          ['model_unavailable', 'provider_unavailable', 'credential_unavailable'],
        ],
      );
      await assert.rejects(
        service.setRoutingPolicy(
          PROFILE_ID,
          [{ modelId: 'mdl_01ARZ3NDEKTSV4RRFFQ69G5FB1' }],
          policy.version,
          actor,
          context,
        ),
        rejectsWith('routing_model_invalid'),
      );
      assert.equal(
        (await service.routingPolicy(PROFILE_ID, actor, context)).version,
        policy.version,
      );

      const openaiProvider = inventory.providers.find((item) => item.nativeReference === 'openai')!;
      const validation = await service.validateProvider(openaiProvider.id, actor, context);
      assert.equal(validation.outcome, 'valid');
      assert.equal(
        (await service.inventory(actor, context, FRAMEWORK_ID)).providers.find(
          (item) => item.id === openaiProvider.id,
        )?.credentialState,
        'configured',
      );

      await assert.rejects(
        service.setCredentialReference(
          openaiProvider.id,
          'secret://providers/openai',
          999,
          actor,
          context,
        ),
        rejectsWith('provider_version_conflict'),
      );
      providerSourceVersion = 'sha256:providers-2';
      modelSourceVersion = 'sha256:models-2';
      providers = [providers[0]!];
      models = [];
      const drift = await service.reconcile(FRAMEWORK_ID, actor, context);
      assert.deepEqual(drift.changes.slice(0, 2), [
        { kind: 'providers', observed: 1 },
        { kind: 'models', observed: 0 },
      ]);
      const retiredInventory = await service.inventory(actor, context, FRAMEWORK_ID);
      assert.equal(
        retiredInventory.providers.find((item) => item.nativeReference === 'anthropic')
          ?.observedState,
        'unavailable',
      );
      assert.equal(
        retiredInventory.models.find((item) => item.nativeReference === 'gpt-5.6')?.observedState,
        'unavailable',
      );

      const evidence = await pool.query<{
        reconciliations: string;
        validations: string;
        policies: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM core.model_reconciliations) AS reconciliations,
           (SELECT count(*)::text FROM core.provider_validation_evidence) AS validations,
           (SELECT count(*)::text FROM core.model_policy_evidence) AS policies`,
      );
      assert.equal(evidence.rows[0]?.reconciliations, '2');
      assert.equal(evidence.rows[0]?.validations, '1');
      assert.equal(evidence.rows[0]?.policies, '1');
      await assert.rejects(pool.query('DELETE FROM core.model_reconciliations'), /immutable/i);
      await assert.rejects(
        pool.query('UPDATE core.model_policy_evidence SET resulting_version=resulting_version'),
        /immutable/i,
      );
    } finally {
      await pool.end();
    }
  },
);
