---
status: accepted
date: 2026-09-29
---

# AG Grid Enterprise only; licence key optional (trial mode without it)

The UI depends on AG Grid Enterprise features, and the Community build silently loses them, so TIM uses `ag-grid-react` + `ag-grid-enterprise` as the only build. The licence key is optional everywhere, production included: without it the grid runs in trial mode.

The Enterprise features the UI relies on:

- the context menu, which is the only UI for pivots and tagging
- set and multi filters
- the side bar
- the status bar
- row grouping and aggregation
- range selection

- Use `ag-grid-react` + `ag-grid-enterprise` (current major version). **Enterprise is the only build**; there is no Community build, fallback or feature flag.
- The licence key is runtime config: `agGridLicenseKey` in `/config.js`, from env `AGGRID_LICENSE` (`VITE_AGGRID_LICENSE_KEY` in the Vite dev server). It is optional in every environment; no deployment check requires it.
- When set, the key is applied via `LicenseManager.setLicenseKey`. When empty, the web container logs one info line, writes an empty `agGridLicenseKey` to `config.js`, and the grid runs in trial mode (watermark and console notice accepted).
- Enterprise code may be used anywhere it's natural; grid configuration still lives in `web/src/features/grid/` for cohesion, not to keep a Community path open.

Decided by the user: keep using the trial, and don't support Community. Related: [architecture.md](../architecture.md), [configuration.md](../configuration.md).

## Consequences

- Development, testing and production all use the real Enterprise UI.
- No work is spent on a custom context menu, side bar or Community-compatible filters.
- Deployments need no licence key; adding one only removes the trial watermark.
