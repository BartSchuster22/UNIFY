import { isPlainPrimaryClick, isViewPath } from './navigation';
export const NAVIGATION_EVENT = 'unify:navigation';
/** One delegated handler for all application links, including portalled menus. */
export function followInternalLink(event: {
  target: EventTarget | null;
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
}): boolean {
  if (!isPlainPrimaryClick(event) || !(event.target instanceof Element)) return false;
  const anchor = event.target.closest('a[href]');
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.hasAttribute('download') ||
    (anchor.target && anchor.target !== '_self') ||
    anchor.hasAttribute('data-native-navigation')
  )
    return false;
  const raw = anchor.getAttribute('href')!;
  if (raw.startsWith('#')) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || !isViewPath(url.pathname)) return false;
  event.preventDefault();
  const href = url.pathname + url.search + url.hash;
  if (href !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.pushState({}, '', href);
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
  }
  return true;
}
