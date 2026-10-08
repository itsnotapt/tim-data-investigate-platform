# 0015. KQL templating in the browser

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** the user
- **Related:** [0014](0014-web-auth-token-cache.md), [0012](0012-query-run-limits-and-lifecycle.md), [architecture](../architecture.md)

## Context
A query template holds Handlebars source for its cluster, summary and KQL, plus declared params and fields. The browser fills in values from a clicked row, selected rows or a form, then sends the rendered KQL to `POST /api/kusto/query`. Templates are shared and managed, not typed by each user. Code: `web/src/lib/kql-templates/` (`engine.ts`, `escape.ts`, `params.ts`), `web/src/features/template-query/`, `web/src/features/new-query/`, `web/src/features/pivots/`.

## Decision
- **Handlebars, rendered client-side**, in an isolated environment (`Handlebars.create()`), so other code cannot change helpers or output. HTML escaping is off (`noEscape`), because the output is KQL.
- **Escaping is done only by three helpers:**
  - `{{array xs}}` gives `@'a','b'` (verbatim literals, quotes doubled);
  - `{{str x}}` gives one `@'x'` verbatim literal, quotes doubled;
  - `{{kql x}}` gives one regular `'x'` literal, with backslash, quotes, newline, CR and tab escaped.
- **A raw `{{x}}` is substituted unchanged.** Template authors are trusted. A template that puts a user-controlled value in raw is open to KQL injection, and nothing in the engine prevents that. Templates must use a helper for any value that comes from data.
- **Template runs send no time range.** `runTemplateQuery` calls the shared pipeline without `timeRange`, so `startTime` and `endTime` are omitted. The template's KQL does its own time filtering.
- **An empty list is a blank parameter.** In the form, a required field whose value is an empty list fails the "Required." check (`paramRules.ts`). For a new pivot query, a `multiple` field needs at least one entry and a `match` field exactly one matching column (`isDataComplete`). A query that is not complete opens in edit mode and is not auto-run.
- **Menu folders are keyed by full path.** The same folder name under different parents (for example `Machine/Windows` and `User/Windows`) gives separate folders (`templateMenuTree.ts`).

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Escape every value automatically | Safe by default | Breaks templates that use raw values for KQL fragments or identifiers |
| Render on the server | Trusted place for escaping. Keeps `unsafe-eval` out of the CSP | The preview and edit-in-browser flow would need a round trip. Larger change from current behaviour |
| Send a time range with template runs | Uniform with ad-hoc queries | Templates differ in what time means. A second filter could conflict with the template's own |
| Run incomplete pivots anyway | Fewer clicks | Runs a query with a missing value, or an ambiguous `match` |

## Consequences
- Template authors carry the escaping responsibility. Review templates for raw `{{x}}` on values that come from rows or user input.
- Compiling templates in the browser needs `'unsafe-eval'` in `script-src` (see `web/docker/nginx.conf.template`).
- A template with no time filter scans whatever its KQL scans, within the limits in [0012](0012-query-run-limits-and-lifecycle.md).
