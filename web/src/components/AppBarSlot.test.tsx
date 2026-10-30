import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppBarSlot, AppBarSlotProvider, InAppBar } from './AppBarSlot';

describe('InAppBar', () => {
  it('renders its children in the app bar slot', () => {
    render(
      <AppBarSlotProvider>
        <header>
          <AppBarSlot />
        </header>
        <main>
          <InAppBar>
            <h2>Sign-ins</h2>
          </InAppBar>
        </main>
      </AppBarSlotProvider>,
    );
    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('heading', { name: 'Sign-ins' }),
    );
    expect(screen.getByRole('main')).toBeEmptyDOMElement();
  });

  it('renders nothing without a slot', () => {
    render(
      <main>
        <InAppBar>
          <h2>Sign-ins</h2>
        </InAppBar>
      </main>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
