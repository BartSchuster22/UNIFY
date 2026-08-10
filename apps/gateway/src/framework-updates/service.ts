import type {
  DeploymentMetadataInput,
  FrameworkUpdateStore,
  TrustedReleaseClient,
  UpdateRelation,
} from './types.js';

export interface FrameworkUpdateVisibilityOptions {
  sourceId: string;
  repository: string;
  deployments: readonly DeploymentMetadataInput[];
  store: FrameworkUpdateStore;
  client: TrustedReleaseClient;
}

export class FrameworkUpdateVisibilityService {
  #refreshing: Promise<void> | undefined;

  constructor(private readonly options: FrameworkUpdateVisibilityOptions) {}

  async ready(): Promise<boolean> {
    return this.options.store.ready();
  }

  async reconcileDeployments(): Promise<void> {
    await this.options.store.reconcileDeployments(this.options.deployments);
  }

  refresh(): Promise<void> {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#discover().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #discover(): Promise<void> {
    await this.reconcileDeployments();
    try {
      const release = await this.options.client.latestStableRelease();
      const current = await this.options.store.snapshot();
      const comparisons = await Promise.all(
        current.frameworks
          .filter(
            (
              framework,
            ): framework is typeof framework & {
              deployment: NonNullable<typeof framework.deployment>;
            } => Boolean(framework.deployment),
          )
          .map(async (framework) => {
            const compared = await this.options.client.compare(
              framework.deployment.frameworkCommit,
              release.tagName,
            );
            return {
              frameworkId: framework.frameworkId,
              relation: relation(compared.status),
              githubStatus: compared.status,
              aheadBy: compared.aheadBy,
              behindBy: compared.behindBy,
            };
          }),
      );
      await this.options.store.recordDiscoverySuccess(
        this.options.sourceId,
        this.options.repository,
        release,
        comparisons,
      );
    } catch (error) {
      await this.options.store.recordDiscoveryFailure(
        this.options.sourceId,
        this.options.repository,
        safeDiscoveryError(error),
      );
    }
  }

  async snapshot() {
    await this.reconcileDeployments();
    let snapshot = await this.options.store.snapshot();
    if (
      snapshot.candidate &&
      snapshot.frameworks.some((framework) => framework.deployment && !framework.comparison)
    ) {
      await this.refresh();
      snapshot = await this.options.store.snapshot();
    }
    return {
      mode: 'read-only' as const,
      source: snapshot.source,
      latestCandidate: snapshot.candidate,
      frameworks: snapshot.frameworks.map((framework) => ({
        frameworkId: framework.frameworkId,
        displayName: framework.displayName,
        currentDeployment: framework.deployment,
        comparison: framework.comparison,
        compatibility: compatibility(framework.comparison?.relation),
      })),
    };
  }
}

function relation(
  status: 'identical' | 'behind' | 'ahead' | 'diverged' | 'unknown',
): UpdateRelation {
  if (status === 'identical') return 'current';
  if (status === 'ahead') return 'update_available';
  if (status === 'behind') return 'installed_ahead';
  return status;
}

function compatibility(relationValue: UpdateRelation | undefined) {
  if (relationValue === 'current')
    return {
      status: 'current' as const,
      reason: 'The deployed commit matches the latest trusted stable release.',
    };
  if (relationValue === 'update_available' || relationValue === 'diverged')
    return {
      status: 'not_assessed' as const,
      reason:
        'Compatibility has not been assessed. Phase 1 discovers releases but does not build, test, approve, or deploy them.',
    };
  if (relationValue === 'installed_ahead')
    return {
      status: 'installed_ahead' as const,
      reason: 'The deployed commit is ahead of the latest trusted stable release.',
    };
  return {
    status: 'unavailable' as const,
    reason: 'No trustworthy commit comparison is currently available.',
  };
}

function safeDiscoveryError(error: unknown): string {
  if (!(error instanceof Error)) return 'Trusted upstream release discovery failed';
  const allowedPrefixes = [
    'Trusted upstream',
    'Invalid installed commit',
    'Invalid trusted GitHub repository',
  ];
  return allowedPrefixes.some((prefix) => error.message.startsWith(prefix))
    ? error.message.slice(0, 500)
    : 'Trusted upstream release discovery failed';
}
