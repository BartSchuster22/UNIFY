import { render, screen, waitFor } from '@testing-library/react';
import * as axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Chat PWA', () => {
  it('loads the authenticated, permission-aware responsive workspace without accessibility violations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me'))
          return Response.json({
            userId: 'u1',
            username: 'reader',
            displayName: 'Chat Reader',
            roles: ['Operator'],
            permissions: ['chat.read'],
          });
        if (url.includes('kind=chat-session'))
          return Response.json({
            items: [
              {
                resource: {
                  canonicalId: 'chat:session:s1',
                  nativeId: 's1',
                  owner: 'chat',
                  kind: 'chat-session',
                  observedAt: '2026-07-19T12:00:00.000Z',
                },
                truth: 'current',
                authoritative: true,
                adapterId: 'chat',
                fetchedAt: '2026-07-19T12:00:00.000Z',
                title: 'Support',
                searchableText: 'Support',
                data: {},
              },
            ],
          });
        if (url.includes('kind=chat-message')) return Response.json({ items: [] });
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(await screen.findByText('Support')).toBeInTheDocument();
    expect(screen.getByText('Migration-only read view')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await waitFor(async () =>
      expect(
        (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
      ).toEqual([]),
    );
  });
});
