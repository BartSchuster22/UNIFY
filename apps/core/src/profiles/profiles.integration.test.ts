import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type HermesProfile,
} from '@aquiero/contracts';
import { Pool } from 'pg';
import { authenticationConfigFromEnvironment } from '../auth/config.js';
import { AuthenticationService } from '../auth/service.js';
import { migrateDatabase, verifyDatabase } from '../database/migrations.js';
import { FrameworkGatewayService } from '../frameworks/service.js';
import type { GatewayCredentialProvider } from '../frameworks/types.js';
import { NativeProfileError, NativeProfileService } from './service.js';

const integrationUrl = process.env.CORE_PROFILE_TEST_DATABASE_URL;
const FRAMEWORK_ID = 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const context = {
  remoteAddress: '127.0.0.1',
  requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAA',
  correlationId: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAB',
} as const;

const credentials: GatewayCredentialProvider = {
  async resolve() {
    return {
      active: {
        version: 'profile-token-v1',
        token: 'profile-integration-token-at-least-thirty-two-bytes',
      },
    };
  },
};

test(
  'persists native profile inventory, lifecycle, protection, concurrency, assignments and evidence',
  { skip: !integrationUrl },
  async () => {
    const parsed = new URL(integrationUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_profile_test(?:_|$)/,
      'integration database name must start with unify_core_profile_test',
    );
    const pool = new Pool({ connectionString: integrationUrl, max: 8 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      await migrateDatabase(pool);
      await verifyDatabase(pool);
      const authentication = await AuthenticationService.create(
        pool,
        authenticationConfigFromEnvironment({
          CORE_AUTH_PASSWORD_PEPPER: 'password-pepper-for-profile-integration-tests',
          CORE_AUTH_TOKEN_PEPPER: 'token-pepper-for-profile-integration-tests',
          CORE_AUTH_MFA_KEY_BASE64: Buffer.alloc(32, 11).toString('base64'),
          CORE_AUTH_BOOTSTRAP_TOKEN: 'bootstrap-token-for-profile-tests-0001',
        }),
      );
      const password = 'Native-Profile-Integration-Password-2026!';
      await authentication.bootstrapAdministrator(
        {
          token: 'bootstrap-token-for-profile-tests-0001',
          username: 'profile-admin',
          displayName: 'Profile Admin',
          password,
        },
        context,
      );
      const actor = (await authentication.login({ username: 'profile-admin', password }, context))
        .principal;

      await pool.query(
        `INSERT INTO core.frameworks
           (id,name,endpoint,credential_reference,desired_state,version)
         VALUES ($1,'Profile Test','https://10.60.0.2',
                 'secret://frameworks/profile-test','active',1)`,
        [FRAMEWORK_ID],
      );
      await pool.query(
        `INSERT INTO core.framework_gateway_policies
           (framework_id,expected_native_framework_id,expected_instance_id,
            expected_release,expected_commit,request_timeout_ms,retry_limit,
            retry_base_delay_ms,maximum_response_bytes,circuit_failure_threshold,circuit_open_ms)
         VALUES ($1,'hermes-profile-test','profile-test-1',$2,$3,2000,0,10,1048576,3,30000)`,
        [FRAMEWORK_ID, PINNED_HERMES_RELEASE, PINNED_HERMES_COMMIT],
      );

      let sourceCounter = 1;
      let nativeProfiles: HermesProfile[] = [];
      let failNextMutation = false;
      const response = (data: unknown) =>
        Response.json({
          contractVersion: HERMES_CONTROL_VERSION,
          frameworkId: 'hermes-profile-test',
          frameworkVersion: PINNED_HERMES_RELEASE,
          frameworkCommit: PINNED_HERMES_COMMIT,
          sourceVersion: `sha256:profiles-${sourceCounter}`,
          observedAt: '2026-08-04T12:00:00.000Z',
          data,
        });
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/control/v1/profiles')
          return response({ items: nativeProfiles, page: { hasMore: false } });
        if (url.pathname === '/control/v1/commands/profiles') {
          if (failNextMutation) {
            failNextMutation = false;
            return new Response('', { status: 503 });
          }
          const command = JSON.parse(String(init?.body)) as {
            operation: string;
            targetId: string;
            expectedSourceVersion?: string;
          };
          assert.equal(command.expectedSourceVersion, `sha256:profiles-${sourceCounter}`);
          if (command.operation === 'profile.create')
            nativeProfiles.push({
              id: command.targetId,
              displayName: command.targetId,
              active: false,
              gatewayStatus: 'stopped',
            });
          if (command.operation === 'profile.delete')
            nativeProfiles = nativeProfiles.filter((item) => item.id !== command.targetId);
          sourceCounter += 1;
          return response({
            operationId: `operation-${sourceCounter}`,
            status: 'completed',
            replayed: false,
            operation: command.operation,
            targetId: command.targetId,
            result: {},
            emittedEvents: 1,
          });
        }
        return new Response('{}', { status: 404 });
      };
      const frameworks = new FrameworkGatewayService({
        pool,
        authentication,
        credentials,
        endpointGuard: { assertPrivate: async () => undefined },
        fetchImpl,
        sleep: async () => undefined,
      });
      const profiles = new NativeProfileService(pool, authentication, frameworks);

      const protectedProfile = await profiles.create(
        {
          frameworkId: FRAMEWORK_ID,
          nativeReference: 'protected-agent',
          name: 'Protected Agent',
          description: 'Must remain present',
          protected: true,
        },
        actor,
        context,
      );
      assert.equal(protectedProfile.observedState, 'inactive');
      assert.equal(protectedProfile.protected, true);
      await assert.rejects(
        profiles.delete(protectedProfile.id, protectedProfile.version, actor, context),
        (error: unknown) =>
          error instanceof NativeProfileError && error.code === 'profile_protected',
      );
      await assert.rejects(
        profiles.update(protectedProfile.id, { description: 'stale' }, 999, actor, context),
        (error: unknown) =>
          error instanceof NativeProfileError && error.code === 'profile_version_conflict',
      );
      failNextMutation = true;
      await assert.rejects(
        profiles.update(
          protectedProfile.id,
          { description: 'Persisted desired state awaiting retry' },
          protectedProfile.version,
          actor,
          context,
        ),
      );
      const failedProfile = await profiles.get(protectedProfile.id, actor, context);
      assert.equal(failedProfile.description, 'Persisted desired state awaiting retry');
      const failedEvidence = await pool.query<{
        outcome: string;
        details: { safeErrorCode?: string };
      }>(
        `SELECT outcome,details FROM core.profile_lifecycle_evidence
         WHERE profile_id=$1 AND action='update' ORDER BY occurred_at DESC LIMIT 1`,
        [protectedProfile.id],
      );
      assert.equal(failedEvidence.rows[0]?.outcome, 'failed');
      assert.ok(failedEvidence.rows[0]?.details.safeErrorCode);

      const inventory = await profiles.inventory(actor, context, FRAMEWORK_ID);
      assert.equal(inventory.frameworks.length, 1);
      assert.equal(inventory.profiles.length, 1);
      assert.equal(inventory.agents.length, 1);
      assert.equal(inventory.assignments.length, 1);
      assert.equal(inventory.assignments[0]?.observedState, 'assigned');

      const assigned = await profiles.assign(
        inventory.agents[0]!.id,
        protectedProfile.id,
        'primary',
        inventory.agents[0]!.version,
        failedProfile.version,
        actor,
        context,
      );
      assert.equal(assigned.role, 'primary');
      await assert.rejects(
        profiles.assign(
          inventory.agents[0]!.id,
          protectedProfile.id,
          'primary',
          999,
          failedProfile.version,
          actor,
          context,
        ),
        (error: unknown) =>
          error instanceof NativeProfileError && error.code === 'profile_version_conflict',
      );

      const reconciliation = await profiles.reconcile(
        FRAMEWORK_ID,
        actor,
        context,
        `sha256:profiles-${sourceCounter}`,
      );
      assert.equal(reconciliation.status, 'converged');
      await assert.rejects(
        profiles.reconcile(FRAMEWORK_ID, actor, context, 'sha256:profiles-stale'),
        (error: unknown) =>
          error instanceof NativeProfileError && error.code === 'profile_source_version_conflict',
      );
      const evidence = await pool.query<{
        observations: string;
        reconciliations: string;
        lifecycle: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM core.profile_inventory_observations) AS observations,
          (SELECT count(*)::text FROM core.profile_reconciliations) AS reconciliations,
          (SELECT count(*)::text FROM core.profile_lifecycle_evidence) AS lifecycle`,
      );
      assert.ok(Number(evidence.rows[0]?.observations) >= 2);
      assert.ok(Number(evidence.rows[0]?.reconciliations) >= 2);
      assert.ok(Number(evidence.rows[0]?.lifecycle) >= 4);
      await assert.rejects(pool.query('DELETE FROM core.profile_lifecycle_evidence'), /immutable/i);
    } finally {
      await pool.end();
    }
  },
);
