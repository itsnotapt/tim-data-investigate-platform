# How MUI 9 switches between light and dark colour schemes at runtime

Question: [#35](https://github.com/itsnotapt/tim-data-investigate-platform/issues/35) (map [#34](https://github.com/itsnotapt/tim-data-investigate-platform/issues/34)).
Version checked: `@mui/material` 9.4.0 and `@mui/system` 9.4.0 (the versions pinned in `web/package-lock.json`). Source was read from the published npm tarballs (`npm pack @mui/material@9.4.0 @mui/system@9.4.0`); paths below are relative to each package root.

Sources:

- [D1] MUI docs, Dark mode: https://mui.com/material-ui/customization/dark-mode/
- [D2] MUI docs, CSS theme variables, Configuration: https://mui.com/material-ui/customization/css-theme-variables/configuration/
- [S1] `@mui/material/styles/createTheme.mjs`
- [S2] `@mui/material/styles/ThemeProvider.mjs`, `ThemeProviderWithVars.mjs`
- [S3] `@mui/system/cssVars/createCssVarsProvider.mjs`
- [S4] `@mui/system/cssVars/useCurrentColorScheme.mjs`
- [S5] `@mui/system/cssVars/localStorageManager.mjs`
- [S6] `@mui/material/InitColorSchemeScript/InitColorSchemeScript.mjs`, `@mui/system/InitColorSchemeScript/InitColorSchemeScript.mjs`
- [S7] `@mui/material/styles/createThemeWithVars.mjs`, `createGetSelector.mjs`
- [S8] `@mui/system/createTheme/applyStyles.mjs`
- [S9] `@mui/material/CssBaseline/CssBaseline.mjs`
- [S10] `@mui/material/CHANGELOG.md` (9.1.1, 9.1.2 entries on `InitColorSchemeScript`)

## Short answer

Declare both schemes with `createTheme({ cssVariables: { colorSchemeSelector: 'class' | 'data' | … }, colorSchemes: { light: {...}, dark: {...} } })`, keep the existing `<ThemeProvider theme={theme}>` (add `noSsr` for a client-only Vite app), and switch with `const { mode, setMode } = useColorScheme()` where `mode` is `'light' | 'dark' | 'system'`. MUI saves the choice to `localStorage` (`mui-mode`, plus `mui-color-scheme-light` / `mui-color-scheme-dark`), follows `prefers-color-scheme` while in `system` mode, and syncs open tabs through the `storage` event. Components should read colours through `theme.vars.*` or `theme.applyStyles('dark', …)`, not `theme.palette.mode`.

## 1. Turning on colour schemes: `colorSchemes` and `cssVariables`

- `createTheme` takes `colorSchemes` (`{ light?: true | {palette…}, dark?: true | {palette…} }`), `defaultColorScheme` and `cssVariables` [S1]. Light is on by default, so `colorSchemes: { dark: true }` is enough to get the built-in dark palette [D1].
- If you pass a top-level `palette`, it overrides the scheme for `palette.mode` (the default scheme) [S1][D1]. The current `web/src/app/theme.ts` passes only `palette` with no `colorSchemes`. That takes the "behaves exactly as v5" path (`createThemeNoVars`) [S1]. `ThemeProvider` then uses the plain provider with no colour-scheme context [S2], so **`useColorScheme` would return no-op setters today**. The theme must move to `colorSchemes` before anything can switch.
- `ThemeProvider` picks the colour-scheme provider (`CssVarsProvider`) whenever the theme has `colorSchemes`, even when `cssVariables` is `false` [S2]. So there are two working modes:

| | `cssVariables: false` + `colorSchemes` | `cssVariables: true` (or an object) + `colorSchemes` |
|---|---|---|
| How a switch is applied | The provider merges the selected scheme into the theme object and re-renders the whole tree [S3] | CSS variables for every scheme are emitted once; the switch only flips an attribute/class on `<html>`; the React theme object is **not** recomputed unless `forceThemeRerender` [S3][D2] |
| `theme.palette.mode` in JS | Matches the active scheme | Stays at `defaultColorScheme` (stale) [S3] |
| `theme.vars` | `null` | `theme.vars.palette.*` resolve to `var(--mui-…)` |
| Pre-paint flash protection | None | Possible (attribute set before paint) |

MUI recommends the CSS-variables route [D1][D2].

## 2. `colorSchemeSelector`: required for a manual toggle

- With both `light` and `dark` declared, `colorSchemeSelector` defaults to `'media'` [S7]. In `media` mode the dark variables sit under `@media (prefers-color-scheme: dark)`, so **`setMode` cannot override the OS**. In development, MUI logs "The `setMode` function has no effect if `colorSchemeSelector` is `media`" [S3].
- For a Light / Dark / System picker, set `cssVariables: { colorSchemeSelector: 'class' }` (gives `.light` / `.dark` on `<html>`), `'data'` (gives `[data-light]` / `[data-dark]`), `'data-mui-color-scheme'` (gives `[data-mui-color-scheme="dark"]`) or a custom `'.theme-%s'` / `'[data-theme="%s"]'` [D2][S7]. The provider writes the attribute onto `document.documentElement` in a layout effect (`useEnhancedEffect`) [S3].
- Other `cssVariables` options: `cssVarPrefix` (default `mui`), `rootSelector` (default `:root`), `nativeColor` [S7].

## 3. `useColorScheme` and Light / Dark / System

Import from `@mui/material/styles`. It returns `{ mode, systemMode, colorScheme, lightColorScheme, darkColorScheme, allColorSchemes, setMode, setColorScheme }` [S3][S4].

- `mode`: `'light' | 'dark' | 'system'`, the user's choice. `systemMode`: `'light' | 'dark'`, the OS preference, set only while `mode === 'system'` [D2][S4]. `colorScheme`: the scheme actually applied.
- `setMode(m)` persists and applies the choice. `setMode(null)` resets to `defaultMode` [S4].
- `ThemeProvider` `defaultMode` defaults to `'system'`, but only when both light and dark schemes exist. Otherwise it falls back to the default scheme's mode [S3][D1].
- **First render returns `mode`, `systemMode` and `colorScheme` as `undefined`**, because they are gated on an `isClient` flag set in an effect. This is hydration safety [S4][D1]. Passing `noSsr` to `ThemeProvider` initialises the flag to `true`, so a client-only app gets real values on the first render and skips the extra render [S4][D1][S3 propTypes].
- Outside a colour-scheme provider, the hook returns a default context with `undefined` values and no-op setters [S3].

## 4. Persistence

- Default storage is `window.localStorage` via `localStorageManager` [S5]. Keys used by Material UI [S2][S6]:
  - `mui-mode`: `light` | `dark` | `system`
  - `mui-color-scheme-light`, `mui-color-scheme-dark`: the scheme name used for each mode (only matters with custom extra schemes)
- You can override them with the `ThemeProvider` props `modeStorageKey` and `colorSchemeStorageKey` [S3].
- `storageManager` prop: a custom `({ key, storageWindow }) => { get(default), set(value), subscribe(handler) => unsubscribe }`. `storageManager={null}` disables persistence, so the app resets to `defaultMode` on reload [D1][S4].
- `localStorage` failures (private mode, quota) are swallowed with try/catch [S5].
- Cross-tab sync: the manager subscribes to the `window` `storage` event and calls `setMode` when another tab changes the key [S4][S5].

## 5. Following the OS `prefers-color-scheme`

- Initial state: `matchMedia('(prefers-color-scheme: dark)').matches` [S4].
- Live: a `matchMedia` listener (registered with the deprecated `addListener` for old Safari) updates `systemMode` while `mode === 'system'` [S4].
- If `window.matchMedia` is not a function (jsdom), MUI skips the listener and `systemMode` stays `undefined`, so `colorScheme` falls back to `defaultColorScheme`. Nothing throws [S4].

## 6. Avoiding a wrong-scheme flash in a Vite SPA

- `InitColorSchemeScript` (`@mui/material/InitColorSchemeScript`) renders an inline `<script>`. The script reads `mui-mode` from storage, resolves `system` via `matchMedia`, and sets the attribute on `<html>` before first paint. Its props are `defaultMode` (default `'system'`), `attribute` (default `'data-mui-color-scheme'`), `modeStorageKey`, `colorSchemeStorageKey`, `colorSchemeNode` and `nonce` [S6].
- **Gotcha: in v9 it renders nothing in a client-only app.** It uses `useSyncExternalStore` to emit the script only on the server pass and the matching hydration pass, and returns `null` on any client render [S6][S10 9.1.1/9.1.2]. With Vite's `createRoot`, there is no server pass. So putting `<InitColorSchemeScript />` in the React tree does nothing. MUI documents it only for Next.js and Gatsby [D2].
- What works for an SPA:
  1. `<ThemeProvider theme={theme} noSsr>`. The provider reads `localStorage` and `matchMedia` synchronously in the `useState` initialiser [S4] and sets the `<html>` attribute in a layout effect before paint [S3]. So the first React paint is already correct [D1: "use `noSsr` … in client-only apps to avoid double rendering and dark-mode flicker on refresh"].
  2. Optional: an inline script in `web/index.html` that does what `buildInitColorSchemeScript` does [S6]: read `mui-mode`, resolve `system`, set the attribute and `color-scheme` on `<html>`. This only covers the moment between HTML parse and JS load, when the page is still the browser default (white). If the app adds a static CSP, the inline script needs a hash or nonce.
- If you use `InitColorSchemeScript` or a copy of it, its `attribute` must match `colorSchemeSelector` (e.g. `attribute="class"`) and its `defaultMode` must match the provider's [D1][D2].
- `disableTransitionOnChange` on `ThemeProvider` injects a `transition: none !important` style for one tick on each switch [S3][D2].

## 7. How components and `sx` read the active scheme

- **Preferred:** `theme.vars.palette.*` in `styled`, `sx` callbacks and `styleOverrides`, e.g. `({ theme }) => ({ borderBottom: \`1px solid ${theme.vars.palette.divider}\` })`. Plain `sx` tokens such as `bgcolor: 'background.paper'` also resolve to variables. These switch with no re-render.
- **Per-scheme differences:** `theme.applyStyles('dark', {...})` [S8][D1]. With CSS variables it returns `{ '*:where(.dark) &': styles }` (or the matching selector). Without them it returns the styles when `palette.mode` matches. Put it last in an array, not spread into an object: `sx={[{…}, (t) => t.applyStyles('dark', {…})]}` [S8]. With `cssVariables: true`, `applyStyles` rules have higher specificity, so overrides of them must also use `applyStyles` [D1].
- **Do not branch on `theme.palette.mode`** under CSS variables. It does not change at runtime [S3][D2]. JS that needs the active scheme (e.g. picking a third-party theme) should use `useColorScheme().colorScheme`, or `mode` / `systemMode`.
- `CssBaseline enableColorScheme` emits `color-scheme: light|dark` per scheme selector, so native scrollbars and form controls follow the scheme [S9].

## Minimal shape for TIM (illustrative, not implemented)

```ts
// theme.ts
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: { palette: { primary: { main: '#1976d2' } } },
    dark: { palette: { primary: { main: '#90caf9' } } },
  },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        }),
      },
    },
  },
});

// App.tsx
<ThemeProvider theme={theme} noSsr disableTransitionOnChange>
  <CssBaseline enableColorScheme />
  …
</ThemeProvider>

// toggle
const { mode, setMode } = useColorScheme(); // 'light' | 'dark' | 'system'
```

## Gotchas that matter for follow-up tickets

- **Mechanism (#39):**
  - The current palette-only theme cannot switch; it must move to `colorSchemes`.
  - A non-`media` `colorSchemeSelector` is mandatory for a manual picker.
  - `InitColorSchemeScript` is a no-op under Vite `createRoot`; use `noSsr`, plus an optional `index.html` script.
- **Palette (#40):**
  - The hard-coded `#fff` and `rgba(0,0,0,…)` in `theme.ts` (AppBar background, border, `text.primary`, `background.default`) must become per-scheme palette values or `theme.vars` references.
  - AG Grid (`themeBalham` in `web/src/features/grid/ResultsGrid.tsx`) is not driven by MUI and needs its own dark switch, keyed off `useColorScheme().colorScheme`.
- **Testing (#41):**
  - jsdom has no `matchMedia`; MUI tolerates that and falls back to the default scheme.
  - To test, either pre-seed `localStorage['mui-mode']` or stub `matchMedia`, and pass `noSsr` so the first render has a defined `mode`.
  - Assert on the `<html>` class or attribute, not computed colours: jsdom does not resolve CSS variables.
  - Persistence is plain `localStorage`, so it can be cleared between tests.
