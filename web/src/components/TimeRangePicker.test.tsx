import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIME_RANGE, type TimeRange } from '../lib/time-range';
import { TimeRangePicker } from './TimeRangePicker';

function Harness({ initial = DEFAULT_TIME_RANGE as TimeRange }) {
  const [value, setValue] = useState<TimeRange>(initial);
  return (
    <>
      <TimeRangePicker value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('value').textContent) as TimeRange;

async function open(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: /Time range:/ }));
  await user.click(screen.getByRole('menuitem', { name: item }));
}

describe('TimeRangePicker', () => {
  it('shows the default and picks presets', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Time range: Last 15 minutes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Time range:/ }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual([
      'Custom Date Range',
      'Custom Time Period',
      'Last 15 minutes',
      'Last 30 minutes',
      'Last 1 hours',
      'Last 24 hours',
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Last 24 hours' }));
    expect(current()).toMatchObject({ kind: 'relative', start: { amount: 24, unit: 'hours' } });
    expect(screen.getByRole('button', { name: 'Time range: Last 24 hours' })).toBeVisible();
  });

  it('applies a custom date range', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user, 'Custom Date Range');
    const dialog = screen.getByRole('dialog', { name: 'Custom date range' });
    await user.clear(within(dialog).getByLabelText('Start date'));
    await user.type(within(dialog).getByLabelText('Start date'), '2024-01-02');
    await user.clear(within(dialog).getByLabelText('Start time'));
    await user.type(within(dialog).getByLabelText('Start time'), '03:04');
    await user.clear(within(dialog).getByLabelText('End date'));
    await user.type(within(dialog).getByLabelText('End date'), '2024-01-03');
    await user.clear(within(dialog).getByLabelText('End time'));
    await user.type(within(dialog).getByLabelText('End time'), '05:06Z');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(current()).toEqual({
      kind: 'absolute',
      start: '2024-01-02T03:04:00.000Z',
      end: '2024-01-03T05:06:00.000Z',
    });
    expect(
      screen.getByRole('button', {
        name: 'Time range: 2024-01-02T03:04Z - 2024-01-03T05:06Z',
      }),
    ).toBeVisible();
  });

  it('rejects bad custom dates and start >= end, and keeps the dialog open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user, 'Custom Date Range');
    const dialog = screen.getByRole('dialog', { name: 'Custom date range' });
    await user.clear(within(dialog).getByLabelText('Start time'));
    await user.type(within(dialog).getByLabelText('Start time'), '25:99');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Start: Please input time (HH:MM)');

    await user.clear(within(dialog).getByLabelText('Start time'));
    await user.type(within(dialog).getByLabelText('Start time'), '10:00');
    await user.clear(within(dialog).getByLabelText('End date'));
    await user.type(within(dialog).getByLabelText('End date'), '2000-01-01');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Start time must be prior to end time',
    );
    expect(current()).toEqual(DEFAULT_TIME_RANGE);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies a custom period ending now, and one with an end offset', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user, 'Custom Time Period');
    let dialog = screen.getByRole('dialog', { name: 'Custom time period' });
    expect(within(dialog).getByLabelText('End time period')).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Start time period'));
    await user.type(within(dialog).getByLabelText('Start time period'), '3');
    await user.selectOptions(within(dialog).getByLabelText('Start time units'), 'hours');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(current()).toEqual({
      kind: 'relative',
      start: { amount: 3, unit: 'hours' },
      end: null,
    });

    await open(user, 'Custom Time Period');
    dialog = screen.getByRole('dialog', { name: 'Custom time period' });
    await user.selectOptions(within(dialog).getByLabelText('End time units'), 'hours');
    await user.type(within(dialog).getByLabelText('End time period'), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(
      screen.getByRole('button', { name: 'Time range: 3 hours ago - 1 hours ago' }),
    ).toBeVisible();
  });

  it('validates custom periods', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user, 'Custom Time Period');
    const dialog = screen.getByRole('dialog', { name: 'Custom time period' });
    const start = within(dialog).getByLabelText('Start time period');
    const apply = () => user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await user.clear(start);
    await apply();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Please input a time period');
    await user.type(start, 'abc');
    await apply();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('must be a number');
    await user.clear(start);
    await user.type(start, '-5');
    await apply();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('greater than zero');
    await user.clear(start);
    await user.type(start, '1');
    await user.selectOptions(within(dialog).getByLabelText('End time units'), 'hours');
    await user.type(within(dialog).getByLabelText('End time period'), '5');
    await apply();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Start time must be prior to end time',
    );
    expect(current()).toEqual(DEFAULT_TIME_RANGE);
  });
});
