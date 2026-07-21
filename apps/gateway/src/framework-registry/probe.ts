import { Value } from '@sinclair/typebox/value';
import {
  HermesCapabilitiesResponseSchema,
  HermesIdentityResponseSchema,
  HermesVersionResponseSchema,
} from '@aquiero/contracts';
import type { FrameworkProbe, FrameworkProbeResult } from './types.js';

export class HttpFrameworkProbe implements FrameworkProbe {
  constructor(private readonly timeoutMs = 5_000) {}

  async inspect(baseUrl: string, bearerToken: string): Promise<FrameworkProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { authorization: `Bearer ${bearerToken}`, accept: 'application/json' };
      const [identity, version, capabilities] = await Promise.all([
        this.get(`${baseUrl}/control/v1/identity`, headers, controller.signal),
        this.get(`${baseUrl}/control/v1/version`, headers, controller.signal),
        this.get(`${baseUrl}/control/v1/capabilities`, headers, controller.signal),
      ]);
      if (!Value.Check(HermesIdentityResponseSchema, identity))
        throw new Error('invalid identity contract');
      if (!Value.Check(HermesVersionResponseSchema, version))
        throw new Error('invalid version contract');
      if (!Value.Check(HermesCapabilitiesResponseSchema, capabilities))
        throw new Error('invalid capabilities contract');
      return { identity, version, capabilities } as FrameworkProbeResult;
    } finally {
      clearTimeout(timer);
    }
  }

  private async get(url: string, headers: Record<string, string>, signal: AbortSignal) {
    const response = await fetch(url, { headers, signal, redirect: 'error' });
    if (!response.ok) throw new Error(`probe returned HTTP ${response.status}`);
    return response.json();
  }
}
