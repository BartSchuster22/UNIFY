import type { FrameworkRegistrationInput } from './types.js';

export interface AlicaHermanGatewayConfiguration {
  readonly alica: FrameworkRegistrationInput;
  readonly herman: FrameworkRegistrationInput;
  readonly secretRoot: string;
  readonly credentialCacheTtlMs: number;
}

export type FrameworkGatewayEnvironment = Readonly<Record<string, string | undefined>>;

const REQUIRED_SUFFIXES = [
  'FRAMEWORK_ID',
  'ENDPOINT',
  'CREDENTIAL_REFERENCE',
  'NATIVE_FRAMEWORK_ID',
  'INSTANCE_ID',
  'RELEASE',
  'COMMIT',
] as const;

export function frameworkGatewayConfigFromEnvironment(
  environment: FrameworkGatewayEnvironment = process.env,
): AlicaHermanGatewayConfiguration | undefined {
  const configured = [...keysFor('ALICA'), ...keysFor('HERMAN')].filter(
    (key) => environment[key] !== undefined,
  );
  if (configured.length === 0) return undefined;
  const missing = [...keysFor('ALICA'), ...keysFor('HERMAN')].filter(
    (key) => !environment[key]?.trim(),
  );
  if (missing.length > 0)
    throw new Error(`Incomplete framework gateway configuration: ${missing.join(', ')}`);
  const secretRoot = environment.CORE_FRAMEWORK_GATEWAY_SECRET_ROOT;
  if (!secretRoot?.startsWith('/'))
    throw new Error('CORE_FRAMEWORK_GATEWAY_SECRET_ROOT must be an absolute path');
  return Object.freeze({
    alica: frameworkInput(environment, 'ALICA', 'Alica'),
    herman: frameworkInput(environment, 'HERMAN', 'Herman'),
    secretRoot,
    credentialCacheTtlMs: integer(
      environment.CORE_FRAMEWORK_GATEWAY_CREDENTIAL_CACHE_TTL_MS,
      5_000,
      0,
      60_000,
      'CORE_FRAMEWORK_GATEWAY_CREDENTIAL_CACHE_TTL_MS',
    ),
  });
}

function frameworkInput(
  environment: FrameworkGatewayEnvironment,
  prefix: 'ALICA' | 'HERMAN',
  name: 'Alica' | 'Herman',
): FrameworkRegistrationInput {
  const key = (suffix: (typeof REQUIRED_SUFFIXES)[number]): string => `CORE_${prefix}_${suffix}`;
  return Object.freeze({
    id: environment[key('FRAMEWORK_ID')]!,
    name,
    endpoint: environment[key('ENDPOINT')]!,
    credentialReference: environment[key('CREDENTIAL_REFERENCE')]!,
    expectedNativeFrameworkId: environment[key('NATIVE_FRAMEWORK_ID')]!,
    expectedInstanceId: environment[key('INSTANCE_ID')]!,
    expectedRelease: environment[key('RELEASE')]!,
    expectedCommit: environment[key('COMMIT')]!,
    policy: Object.freeze({
      requestTimeoutMs: integer(
        environment[`CORE_${prefix}_REQUEST_TIMEOUT_MS`],
        5_000,
        100,
        60_000,
        `CORE_${prefix}_REQUEST_TIMEOUT_MS`,
      ),
      retryLimit: integer(
        environment[`CORE_${prefix}_RETRY_LIMIT`],
        2,
        0,
        5,
        `CORE_${prefix}_RETRY_LIMIT`,
      ),
      retryBaseDelayMs: integer(
        environment[`CORE_${prefix}_RETRY_BASE_DELAY_MS`],
        100,
        10,
        5_000,
        `CORE_${prefix}_RETRY_BASE_DELAY_MS`,
      ),
      maximumResponseBytes: integer(
        environment[`CORE_${prefix}_MAXIMUM_RESPONSE_BYTES`],
        2 * 1024 * 1024,
        1_024,
        16_777_216,
        `CORE_${prefix}_MAXIMUM_RESPONSE_BYTES`,
      ),
      circuitFailureThreshold: integer(
        environment[`CORE_${prefix}_CIRCUIT_FAILURE_THRESHOLD`],
        3,
        1,
        20,
        `CORE_${prefix}_CIRCUIT_FAILURE_THRESHOLD`,
      ),
      circuitOpenMs: integer(
        environment[`CORE_${prefix}_CIRCUIT_OPEN_MS`],
        30_000,
        1_000,
        3_600_000,
        `CORE_${prefix}_CIRCUIT_OPEN_MS`,
      ),
    }),
  });
}

function keysFor(prefix: 'ALICA' | 'HERMAN'): readonly string[] {
  return REQUIRED_SUFFIXES.map((suffix) => `CORE_${prefix}_${suffix}`);
}

function integer(
  supplied: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (supplied === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(supplied)) throw new Error(`${name} must be an integer`);
  const value = Number(supplied);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} is outside its supported range`);
  return value;
}
