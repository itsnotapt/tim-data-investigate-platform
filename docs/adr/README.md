# Architecture Decision Records

An ADR records a decision and why it was made. ADRs are the only place in the docs for rationale and history; the rest of `docs/` describes the system as it is.

Write an ADR only when all three hold:

1. **Hard to reverse**: changing your mind later is costly.
2. **Surprising without context**: a future reader would wonder why it was done this way.
3. **A real trade-off**: there were genuine alternatives and one was picked for specific reasons.

If any test fails, skip the ADR.

Typical subjects:

- architectural shape;
- technology choices with lock-in;
- boundary and scope decisions, including what TIM deliberately does not do;
- deliberate deviations from the obvious path;
- constraints not visible in the code;
- rejected alternatives whose rejection is not obvious.

## Adding an ADR

1. Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md` with the next free number: the highest existing number plus one. Numbers are never reused or renumbered.
2. Write the title and, under it, one to three sentences: the context, what was decided, and why. Further detail may follow as paragraphs, lists or tables without headings.
3. Add `## Considered Options` only when the rejected alternatives are worth remembering, and `## Consequences` only when non-obvious downstream effects need calling out. No other headings.
4. Set `status` in the frontmatter: `proposed` while it awaits agreement, `accepted` once agreed. Only accepted ADRs are binding. Set `date` to the day of the decision.
5. Add a row to the table below.
6. When a decision changes, edit its ADR in place. When it's replaced, delete the ADR and write the replacement under a new number; an old approach worth remembering becomes a row in the new ADR's Considered Options. Numbers are never reused.

## Format

Each ADR is `docs/adr/NNNN-slug.md` (four digits, lowercase hyphenated slug) and has this shape:

```md
---
status: accepted
date: 2026-10-07
---

# Short title of the decision

One to three sentences: the context, what was decided, and why.

## Considered Options

## Consequences
```

- The frontmatter has exactly the keys `status` and `date`, in that order. `status` is one of `proposed`, `accepted` or `deprecated`; `date` is `YYYY-MM-DD`.
- The first line after the frontmatter is the only H1, the title, without a number.
- The paragraph under the title is prose of one to three sentences.
- The only H2 headings are `## Considered Options` and `## Consequences`, both optional, in that order. There are no deeper headings.

## Index

Numbers are never reused, so the sequence has gaps.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-react-python-web-api.md) | TIM is React + Python in `web/` and `api/` | accepted | 2026-09-29 |
| [0004](0004-postgresql-persistence.md) | PostgreSQL for templates, runs and annotations | accepted | 2026-09-29 |
| [0005](0005-auth-entra-popup-obo.md) | Auth: single Entra app, popup login, OBO to connections | accepted | 2026-09-29 |
| [0006](0006-ag-grid-enterprise.md) | AG Grid Enterprise only; licence key optional (trial mode without it) | accepted | 2026-09-29 |
| [0007](0007-docs-describe-current-state.md) | Docs describe the current system; rationale lives in ADRs | accepted | 2026-10-06 |
| [0008](0008-helm-chart.md) | Helm chart for Kubernetes deployment | accepted | 2026-10-06 |
| [0009](0009-obo-token-exchange.md) | OBO token exchange: one shared MSAL app, scope per connection | accepted | 2026-10-06 |
| [0010](0010-kusto-cluster-allow-list.md) | Kusto cluster allow-list | accepted | 2026-10-07 |
| [0011](0011-development-only-modes.md) | Development-only modes refuse to run in production | accepted | 2026-10-06 |
| [0012](0012-query-run-limits-and-lifecycle.md) | Run limits and lifecycle | accepted | 2026-10-06 |
| [0013](0013-tag-ingestion.md) | Tag ingestion runs as the app identity | accepted | 2026-10-06 |
| [0014](0014-web-auth-token-cache.md) | Web sign-in: token cache in localStorage | accepted | 2026-10-06 |
| [0015](0015-kql-templating.md) | KQL templating in the browser | accepted | 2026-10-06 |
| [0016](0016-release-versions.md) | Release versions for frontend, backend, the Helm chart and tim-actions | accepted | 2026-10-07 |
| [0017](0017-actions-from-providers.md) | Actions are Python classes from installed providers, configured by YAML files | accepted | 2026-10-20 |
| [0018](0018-fixed-connections.md) | Fixed connections | accepted | 2026-10-20 |
| [0019](0019-params-are-bound.md) | Params are bound, never templated | accepted | 2026-10-20 |
| [0020](0020-annotations-in-postgres.md) | Annotations in Postgres keyed by `id`, with a change feed | accepted | 2026-10-20 |
| [0021](0021-tim-actions-and-derived-images.md) | The `tim-actions` distribution and derived images | accepted | 2026-10-20 |
