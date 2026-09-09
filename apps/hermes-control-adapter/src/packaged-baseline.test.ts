import { describe, expect, it } from 'vitest';
import { verifyPackagedBaseline } from './packaged-baseline.js';
const sha = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4';
describe('offline immutable baseline', () => {
  it('accepts exact native marker without network version output', () =>
    expect(() =>
      verifyPackagedBaseline('Hermes Agent v0.20.0 (2026.8.3)', sha + '\n', '0.20.0', sha),
    ).not.toThrow());
  it.each(['', sha.slice(0, 8), '413ed6b9', 'f'.repeat(40)])('rejects wrong marker %s', (marker) =>
    expect(() => verifyPackagedBaseline('Hermes Agent v0.20.0', marker, '0.20.0', sha)).toThrow(),
  );
  it('rejects wrong release', () =>
    expect(() => verifyPackagedBaseline('Hermes Agent v0.19.0', sha, '0.20.0', sha)).toThrow());
  it('rejects malformed expected commit', () =>
    expect(() =>
      verifyPackagedBaseline('Hermes Agent v0.20.0', 'short', '0.20.0', 'short'),
    ).toThrow());
});
