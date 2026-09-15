import { afterEach, expect, it } from 'vitest';
import { setDisplayTimezone, userDateFormatter, formatUserDate } from './userTime';
afterEach(() => setDisplayTimezone(undefined));
it('applies the account timezone and daylight saving', () => {
  setDisplayTimezone('Atlantic/Canary');
  const hour = (date: string) =>
    userDateFormatter('en-GB', { hour: '2-digit', hourCycle: 'h23' }).format(new Date(date));
  expect(hour('2026-01-15T12:00:00Z')).toBe('12');
  expect(hour('2026-07-15T12:00:00Z')).toBe('13');
  setDisplayTimezone('UTC');
  expect(hour('2026-07-15T12:00:00Z')).toBe('12');
});
it('does not fabricate missing timestamps', () =>
  expect(formatUserDate('invalid')).toBe('time unavailable'));
