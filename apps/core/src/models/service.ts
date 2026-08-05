import type { HermesModel, HermesProvider } from '@aquiero/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ulid } from 'ulid';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import type { FrameworkGatewayService } from '../frameworks/service.js';

export type ModelCapability =
  'text' | 'vision' | 'audio' | 'tool-use' | 'structured-output' | 'reasoning';

export interface NativeProviderRecord {
  id: string;
  frameworkId: string;
  nativeReference: string;
  name: string;
  authenticationMethod: 'none' | 'api-key' | 'oauth2' | 'framework-managed';
  credentialReference: string | null;
  credentialState: 'not-required' | 'missing' | 'configured' | 'invalid' | 'unknown';
  desiredState: 'active' | 'disabled';
  observedState: 'unknown' | 'available' | 'invalid' | 'unavailable' | 'disabled';
  selectedDefault: boolean;
  sourceVersion: string | null;
  lastValidatedAt: Date | null;
  lastObservedAt: Date | null;
  safeErrorCode: string | null;
  version: number;
}

export interface NativeModelRecord {
  id: string;
  frameworkId: string;
  providerId: string;
  nativeReference: string;
  name: string;
  aliases: string[];
  capabilities: ModelCapability[];
  contextWindow: number | null;
  maximumOutputTokens: number | null;
  desiredState: 'enabled' | 'disabled' | 'retired';
  observedState: 'available' | 'unavailable' | 'retired';
  selectedDefault: boolean;
  selectable: boolean;
  sourceVersion: string | null;
  observedAt: Date | null;
  version: number;
}

export interface RoutingCandidateInput {
  modelId: string;
  requiredCapabilities?: readonly string[];
  required?: boolean;
}

export interface RouteResolution {
  profileId: string;
  selected: NativeModelRecord | null;
  rejections: { modelId: string; reasons: string[] }[];
}

export class NativeModelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409 | 422 | 502 | 503,
  ) {
    super(message);
    this.name = 'NativeModelError';
  }
}

interface ProviderRow extends QueryResultRow {
  id: string;
  framework_id: string;
  native_reference: string;
  display_name: string;
  authentication_method: NativeProviderRecord['authenticationMethod'];
  credential_reference: string | null;
  credential_state: NativeProviderRecord['credentialState'];
  desired_state: NativeProviderRecord['desiredState'];
  observed_state: NativeProviderRecord['observedState'];
  selected_default: boolean;
  source_version: string | null;
  validated_at: Date | null;
  last_observed_at: Date | null;
  safe_error_code: string | null;
  version: string | number;
}

interface ModelRow extends QueryResultRow {
  id: string;
  framework_id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  aliases: string[];
  capabilities: string[];
  context_window: number | null;
  max_output_tokens: number | null;
  desired_state: NativeModelRecord['desiredState'];
  observed_state: NativeModelRecord['observedState'];
  selected_default: boolean;
  selectable: boolean;
  source_version: string | null;
  observed_at: Date | null;
  version: string | number;
}

export class NativeModelService {
  constructor(
    private readonly pool: Pool,
    private readonly authentication: AuthenticationService,
    private readonly frameworks: FrameworkGatewayService,
  ) {}

  async inventory(actor: AuthenticatedPrincipal, context: RequestContext, frameworkId?: string) {
    await this.authentication.authorize(actor, 'models.read', undefined, context);
    const parameters = frameworkId ? [frameworkId] : [];
    const where = frameworkId ? ' WHERE framework_id=$1' : '';
    const [providers, models, snapshots] = await Promise.all([
      this.pool.query<ProviderRow>(
        `${providerSelect()}${where} ORDER BY display_name,id`,
        parameters,
      ),
      this.pool.query<ModelRow>(`${modelSelect()}${where} ORDER BY display_name,id`, parameters),
      this.pool.query<{
        framework_id: string;
        provider_source_version: string;
        model_source_version: string;
        document: { models?: HermesModel[] };
      }>(
        `SELECT DISTINCT ON (framework_id)
           framework_id,provider_source_version,model_source_version,document
         FROM core.model_catalog_snapshots${frameworkId ? ' WHERE framework_id=$1' : ''}
         ORDER BY framework_id,created_at DESC`,
        parameters,
      ),
    ]);
    const providerRecords = providers.rows.map(providerFromRow);
    const modelRecords = models.rows.map(modelFromRow);
    const nativeToCanonical = new Map(
      modelRecords.map((model) => {
        const provider = providerRecords.find((item) => item.id === model.providerId);
        return [`${provider?.nativeReference ?? ''}/${model.nativeReference}`, model.id] as const;
      }),
    );
    const fallbackModelIds = snapshots.rows
      .flatMap((snapshot) => snapshot.document.models ?? [])
      .filter((model) => model.fallbackPriority !== undefined)
      .sort((left, right) => left.fallbackPriority! - right.fallbackPriority!)
      .map((model) => nativeToCanonical.get(`${model.providerId}/${model.id}`))
      .filter((id): id is string => Boolean(id));
    return {
      providers: providerRecords,
      models: modelRecords,
      selectedModelId: modelRecords.find((model) => model.selectedDefault)?.id,
      fallbackModelIds,
      provenance: snapshots.rows.map((snapshot) => ({
        frameworkId: snapshot.framework_id,
        providerSourceVersion: snapshot.provider_source_version,
        modelSourceVersion: snapshot.model_source_version,
      })),
    };
  }

  async reconcile(frameworkId: string, actor: AuthenticatedPrincipal, context: RequestContext) {
    await this.authentication.authorize(
      actor,
      'models.manage',
      { kind: 'framework', id: frameworkId },
      context,
    );
    const [providerDocument, modelDocument] = await Promise.all([
      this.frameworks.listNativeProviders(frameworkId, actor, context),
      this.frameworks.listNativeModels(frameworkId, actor, context),
    ]);
    const providerSnapshot = providerDocument as unknown as {
      sourceVersion: string;
      observedAt: string;
      data: { items: HermesProvider[] };
    };
    const modelSnapshot = modelDocument as unknown as {
      sourceVersion: string;
      observedAt: string;
      data: { items: HermesModel[] };
    };
    const observedAt = new Date(
      Date.parse(providerSnapshot.observedAt) > Date.parse(modelSnapshot.observedAt)
        ? providerSnapshot.observedAt
        : modelSnapshot.observedAt,
    );
    const nativeProviders = new Map(providerSnapshot.data.items.map((item) => [item.id, item]));
    for (const model of modelSnapshot.data.items)
      if (!nativeProviders.has(model.providerId))
        nativeProviders.set(model.providerId, {
          id: model.providerId,
          displayName: model.providerId,
          credentialStatus: 'unknown',
          selected: false,
        });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE core.providers SET observed_state=CASE WHEN desired_state='disabled' THEN 'disabled' ELSE 'unavailable' END,
                selected_default=false,source_version=$2,last_observed_at=$3 WHERE framework_id=$1`,
        [frameworkId, providerSnapshot.sourceVersion, observedAt],
      );
      const providers = new Map<string, NativeProviderRecord>();
      for (const item of nativeProviders.values()) {
        const row = await upsertProvider(
          client,
          frameworkId,
          item,
          providerSnapshot.sourceVersion,
          observedAt,
        );
        providers.set(item.id, row);
      }
      await client.query(
        `UPDATE core.models SET observed_state=CASE WHEN desired_state='retired' THEN 'retired' ELSE 'unavailable' END,
                selectable=false,selected_default=false,source_version=$2,observed_at=$3 WHERE framework_id=$1`,
        [frameworkId, modelSnapshot.sourceVersion, observedAt],
      );
      const models = new Map<string, NativeModelRecord>();
      for (const item of modelSnapshot.data.items) {
        const provider = providers.get(item.providerId)!;
        const row = await upsertModel(
          client,
          frameworkId,
          provider,
          item,
          modelSnapshot.sourceVersion,
          observedAt,
        );
        models.set(`${item.providerId}/${item.id}`, row);
      }

      await initializeRoutingDefaults(client, frameworkId, modelSnapshot.data.items, models);
      const drift = await routingDrift(client, frameworkId);
      const changes = [
        { kind: 'providers', observed: nativeProviders.size },
        { kind: 'models', observed: modelSnapshot.data.items.length },
        ...drift,
      ];
      await client.query(
        `INSERT INTO core.model_catalog_snapshots
           (id,framework_id,provider_source_version,model_source_version,observed_at,
            provider_count,model_count,document)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          canonicalId('mcs'),
          frameworkId,
          providerSnapshot.sourceVersion,
          modelSnapshot.sourceVersion,
          observedAt,
          nativeProviders.size,
          modelSnapshot.data.items.length,
          JSON.stringify({
            providers: [...nativeProviders.values()],
            models: modelSnapshot.data.items,
          }),
        ],
      );
      const status = drift.length ? 'drifted' : 'converged';
      await client.query(
        `INSERT INTO core.model_reconciliations
           (id,framework_id,actor_kind,actor_id,request_id,correlation_id,
            provider_source_version,model_source_version,status,changes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          canonicalId('rec'),
          frameworkId,
          actor.kind,
          actor.id,
          requestId(context),
          correlationId(context),
          providerSnapshot.sourceVersion,
          modelSnapshot.sourceVersion,
          status,
          JSON.stringify(changes),
        ],
      );
      await client.query('COMMIT');
      return {
        status,
        changes,
        providerSourceVersion: providerSnapshot.sourceVersion,
        modelSourceVersion: modelSnapshot.sourceVersion,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setCredentialReference(
    providerId: string,
    credentialReference: string | null,
    expectedVersion: number,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'models.manage', undefined, context);
    if (credentialReference !== null && !/^secret:\/\/[A-Za-z0-9._/-]+$/.test(credentialReference))
      throw new NativeModelError(
        'credential_reference_invalid',
        'Credential reference is invalid',
        422,
      );
    const result = await this.pool.query<ProviderRow>(
      `UPDATE core.providers SET credential_reference=$2,credential_state=CASE
         WHEN $2::text IS NULL THEN 'missing' ELSE 'unknown' END,validated_at=NULL,safe_error_code=NULL
       WHERE id=$1 AND version=$3 RETURNING ${providerColumns()}`,
      [providerId, credentialReference, expectedVersion],
    );
    if (!result.rows[0]) await this.throwProviderConflict(providerId, actor, context);
    return providerFromRow(result.rows[0]!);
  }

  async validateProvider(
    providerId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'models.manage', undefined, context);
    const current = await this.getProvider(providerId, actor, context);
    const snapshot = await this.frameworks.listNativeProviders(current.frameworkId, actor, context);
    const observed = snapshot.data.items.find((item) => item.id === current.nativeReference);
    const outcome = !observed
      ? 'unavailable'
      : observed.credentialStatus === 'configured'
        ? 'valid'
        : observed.credentialStatus === 'missing'
          ? 'invalid'
          : 'unavailable';
    const code =
      outcome === 'valid'
        ? null
        : outcome === 'invalid'
          ? 'credential_missing'
          : 'provider_unavailable';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE core.providers SET credential_state=$2,observed_state=$3,validated_at=clock_timestamp(),
                 safe_error_code=$4,source_version=$5,last_observed_at=clock_timestamp()
         WHERE id=$1`,
        [
          providerId,
          outcome === 'valid' ? 'configured' : outcome === 'invalid' ? 'invalid' : 'unknown',
          outcome === 'valid' ? 'available' : outcome === 'invalid' ? 'invalid' : 'unavailable',
          code,
          snapshot.sourceVersion,
        ],
      );
      await client.query(
        `INSERT INTO core.provider_validation_evidence
           (id,provider_id,actor_kind,actor_id,request_id,correlation_id,source_version,outcome,safe_error_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          canonicalId('pvl'),
          providerId,
          actor.kind,
          actor.id,
          requestId(context),
          correlationId(context),
          snapshot.sourceVersion,
          outcome,
          code,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { outcome, safeErrorCode: code, sourceVersion: snapshot.sourceVersion };
  }

  async setRoutingPolicy(
    profileId: string,
    candidates: readonly RoutingCandidateInput[],
    expectedVersion: number,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'models.manage', undefined, context);
    if (!candidates.length || candidates.length > 100)
      throw new NativeModelError(
        'routing_candidates_invalid',
        'Routing policy requires 1 to 100 candidates',
        422,
      );
    if (new Set(candidates.map((item) => item.modelId)).size !== candidates.length)
      throw new NativeModelError(
        'routing_candidates_duplicate',
        'Routing models must be unique',
        422,
      );
    const normalized = candidates.map((candidate) => ({
      ...candidate,
      requiredCapabilities: validateRequiredCapabilities(candidate.requiredCapabilities ?? []),
    }));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await client.query<{ framework_id: string }>(
        'SELECT framework_id FROM core.profiles WHERE id=$1 FOR UPDATE',
        [profileId],
      );
      if (!profile.rows[0])
        throw new NativeModelError('profile_not_found', 'Profile was not found', 404);
      const current = await client.query<{ version: string | number }>(
        'SELECT version FROM core.model_routing_policies WHERE profile_id=$1 FOR UPDATE',
        [profileId],
      );
      const actualVersion = current.rows[0] ? Number(current.rows[0].version) : 0;
      if (actualVersion !== expectedVersion)
        throw new NativeModelError(
          'routing_version_conflict',
          'Routing policy changed; refresh and retry',
          409,
        );
      const validModels = await client.query<{ id: string }>(
        'SELECT id FROM core.models WHERE framework_id=$1 AND id=ANY($2::text[])',
        [profile.rows[0].framework_id, normalized.map((item) => item.modelId)],
      );
      if (validModels.rows.length !== normalized.length)
        throw new NativeModelError(
          'routing_model_invalid',
          'Routing model is not in the profile framework',
          422,
        );
      if (current.rows[0])
        await client.query(
          'UPDATE core.model_routing_policies SET updated_at=clock_timestamp() WHERE profile_id=$1',
          [profileId],
        );
      else
        await client.query('INSERT INTO core.model_routing_policies (profile_id) VALUES ($1)', [
          profileId,
        ]);
      await client.query('DELETE FROM core.model_routing_candidates WHERE profile_id=$1', [
        profileId,
      ]);
      for (const [priority, candidate] of normalized.entries())
        await client.query(
          `INSERT INTO core.model_routing_candidates
             (profile_id,priority,model_id,is_required,required_capabilities,enabled)
           VALUES ($1,$2,$3,$4,$5,true)`,
          [
            profileId,
            priority,
            candidate.modelId,
            candidate.required ?? false,
            candidate.requiredCapabilities,
          ],
        );
      const resulting = await client.query<{ version: string | number }>(
        'SELECT version FROM core.model_routing_policies WHERE profile_id=$1',
        [profileId],
      );
      const version = Number(resulting.rows[0]!.version);
      await client.query(
        `INSERT INTO core.model_policy_evidence
           (id,profile_id,actor_kind,actor_id,request_id,correlation_id,expected_version,resulting_version,candidates)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          canonicalId('mev'),
          profileId,
          actor.kind,
          actor.id,
          requestId(context),
          correlationId(context),
          expectedVersion,
          version,
          JSON.stringify(normalized),
        ],
      );
      await client.query('COMMIT');
      return { profileId, version, candidates: normalized };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async routingPolicy(profileId: string, actor: AuthenticatedPrincipal, context: RequestContext) {
    await this.authentication.authorize(actor, 'models.read', undefined, context);
    const [policy, candidates] = await Promise.all([
      this.pool.query<{ version: string | number }>(
        'SELECT version FROM core.model_routing_policies WHERE profile_id=$1',
        [profileId],
      ),
      this.pool.query<{
        priority: number;
        model_id: string;
        is_required: boolean;
        required_capabilities: string[];
        enabled: boolean;
      }>(
        `SELECT priority,model_id,is_required,required_capabilities,enabled
         FROM core.model_routing_candidates WHERE profile_id=$1 ORDER BY priority`,
        [profileId],
      ),
    ]);
    return {
      profileId,
      version: policy.rows[0] ? Number(policy.rows[0].version) : 0,
      candidates: candidates.rows.map((candidate) => ({
        priority: candidate.priority,
        modelId: candidate.model_id,
        required: candidate.is_required,
        requiredCapabilities: normalizeCapabilities(candidate.required_capabilities),
        enabled: candidate.enabled,
      })),
    };
  }

  async reconciliations(
    frameworkId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'models.read', undefined, context);
    const result = await this.pool.query<{
      id: string;
      provider_source_version: string;
      model_source_version: string;
      status: 'converged' | 'drifted' | 'failed';
      changes: unknown[];
      created_at: Date;
    }>(
      `SELECT id,provider_source_version,model_source_version,status,changes,created_at
       FROM core.model_reconciliations WHERE framework_id=$1 ORDER BY created_at DESC,id DESC`,
      [frameworkId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      frameworkId,
      providerSourceVersion: row.provider_source_version,
      modelSourceVersion: row.model_source_version,
      status: row.status,
      changes: row.changes,
      createdAt: row.created_at,
    }));
  }

  async resolve(
    profileId: string,
    required: readonly string[],
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<RouteResolution> {
    await this.authentication.authorize(actor, 'models.read', undefined, context);
    const requiredCapabilitySet = validateRequiredCapabilities(required);
    const result = await this.pool.query<
      ModelRow & {
        priority: number;
        is_required: boolean;
        credential_state: NativeProviderRecord['credentialState'];
        provider_state: NativeProviderRecord['observedState'];
        candidate_capabilities: string[];
      }
    >(
      `SELECT ${modelColumns('model')},candidate.priority,candidate.is_required,candidate.required_capabilities AS candidate_capabilities,
              provider.credential_state,provider.observed_state AS provider_state
       FROM core.model_routing_candidates candidate
       JOIN core.models model ON model.id=candidate.model_id
       JOIN core.providers provider ON provider.id=model.provider_id
       WHERE candidate.profile_id=$1 AND candidate.enabled ORDER BY candidate.priority`,
      [profileId],
    );
    const rejections: RouteResolution['rejections'] = [];
    for (const row of result.rows) {
      const reasons: string[] = [];
      if (row.desired_state !== 'enabled') reasons.push('model_disabled');
      if (row.observed_state !== 'available' || !row.selectable) reasons.push('model_unavailable');
      if (row.provider_state !== 'available') reasons.push('provider_unavailable');
      if (!['configured', 'not-required'].includes(row.credential_state))
        reasons.push('credential_unavailable');
      const capabilities = new Set(normalizeCapabilities(row.capabilities));
      const needed = normalizeCapabilities([
        ...requiredCapabilitySet,
        ...row.candidate_capabilities,
      ]);
      if (needed.some((capability) => !capabilities.has(capability)))
        reasons.push('capability_mismatch');
      if (!reasons.length) return { profileId, selected: modelFromRow(row), rejections };
      rejections.push({ modelId: row.id, reasons: [...new Set(reasons)] });
      if (row.is_required) break;
    }
    return { profileId, selected: null, rejections };
  }

  private async getProvider(
    providerId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'models.read', undefined, context);
    const result = await this.pool.query<ProviderRow>(`${providerSelect()} WHERE id=$1`, [
      providerId,
    ]);
    if (!result.rows[0])
      throw new NativeModelError('provider_not_found', 'Provider was not found', 404);
    return providerFromRow(result.rows[0]);
  }

  private async throwProviderConflict(
    providerId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<never> {
    await this.getProvider(providerId, actor, context);
    throw new NativeModelError(
      'provider_version_conflict',
      'Provider changed; refresh and retry',
      409,
    );
  }
}

async function upsertProvider(
  client: PoolClient,
  frameworkId: string,
  item: HermesProvider,
  sourceVersion: string,
  observedAt: Date,
) {
  const id = canonicalId('pvd');
  const observedState =
    item.credentialStatus === 'configured'
      ? 'available'
      : item.credentialStatus === 'missing'
        ? 'invalid'
        : 'unknown';
  const result = await client.query<ProviderRow>(
    `INSERT INTO core.providers
       (id,framework_id,provider_key,native_reference,display_name,authentication_method,
        credential_state,selected_default,source_version,last_observed_at,observed_state)
     VALUES ($1,$2,$3,$3,$4,'framework-managed',$5,$6,$7,$8,$9)
     ON CONFLICT (framework_id,provider_key) DO UPDATE SET
       native_reference=EXCLUDED.native_reference,display_name=EXCLUDED.display_name,
       credential_state=EXCLUDED.credential_state,selected_default=EXCLUDED.selected_default,
       source_version=EXCLUDED.source_version,last_observed_at=EXCLUDED.last_observed_at,
       observed_state=CASE WHEN core.providers.desired_state='disabled' THEN 'disabled' ELSE EXCLUDED.observed_state END
     RETURNING ${providerColumns()}`,
    [
      id,
      frameworkId,
      item.id,
      item.displayName,
      item.credentialStatus,
      item.selected,
      sourceVersion,
      observedAt,
      observedState,
    ],
  );
  return providerFromRow(result.rows[0]!);
}

async function upsertModel(
  client: PoolClient,
  frameworkId: string,
  provider: NativeProviderRecord,
  item: HermesModel,
  sourceVersion: string,
  observedAt: Date,
) {
  const capabilities = normalizeCapabilities(item.capabilities);
  const selectable =
    provider.desiredState === 'active' &&
    provider.observedState === 'available' &&
    ['configured', 'not-required'].includes(provider.credentialState);
  const result = await client.query<ModelRow>(
    `INSERT INTO core.models
       (id,framework_id,provider_id,model_key,display_name,capabilities,context_window,
        max_output_tokens,observed_state,inventory_revision,selected_default,selectable,source_version,observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'available',1,$9,$10,$11,$12)
     ON CONFLICT (provider_id,model_key) DO UPDATE SET
       display_name=EXCLUDED.display_name,capabilities=EXCLUDED.capabilities,
       context_window=EXCLUDED.context_window,max_output_tokens=EXCLUDED.max_output_tokens,
       observed_state=CASE WHEN core.models.desired_state='retired' THEN 'retired' ELSE 'available' END,
       inventory_revision=core.models.inventory_revision+1,selected_default=EXCLUDED.selected_default,
       selectable=EXCLUDED.selectable AND core.models.desired_state='enabled',
       source_version=EXCLUDED.source_version,observed_at=EXCLUDED.observed_at
     RETURNING ${modelColumns()}`,
    [
      canonicalId('mdl'),
      frameworkId,
      provider.id,
      item.id,
      item.displayName,
      capabilities,
      item.contextWindow ?? null,
      item.maximumOutputTokens ?? null,
      item.selected,
      selectable,
      sourceVersion,
      observedAt,
    ],
  );
  return modelFromRow(result.rows[0]!);
}

async function initializeRoutingDefaults(
  client: PoolClient,
  frameworkId: string,
  nativeModels: readonly HermesModel[],
  models: Map<string, NativeModelRecord>,
) {
  const ordered = [...nativeModels].sort(
    (left, right) =>
      Number(right.selected) - Number(left.selected) ||
      (left.fallbackPriority ?? 100) - (right.fallbackPriority ?? 100),
  );
  if (!ordered.length) return;
  const profiles = await client.query<{ id: string }>(
    `SELECT profile.id FROM core.profiles profile
     LEFT JOIN core.model_routing_policies policy ON policy.profile_id=profile.id
     WHERE profile.framework_id=$1 AND profile.desired_state<>'deleted' AND policy.profile_id IS NULL`,
    [frameworkId],
  );
  for (const profile of profiles.rows) {
    await client.query('INSERT INTO core.model_routing_policies (profile_id) VALUES ($1)', [
      profile.id,
    ]);
    for (const [priority, native] of ordered.entries()) {
      const model = models.get(`${native.providerId}/${native.id}`);
      if (model)
        await client.query(
          'INSERT INTO core.model_routing_candidates (profile_id,priority,model_id,is_required) VALUES ($1,$2,$3,false)',
          [profile.id, priority, model.id],
        );
    }
  }
}

async function routingDrift(client: PoolClient, frameworkId: string) {
  const result = await client.query<{ profile_id: string; model_id: string }>(
    `SELECT candidate.profile_id,candidate.model_id
     FROM core.model_routing_candidates candidate
     JOIN core.profiles profile ON profile.id=candidate.profile_id
     JOIN core.models model ON model.id=candidate.model_id
     JOIN core.providers provider ON provider.id=model.provider_id
     WHERE profile.framework_id=$1 AND candidate.enabled AND
       (model.desired_state<>'enabled' OR model.observed_state<>'available' OR NOT model.selectable OR
        provider.desired_state<>'active' OR provider.observed_state<>'available' OR
        provider.credential_state NOT IN ('configured','not-required'))`,
    [frameworkId],
  );
  return result.rows.map((row) => ({
    kind: 'route-drift',
    profileId: row.profile_id,
    modelId: row.model_id,
  }));
}

export function normalizeCapabilities(values: readonly string[]): ModelCapability[] {
  const aliases: Record<string, ModelCapability> = {
    text: 'text',
    chat: 'text',
    vision: 'vision',
    image: 'vision',
    'image-input': 'vision',
    multimodal: 'vision',
    audio: 'audio',
    tools: 'tool-use',
    'tool-use': 'tool-use',
    'function-calling': 'tool-use',
    json: 'structured-output',
    'structured-output': 'structured-output',
    reasoning: 'reasoning',
    thinking: 'reasoning',
  };
  return [
    ...new Set(
      values
        .map((value) => aliases[value.trim().toLowerCase()])
        .filter((value): value is ModelCapability => Boolean(value)),
    ),
  ].sort();
}

function validateRequiredCapabilities(values: readonly string[]): ModelCapability[] {
  const normalized = normalizeCapabilities(values);
  if (normalized.length !== values.length)
    throw new NativeModelError(
      'model_capability_invalid',
      'Required capabilities must be unique supported capability names',
      422,
    );
  return normalized;
}

function providerSelect() {
  return `SELECT ${providerColumns()} FROM core.providers`;
}
function providerColumns(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}id,${prefix}framework_id,${prefix}native_reference,${prefix}display_name,${prefix}authentication_method,${prefix}credential_reference,${prefix}credential_state,${prefix}desired_state,${prefix}observed_state,${prefix}selected_default,${prefix}source_version,${prefix}validated_at,${prefix}last_observed_at,${prefix}safe_error_code,${prefix}version`;
}
function modelSelect() {
  return `SELECT ${modelColumns()} FROM core.models`;
}
function modelColumns(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `${p}id,${p}framework_id,${p}provider_id,${p}model_key,${p}display_name,${p}aliases,${p}capabilities,${p}context_window,${p}max_output_tokens,${p}desired_state,${p}observed_state,${p}selected_default,${p}selectable,${p}source_version,${p}observed_at,${p}version`;
}
function providerFromRow(row: ProviderRow): NativeProviderRecord {
  return {
    id: row.id,
    frameworkId: row.framework_id,
    nativeReference: row.native_reference,
    name: row.display_name,
    authenticationMethod: row.authentication_method,
    credentialReference: row.credential_reference,
    credentialState: row.credential_state,
    desiredState: row.desired_state,
    observedState: row.observed_state,
    selectedDefault: row.selected_default,
    sourceVersion: row.source_version,
    lastValidatedAt: row.validated_at,
    lastObservedAt: row.last_observed_at,
    safeErrorCode: row.safe_error_code,
    version: Number(row.version),
  };
}
function modelFromRow(row: ModelRow): NativeModelRecord {
  return {
    id: row.id,
    frameworkId: row.framework_id,
    providerId: row.provider_id,
    nativeReference: row.model_key,
    name: row.display_name,
    aliases: row.aliases,
    capabilities: normalizeCapabilities(row.capabilities),
    contextWindow: row.context_window,
    maximumOutputTokens: row.max_output_tokens,
    desiredState: row.desired_state,
    observedState: row.observed_state,
    selectedDefault: row.selected_default,
    selectable: row.selectable,
    sourceVersion: row.source_version,
    observedAt: row.observed_at,
    version: Number(row.version),
  };
}
function canonicalId(prefix: string) {
  return `${prefix}_${ulid()}`;
}
const contextIds = new WeakMap<RequestContext, { requestId: string; correlationId: string }>();
function ids(context: RequestContext) {
  const existing = contextIds.get(context);
  if (existing) return existing;
  const value = {
    requestId:
      context.requestId && /^req_[0-9A-HJKMNP-TV-Z]{26}$/.test(context.requestId)
        ? context.requestId
        : canonicalId('req'),
    correlationId:
      context.correlationId && /^cor_[0-9A-HJKMNP-TV-Z]{26}$/.test(context.correlationId)
        ? context.correlationId
        : canonicalId('cor'),
  };
  contextIds.set(context, value);
  return value;
}
function requestId(context: RequestContext) {
  return ids(context).requestId;
}
function correlationId(context: RequestContext) {
  return ids(context).correlationId;
}
