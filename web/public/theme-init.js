// Applies the saved Light / Dark / System choice before the bundle runs. Key and attribute as in
// src/app/themeKeys.ts, used by theme.ts and CodeEditor.
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
