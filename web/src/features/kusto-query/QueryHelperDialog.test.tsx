import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueryHelperDialog } from './QueryHelperDialog';
import {
  buildTagEventsSample,
  DEFAULT_QUERY_EXAMPLE,
  TIME_RANGE_SAMPLE,
} from './queryHelperSamples';

describe('sample KQL', () => {
  it('matches snapshots', () => {
    expect(TIME_RANGE_SAMPLE).toMatchSnapshot('time-range');
    expect(DEFAULT_QUERY_EXAMPLE).toMatchSnapshot('default-query');
    expect(buildTagEventsSample('https://tags.kusto.windows.net', 'Research')).toMatchSnapshot(
      'tag-events',
    );
  });

  it('BUG-41: invokes the function with the defined casing and has no stray brace', () => {
    const tag = buildTagEventsSample('c', 'd');
    expect(tag).toContain('let getTagEvents=');
    expect(tag).toContain('| invoke getTagEvents()');
    expect(tag).not.toContain('GetTagEvents');
    expect(DEFAULT_QUERY_EXAMPLE.trimEnd().endsWith('}')).toBe(false);
    expect(DEFAULT_QUERY_EXAMPLE).not.toMatch(/\}\s*$/);
  });
});

describe('QueryHelperDialog', () => {
  it('renders all sections with the tag cluster and database', () => {
    render(
      <QueryHelperDialog
        open
        onClose={() => {}}
        tagCluster="https://tags.kusto.windows.net"
        tagDatabase="Research"
      />,
    );
    expect(screen.getByText('Query Help')).toBeInTheDocument();
    for (const t of ['Required Fields', 'Time Range Parameters', 'Tagged Events', 'Examples']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getByRole('table', { name: 'Required Fields' })).toBeInTheDocument();
    expect(screen.getByText('Unique identifier for this event.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tagged events sample').textContent).toContain(
      'cluster("https://tags.kusto.windows.net").database("Research")',
    );
    expect(screen.getByLabelText('Default query example').textContent).toBe(DEFAULT_QUERY_EXAMPLE);
    expect(screen.getByText('More examples...')).toBeInTheDocument();
  });

  it('calls onClose from the Close button and renders nothing when closed', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <QueryHelperDialog open onClose={onClose} tagCluster="c" tagDatabase="d" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    rerender(<QueryHelperDialog open={false} onClose={onClose} tagCluster="c" tagDatabase="d" />);
    await waitFor(() => expect(screen.queryByText('Query Help')).not.toBeInTheDocument());
  });
});
