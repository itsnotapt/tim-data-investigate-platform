# Architecture Decision Records

An ADR records a decision and why it was made. ADRs are the only place in the docs for rationale and history; the rest of `docs/` describes the system as it is.

Write an ADR only when all three hold:

1. **Hard to reverse**: changing your mind later is costly.
2. **Surprising without context**: a future reader would wonder why it was done this way.
3. **A real trade-off**: there were genuine alternatives and one was picked for specific reasons.

Typical subjects: architectural shape, technology choices with lock-in, boundary and scope decisions (including what TIM deliberately does not do), deliberate deviations from the obvious path, constraints not visible in the code, and rejected alternatives whose rejection is not obvious. If any test fails, skip the ADR.

## Adding an ADR

1. Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md` with the next free number. Numbers are never reused or renumbered.
2. Write the context, the decision and why in a few sentences. Add considered options or consequences only when they are worth remembering.
3. Set the status: **Proposed** while it awaits agreement, **Accepted** once agreed. Only Accepted ADRs are binding.
4. Add a row to the table below.
5. To replace a decision, write a new ADR and set the old one to **Superseded by NNNN**. Don't delete or rewrite old ADRs beyond fixing links.

Some ADRs refer to documents from the React + Python migration. Those are preserved at git tag `migration-complete` (`git show migration-complete:docs/<path>`).

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-react-python-rewrite.md) | Rewrite TIM as React + Python | Accepted | 2026-09-29 |
| [0002](0002-docs-as-source-of-truth.md) | `docs/` is the source of truth for the rewrite | Superseded by 0007 | 2026-09-29 |
| [0003](0003-repo-layout.md) | Repo layout: `web/` + `api/` | Accepted | 2026-09-29 |
| [0004](0004-postgresql-persistence.md) | PostgreSQL for templates and query runs | Accepted | 2026-09-29 |
| [0005](0005-auth-entra-popup-obo.md) | Auth: single Entra app, popup login, OBO to Kusto | Accepted | 2026-09-29 |
| [0006](0006-ag-grid-enterprise.md) | AG Grid Enterprise only; licence key optional (trial mode without it) | Accepted | 2026-09-29 |
| [0007](0007-docs-describe-current-state.md) | Docs describe the current system; rationale lives in ADRs | Accepted | 2026-10-06 |
| [0008](0008-helm-chart.md) | Helm chart for Kubernetes deployment | Accepted; image tag and chart version rules superseded by 0016 | 2026-10-06 |
| [0009](0009-obo-token-exchange.md) | OBO token exchange: one shared MSAL app, configurable scope | Accepted | 2026-10-06 |
| [0010](0010-kusto-cluster-allow-list.md) | Kusto cluster allow-list | Accepted | 2026-10-07 |
| [0011](0011-development-only-modes.md) | Development-only modes refuse to run in production | Accepted | 2026-10-06 |
| [0012](0012-query-run-limits-and-lifecycle.md) | Query-run limits and lifecycle | Accepted | 2026-10-06 |
| [0013](0013-tag-ingestion.md) | Tag ingestion runs as the app identity | Accepted | 2026-10-06 |
| [0014](0014-web-auth-token-cache.md) | Web sign-in: token cache in localStorage | Accepted | 2026-10-06 |
| [0015](0015-kql-templating.md) | KQL templating in the browser | Accepted | 2026-10-06 |
| [0016](0016-release-versions.md) | Release versions for frontend, backend and the Helm chart | Accepted | 2026-10-07 |
