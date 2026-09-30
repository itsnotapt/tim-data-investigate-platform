# 0006. AG Grid Enterprise only (trial in development, licensed in production)

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** the user (Q-002: "keep using the trial"; Q-027: "assume we will get a licence, use trial for now; don't support community")
- **Related:** Q-002, Q-027, BUG-43

## Context
The legacy UI depends on AG Grid Enterprise features:
- the context menu, which is the only UI for pivots and tagging
- set and multi filters
- the side bar
- the status bar
- row grouping and aggregation
- range selection

The legacy app shipped two builds (community and enterprise); the community build silently loses these features (BUG-43). No licence key is available today, but one will be obtained.

## Decision
- Use `ag-grid-react` + `ag-grid-enterprise` (current major version). **Enterprise is the only supported build**; there is no Community build, fallback or feature flag.
- During development the grid runs **without a licence key** (trial). The watermark and console warning are accepted.
- The licence key is runtime config (`agGridLicenseKey` in `/config.js`, from env `AGGRID_LICENSE`). It's applied when present. It is optional in development and **required for production deployments** (deployment docs and the prod entrypoint check it).
- Enterprise code may be used anywhere it's natural; grid configuration still lives in `web/src/features/grid/` for cohesion, not to keep a Community path open.

## Consequences
- Development and parity testing use the real Enterprise UI (same as the screenshots).
- No work is spent on a custom context menu, side bar or Community-compatible filters.
- Production deploy (P5-08, P5-11) needs the purchased licence key configured; this is a deployment prerequisite, not an open question.
