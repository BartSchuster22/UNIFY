import { createHash, randomUUID } from 'node:crypto';
import type { EventEnvelope, UnifiedResource } from '@aquiero/contracts';
import { resourceHash } from './adapters.js';
import type {
  IntegrationOwner,
  IntegrationQuery,
  IntegrationReadResult,
  IntegrationSnapshot,
  ShadowComparison,
  SourceAdapter,
  UnifiedNotification,
} from './types.js';

export class IntegrationService {
  readonly #adapters: SourceAdapter[];
  readonly #cache = new Map<string, IntegrationSnapshot>();
  readonly #events: EventEnvelope[] = [];

  constructor(adapters: SourceAdapter[]) {
    this.#adapters = adapters;
  }

  async read(query: IntegrationQuery = {}, signal?: AbortSignal): Promise<IntegrationReadResult> {
    const selected = query.owner
      ? this.#adapters.filter((adapter) => adapter.owners.includes(query.owner!))
      : this.#adapters;
    const snapshots = await Promise.all(
      selected.map(async (adapter) => {
        const cached = this.#cache.get(adapter.id);
        if (cached && !query.refresh) return cached;
        return this.refresh(adapter, signal);
      }),
    );
    const resources = snapshots
      .flatMap((snapshot) => snapshot.resources)
      .filter((resource) => !query.owner || resource.resource.owner === query.owner)
      .filter((resource) => !query.kind || resource.resource.kind === query.kind)
      .sort((left, right) => left.resource.canonicalId.localeCompare(right.resource.canonicalId));
    return { resources, snapshots, events: [...this.#events] };
  }

  async search(query: string, filters: IntegrationQuery = {}, signal?: AbortSignal) {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const result = await this.read(filters, signal);
    const hits = result.resources
      .map((resource) => score(resource, normalized))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const memory = this.#adapters.find((adapter) => adapter.id === 'memory-v4-read-v1');
    if (memory?.search && (!filters.owner || filters.owner === 'memory-v4')) {
      try {
        for (const resource of await memory.search(query, signal)) {
          if (
            !hits.some((hit) => hit.resource.resource.canonicalId === resource.resource.canonicalId)
          ) {
            hits.push({ resource, score: 100, matchedFields: ['owner-search'] });
          }
        }
      } catch {
        // The cached cross-owner result remains truthful; source status is reported separately.
      }
    }
    return hits.sort(
      (left, right) =>
        right.score - left.score ||
        left.resource.resource.canonicalId.localeCompare(right.resource.resource.canonicalId),
    );
  }

  async notifications(signal?: AbortSignal): Promise<UnifiedNotification[]> {
    const { resources, snapshots } = await this.read({}, signal);
    const notifications: UnifiedNotification[] = resources
      .filter((resource) => resource.resource.kind === 'notification')
      .map((resource) => ({
        id: resource.resource.canonicalId,
        severity: severity(resource.data.severity),
        title: string(resource.data.title) || resource.title,
        body:
          string(resource.data.body ?? resource.data.message) ||
          'Notification from authoritative owner',
        source: resource.resource.owner,
        state: state(resource.data.state ?? resource.data.status),
        createdAt: date(resource.data.createdAt ?? resource.data.created_at) ?? resource.fetchedAt,
        resource: resource.resource,
      }));
    for (const snapshot of snapshots) {
      for (const warning of snapshot.warnings) {
        notifications.push({
          id: digest(`${snapshot.adapterId}:${warning.code}:${warning.message}`),
          severity: snapshot.status === 'unavailable' ? 'error' : 'warning',
          title: `${snapshot.adapterId} ${snapshot.status}`,
          body: warning.message,
          source: snapshot.owners[0]!,
          state: 'unread',
          createdAt: snapshot.observedAt,
        });
      }
    }
    return notifications.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  events(): EventEnvelope[] {
    return [...this.#events].sort((left, right) =>
      right.receivedTime.localeCompare(left.receivedTime),
    );
  }

  statuses() {
    return this.#adapters.map((adapter) => {
      const snapshot = this.#cache.get(adapter.id);
      return {
        adapterId: adapter.id,
        owners: adapter.owners,
        sourceRole: adapter.sourceRole,
        writeEnabled: adapter.writeEnabled,
        status: snapshot?.status ?? 'unavailable',
        ...(snapshot ? { observedAt: snapshot.observedAt } : {}),
        resourceCount: snapshot?.resources.length ?? 0,
        warnings: snapshot?.warnings ?? [
          { code: 'NOT_OBSERVED', message: 'Integration has not been read yet' },
        ],
      };
    });
  }

  async shadow(owner?: IntegrationOwner, signal?: AbortSignal): Promise<ShadowComparison[]> {
    const selected = owner
      ? this.#adapters.filter((adapter) => adapter.owners.includes(owner))
      : this.#adapters;
    const comparisons: ShadowComparison[] = [];
    for (const adapter of selected) {
      let expected = this.#cache.get(adapter.id);
      if (!expected) expected = await this.refresh(adapter, signal);
      let actual: IntegrationSnapshot;
      try {
        actual = await adapter.snapshot(signal);
      } catch {
        actual = {
          adapterId: adapter.id,
          owners: adapter.owners,
          sourceRole: adapter.sourceRole,
          writeEnabled: adapter.writeEnabled,
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          resources: [],
          warnings: [],
        };
      }
      for (const currentOwner of adapter.owners) {
        const comparison = compare(adapter.id, currentOwner, expected, actual);
        comparisons.push(comparison);
        if (comparison.status !== 'match')
          this.pushEvent(currentOwner, 'shadow.comparison.mismatch', { comparison });
      }
    }
    return comparisons;
  }

  private async refresh(
    adapter: SourceAdapter,
    signal?: AbortSignal,
  ): Promise<IntegrationSnapshot> {
    let snapshot: IntegrationSnapshot;
    try {
      snapshot = await adapter.snapshot(signal);
    } catch (error) {
      snapshot = {
        adapterId: adapter.id,
        owners: adapter.owners,
        sourceRole: adapter.sourceRole,
        writeEnabled: adapter.writeEnabled,
        status: 'failed',
        observedAt: new Date().toISOString(),
        resources: [],
        warnings: [
          {
            code: 'ADAPTER_FAILED',
            message: error instanceof Error ? error.message.slice(0, 500) : 'Adapter failed',
          },
        ],
      };
    }
    this.#cache.set(adapter.id, snapshot);
    this.pushEvent(
      snapshot.owners[0]!,
      'source.snapshot.observed',
      {
        adapterId: adapter.id,
        status: snapshot.status,
        resourceCount: snapshot.resources.length,
        warningCount: snapshot.warnings.length,
      },
      snapshot.observedAt,
    );
    return snapshot;
  }

  private pushEvent(
    owner: IntegrationOwner,
    type: string,
    payload: Record<string, unknown>,
    at = new Date().toISOString(),
  ) {
    this.#events.push({
      eventId: randomUUID(),
      sequence: `${Date.now()}-${this.#events.length + 1}`,
      type,
      classification: 'durable',
      source: { owner },
      eventTime: at,
      receivedTime: new Date().toISOString(),
      payload,
      schemaVersion: '1.0',
    });
    if (this.#events.length > 500) this.#events.splice(0, this.#events.length - 500);
  }
}

function compare(
  adapterId: string,
  owner: IntegrationOwner,
  expected: IntegrationSnapshot,
  actual: IntegrationSnapshot,
): ShadowComparison {
  const comparedAt = new Date().toISOString();
  const left = map(expected.resources.filter((item) => item.resource.owner === owner));
  const right = map(actual.resources.filter((item) => item.resource.owner === owner));
  const missing = [...left.keys()].filter((key) => !right.has(key)).sort();
  const unexpected = [...right.keys()].filter((key) => !left.has(key)).sort();
  const changed = [...left.keys()]
    .filter((key) => right.has(key) && right.get(key) !== left.get(key))
    .sort();
  const unavailable = actual.status === 'unavailable' || actual.status === 'failed';
  const status: ShadowComparison['status'] = unavailable
    ? 'unavailable'
    : missing.length || unexpected.length || changed.length
      ? 'mismatch'
      : 'match';
  const evidence = {
    adapterId,
    owner,
    status,
    expectedCount: left.size,
    actualCount: right.size,
    missing,
    unexpected,
    changed,
  };
  return { ...evidence, comparedAt, evidenceHash: digest(JSON.stringify(evidence)) };
}
function map(resources: UnifiedResource[]): Map<string, string> {
  return new Map(
    resources.map((resource) => [resource.resource.canonicalId, resourceHash(resource)]),
  );
}
function score(resource: UnifiedResource, query: string) {
  const fields: string[] = [];
  let value = 0;
  if (resource.title.toLocaleLowerCase().includes(query)) {
    fields.push('title');
    value += 20;
  }
  if (resource.resource.nativeId.toLocaleLowerCase().includes(query)) {
    fields.push('nativeId');
    value += 10;
  }
  if (resource.searchableText.toLocaleLowerCase().includes(query)) {
    fields.push('data');
    value += 5;
  }
  return value ? { resource, score: value, matchedFields: fields } : null;
}
function severity(value: unknown): UnifiedNotification['severity'] {
  return value === 'critical' || value === 'error' || value === 'warning' ? value : 'info';
}
function state(value: unknown): UnifiedNotification['state'] {
  return value === 'read' || value === 'acknowledged' ? value : 'unread';
}
function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function date(value: unknown): string | undefined {
  const text = string(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : undefined;
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
