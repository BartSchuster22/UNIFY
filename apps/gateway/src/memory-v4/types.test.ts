import { describe, expect, it } from 'vitest';
import { memoryRoute } from './types.js';
describe('scoped application erasure route', () => {
  it('allows only exact POST with admin permission and body scope enforcement', () => {
    expect(memoryRoute('POST', '/applications/knowledge/scrub')).toEqual({
      permission: 'memory.admin', mutation: true, injectQueryScope: false, injectBodyScope: true,
    });
    for (const method of ['GET', 'DELETE', 'PATCH'])
      expect(memoryRoute(method, '/applications/knowledge/scrub')).toBeNull();
    for (const path of ['/applications/knowledge/scrub/all', '/applications/knowledge/scrub/',
      '/applications/../knowledge/scrub', '/applications/knowledge/delete'])
      expect(memoryRoute('POST', path)).toBeNull();
  });
});
