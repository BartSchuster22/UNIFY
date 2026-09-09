export async function startUpdateDiscovery(
  configured: string | undefined,
  refresh: () => Promise<unknown>,
) {
  const interval = Number(configured ?? 6 * 60 * 60 * 1000);
  if (!Number.isFinite(interval) || (interval !== 0 && interval < 60000)) {
    throw new Error('HERMES_UPDATE_DISCOVERY_INTERVAL_MS must be 0 (offline) or at least 60000');
  }
  if (interval === 0) return undefined;
  await refresh();
  const timer = setInterval(() => void refresh(), interval);
  timer.unref();
  return timer;
}
