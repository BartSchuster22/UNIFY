import { describe, it, expect, vi } from 'vitest';
import { startUpdateDiscovery } from './update-discovery.js';
describe('offline update discovery', () => {
  it('does not make an initial network request or install a timer when disabled', async () => {
    const refresh = vi.fn();
    expect(await startUpdateDiscovery('0', refresh)).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each(['-1', 'NaN', '59999'])('rejects invalid intervals %s', async (value) => {
    await expect(startUpdateDiscovery(value, vi.fn())).rejects.toThrow();
  });
  it('preserves online discovery', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const timer = await startUpdateDiscovery('60000', refresh);
    expect(refresh).toHaveBeenCalledOnce();
    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});
