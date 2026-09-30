import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DetailPanel } from './DetailPanel';
import { detailEntries, detailText } from './detailText';

describe('detail text', () => {
  it('dumps objects as YAML and strips control characters', () => {
    expect(detailText({ a: 1, b: ['x'] })).toBe('a: 1\nb:\n  - x\n');
    expect(detailText({ s: 'a\u0001b' })).toBe('s: ab\n');
    expect(detailText(5)).toBe('5');
  });
  it('hides empty values and the client row id', () => {
    const entries = detailEntries({ _id: 'x', a: '', b: null, c: {}, d: [], e: 0, f: 'ok' });
    expect(entries.map((e) => e.key)).toEqual(['e', 'f']);
  });
});

describe('DetailPanel', () => {
  it('renders fields and a visible close button', async () => {
    const onClose = vi.fn();
    render(
      <DetailPanel open data={{ Name: 'alpha', Obj: { k: 'v' }, Empty: '' }} onClose={onClose} />,
    );
    expect(screen.getByText('Result Details')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('k: v')).toBeInTheDocument();
    expect(screen.queryByText('Empty')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalled();
  });
});
