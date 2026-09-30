# Legacy system overview

TIM ("triage and investigation") lets analysts run KQL against Azure Data Explorer (Kusto), pivot from result rows into other queries through shared **query templates**, and tag or comment on events. An investigation is a **tree of tabs**: each pivot creates a child tab.

Details: [backend-api.md](backend-api.md) · [frontend-architecture.md](frontend-architecture.md) · [frontend-components.md](frontend-components.md) · [data-models.md](data-models.md) · [workflows.md](workflows.md) · [infrastructure.md](infrastructure.md) · [known-issues.md](known-issues.md).

## Architecture

```
 Browser (SPA, hash routes)                         Azure
 ┌───────────────────────────────┐   MSAL popup   ┌──────────────────────┐
 │ Vue 2 + Vuetify + AG Grid     │───────────────►│ Entra ID             │
 │ Monaco (Kusto language)       │  token aud     │ (1 app reg: SPA+API) │
 │ Handlebars (template → KQL)   │  api://<cid>   └──────────▲───────────┘
 │ IndexedDB: tabs, rows,        │                           │ OBO exchange
 │   column views, query options │                           │
 └──────────────┬────────────────┘                ┌──────────┴───────────┐
                │ /api/*  (nginx proxy)           │ .NET 6 backend       │
                └────────────────────────────────►│  templates CRUD      │
                                                  │  async query runs    │
                                                  │  tag ingestion       │
                                                  └───┬─────────┬────────┘
                         user token (OBO) ┌───────────┘         │ app identity
                                          ▼                     ▼
                              ┌─────────────────────┐  ┌───────────────────────────┐
                              │ Kusto clusters the  │  │ Tag cluster/db (Research) │
                              │ user queries        │  │ SavedEvent, EventTag,     │
                              └─────────────────────┘  │ EventComment (append-only)│
                                                       └───────────▲───────────────┘
   Couchbase | Mongo | Redis  ◄── backend: QueryTemplate,          │ read back by
   (DATABASE_TYPE)                KustoQueryRun                    │ getTagEvents KQL
                                                                   │ (runs as user)
```

Key points:
- **Most state lives in the browser.** Investigations (tabs, cached results, column views) are never sent to the server.
- **Template rendering is client-side.** The backend only ever receives the final KQL text.
- **Tag data round-trips through Kusto.** Writes go through the backend's ingestion. Reads are a KQL join (`{{> getTagEvents}}`) inside the user's own query.

## Tech stack

| Layer | Legacy | Rewrite (see [ADR-0001](../decisions/0001-react-python-rewrite.md)) |
|---|---|---|
| UI framework | Vue 2.7, Vuetify 2.6, Vuex 3, vue-router 3 (hash) | React + TypeScript (UI library: Q-012) |
| Grid | AG Grid 29 **Enterprise** features | AG Grid (licence: Q-002) |
| Editor | Monaco 0.35 + `@kusto/monaco-kusto` | same libraries |
| Auth (SPA) | `@azure/msal-browser` v2, popup | `@azure/msal-react` (Q-003) |
| Browser storage | localforage (IndexedDB) | IndexedDB (Q-005) |
| Templating | Handlebars, js-yaml | Q-006 |
| Build | Vite 3 | Vite |
| Backend | .NET 6, Newtonsoft, Kusto SDK, MSAL.NET | Python 3.12, FastAPI, `azure-kusto-data`/`-ingest`, `msal` |
| Persistence | Couchbase / Mongo / Redis | Q-001 |
| Deploy | Docker (nginx + aspnet), compose, Helm (broken) | Q-016 |

## Glossary

| Term | Meaning |
|---|---|
| **Display component** / **tab** | One investigation node in the side tree. Either `KustoQueryResult` or `TemplateQueryResult`. Stored in IndexedDB `display_components`; its result rows go in `row_results`. |
| **KustoQueryResult** | Ad-hoc tab: free KQL, cluster/database, time range. |
| **TemplateQueryResult** | Tab created from a template. Holds a **snapshot** of the template plus the input params (`inParams`). |
| **Query template** | Server-stored, shared definition: Handlebars KQL, summary, cluster/database (which may be templated), params, fields, columns, menu path. |
| **View vs query** (`queryType`) | `view` templates appear in the **New** menu (start points). `query` templates appear in the grid **context menu** as pivots and need `fields`. |
| **Param** | Template input the user fills in the form (`type`: string default, `array` with `values`, `boolean`). Has `default`, `optional`, `multiple`, `hint`. |
| **Field** | Template input filled **from the grid row(s)** when pivoting. The field name is the column name. `type: multiple` takes the `from` column across selected rows; `type: match` takes columns whose name matches `regex`. Any other type is copied from the clicked row. |
| **Pivot** | Right-clicking a row and choosing a query template. Creates a child TemplateQueryResult. It auto-runs if all params are complete (`isDataComplete`). |
| **Managed template** | `isManaged: true`: maintained in source control; read-only in the Query Manager. |
| **Path / menu** | `path` is the submenu path (e.g. `["Machine","Windows"]`); `menu` is the item text. |
| **Columns** (template) | Map of column name → AG Grid `ColDef` overrides. The key `default` applies to all other columns. |
| **columnId** | Row identity column (default `EventId`). |
| **Column view** | Named, saved AG Grid column state. **Global** across all tabs; browser-only. |
| **Query options** | Per-template `{hide}` flag in IndexedDB. Honoured by the menus, but no UI sets it. |
| **Saved event** | Snapshot of a row ingested into `SavedEvent`. A row must be saved before tags or comments are added. |
| **Determination** | `malicious` / `suspicious` / `benign` (lowercase when stored; `removed` + `isDeleted` to clear). Drives row colour. |
| **TagEvent** | Dynamic column added by `getTagEvents`: `{IsSaved, Tags[], Determination, Comment, Comments[]}`. |
| **Query run** | Server-side async execution record (`KustoQueryRun`): `created` → `completed` / `error`, polled by the client. |
| **Share link** | `#/share/<templateUuid>?p=<base64 params>&execute=0|1`. |
| **Tag cluster / database** | Where the tag tables live (config `tagCluster` / `tagDatabase`, backend `KUSTO_CLUSTER_URI` / `KUSTO_DATABASE_NAME`). |
