import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionBarSlot, ActionBarSlotProvider, InActionBar } from './ActionBarSlot';

describe('InActionBar', () => {
  it('renders its children in the action bar slot', () => {
    render(
      <ActionBarSlotProvider>
        <div role="region" aria-label="Action bar">
          <ActionBarSlot />
        </div>
        <main>
          <InActionBar>
            <button type="button">Run</button>
          </InActionBar>
        </main>
      </ActionBarSlotProvider>,
    );
    expect(screen.getByRole('region', { name: 'Action bar' })).toContainElement(
      screen.getByRole('button', { name: 'Run' }),
    );
    expect(screen.getByRole('main')).toBeEmptyDOMElement();
  });

  it('renders nothing without a slot', () => {
    render(
      <main>
        <InActionBar>
          <button type="button">Run</button>
        </InActionBar>
      </main>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
