import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { afterEach, it, expect, vi } from 'vitest';
import { UserPreferencesProvider, UserTimezoneSettings } from './UserPreferences';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requires first-login confirmation and persists edits across reloads', async () => {
  let timezone: string | null = null;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') timezone = JSON.parse(String(init.body)).timezone;
    return new Response(JSON.stringify({ timezone }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const view = () => (
    <MantineProvider>
      <UserPreferencesProvider>
        <UserTimezoneSettings />
      </UserPreferencesProvider>
    </MantineProvider>
  );
  const first = render(view());
  expect(await screen.findByRole('dialog', { name: 'Confirm your timezone' })).toBeVisible();
  const inputs = screen.getAllByRole('combobox', { name: 'Timezone' });
  const input = inputs.find((x) => x.closest('[role="dialog"]'))!;
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, 'Atlantic/Canary');
  const buttons = screen.getAllByRole('button', { name: 'Save timezone' });
  await user.click(buttons.find((x) => x.closest('[role="dialog"]'))!);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(timezone).toBe('Atlantic/Canary');
  const setting = screen.getByRole('combobox', { name: 'Timezone' });
  await user.clear(setting);
  await user.type(setting, 'UTC');
  await user.click(screen.getByRole('button', { name: 'Save timezone' }));
  await waitFor(() => expect(timezone).toBe('UTC'));
  first.unmount();
  render(view());
  expect(await screen.findByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('reports preference load errors and allows retry without inventing a saved setting', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response(JSON.stringify({ timezone: 'UTC' }))),
  );
  render(
    <MantineProvider>
      <UserPreferencesProvider>
        <UserTimezoneSettings />
      </UserPreferencesProvider>
    </MantineProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Retry preferences' }));
  expect(await screen.findByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
});
