import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the app bar title', () => {
    window.location.hash = '#/';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'TIM' })).toBeInTheDocument();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('renders a placeholder route from the hash', async () => {
    window.location.hash = '#/queries';
    render(<App />);
    expect(await screen.findByText('Query Manager')).toBeInTheDocument();
  });
});
