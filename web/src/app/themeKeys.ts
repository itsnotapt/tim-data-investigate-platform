import type { useColorScheme } from '@mui/material/styles';

/** `localStorage` key of the Light / Dark / System choice. `public/theme-init.js` repeats it. */
export const THEME_MODE_KEY = 'tim-theme-mode';

/** Attribute on `<html>` naming the scheme in effect. `public/theme-init.js` repeats it. */
export const COLOR_SCHEME_ATTRIBUTE = 'data-ag-theme-mode';

/** The user's choice: `light`, `dark` or `system`. */
export type ThemeMode = NonNullable<ReturnType<typeof useColorScheme>['mode']>;
