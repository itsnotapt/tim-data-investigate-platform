# Architecture Decision Records

One file per decision: `NNNN-short-title.md`, numbered in sequence, never renumbered. Copy [0000-template.md](0000-template.md) to start one.

Statuses: **Proposed** (drafted, waiting for the user) → **Accepted** → optionally **Superseded by NNNN** / **Deprecated**. Only Accepted ADRs are binding (see [RULES.md §2](../RULES.md#2-sources-of-truth-in-priority-order)). When a question in [open-questions.md](../open-questions.md) is answered and the answer is architectural, write an ADR and link it from the question.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-react-python-rewrite.md) | Rewrite TIM as React + Python | Accepted | 2026-09-29 |
| [0002](0002-docs-as-source-of-truth.md) | `docs/` is the source of truth for the rewrite | Accepted | 2026-09-29 |
| [0003](0003-repo-layout.md) | Repo layout: `web/` + `api/` | Accepted | 2026-09-29 |
| [0004](0004-postgresql-persistence.md) | PostgreSQL for templates and query runs | Accepted | 2026-09-29 |
| [0005](0005-auth-entra-popup-obo.md) | Auth: single Entra app, popup login, OBO to Kusto | Accepted | 2026-09-29 |
| [0006](0006-ag-grid-enterprise.md) | AG Grid Enterprise (unlicensed during development) | Accepted | 2026-09-29 |
