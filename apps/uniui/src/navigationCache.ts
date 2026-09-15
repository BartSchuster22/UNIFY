// Presentation-only snapshots: short-lived, bounded, never an authorization cache.
const entries = new Map<string, { value: unknown; expires: number }>();
let epoch = 0;
export const navigationCacheEpoch = () => epoch;
export function clearNavigationCache() {
  entries.clear();
  epoch++;
}
export function readNavigationCache<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry || entry.expires <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}
export function writeNavigationCache(key: string, value: unknown, startedEpoch: number) {
  if (startedEpoch !== epoch) return;
  entries.delete(key);
  entries.set(key, { value, expires: Date.now() + 15_000 });
  while (entries.size > 12) entries.delete(entries.keys().next().value!);
}
