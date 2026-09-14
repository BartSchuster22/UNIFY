import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionFeedback } from './ExecutionFeedback';
afterEach(() => vi.useRealTimers());
describe('execution feedback', () => {
  it('shows waiting immediately and elapsed time without inventing tool progress', () => {
    vi.useFakeTimers();
    render(<MantineProvider><ExecutionFeedback startedAt={Date.now()} uncertain={false} onChecked={() => {}} /></MantineProvider>);
    expect(screen.getByText('Waiting for Hermes')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('individual tool progress is not streamed');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText(/Elapsed: 3s/)).toBeVisible();
  });
  it('does not label an interrupted request as failed or encourage automatic resubmission', () => {
    const checked = vi.fn();
    render(<MantineProvider><ExecutionFeedback startedAt={Date.now()} uncertain onChecked={checked} /></MantineProvider>);
    expect(screen.getByText('Request outcome unconfirmed')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('may have completed');
    expect(screen.queryByText(/Elapsed:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I have checked the conversation history' }));
    expect(checked).toHaveBeenCalledTimes(1);
  });
});
