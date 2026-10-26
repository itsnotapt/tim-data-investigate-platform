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
  it('dumps a whole number beyond 2^53 exactly, as a number', () => {
    expect(detailText({ id: 12345678901234567890n, raw: { hash: [-9007199254740993n] } })).toBe(
      'id: 12345678901234567890\nraw:\n  hash:\n    - -9007199254740993\n',
    );
    expect(detailText(12345678901234567890n)).toBe('12345678901234567890');
  });

  it('hides empty values', () => {
    const entries = detailEntries({ a: '', b: null, c: {}, d: [], e: 0, f: 'ok' });
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

  it('renders the close icon inside the close button', () => {
    render(<DetailPanel open data={{ Name: 'alpha' }} onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Close details' });
    expect(button.querySelector('svg[data-testid="CloseIcon"]')).not.toBeNull();
  });
});
