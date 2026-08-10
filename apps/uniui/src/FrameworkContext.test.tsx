import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameworkProvider, useFrameworkContext } from './FrameworkContext';

const frameworks = [
  { frameworkId: 'hermes-alica', displayName: 'Alica', status: 'verified', enabled: true },
  { frameworkId: 'hermes-herman', displayName: 'Herman', status: 'verified', enabled: true },
  { frameworkId: 'hermes-disabled', displayName: 'Disabled', status: 'verified', enabled: false },
  {
    frameworkId: 'hermes-unavailable',
    displayName: 'Unavailable',
    status: 'unavailable',
    enabled: true,
  },
];

function response(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function Probe({ name }: { name: string }) {
  const context = useFrameworkContext();
  return (
    <section aria-label={name}>
      <span>{context.loading ? 'loading' : 'ready'}</span>
      <span data-testid={`${name}-selected`}>{context.frameworkId || 'none'}</span>
      <span data-testid={`${name}-options`}>
        {context.frameworks.map((item) => item.frameworkId).join(',')}
      </span>
      <span role="alert">{context.selectionIssue || context.error}</span>
      <button onClick={() => context.selectFramework('hermes-alica')}>Choose Alica</button>
      <button onClick={() => context.selectFramework('hermes-herman')}>Choose Herman</button>
      <button onClick={() => context.selectFramework('missing')}>Choose missing</button>
    </section>
  );
}

function renderContext() {
  return render(
    <FrameworkProvider>
      <Probe name="profiles" />
      <Probe name="models" />
    </FrameworkProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/?view=profiles');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response({ items: frameworks })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared framework context', () => {
  it('discovers enabled verified frameworks once and defaults to the first real framework', async () => {
    renderContext();
    await waitFor(() =>
      expect(screen.getByTestId('profiles-selected')).toHaveTextContent('hermes-alica'),
    );
    expect(screen.getByTestId('models-selected')).toHaveTextContent('hermes-alica');
    expect(screen.getByTestId('profiles-options')).toHaveTextContent('hermes-alica,hermes-herman');
    expect(screen.getByTestId('profiles-options')).not.toHaveTextContent('disabled');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.get('framework')).toBe('hermes-alica');
  });

  it('restores a valid framework from the URL and shares a later selection across consumers', async () => {
    window.history.replaceState(null, '', '/?view=models&framework=hermes-herman');
    renderContext();
    await waitFor(() =>
      expect(screen.getByTestId('models-selected')).toHaveTextContent('hermes-herman'),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose Alica' })[0]!);
    expect(screen.getByTestId('profiles-selected')).toHaveTextContent('hermes-alica');
    expect(screen.getByTestId('models-selected')).toHaveTextContent('hermes-alica');
    expect(new URL(window.location.href).searchParams.get('framework')).toBe('hermes-alica');
  });

  it('restores framework selection from browser history', async () => {
    window.history.replaceState(null, '', '/profiles?framework=hermes-herman');
    renderContext();
    await waitFor(() =>
      expect(screen.getByTestId('profiles-selected')).toHaveTextContent('hermes-herman'),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose Alica' })[0]!);
    expect(window.location.search).toContain('framework=hermes-alica');

    window.history.replaceState(null, '', '/profiles?framework=hermes-herman');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() =>
      expect(screen.getByTestId('profiles-selected')).toHaveTextContent('hermes-herman'),
    );
  });

  it('fails closed on an invalid URL framework instead of silently routing to another framework', async () => {
    window.history.replaceState(null, '', '/?view=profiles&framework=hermes-missing');
    renderContext();
    await waitFor(() => expect(screen.getByTestId('profiles-selected')).toHaveTextContent('none'));
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Framework hermes-missing is not enabled and verified',
    );
    expect(new URL(window.location.href).searchParams.has('framework')).toBe(false);
  });

  it('rejects selection of an unregistered framework', async () => {
    renderContext();
    await waitFor(() =>
      expect(screen.getByTestId('profiles-selected')).toHaveTextContent('hermes-alica'),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose missing' })[0]!);
    expect(screen.getByTestId('profiles-selected')).toHaveTextContent('none');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Framework missing is not enabled and verified',
    );
  });
});
