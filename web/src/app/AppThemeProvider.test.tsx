import { render, screen } from '@testing-library/react';
import { setPrefersColorScheme } from '../test/matchMedia';
import { AppThemeProvider } from './AppThemeProvider';
import { ConfigError } from './ConfigError';

const schemeAttr = () => document.documentElement.getAttribute('data-ag-theme-mode');

describe('AppThemeProvider', () => {
  afterEach(() => document.documentElement.removeAttribute('data-ag-theme-mode'));

  it('renders light on a dark OS when nothing is stored', () => {
    setPrefersColorScheme('dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(screen.getByText('bad config')).toBeInTheDocument();
    expect(schemeAttr()).toBe('light');
  });

  it('applies a stored dark mode', () => {
    localStorage.setItem('tim-theme-mode', 'dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('dark');
  });
});
