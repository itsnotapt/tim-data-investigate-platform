---
status: accepted
date: 2026-09-29
---

# AG Grid Enterprise only (trial in development, licensed in production)

The legacy UI depends on AG Grid Enterprise features, and its community build silently loses them (BUG-43), so TIM uses `ag-grid-react` + `ag-grid-enterprise` as the only supported build. No licence key is available today, so the grid runs as a trial without one.

The Enterprise features the legacy UI relies on:

- the context menu, which is the only UI for pivots and tagging
- set and multi filters
- the side bar
- the status bar
- row grouping and aggregation
- range selection

The legacy app shipped two builds (community and enterprise). A licence will be obtained later.

- Use `ag-grid-react` + `ag-grid-enterprise` (current major version). **Enterprise is the only supported build**; there is no Community build, fallback or feature flag.
- During development the grid runs **without a licence key** (trial). The watermark and console warning are accepted.
- The licence key is runtime config (`agGridLicenseKey` in `/config.js`, from env `AGGRID_LICENSE`). It's applied when present. It is optional in development and **required for production deployments** (deployment docs and the prod entrypoint check it). This production requirement was withdrawn by the 2026-09-30 amendment described below.
- Enterprise code may be used anywhere it's natural; grid configuration still lives in `web/src/features/grid/` for cohesion, not to keep a Community path open.

Amendment 2026-09-30, licence key optional everywhere: by user decision there is no production deployment and no analysts, and the AG Grid Enterprise trial (no key) must work everywhere, including the production compose/container. The "required for production" rule above (and the fail-fast entrypoint from Q-027) is withdrawn. `AGGRID_LICENSE` stays optional: when set it is applied via `LicenseManager.setLicenseKey`; when empty the container logs one info line, writes an empty `agGridLicenseKey` to `config.js`, and the grid runs as a trial (watermark and console notice accepted). Enterprise remains the only build (no Community fallback).

Decided by the user (Q-002: "keep using the trial"; Q-027: "assume we will get a licence, use trial for now; don't support community"). Related: Q-002, Q-027, BUG-43.

## Consequences

- Development and parity testing use the real Enterprise UI (same as the screenshots).
- No work is spent on a custom context menu, side bar or Community-compatible filters.
- ~~Production deploy needs the purchased licence key configured; this is a deployment prerequisite.~~ Withdrawn by the 2026-09-30 amendment above.
