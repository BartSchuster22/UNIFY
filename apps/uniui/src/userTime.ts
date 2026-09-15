let displayTimezone: string | undefined;
export function setDisplayTimezone(timezone: string | undefined) {
  displayTimezone = timezone;
}
export function userDateFormatter(
  locales?: Intl.LocalesArgument,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat(locales, {
    ...options,
    ...(displayTimezone ? { timeZone: displayTimezone } : {}),
  });
}
export function formatUserDate(value: string | number | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return userDateFormatter(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}
