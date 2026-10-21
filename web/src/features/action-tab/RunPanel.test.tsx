import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Run } from '../../lib/api';
import { RunPanel } from './RunPanel';

const RUN_ID = '5b0c5d0e-1f7e-4a8e-9d55-2f1c2f3a4b5c';
const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: RUN_ID,
  status: 'succeeded',
  action: { key: 'dev-sign-ins', name: 'Sign-ins' },
  params: { users: ['alice', 'bob'], limit: 10 },
  owner: 'jo@example.com',
  startedAt: '2026-10-20T10:00:00Z',
  finishedAt: '2026-10-20T10:02:05Z',
  expiresAt: '2026-10-21T10:00:00Z',
  details: { duration: 125.2, rowCount: 2 },
  rowCount: 2,
  columns: [
    { name: 'User', type: 'string', declared: true },
    { name: 'Result', type: 'string', declared: false },
  ],
  ...overrides,
});

const rowsOf = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

describe('RunPanel', () => {
  it('shows the run’s status, start, duration and id', () => {
    render(<RunPanel run={makeRun()} error={null} />);
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByText('2026-10-20 10:00:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('2 min 5 s')).toBeInTheDocument();
    expect(screen.getByText(RUN_ID)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a run that succeeded with no rows as such', () => {
    render(<RunPanel run={makeRun({ rowCount: 0 })} error={null} />);
    expect(screen.getByText('Succeeded, no rows')).toBeInTheDocument();
  });

  it('shows the details in order, with a warning icon on a warning', () => {
    render(
      <RunPanel
        run={makeRun({
          status: 'error',
          error: 'The sign-in log is unavailable',
          details: { duration: 2.5, rowCount: 0, warning: 'Partial scan', cluster: 'dev' },
        })}
        error="The sign-in log is unavailable"
      />,
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('2.5 s')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The sign-in log is unavailable');
    expect(rowsOf('Details')).toEqual([
      ['duration', '2.5'],
      ['rowCount', '0'],
      ['warning', 'Partial scan'],
      ['cluster', 'dev'],
    ]);
    const warning = within(screen.getByRole('table', { name: 'Details' })).getAllByRole('row')[2]!;
    expect(within(warning).getByRole('img', { name: 'Warning' })).toBeInTheDocument();
  });

  it('shows the columns, declared or inferred, and the params used', () => {
    render(<RunPanel run={makeRun()} error={null} />);
    expect(rowsOf('Columns')).toEqual([
      ['User', 'string', 'declared'],
      ['Result', 'string', 'inferred'],
    ]);
    expect(rowsOf('Params')).toEqual([
      ['users', 'alice, bob'],
      ['limit', '10'],
    ]);
  });

  it.each([
    ['timedOut', 'Timed out'],
    ['cancelled', 'Cancelled'],
    ['running', 'Running'],
  ] as const)('names the status %s', (status, text) => {
    render(<RunPanel run={makeRun({ status })} error={null} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows why a run could not start when there is no run', () => {
    render(<RunPanel run={null} error="Couldn't start: No token for the connection" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't start: No token for the connection",
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says when the tab has not run', () => {
    render(<RunPanel run={null} error={null} />);
    expect(screen.getByText('Not run yet.')).toBeInTheDocument();
  });
});
