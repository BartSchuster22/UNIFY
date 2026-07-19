import type { EventEnvelope, ResourceRef, UnifiedResource } from '@aquiero/contracts';

export type IntegrationOwner = ResourceRef['owner'];
export type IntegrationKind = ResourceRef['kind'];

export interface IntegrationWarning {
  code: string;
  message: string;
}

export interface IntegrationSnapshot {
  adapterId: string;
  owners: IntegrationOwner[];
  status: 'current' | 'partial' | 'empty' | 'unavailable' | 'failed';
  observedAt: string;
  resources: UnifiedResource[];
  warnings: IntegrationWarning[];
}

export interface SourceAdapter {
  readonly id: string;
  readonly owners: IntegrationOwner[];
  snapshot(signal?: AbortSignal): Promise<IntegrationSnapshot>;
  search?(query: string, signal?: AbortSignal): Promise<UnifiedResource[]>;
}

export interface UnifiedNotification {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  source: IntegrationOwner;
  state: 'unread' | 'read' | 'acknowledged';
  createdAt: string;
  resource?: ResourceRef;
}

export interface ShadowComparison {
  adapterId: string;
  owner: IntegrationOwner;
  status: 'match' | 'mismatch' | 'unavailable';
  comparedAt: string;
  expectedCount: number;
  actualCount: number;
  missing: string[];
  unexpected: string[];
  changed: string[];
  evidenceHash: string;
}

export interface IntegrationQuery {
  owner?: IntegrationOwner;
  kind?: IntegrationKind;
  refresh?: boolean;
}

export interface IntegrationReadResult {
  resources: UnifiedResource[];
  snapshots: IntegrationSnapshot[];
  events: EventEnvelope[];
}
