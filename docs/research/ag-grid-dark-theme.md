# AG Grid 36: switching light/dark, and determination row colours

Research for [#36](https://github.com/itsnotapt/tim-data-investigate-platform/issues/36) (map [#34](https://github.com/itsnotapt/tim-data-investigate-platform/issues/34), dark mode).
Versions checked: `ag-grid-community@36.2.0` (the version `web/package.json` resolves, `^36.2.0`) and `@mui/system@9.4.0`.
Date: 2026-10-08.

Sources:

- [AG] AG Grid docs, Theming: Colours & Dark Mode: https://www.ag-grid.com/react-data-grid/theming-colors/
- [AGP] AG Grid docs, Theming: Parameters: https://www.ag-grid.com/react-data-grid/theming-parameters/
- [AGT] AG Grid docs, Theming (CSS layers): https://www.ag-grid.com/react-data-grid/theming/
- [AGR] AG Grid docs, Row Styles: https://www.ag-grid.com/react-data-grid/row-styles/
- [SRC] `ag-grid-community@36.2.0` npm tarball, `dist/ag-grid-community.noStyle.js` (line numbers refer to that file)
- [MUI] MUI docs, CSS theme variables configuration: https://mui.com/material-ui/customization/css-theme-variables/configuration/
- [MUISRC] `@mui/system@9.4.0` npm tarball, `cssVars/createCssVarsProvider.js`
- [EXP] Headless Chromium experiment against the 36.2.0 UMD bundle (see "Experiment" below)

## Answer in brief

- **`themeBalham` already supports dark mode.** It is built with the `colorSchemeVariable` part, which has `light`, `dark` and `dark-blue` modes [SRC 31260-31267, 31847]. The mode follows the `data-ag-theme-mode` attribute on `<html>`, on `<body>`, or on an ancestor that has the `ag-theme-mode` class [AG; SRC 4017]. No JS call to the grid is needed, and the `theme` prop stays `themeBalham`.
- **MUI can set that attribute for us.** In MUI 9, `createTheme({ cssVariables: { colorSchemeSelector: 'data-ag-theme-mode' }, colorSchemes: { light, dark } })` makes MUI write `data-ag-theme-mode="light|dark"` on `<html>` [MUISRC 181-183, 189-197; `colorSchemeNode` defaults to `document.documentElement`, line 64]. MUI's scheme names (`light`/`dark`) match AG Grid's mode names, so one attribute drives both libraries.
- **Params can reference CSS variables.** Any colour param accepts `'var(--myColorVar)'` [AG; AGP], so `--mui-palette-*` variables can be used.
- **Determination rows:** keep `rowClassRules`, and drive the colour through a scheme-scoped CSS custom property. The best way found is to set AG Grid's own `--ag-data-background-color` / `--ag-odd-row-background-color` on the row class instead of `background-color: … !important` (see below).

## How the theme modes work (source)

- `withParams(params, mode = '$default')` adds a part with `modeParams: { [mode]: params }` [SRC 3927-3933]. Parts can carry per-mode params.
- When the theme CSS is generated, each non-default mode is wrapped in
  `:where(html[data-ag-theme-mode="M"],body[data-ag-theme-mode="M"],.ag-theme-mode[data-ag-theme-mode="M"]) & { … }` [SRC 4013-4019]. This uses native CSS nesting (`&`), so the browser must support CSS nesting. All evergreen browsers have supported it since 2023.
- `themeBalham = createTheme().withPart(buttonStyleBalham)…withPart(colorSchemeVariable)…withParams(themeBalhamParams())` [SRC 31847].
- `colorSchemeVariable` has default = light params, plus modes `light`, `dark`, `dark-blue` [SRC 31260-31267].
- Fixed schemes `colorSchemeLight`, `colorSchemeDark`, `colorSchemeDarkBlue`, `colorSchemeDarkWarm`, … are plain parts with no modes [SRC 31179-31257]. `theme.withPart(colorSchemeDark)` replaces the colour-scheme feature, because parts are de-duplicated by `feature` [SRC 4053-4065]. The result is a theme that is always dark.
- Custom modes: `theme.withParams({...}, 'my-dark')` defines params that apply only under `data-ag-theme-mode="my-dark"` [AG].
- In the dark params, `browserColorScheme: 'dark'` sets CSS `color-scheme` (native scrollbars, form controls) [SRC 31213].

### Gotcha: `withParams` without a mode overrides that param in every mode

In `_getModeParams`, any param that a later part sets in the **default** mode is deleted from the non-default modes merged so far [SRC 3972-3997]. For example, `themeBalham.withParams({ backgroundColor: '#fafafa' })` gives a background that stays `#fafafa` in dark mode too. To customise colours, choose one of these:

- pass the mode: `.withParams({...}, 'light').withParams({...}, 'dark')`, or
- pass a CSS variable that itself changes per scheme, e.g. `.withParams({ accentColor: 'var(--mui-palette-primary-main)' })`. Overriding in all modes is then fine because the variable's value changes.

Balham's own `themeBalhamParams` already does this for a few params, such as `checkboxUncheckedBorderColor` and `toggleButtonOffBackgroundColor`. That is why they look the same in both modes. They are relative mixes of foreground and background, so they still adapt.

## Switching options and their cost

| Option | How | Cost on a live grid |
|---|---|---|
| **Theme mode attribute** (recommended) | Set `data-ag-theme-mode` on `<html>`/`<body>` (or let MUI do it) | Pure CSS: the variable values change and the browser restyles. No grid code runs. [EXP] confirmed that a live grid repaints immediately. |
| Swap the `theme` grid option | `theme={dark ? themeBalham.withPart(colorSchemeDark) : themeBalham}` | `handleThemeChange` injects the new theme's CSS (once per theme object), swaps the root `ag-theme-params-N` class and fires `stylesChanged` [SRC 4130, 4285-4330]. Grid code then re-measures CSS-variable sizes. The grid is not re-created, but each theme object must be stable (module scope or `useMemo`). A new object on every render injects new CSS every time. |
| Override `--ag-*` variables in app CSS | e.g. `[data-ag-theme-mode=dark] .ag-root-wrapper { --ag-background-color: … }` | Pure CSS. The docs support it ("theme parameters are implemented using CSS custom properties … so you can override them in your application style sheets") [AGP]. It is clumsier than modes. |

The docs recommend modes for "a website with its own dark mode", because updating the `theme` option can be awkward there [AG].

## Determination row colours

The current setup: `rowClassRules` adds `ag-tag-malicious|suspicious|benign` (`web/src/features/grid/rowClasses.ts`), and `grid.css` sets `background-color: <pastel> !important`. Row Styles docs recommend `rowClassRules` "for most use cases" and re-apply rules when the row data changes [AGR]. The docs do not mention theming row classes [AGR].

Relevant v36 row CSS [SRC, injected core CSS]:

- `:where(.ag-row:not(.ag-header-row)) { background-color: var(--ag-data-background-color) }`: zero specificity.
- `.ag-row-odd { background-color: var(--ag-odd-row-background-color) }`: Balham sets odd rows to `chromeBackgroundColor` at 50% [SRC 31808]. This is why a plain class rule has to fight with `!important` today.
- Each row now has `.ag-grid-pinned-left-cells` / `.ag-grid-scrolling-cells` / `.ag-grid-pinned-right-cells` sections. It also has an `::after` filler to the right of the last column that paints `var(--ag-data-background-color)`.
- Hover and selection are painted as a `::before` overlay (`--ag-internal-row-overlay-color`) on top of the sections, so they layer over whatever row background is set.

### Experiment [EXP]

Setup: `themeBalham`, one left-pinned column, rows 0–1 with the current `!important` rule, and rows 2–3 with `.vb { --ag-data-background-color: #fbbbb9; --ag-odd-row-background-color: #fbbbb9 }`. I sampled pixels in the pinned cell, the scrolling cell and the filler, in light mode and then after setting `body[data-ag-theme-mode=dark]`:

```
== light
0 even, ag-tag-malicious  pinned #fbbbb9 scroll #fbbbb9 filler #ffffff
1 odd,  ag-tag-malicious  pinned #fbbbb9 scroll #fbbbb9 filler #ffffff
2 even, vb                pinned #fbbbb9 scroll #fbbbb9 filler #fbbbb9
3 odd,  vb                pinned #fbbbb9 scroll #fbbbb9 filler #fbbbb9
4 even                    pinned #ffffff scroll #ffffff filler #ffffff
== dark via data-ag-theme-mode
0 even, ag-tag-malicious  pinned #fbbbb9 scroll #fbbbb9 filler #2b2b2b
2 even, vb                pinned #fbbbb9 scroll #fbbbb9 filler #fbbbb9
4 even                    pinned #2b2b2b scroll #2b2b2b filler #2b2b2b
```

Findings:

1. The mode attribute switches a live grid with no JS (row 4 changes from `#ffffff` to `#2b2b2b`).
2. The hard-coded pastels stay light pastels in dark mode, so the row colours must become per-scheme.
3. The `!important` background leaves the filler to the right of the last column uncoloured. Setting the grid's own variables on the row class colours the whole row, needs no `!important`, and works for odd rows too.

### Recommended pattern

```css
/* grid.css: per-scheme determination colours as custom properties */
:root {
  --tim-determination-malicious: #fbbbb9;
  --tim-determination-suspicious: #ffecae;
  --tim-determination-benign: #d4f3cd;
}
[data-ag-theme-mode='dark'] {
  --tim-determination-malicious: /* dark-palette value, see #40 */;
  /* … */
}
.ag-tag-malicious {
  --ag-data-background-color: var(--tim-determination-malicious);
  --ag-odd-row-background-color: var(--tim-determination-malicious);
}
/* likewise suspicious / benign */
```

- The scheme selector can be the shared `data-ag-theme-mode` attribute. Alternatively, the colours can come from the MUI palette (`var(--mui-palette-…)`) if #40 defines them there.
- Row foreground text uses `--ag-foreground-color` (white in dark mode). The dark-mode background colours must give contrast with light text; the current light pastels would not.
- AG Grid has no API for app-defined theme params. Custom colours belong in CSS custom properties, not in `withParams`.

## MUI integration notes

- Use `cssVariables.colorSchemeSelector: 'data-ag-theme-mode'`. MUI then uses the attribute both as the CSS selector for its own variables and as the attribute it writes on `<html>` [MUISRC 181-197; MUI].
- With `'class'`/`'data'` selectors MUI would write `.dark` or `data-dark` instead. These would need a small effect to mirror the mode into `data-ag-theme-mode`.
- `useColorScheme()` gives `mode`/`setMode` (`system`/`light`/`dark`). In `system` mode MUI still writes the resolved `light`/`dark` value [MUI; MUISRC].
- To avoid a flash of the wrong scheme on load, render MUI's `InitColorSchemeScript` with the same attribute [MUI]. This is an SPA, not SSR, but it still applies to the first paint.
- AG Grid itself never reads `prefers-color-scheme`: there is no match in the 36.2.0 bundle [SRC]. "Follow the OS" has to come from MUI (`mode: 'system'`) via the attribute.

## Implications for other tickets

- **#39 (mechanism):** a single `data-ag-theme-mode` attribute on `<html>`, written by MUI's CSS-variables provider, drives MUI, AG Grid and the app's own CSS. No grid `theme` swap and no React context plumbing into `ResultsGrid` are needed.
- **#40 (palette):** determination colours need dark-scheme values that work with white text. Grid params that the app overrides must be per-mode or must be `var(--mui-…)` references, because of the `withParams` default-mode gotcha above.
- **#41 (testing):** jsdom cannot test this, because it has no nested-CSS cascade. Use Playwright: toggle the attribute, then assert computed colours or sample pixels as in [EXP]. Include the filler region and odd rows. Unit tests can still assert the `rowClassRules` class names, as today.

## Experiment files

These were run outside the repo against the npm tarball:

- Page: `createGrid` with `themeBalham`, `AllCommunityModule`, columns `id` (pinned left) / `a` / `b`, and the two row-class variants above.
- Driver: Playwright `chromium.launch()`, a screenshot, then pixel sampling with `pngjs` at the centre of each section, before and after `document.body.dataset.agThemeMode = 'dark'`.
