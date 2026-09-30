# 0006. AG Grid Enterprise (unlicensed during development)

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** the user (Q-002: "keep using the trial")
- **Related:** Q-002, Q-027, BUG-43

## Context
The legacy UI depends on AG Grid Enterprise features:
- the context menu, which is the only UI for pivots and tagging
- set and multi filters
- the side bar
- the status bar
- row grouping and aggregation
- range selection

The community build silently loses them (BUG-43). No licence key is available today.

## Decision
- Use `ag-grid-react` + `ag-grid-enterprise` (current major version) from the start, **without a licence key** during development. The watermark and console warning are accepted.
- The licence key is optional runtime config (`agGridLicenseKey` in `/config.js`); it's applied when present.
- Enterprise-specific code is kept inside `web/src/features/grid/` (context-menu builder, side bar, status bar config). Other features call grid-agnostic hooks, so a Community fallback with a custom context menu stays possible.
- **Before the first production deployment**, Q-027 must be answered: buy a licence, or build the Community fallback. AG Grid's terms require a licence for production use of Enterprise features.

## Consequences
Development and parity testing use the real Enterprise UI (same as the screenshots). Deployment task(s) in P5 are blocked by Q-027.
