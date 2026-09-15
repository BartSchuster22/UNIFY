import { beforeEach, describe, expect, it, vi } from 'vitest';
import { followInternalLink, NAVIGATION_EVENT } from './internalNavigation';
beforeEach(() => {
  window.history.replaceState({}, '', '/?framework=a');
  document.body.innerHTML = '';
});
function click(href: string, extra = {}, attrs = {}) {
  const anchor = document.createElement('a');
  anchor.href = href;
  Object.entries(attrs).forEach(([k, v]) => anchor.setAttribute(k, String(v)));
  const child = document.createElement('span');
  anchor.append(child);
  document.body.append(anchor);
  const event = {
    target: child,
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...extra,
  };
  return { handled: followInternalLink(event), event };
}
describe('shared internal navigation', () => {
  it('routes nested link content, keeps query parameters and emits one notification', () => {
    const changed = vi.fn();
    window.addEventListener(NAVIGATION_EVENT, changed);
    const { handled, event } = click('/work?framework=b&workPage=board&project=p');
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.location.pathname + window.location.search).toBe(
      '/work?framework=b&workPage=board&project=p',
    );
    expect(changed).toHaveBeenCalledOnce();
    click('/work?framework=b&workPage=board&project=p');
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener(NAVIGATION_EVENT, changed);
  });
  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { defaultPrevented: true },
  ])('preserves native modified clicks %o', (extra) => {
    const result = click('/settings', extra);
    expect(result.handled).toBe(false);
    expect(result.event.preventDefault).not.toHaveBeenCalled();
  });
  it.each([
    ['/settings', { target: '_blank' }],
    ['/settings', { download: '' }],
    ['/settings', { 'data-native-navigation': '' }],
    ['#main-content', {}],
    ['https://example.com/settings', {}],
    ['/api/v1/auth/oidc/login', {}],
    ['/not-an-app-route', {}],
  ])('leaves native links alone: %s', (href, attrs) => {
    expect(click(href as string, {}, attrs).handled).toBe(false);
  });
});
