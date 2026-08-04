import type { Pool } from 'pg';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import {
  frameworkGatewayConfigFromEnvironment,
  type AlicaHermanGatewayConfiguration,
  type FrameworkGatewayEnvironment,
} from './config.js';
import { FileGatewayCredentialProvider } from './credentials.js';
import { DnsPrivateEndpointGuard } from './private-network.js';
import { FrameworkGatewayService } from './service.js';
import type { FrameworkGatewayRegistration } from './types.js';

export interface FrameworkGatewayRuntimeOptions {
  readonly pool: Pool;
  readonly authentication: AuthenticationService;
  readonly environment?: FrameworkGatewayEnvironment;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

export class FrameworkGatewayRuntime {
  readonly service: FrameworkGatewayService;

  constructor(
    readonly configuration: AlicaHermanGatewayConfiguration,
    options: Omit<FrameworkGatewayRuntimeOptions, 'environment'>,
  ) {
    const credentials = options.now
      ? new FileGatewayCredentialProvider(
          configuration.secretRoot,
          configuration.credentialCacheTtlMs,
          options.now,
        )
      : new FileGatewayCredentialProvider(
          configuration.secretRoot,
          configuration.credentialCacheTtlMs,
        );
    this.service = new FrameworkGatewayService({
      pool: options.pool,
      authentication: options.authentication,
      credentials,
      endpointGuard: new DnsPrivateEndpointGuard(),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  async ensureRegistered(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<readonly [FrameworkGatewayRegistration, FrameworkGatewayRegistration]> {
    return this.service.ensureAlicaAndHermanRegistered(
      this.configuration.alica,
      this.configuration.herman,
      actor,
      context,
    );
  }
}

export function frameworkGatewayRuntimeFromEnvironment(
  options: FrameworkGatewayRuntimeOptions,
): FrameworkGatewayRuntime | undefined {
  const configuration = frameworkGatewayConfigFromEnvironment(options.environment);
  if (!configuration) return undefined;
  return new FrameworkGatewayRuntime(configuration, options);
}
