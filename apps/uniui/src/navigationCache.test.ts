import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  clearNavigationCache,
  navigationCacheEpoch,
  readNavigationCache,
  writeNavigationCache,
} from './navigationCache';
import { api } from './api';
beforeEach(() => {
  clearNavigationCache();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('expires snapshots and separates account/framework keys', () => {
  writeNavigationCache('alice/framework-a', { value: 1 }, navigationCacheEpoch());
  expect(readNavigationCache('alice/framework-a')).toEqual({ value: 1 });
  expect(readNavigationCache('bob/framework-a')).toBeUndefined();
  expect(readNavigationCache('alice/framework-b')).toBeUndefined();
  vi.advanceTimersByTime(15_000);
  expect(readNavigationCache('alice/framework-a')).toBeUndefined();
});
it('invalidates snapshots created while a mutation is pending', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const write = api('/test', { method: 'POST' });
  writeNavigationCache('during-write', {}, navigationCacheEpoch());
  finish(new Response('{}'));
  await write;
  expect(readNavigationCache('during-write')).toBeUndefined();
});
it('bounds the cache and rejects invalidated in-flight snapshots', () => {
  const epoch = navigationCacheEpoch();
  clearNavigationCache();
  writeNavigationCache('old', {}, epoch);
  expect(readNavigationCache('old')).toBeUndefined();
  for (let i = 0; i < 13; i++) writeNavigationCache(String(i), i, navigationCacheEpoch());
  expect(readNavigationCache('0')).toBeUndefined();
  expect(readNavigationCache('12')).toBe(12);
});
it.each([
  ['POST', 200],
  ['GET', 401],
  ['GET', 403],
])('invalidates on mutation or authentication failure %s %s', async (method, status) => {
  writeNavigationCache('x', {}, navigationCacheEpoch());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
  await api('/test', { method }).catch(() => undefined);
  expect(readNavigationCache('x')).toBeUndefined();
});
