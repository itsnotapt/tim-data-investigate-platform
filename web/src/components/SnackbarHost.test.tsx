import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { SnackbarHost } from './SnackbarHost';
import { useNotify } from './useNotify';
import type { NotifyOptions } from './notifyContext';

let sendFn: ((o: NotifyOptions | string) => void) | undefined;
function Grab() {
  const notify = useNotify();
  useEffect(() => {
    sendFn = notify;
  }, [notify]);
  return null;
}
const setup = () =>
  render(
    <SnackbarHost>
      <Grab />
    </SnackbarHost>,
  );
const send = (o: NotifyOptions | string) =>
  act(() => {
    sendFn?.(o);
  });

describe('SnackbarHost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows messages one at a time in FIFO order, advancing after timeout + pause', () => {
    setup();
    send({ message: 'first', timeout: 1000 });
    send({ message: 'second', timeout: 1000 });
    send('third');
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.queryByText('second')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(screen.getByText('first')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('second')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText('third')).toBeInTheDocument();
    expect(screen.queryByText('second')).not.toBeInTheDocument();
  });

  it('Dismiss hides now and shows the next after the pause', () => {
    setup();
    send('one');
    send('two');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByText('two')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('two')).toBeInTheDocument();
  });

  it('renders a link button only when a link is given', () => {
    setup();
    send({ message: 'with link', link: 'https://example.com/x', linkText: 'View' });
    const link = screen.getByRole('link', { name: /view/i });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    send('plain');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('useNotify throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Grab />)).toThrow(/SnackbarHost/);
    spy.mockRestore();
  });
});
