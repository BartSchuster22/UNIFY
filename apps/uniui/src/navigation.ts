export const VIEW_IDS = [
  'overview',
  'frameworks',
  'framework-updates',
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
const VIEW_PATHS: Record<ViewId, string> = Object.fromEntries(
  VIEW_IDS.map((view) => [view, view === 'overview' ? '/' : `/${view}`]),
) as Record<ViewId, string>;
VIEW_PATHS['framework-updates'] = '/frameworks/updates';
const PATH_VIEWS = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as ViewId]),
);

export function viewFromLocation(location: Location = window.location): ViewId {
  const normalizedPath = location.pathname === '/' ? '/' : location.pathname.replace(/\/+$/g, '');
  const pathView = PATH_VIEWS.get(normalizedPath);
  if (normalizedPath !== '/' && pathView) return pathView;
  const legacyView = new URLSearchParams(location.search).get('view');
  if (legacyView && VIEW_SET.has(legacyView)) return legacyView as ViewId;
  return pathView ?? 'overview';
}

export function viewHref(view: ViewId, source = window.location.href): string {
  const url = new URL(source);
  url.pathname = VIEW_PATHS[view];
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
