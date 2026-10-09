import { act, render, screen } from '@testing-library/react';
import { setPrefersColorScheme } from '../test/matchMedia';
import { AppThemeProvider } from './AppThemeProvider';
import { ConfigError } from './ConfigError';

const schemeAttr = () => document.documentElement.getAttribute('data-ag-theme-mode');

describe('AppThemeProvider', () => {
  afterEach(() => document.documentElement.removeAttribute('data-ag-theme-mode'));

  it('follows a dark OS when nothing is stored', () => {
    setPrefersColorScheme('dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(screen.getByText('bad config')).toBeInTheDocument();
    expect(schemeAttr()).toBe('dark');
  });

  it('follows a live OS change when nothing is stored', () => {
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('light');
    act(() => setPrefersColorScheme('dark'));
    expect(schemeAttr()).toBe('dark');
  });

  it('a stored light mode ignores a dark OS', () => {
    localStorage.setItem('tim-theme-mode', 'light');
    setPrefersColorScheme('dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('light');
  });

  it('takes over from theme-init.js: its inline color-scheme would outlast a change', () => {
    document.documentElement.style.colorScheme = 'dark';
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(document.documentElement.style.colorScheme).toBe('');
  });

  it('applies a stored dark mode', () => {
    localStorage.setItem('tim-theme-mode', 'dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('dark');
  });
});
