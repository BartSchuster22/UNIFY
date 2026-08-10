import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeCurrentView, viewFromLocation, viewHref } from './navigation';

beforeEach(() => window.history.replaceState(null, '', '/'));

describe('dedicated UNIUI navigation URLs', () => {
  it('reads legacy query links and canonicalizes them to dedicated paths', () => {
    window.history.replaceState(
      null,
      '',
      '/?view=profiles&framework=hermes-herman&workPage=settings&project=stale',
    );
    expect(viewFromLocation()).toBe('profiles');
    canonicalizeCurrentView('profiles');
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/profiles?framework=hermes-herman',
    );
  });

  it('creates clean, copyable links while retaining the selected framework', () => {
    window.history.replaceState(
      null,
      '',
      '/work?framework=hermes-alica&workPage=board&project=alpha',
    );
    expect(viewHref('models')).toBe('/models?framework=hermes-alica');
    expect(viewHref('work')).toBe('/work?framework=hermes-alica&workPage=board&project=alpha');
  });

  it('uses the pathname before the legacy view query', () => {
    window.history.replaceState(null, '', '/chat?view=models&framework=hermes-herman');
    expect(viewFromLocation()).toBe('chat');
  });
});
