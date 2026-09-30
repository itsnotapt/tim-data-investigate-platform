# 0003. Repo layout: `web/` + `api/`

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** the user (Q-019)
- **Related:** Q-019, Q-016, [target-architecture.md](../rewrite/target-architecture.md)

## Context
The legacy apps live in `frontend/` (Vue) and `backend/` (.NET), and release-please manages them as separate packages. The rewrite needs room to grow alongside them until cut-over.

## Decision
- New React app in **`web/`**, new Python app in **`api/`**, both at the repo root.
- Legacy `frontend/` and `backend/` stay untouched (read-only reference) until cut-over, then get deleted in one change (work-breakdown P5).
- Each new app has its own README, tooling config and Dockerfile. CI gets separate workflows (`build-web.yml`, `build-api.yml`), path-filtered like the legacy ones.
- `web` and `api` are added as release-please packages when the first release is cut. Until then they aren't versioned.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Replace `frontend/`/`backend/` in place | Keeps familiar paths | Loses the side-by-side reference; messy history |
| Separate repos | Independent CI | Harder to keep the docs and both apps in step |
| `web/` + `api/` (chosen) | Legacy and new side by side; clear names | Temporary duplication until cut-over |

## Consequences
RULES §3 no longer says "pending ADR-0003". P1 scaffolding tasks can start.
