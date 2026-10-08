---
status: accepted
date: 2026-09-29
---

# Repo layout: `web/` + `api/`

The legacy apps live in `frontend/` (Vue) and `backend/` (.NET), managed by release-please as separate packages, and the rewrite needs room to grow alongside them until cut-over. The new React app goes in **`web/`** and the new Python app in **`api/`**, both at the repo root.

- Legacy `frontend/` and `backend/` stay untouched (read-only reference) until cut-over, then get deleted in one change (work-breakdown P5).
- Each new app has its own README, tooling config and Dockerfile. CI gets separate workflows (`build-web.yml`, `build-api.yml`), path-filtered like the legacy ones.
- `web` and `api` are added as release-please packages when the first release is cut. Until then they aren't versioned.

Decided by the user (Q-019). Related: Q-019, Q-016, [architecture.md](../architecture.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Replace `frontend/`/`backend/` in place | Keeps familiar paths | Loses the side-by-side reference; messy history |
| Separate repos | Independent CI | Harder to keep the docs and both apps in step |
| `web/` + `api/` (chosen) | Legacy and new side by side; clear names | Temporary duplication until cut-over |

## Consequences

RULES §3 no longer says "pending ADR-0003". P1 scaffolding tasks can start.
