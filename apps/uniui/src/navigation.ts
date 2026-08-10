export const VIEW_IDS = [
  'overview',
  'frameworks',
  'models',
  'profiles',
  'work',
  'chat',
  'memory',
  'audit',
  'operations',
  'mutations',
  'notifications',
  'settings',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

const VIEW_SET = new Set<string>(VIEW_IDS);

export function viewFromLocation(location: Location = window.location): ViewId {
  const pathView = location.pathname.replace(/^\/+|\/+$/g, '');
  if (pathView && VIEW_SET.has(pathView)) return pathView as ViewId;
  const legacyView = new URLSearchParams(location.search).get('view');
  return legacyView && VIEW_SET.has(legacyView) ? (legacyView as ViewId) : 'overview';
}

export function viewHref(view: ViewId, source = window.location.href): string {
  const url = new URL(source);
  url.pathname = view === 'overview' ? '/' : `/${view}`;
  url.searchParams.delete('view');
  if (view !== 'work') {
    url.searchParams.delete('workPage');
    url.searchParams.delete('project');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function canonicalizeCurrentView(view: ViewId): void {
  const href = viewHref(view);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href !== current) window.history.replaceState(window.history.state, '', href);
}

export function pushView(view: ViewId): void {
  const href = viewHref(view);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href !== current) window.history.pushState({ view }, '', href);
}

export function isPlainPrimaryClick(event: {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
