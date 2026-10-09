// Applies the saved Light / Dark / System choice before the module bundle runs, so the page
// never shows the other scheme first. Loaded by a plain <script src> in <head> of index.html:
// the CSP has no 'unsafe-inline' in script-src, so this can't be an inline script.
// The storage key and the attribute must match AppThemeProvider (modeStorageKey) and
// src/app/theme.ts (colorSchemeSelector), where MUI takes over once the bundle runs.
(function () {
  var mode = null;
  try {
    mode = window.localStorage.getItem('tim-theme-mode');
  } catch {
    // Storage unavailable (blocked or sandboxed): follow the OS.
  }
  if (mode !== 'light' && mode !== 'dark') {
    // 'system', nothing saved or a junk value.
    var dark = false;
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      // No matchMedia: light.
    }
    mode = dark ? 'dark' : 'light';
  }
  var html = document.documentElement;
  html.setAttribute('data-ag-theme-mode', mode);
  html.style.colorScheme = mode;
})();
