# TIM

This repo contains the TIM app: `web/` (React) and `api/` (Python, FastAPI). It is a rewrite of the legacy Vue 2 + .NET 6 app, which was removed in P5-12 (last commit containing it: `8a2ff2e`; read it with `git show 8a2ff2e:frontend/...`).

**Before doing anything, read [docs/RULES.md](docs/RULES.md), then [docs/README.md](docs/README.md) for current status.**

Key rules (details in RULES.md):
- New code goes in `web/` (React) and `api/` (Python) (ADR-0003). Legacy behaviour is documented in `docs/current-system/` (historical archive).
- Pick work from `docs/rewrite/work-breakdown.md`. Log questions in `docs/open-questions.md`; stop on **Blocking** ones.
- Keep parity with documented legacy behaviour; don't reintroduce bugs listed in `docs/current-system/known-issues.md` (regression list, see `docs/rewrite/parity-report.md`).
- Update docs in the same change as code. Commit only when asked, on a `rewrite/<task-id>-name` branch.
