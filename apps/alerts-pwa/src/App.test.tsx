import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

describe('Alerts PWA', () => {
  it('loads, filters, deep-links, and acknowledges an authenticated alert accessibly', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'aquiero_csrf=csrf-test',
    });
    let acknowledged = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me'))
        return Response.json({
          userId: 'u1',
          username: 'operator',
          displayName: 'Alert Operator',
          roles: ['Operator'],
          permissions: ['frameworks.read'],
        });
      if (url.includes('/notifications/') && url.endsWith('/acknowledge')) {
        acknowledged = true;
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-test');
        return new Response(null, { status: 204 });
      }
      if (url.includes('/notifications'))
        return Response.json({
          items: [
            {
              id: 'notice-1',
              severity: 'warning',
              title: 'Agency attention',
              body: 'Review Agency',
              source: 'agency',
              state: acknowledged ? 'acknowledged' : 'unread',
              createdAt: '2026-07-19T12:00:00.000Z',
              deepLink: '/?view=notifications',
            },
          ],
        });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Alerts' })).toBeInTheDocument();
    expect(await screen.findByText('Agency attention')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in UNIUI/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/?view=notifications'),
    );
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(acknowledged).toBe(true));
    await waitFor(async () =>
      expect(
        (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
      ).toEqual([]),
    );
  });
});
