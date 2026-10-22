---
status: accepted
date: 2026-10-20
---

# Params are bound, never templated

Query templates were rendered with Handlebars in the browser, so the server ran whatever text it received, and quoting was the template author's job. Params are now resolved on the server by the action's Python and sent to the connection as bind parameters. Query text is never rewritten with values.

- **Kusto.** Values go in `ClientRequestProperties` query parameters as Kusto literals, and lists become `dynamic`. Action files declare them with `declare query_parameters(...)`. For a preset's query parameters on Run KQL, TIM prepends that declaration from their names and types.
- **Snowflake.** Server-side positional binds (`paramstyle=numeric`). The hook renames `:name` to `:N` with a tokenizer that skips string literals, comments and `::` casts, which is the only rewrite. Lists are bound as JSON text and parsed in the query with `PARSE_JSON` and `FLATTEN`. The connector's default `pyformat` binds on the client, so it isn't used.
- **Presets bind too.** A preset's fixed values and From-row values are params like any other; a fixed query parameter is still bound.

Decided by the user. Related: [0017](0017-actions-from-providers.md), [0018](0018-fixed-connections.md), [actions](../actions.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Handlebars templates rendered in the browser | Any text shape; no server logic | The server runs arbitrary text; escaping helpers per literal kind; needs `'unsafe-eval'` in the CSP |
| Templates rendered on the server | One place to escape | Still splices values into text; quoting rules differ per connection type |
| Snowflake `pyformat` (client-side) binding | Named placeholders out of the box | Not server-side binding; authors must write `%%` in `LIKE` |
| Expanding lists into `IN (?, ?, …)` | Familiar SQL | Rewrites the query per call; the connector can't bind into `IN` lists |

## Consequences

- An action file's KQL must declare its params with `declare query_parameters(...)`.
- Snowflake SQL that takes a list parses JSON in the query.
