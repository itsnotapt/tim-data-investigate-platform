---
status: accepted
date: 2026-10-20
---

# Actions are Python classes from installed providers, configured by YAML files

TIM stops being a Kusto query tool and runs actions instead, which needs an extension point that third parties can ship code for while operators configure what their instance offers. An action type is a Python subclass of `Action` (or `Sink`) in a provider, a package found through the `tim.actions` entry-point group. An action is a configured instance of one, written in Python or as a YAML action file, and everything is loaded once, at startup.

- **Providers.** A package's entry point returns `Provider(actions, action_types, hooks)`: actions, file-capable action types and connection types with their hooks. TIM's built-ins register the same way. The interface ships in the `tim-actions` distribution ([0021](0021-tim-actions-and-derived-images.md)).
- **Action types and actions.** An action type implements `run(params, ctx)`, synchronous, yielding rows. TIM runs it in a worker thread, and cancels through `Hook.cancel()`. An action is a configured instance with a stable `key`, a name, a menu path, declared params (`Param`), an optional `id` and optional columns.
- **Params are data.** Params, and the columns a pivot resolves them from (`from_columns`), are declared, so TIM can validate them, build the form and filter the right-click menu without running code. `resolve()` and `pivot_columns()` can be overridden for logic that needs code, and that is why pivots are resolved on the server.
- **Action files.** A file-capable action type declares a `type_name` and a pydantic `File` model. Action files name the type and give its configuration. Most actions are files; Python is for actions that need code.
- **Startup only.** Action files come from package data and one instance directory (`TIM_ACTIONS_DIR`). Any error (a bad file, a duplicate key, a missing connection) stops startup, with file:line errors. `tim-api check` runs the same validation offline.
- **`id`.** TIM never makes up an `id`, and rows without one can't be annotated (0020). Superseded by [0025](0025-ids-from-the-id-column-in-the-browser.md): an action's `id` names a column, and the browser takes each row's `id` from it.

Code: the interface in `api/tim-actions/src/tim_actions/` (`action.py`, `params.py`, `provider.py`), action files in `api/tim-actions/src/tim_actions/files.py`, loading and validation in `api/src/tim_api/actions/registry.py`, `tim-api check` in `api/src/tim_api/cli.py`.

Decided by the user. Related: 0018, 0019, [0021](0021-tim-actions-and-derived-images.md), [architecture](../architecture.md), [actions](../actions.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Airflow hooks and providers | Existing hooks for Kusto and Snowflake; a known pattern | Both providers pull in all of Airflow core (about +169 packages / +512 MB); core caps FastAPI; `import airflow` takes over logging; neither hook can run as the analyst. The pattern is copied instead |
| Uploading action code at runtime | No image build | Replicas disagree; arbitrary code through the API |
| Templates only (YAML with text substitution) | No Python | Pivot logic, computed params and new connection types need code |
| Python only | One format | Most actions are a query and some params; YAML is checkable by a schema and could later be stored in Postgres |
| Live reload of action files | No restart | Replicas disagree, actions vanish under in-flight pivots and presets, and browsers need a catalogue-changed signal |

## Consequences

- Adding an action type means building a derived image; adding an action file means a restart.
- A rolling update with a broken file never becomes ready, and the old pods keep serving.
- The browser re-fetches `GET /api/instance` when its `version` changes, so a rolling update reaches open tabs.
