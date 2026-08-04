import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { FrameworkGatewayError, type PrivateEndpointGuard } from './types.js';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type AddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const defaultResolver: AddressResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export class DnsPrivateEndpointGuard implements PrivateEndpointGuard {
  constructor(private readonly resolve: AddressResolver = defaultResolver) {}

  async assertPrivate(endpoint: URL): Promise<void> {
    if (endpoint.protocol !== 'https:')
      throw new FrameworkGatewayError(
        'framework_endpoint_scheme',
        'Framework endpoint must use HTTPS',
        false,
        422,
      );
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new FrameworkGatewayError(
        'framework_endpoint_invalid',
        'Framework endpoint must not contain credentials, query parameters, or fragments',
        false,
        422,
      );
    if (endpoint.pathname !== '/' && endpoint.pathname !== '')
      throw new FrameworkGatewayError(
        'framework_endpoint_path',
        'Framework endpoint must be an origin without a path',
        false,
        422,
      );

    const hostname =
      endpoint.hostname.startsWith('[') && endpoint.hostname.endsWith(']')
        ? endpoint.hostname.slice(1, -1)
        : endpoint.hostname;
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await this.resolve(hostname).catch(() => []);
    if (addresses.length === 0 || addresses.some(({ address }) => !isPrivateAddress(address))) {
      throw new FrameworkGatewayError(
        'framework_endpoint_not_private',
        'Framework endpoint must resolve exclusively to private network addresses',
        false,
        422,
      );
    }
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0]!;
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [first, second] = octets;
    return Boolean(
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second !== undefined && second >= 64 && second <= 127),
    );
  }
  if (isIP(normalized) !== 6) return false;
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/u.test(normalized)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  return mapped ? isPrivateAddress(mapped) : false;
}

export function normalizedPrivateOrigin(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new FrameworkGatewayError(
      'framework_endpoint_invalid',
      'Framework endpoint is invalid',
      false,
      422,
    );
  }
  endpoint.pathname = endpoint.pathname || '/';
  return endpoint;
}
