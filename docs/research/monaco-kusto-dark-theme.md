# Research: monaco-kusto dark theme and runtime theme switching in Monaco

Question ([#37](https://github.com/itsnotapt/tim-data-investigate-platform/issues/37), map [#34](https://github.com/itsnotapt/tim-data-investigate-platform/issues/34)):
does `@kusto/monaco-kusto` 15 ship dark (and light) KQL themes, and under what names? How does
`monaco-editor` 0.55 / `@monaco-editor/react` switch theme at runtime, does that affect the YAML/JSON
editors that share `web/src/components/CodeEditor.tsx`, and what customisation hooks exist to match a dark
MUI palette?

Versions inspected (installed in `web/node_modules`): `@kusto/monaco-kusto` 15.0.1, `monaco-editor`
0.55.1, `@monaco-editor/react` 4.7.0. All sources below are the published package files; paths are
relative to `web/node_modules/`.

## Answer

1. **Yes, there are two themes: `kusto-light` and `kusto-dark`.** monaco-kusto calls
   `monaco.editor.defineTheme` for both when `release/esm/monaco.contribution` is imported. The app
   has to select one; monaco-kusto never calls `setTheme`.
2. **Monaco has one theme for the whole page.** `monaco.editor.setTheme(name)` and the `theme`
   editor option both set it, and so does the `theme` prop of `@monaco-editor/react`, which defaults
   to `"light"`. Every editor on the page shares that theme, YAML/JSON ones included, and the last
   call wins.
3. **The Kusto themes are safe for YAML/JSON.** They `inherit` from `vs`/`vs-dark`, so YAML/JSON tokens
   fall back to the stock colours. Some Kusto rules (`keyword`, `comment`, `type`, `''`) also match
   YAML/JSON tokens by prefix.
4. **Customisation:** `monaco.editor.defineTheme(name, { base, inherit: true, rules, colors })`. This
   is the only hook. It sets token colours (`rules`) and UI colours (`colors`, such as
   `editor.background`). Calling `defineTheme` again for the active theme name re-applies it.

## Evidence

### monaco-kusto 15 themes

- `@kusto/monaco-kusto/release/esm/syntaxHighlighting/themes.js` defines
  `ThemeName.light = 'kusto-light'` and `ThemeName.dark = 'kusto-dark'` and exports
  `themes = [{ name, data }]`. Settings of `kusto-dark`:
  - `base: 'vs-dark'` and `inherit: true`.
  - Its `colors` override two keys:
    - `editor.background: '#1B1A19'`
    - `editorSuggestWidget.selectedBackground: '#004E8C'`
  - Its token `rules` cover 25 Kusto token types and the default `''`:
    - `plainText`, `identifier` and the `''` default: `#DCDCDC`
    - `comment`: `#608B4E`
    - `stringLiteral`: `#D69D85`
    - `keyword`, `function`, `type` and `command`: `#569CD6`
    - `queryOperator`: `#4EC9B0`
    - `table`, `database` and `materializedView`: `#D7BA7D`
    - `column`: `#DB7093`
    - `parameter` and `variable`: `#92CAF4`
    - `clientParameter` and `queryParameter`: `#2B91AF`
  - `kusto-light` is `base: 'vs'` with the matching light palette. It sets no `colors`.
- `@kusto/monaco-kusto/release/esm/monaco.contribution.js`, lines ~141-144:
  `themes.forEach(({name, data}) => monaco.editor.defineTheme(name, data))`. This runs once, as a
  side effect of the import (in TIM that import is in `loadMonacoKusto()`). The package contains no
  `setTheme` call.
- The `themes`/`ThemeName` exports are **not** re-exported from the `monaco.contribution` entry; only
  `syntaxHighlighting/themes.d.ts` declares them. The package has no `exports` field, so a deep import
  `@kusto/monaco-kusto/release/esm/syntaxHighlighting/themes` resolves. It is not documented API, though,
  and could move between releases.
- `@kusto/monaco-kusto/README.md` changelog:
  - 12.0.0 renamed `kusto-dark2` to `kusto-dark`.
  - 7.2.0 mentions an exported `themeNames` object. 15.0.1 no longer exports it.
  - Very old docs say `kusto.dark`, which is wrong today.

### KQL colouring in TIM today comes from Monarch tokens; semantic tokens are off

- `syntaxHighlighting/kustoMonarchLanguageDefinition.js` emits only these Monarch tokens:
  - `comment`, `punctuation`, `mathOperator` and `stringLiteral`
  - `queryOperator`, `queryParameter`, `type`, `command`, `function` and `keyword`
  - `identifier`
- `table`, `column`, `database`, `materializedView` and the other schema-aware tokens come only from
  the semantic tokens provider (`syntaxHighlighting/SemanticTokensProvider.js`).
- README 12.0.0 says the new highlighting needs the editor option `'semanticHighlighting.enabled': true`.
- In monaco-editor 0.55.1 the option defaults to `'configuredByTheme'`
  (`esm/vs/editor/common/config/editorConfigurationSchema.js:70-77`).
  `isSemanticColoringEnabled` falls back to `themeService.getColorTheme().semanticHighlighting`
  (`esm/vs/editor/contrib/semanticTokens/common/semanticTokensConfig.js:6-12`), and standalone themes
  hard-code `semanticHighlighting = false` (`esm/vs/editor/standalone/browser/standaloneThemeService.js:40`).
  `web/src/components/codeEditorOptions.ts` does not set the option, so **semantic KQL colouring is
  currently off in TIM**. Tables and columns render in the plain identifier colour in either theme.
- When semantic tokens are on, the standalone theme styles them through the same token-theme rules
  (`getTokenStyleMetadata` → `tokenTheme._match(type…)`, `standaloneThemeService.js:149-162`). The
  `table`/`column` rules in `kusto-dark` would then take effect without further work.

### How Monaco switches theme at runtime

- `esm/vs/editor/standalone/browser/standaloneEditor.js:341` defines `monaco.editor.setTheme` as a call
  to the singleton `IStandaloneThemeService.setTheme`.
- `standaloneThemeService.js:282-291` handles an **unknown theme name by silently falling back to `vs`**
  (light), without throwing.
- `_updateThemeOrColorMap` (`standaloneThemeService.js` ~314+) writes CSS variables onto
  `.monaco-editor, .monaco-diff-editor, .monaco-component` and regenerates the token colour CSS. Every
  editor instance on the page changes immediately. No editor needs to be recreated.
- `esm/vs/editor/standalone/browser/standaloneCodeEditor.js:184-185, 220-221`: the `theme` field of
  the create options and of `updateOptions` is forwarded to the same global `setTheme`. A per-editor
  option looks local but is global.
- `standaloneThemeService.js:255-273`, `defineTheme`:
  - The theme name must match `/^[a-z0-9\-]+$/i`.
  - `base` must be `vs`, `vs-dark`, `hc-black` or `hc-light`.
  - Redefining the **currently active** theme name re-applies it.
- `@monaco-editor/react` 4.7.0 (`dist/index.mjs`, `dist/index.d.ts`):
  - `Editor` takes `theme = "light"` by default. (`"light"` is not a defined Monaco theme, so it
    resolves to `vs` through the fallback above.)
  - It calls `monaco.editor.setTheme(theme)` on mount and in an effect whenever `theme` changes.

## Effect on TIM's editors

- One `CodeEditor` serves all four editor screens: `KustoQueryTab` (KQL), `TemplateQueryTab` (KQL),
  `TemplateYamlEditor` (YAML) and `TemplateDialog`. It passes no `theme` prop today, so every mount calls
  `setTheme('light')` → `vs`.
- In dark mode, every `CodeEditor` must receive the same theme name from one source (the MUI palette
  mode). Otherwise any editor that mounts without the prop resets the whole page to light. Two
  editors on one page cannot have different themes.
- `kusto-dark` is registered only after `loadMonacoKusto()`. A YAML/JSON-only screen goes through
  `loadMonaco()` alone. There, `theme="kusto-dark"` resolves to light `vs` with no error. Later
  loading the Kusto contribution does not fix this: the active theme object is now `vs`, not
  `kusto-dark`, so the redefine-refresh does not fire. Each theme TIM uses has to be defined in
  `loadMonaco()` (the core path), or `loadMonaco()` has to import the Kusto contribution.
- YAML (Monarch `*.yaml` tokens) and JSON under `kusto-dark` look like `vs-dark`, plus prefix matches
  from the Kusto rules (for example `keyword.yaml` gets `#569CD6`, `comment.yaml` gets `#608B4E`).
  These are acceptable dark colours.

## Customisation hooks for a dark MUI palette

- **Own theme:** call `monaco.editor.defineTheme('tim-dark', { base: 'vs-dark', inherit: true, rules,
  colors })`. Copy the Kusto `rules` by value, or deep-import `themes` (not public API). Map MUI tokens
  in `colors`:
  - `editor.background`: `palette.background.paper` or `default`
  - `editor.foreground`
  - `editorGutter.background`
  - `editorLineNumber.foreground`
  - `editorWidget.background`
  - `editorSuggestWidget.background`
  - `editorSuggestWidget.selectedBackground`
  - `editorHoverWidget.background`
  - `editor.selectionBackground`
  - `focusBorder`

  Define a light counterpart such as `tim-light` the same way.
- **Restyling at runtime:** calling `defineTheme` again with the active name (for example after a
  palette change) restyles every editor in place.
- **Colour format:** colours must be hex strings (`#RRGGBB` or `#RRGGBBAA`). MUI's `rgba(...)`
  values and CSS variables are not accepted by Monaco's colour parser (`Color.fromHex` in
  `StandaloneTheme.getColors`, `standaloneThemeService.js` ~71-80), so they need converting first.
- **Background mismatch:** MUI dark `background.paper` gets an elevation overlay. `kusto-dark`'s
  `#1B1A19` will not match MUI's default `#121212` without an override.
- **Semantic highlighting:** opt in with `'semanticHighlighting.enabled': true` in
  `DEFAULT_EDITOR_OPTIONS`. A theme cannot opt in, because standalone themes hard-code
  `semanticHighlighting = false`. This is an independent change, but it determines whether the
  `table`/`column` colours ever appear.
- **High contrast:** `autoDetectHighContrast` (default on) can swap to `hc-black`/`hc-light` under
  `forced-colors: active` (`standaloneThemeService.js` `_onOSSchemeChanged`).

## Testing notes

- `web/src/components/CodeEditor.test.tsx` mocks `@monaco-editor/react` and records the props passed
  to `Editor` (`h.editorProps`). The feature tests mock `CodeEditor` entirely.
- A theme prop can therefore be asserted on the recorded props. The theme registration
  (`defineTheme` in `loadMonaco`) needs a test against a faked `monaco.editor`, because Monaco does
  not render under jsdom.
