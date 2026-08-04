import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
} from '@aquiero/contracts';
import { Pool } from 'pg';
import { authenticationConfigFromEnvironment } from '../auth/config.js';
import { AuthenticationService } from '../auth/service.js';
import { migrateDatabase, verifyDatabase } from '../database/migrations.js';
import { DnsPrivateEndpointGuard } from './private-network.js';
import { FrameworkGatewayService } from './service.js';
import type {
  FrameworkGatewayError,
  GatewayCredentialBundle,
  GatewayCredentialProvider,
} from './types.js';

const integrationUrl = process.env.CORE_FRAMEWORK_TEST_DATABASE_URL;
const ALICA_TOKEN = 'alica-integration-token-at-least-thirty-two-bytes';
const HERMAN_TOKEN = 'herman-integration-token-at-least-thirty-two-bytes';
const ALICA_ROTATED = 'alica-rotated-token-at-least-thirty-two-bytes';
const ALICA_ID = 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const HERMAN_ID = 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAW';

class MapCredentials implements GatewayCredentialProvider {
  readonly values = new Map<string, GatewayCredentialBundle>([
    ['secret://frameworks/alica', { active: { version: 'alica-v1', token: ALICA_TOKEN } }],
    ['secret://frameworks/herman', { active: { version: 'herman-v1', token: HERMAN_TOKEN } }],
  ]);

  async resolve(reference: string): Promise<GatewayCredentialBundle> {
    const bundle = this.values.get(reference);
    if (!bundle) throw new Error('missing test credential');
    return bundle;
  }
}

function controlDocuments(frameworkId: string, instanceId: string) {
  const metadata = {
    contractVersion: HERMES_CONTROL_VERSION,
    frameworkId,
    frameworkVersion: PINNED_HERMES_RELEASE,
    frameworkCommit: PINNED_HERMES_COMMIT,
    sourceVersion: `${PINNED_HERMES_RELEASE}+${PINNED_HERMES_COMMIT}`,
    observedAt: '2026-08-04T12:00:00.000Z',
  } as const;
  return {
    '/control/v1/identity': {
      ...metadata,
      data: { runtime: 'hermes-agent', instanceId, displayName: frameworkId },
    },
    '/control/v1/version': {
      ...metadata,
      data: {
        release: PINNED_HERMES_RELEASE,
        commit: PINNED_HERMES_COMMIT,
        dirty: false,
        pythonVersion: '3.11.9',
      },
    },
    '/control/v1/health': {
      ...metadata,
      data: { status: 'healthy', checks: { gateway: { status: 'healthy' } } },
    },
    '/control/v1/capabilities': {
      ...metadata,
      data: {
        capabilities: {
          'profiles.read': { status: 'supported', modes: ['read'], requiredScopes: [] },
          'providers.read': { status: 'supported', modes: ['read'], requiredScopes: [] },
          'work.cron.execute': {
            status: 'unavailable',
            modes: ['execute'],
            requiredScopes: ['control:work'],
            reasonCode: 'maintenance',
          },
        },
      },
    },
  } as const;
}

const context = { remoteAddress: '127.0.0.1' } as const;

test(
  'registers and inspects isolated Alica and Herman gateways with persisted rotation metadata',
  { skip: !integrationUrl },
  async () => {
    const parsed = new URL(integrationUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_framework_test(?:_|$)/,
      'integration database name must start with unify_core_framework_test',
    );
    const pool = new Pool({ connectionString: integrationUrl, max: 8 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      await migrateDatabase(pool);
      await verifyDatabase(pool);
      const authentication = await AuthenticationService.create(
        pool,
        authenticationConfigFromEnvironment({
          CORE_AUTH_PASSWORD_PEPPER: 'password-pepper-for-framework-integration-tests',
          CORE_AUTH_TOKEN_PEPPER: 'token-pepper-for-framework-integration-tests',
          CORE_AUTH_MFA_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
          CORE_AUTH_BOOTSTRAP_TOKEN: 'bootstrap-token-for-framework-tests-0001',
        }),
      );
      const adminPassword = 'Framework-Gateway-Integration-Password-2026!';
      await authentication.bootstrapAdministrator(
        {
          token: 'bootstrap-token-for-framework-tests-0001',
          username: 'framework-admin',
          displayName: 'Framework Admin',
          password: adminPassword,
        },
        context,
      );
      const actor = (
        await authentication.login(
          { username: 'framework-admin', password: adminPassword },
          context,
        )
      ).principal;
      const credentials = new MapCredentials();
      const expected = new Map([
        [
          '10.40.0.2',
          {
            token: () => credentials.values.get('secret://frameworks/alica')!.active.token,
            documents: controlDocuments('hermes-alica', 'alica-private-1'),
          },
        ],
        [
          '10.40.0.3',
          {
            token: () => credentials.values.get('secret://frameworks/herman')!.active.token,
            documents: controlDocuments('hermes-herman', 'herman-private-1'),
          },
        ],
      ]);
      const transport: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const target = expected.get(url.hostname)!;
        const supplied = new Headers(init?.headers).get('authorization');
        if (supplied !== `Bearer ${target.token()}`)
          return new Response('{}', {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        return new Response(
          JSON.stringify(target.documents[url.pathname as keyof typeof target.documents]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };
      const service = new FrameworkGatewayService({
        pool,
        authentication,
        credentials,
        endpointGuard: new DnsPrivateEndpointGuard(),
        fetchImpl: transport,
        sleep: async () => undefined,
      });
      const pair = await service.registerAlicaAndHerman(
        {
          id: ALICA_ID,
          name: 'Alica',
          endpoint: 'https://10.40.0.2',
          credentialReference: 'secret://frameworks/alica',
          expectedNativeFrameworkId: 'hermes-alica',
          expectedInstanceId: 'alica-private-1',
          expectedRelease: PINNED_HERMES_RELEASE,
          expectedCommit: PINNED_HERMES_COMMIT,
        },
        {
          id: HERMAN_ID,
          name: 'Herman',
          endpoint: 'https://10.40.0.3',
          credentialReference: 'secret://frameworks/herman',
          expectedNativeFrameworkId: 'hermes-herman',
          expectedInstanceId: 'herman-private-1',
          expectedRelease: PINNED_HERMES_RELEASE,
          expectedCommit: PINNED_HERMES_COMMIT,
        },
        actor,
        context,
      );
      assert.deepEqual(
        pair.map((framework) => framework.name),
        ['Alica', 'Herman'],
      );
      assert.notEqual(pair[0].endpoint, pair[1].endpoint);
      assert.notEqual(pair[0].credentialReference, pair[1].credentialReference);
      const ensured = await service.ensureAlicaAndHermanRegistered(
        {
          id: ALICA_ID,
          name: 'Alica',
          endpoint: 'https://10.40.0.2',
          credentialReference: 'secret://frameworks/alica',
          expectedNativeFrameworkId: 'hermes-alica',
          expectedInstanceId: 'alica-private-1',
          expectedRelease: PINNED_HERMES_RELEASE,
          expectedCommit: PINNED_HERMES_COMMIT,
        },
        {
          id: HERMAN_ID,
          name: 'Herman',
          endpoint: 'https://10.40.0.3',
          credentialReference: 'secret://frameworks/herman',
          expectedNativeFrameworkId: 'hermes-herman',
          expectedInstanceId: 'herman-private-1',
          expectedRelease: PINNED_HERMES_RELEASE,
          expectedCommit: PINNED_HERMES_COMMIT,
        },
        actor,
        context,
      );
      assert.deepEqual(
        ensured.map((framework) => framework.id),
        [ALICA_ID, HERMAN_ID],
      );

      const [alica, herman] = await Promise.all([
        service.inspectFramework(ALICA_ID, actor, context),
        service.inspectFramework(HERMAN_ID, actor, context),
      ]);
      assert.equal(alica.identity.data.instanceId, 'alica-private-1');
      assert.equal(herman.identity.data.instanceId, 'herman-private-1');
      assert.equal(alica.credentialVersion, 'alica-v1');
      assert.equal(herman.credentialVersion, 'herman-v1');

      const persisted = await pool.query<{
        frameworks: string;
        observations: string;
        capability_documents: string;
        leaked_tokens: string;
      }>(
        `SELECT
        (SELECT count(*)::text FROM core.frameworks) AS frameworks,
        (SELECT count(*)::text FROM core.framework_gateway_observations) AS observations,
        (SELECT count(*)::text FROM core.framework_capability_documents) AS capability_documents,
        (SELECT count(*)::text FROM core.framework_gateway_observations
          WHERE document::text LIKE '%' || $1 || '%' OR document::text LIKE '%' || $2 || '%') AS leaked_tokens`,
        [ALICA_TOKEN, HERMAN_TOKEN],
      );
      assert.deepEqual(persisted.rows[0], {
        frameworks: '2',
        observations: '8',
        capability_documents: '2',
        leaked_tokens: '0',
      });

      credentials.values.set('secret://frameworks/alica', {
        active: { version: 'alica-v2', token: ALICA_ROTATED },
        retiring: { version: 'alica-v1', token: ALICA_TOKEN },
      });
      const rotated = await service.inspectFramework(ALICA_ID, actor, context);
      assert.equal(rotated.credentialVersion, 'alica-v2');
      const rotations = await pool.query<{
        previous_version: string;
        active_version: string;
      }>(
        'SELECT previous_version,active_version FROM core.framework_gateway_token_rotations WHERE framework_id=$1',
        [ALICA_ID],
      );
      assert.deepEqual(rotations.rows, [
        { previous_version: 'alica-v1', active_version: 'alica-v2' },
      ]);
      const hermanRuntime = await pool.query<{ active_credential_version: string }>(
        'SELECT active_credential_version FROM core.framework_gateway_runtime WHERE framework_id=$1',
        [HERMAN_ID],
      );
      assert.equal(hermanRuntime.rows[0]?.active_credential_version, 'herman-v1');

      await assert.rejects(
        service.registerFramework(
          {
            id: 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            name: 'Duplicate',
            endpoint: 'https://10.40.0.4',
            credentialReference: 'secret://frameworks/alica',
            expectedNativeFrameworkId: 'hermes-duplicate',
            expectedInstanceId: 'duplicate-private-1',
            expectedRelease: PINNED_HERMES_RELEASE,
            expectedCommit: PINNED_HERMES_COMMIT,
          },
          actor,
          context,
        ),
        (error: unknown) =>
          (error as FrameworkGatewayError).code === 'framework_registration_conflict',
      );
      await assert.rejects(
        service.registerFramework(
          {
            id: 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAY',
            name: 'Public',
            endpoint: 'https://8.8.8.8',
            credentialReference: 'secret://frameworks/public',
            expectedNativeFrameworkId: 'hermes-public',
            expectedInstanceId: 'public-1',
            expectedRelease: PINNED_HERMES_RELEASE,
            expectedCommit: PINNED_HERMES_COMMIT,
          },
          actor,
          context,
        ),
        (error: unknown) =>
          (error as FrameworkGatewayError).code === 'framework_endpoint_not_private',
      );
    } finally {
      await pool.end();
    }
  },
);
