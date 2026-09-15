import { describe, it, expect } from 'vitest';
import { dateString, HermesNativeSource } from './source.js';
describe('native timestamps', () => {
  it('converts Unix seconds, milliseconds and ISO without inventing absent dates', () => {
    expect(dateString(1789484720.8328204)).toBe('2026-09-15T15:05:20.832Z');
    expect(dateString(1789484720832)).toBe('2026-09-15T15:05:20.832Z');
    expect(dateString('2026-09-15T15:05:20.832Z')).toBe('2026-09-15T15:05:20.832Z');
    for (const value of [null, undefined, '', NaN, Infinity, {}, 'not a date'])
      expect(dateString(value)).toBeUndefined();
  });
  it('maps real Hermes field names for existing sessions/messages', async () => {
    const source = new HermesNativeSource({
      runner: {
        async run(args: string[]) {
          if (args.join(' ') === 'profile list') return '';
          throw Error('CLI not allowed');
        },
      },
      apiBaseUrl: 'http://127.0.0.1:8765',
      fetchImpl: async (input) => {
        const url = String(input);
        const session = { id: 's1', source: 'api_server', started_at: 1789484720.8328204 };
        return new Response(
          JSON.stringify(
            url.endsWith('/messages')
              ? { data: [{ id: 'm1', role: 'user', timestamp: 1789484720.8328204, content: 'hi' }] }
              : url.endsWith('/s1')
                ? session
                : { data: [session] },
          ),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    });
    expect((await source.sessions()).items[0]?.createdAt).toBe('2026-09-15T15:05:20.832Z');
    expect((await source.messages('s1')).items[0]?.createdAt).toBe('2026-09-15T15:05:20.832Z');
  });
});
