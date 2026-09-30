# Legacy UI screenshot harness

Runs the **legacy Vue frontend** with no backend and no Azure AD, and captures a scripted walkthrough of every screen with Playwright. Output: `docs/current-system/screenshots/`.

Use it to (a) regenerate reference screenshots, (b) check how a legacy screen behaves, (c) later, point `flow.mjs`-style scripts at the React app for visual parity checks.

## How it works
| Piece | What it does |
|---|---|
| `vite.config.mjs` | Serves `frontend/` with `@/helpers/auth` aliased to `stubs/auth.js`, API base = `http://localhost:5199/`, and `ag-grid-enterprise` injected into `main.js` (the prod Docker "enterprise" build does the same via `sed`). Unlicensed → watermark/console warning; fine for docs. |
| `mocks.mjs` | Playwright `page.route` handlers for every `/api/*` call: 4 templates (query / managed query / view / deleted), 40 StormEvents-like rows with `EventId`, `EventTime`, `TagEvent`, schema, query run. Edit here to change fixtures. |
| `flow.mjs` | The walkthrough. Each `step()` is isolated; a failure logs `STEP FAILED` and continues. |

## Run
```bash
# once
cd frontend && npx yarn@1 install --frozen-lockfile --ignore-engines && cd -
cd tools/legacy-screenshots && npm install && npx playwright install chromium
# Linux needs Chromium system libs once (needs sudo; nvm users keep PATH):
#   sudo env "PATH=$PATH" npx playwright install-deps chromium

npm run serve &          # vite on :5173
npm run shots            # writes NN-name.png into docs/current-system/screenshots
```
Screenshots are numbered in capture order; `00-share-missing-params.png` was captured separately.

Gotchas: Vuetify 2 open menus have class `.menuable__content__active`; there are two `.v-navigation-drawer`s (side tree and detail panel) — select with `:has(.v-treeview)`.
