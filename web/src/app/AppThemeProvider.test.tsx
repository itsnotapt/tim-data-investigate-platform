import { act, render, screen } from '@testing-library/react';
import { setPrefersColorScheme } from '../test/matchMedia';
import { AppThemeProvider } from './AppThemeProvider';
import { COLOR_SCHEME_ATTRIBUTE, THEME_MODE_KEY } from './themeKeys';
import { ConfigError } from './ConfigError';

const schemeAttr = () => document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE);

describe('AppThemeProvider', () => {
  afterEach(() => document.documentElement.removeAttribute(COLOR_SCHEME_ATTRIBUTE));

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
    localStorage.setItem(THEME_MODE_KEY, 'light');
    setPrefersColorScheme('dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('light');
  });

  it('takes over from theme-init.js: its inline color-scheme would outlast a change', () => {
    document.documentElement.style.colorScheme = 'dark';
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(document.documentElement.style.colorScheme).toBe('');
  });

  it('treats a junk stored value as System, following the OS and its live changes', () => {
    localStorage.setItem(THEME_MODE_KEY, 'sepia');
    setPrefersColorScheme('dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('dark');
    act(() => setPrefersColorScheme('light'));
    expect(schemeAttr()).toBe('light');
  });

  it('applies a stored dark mode', () => {
    localStorage.setItem(THEME_MODE_KEY, 'dark');
    render(<ConfigError message="bad config" />, { wrapper: AppThemeProvider });
    expect(schemeAttr()).toBe('dark');
  });
});
