# TIM

This repo contains the **legacy** TIM app (`frontend/` Vue 2, `backend/` .NET 6) and a **rewrite in progress** to React + Python.

**Before doing anything, read [docs/RULES.md](docs/RULES.md), then [docs/README.md](docs/README.md) for current status.**

Key rules (details in RULES.md):
- `frontend/` and `backend/` are read-only reference implementations. New code goes in `web/` (React) and `api/` (Python) (ADR-0003).
- Pick work from `docs/rewrite/work-breakdown.md`. Log questions in `docs/open-questions.md`; stop on **Blocking** ones.
- Parity first; don't port bugs listed in `docs/current-system/known-issues.md`.
- Update docs in the same change as code. Commit only when asked, on a `rewrite/<task-id>-name` branch.
