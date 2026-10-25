# Actions

The guide for operators and action authors. It covers what configures an instance's actions, how to write action files, and how to check them.

- How TIM loads them is in [architecture.md](architecture.md#actions-and-providers).
- The decisions are [ADR-0017](adr/0017-actions-from-providers.md) and, for connections, [ADR-0018](adr/0018-fixed-connections.md).

## What an instance holds

- **Providers**, installed packages that add action types, Python actions and action files of their own, found through the `tim.actions` entry-point group.
- **Action files**, YAML in one flat directory, `TIM_ACTIONS_DIR` ([configuration.md](configuration.md#actions)).
- **The connections file**, YAML, `TIM_CONNECTIONS_FILE` ([configuration.md](configuration.md#connections)).
- **The labels file**, YAML, `TIM_LABELS_FILE` ([configuration.md](configuration.md#labels-and-annotations)).

All are read once, at startup. Any problem stops startup ([operations.md](operations.md#startup-failures-from-the-files)), so a change to a file takes a restart.

## Action files

An action file holds one or more actions, one YAML document each, with `---` between them. Each action names an installed, file-capable action type in `type`, and gives its `key` and the rest of its configuration. Each document is validated on its own.

```yaml
# yaml-language-server: $schema=./action-file.schema.json
type: acme_query                 # an installed action type's type_name
key: acme.sign_ins               # unique across the instance
name: Sign-ins
menu: Identity / Entra           # the New menu's folders, /-separated
description: Sign-ins for the selected users
pivot: rows                      # row, rows or none
params:
  - name: users
    kind: string
    title: Users
    many: true
    from_columns: [UserPrincipalName, Upn]
  - name: since
    kind: datetime
    required: false
    default: 2026-10-01T00:00:00Z
id: [CorrelationId, RequestId]
columns:
  - {name: Timestamp, type: datetime, pinned: left, sort: desc}
  - {name: IpAddress, type: string, hidden: true}
query_file: sign_ins.kql         # this type's own field, read from a sidecar
---
type: acme_query
key: acme.users
name: Users
pivot: none
query: |
  Users
  | take 100
```

The fields every action file takes:

| Field | Required | Description |
|---|---|---|
| `type` | yes | The action type, by its `type_name`. `tim-api schema actions` lists the installed ones. |
| `key` | yes | Lowercase letters, digits, `_`, `-` and `.`, unique across the instance. The `tim.` prefix is TIM's own. |
| `name` | yes | What analysts see. |
| `menu` | no | A `/`-separated folder path; none puts the action at the top level. |
| `description` | no | A longer description. |
| `pivot` | yes | `row` or `rows` offers the action in the grid's context menu (**Pivot ▸**) on one or several selected rows; `none` keeps it out. A pivot takes at most `TIM_MAX_PIVOT_ROWS` rows. |
| `params` | no | The params, below. |
| `id` | no | The column that gives each row its `id`, or a list of alternative columns. Leave it out and the rows have no `id`, so they cannot be annotated. |
| `columns` | no | Declared result columns, below. |

The action type adds fields of its own, such as a connection and a query.

### Params

| Field | Default | Description |
|---|---|---|
| `name` | required | Starts with a letter or `_`; letters, digits and `_`. |
| `kind` | required | `string`, `number`, `boolean`, `datetime`, `timespan`, `json`, `kql`, `sql` or `connection`. |
| `title` | the name | What the tab shows. |
| `required` | `true` | |
| `default` | none | A value as the browser sends it: a `datetime` is an ISO 8601 string, a `timespan` an ISO 8601 duration or `HH:MM:SS`. |
| `many` | `false` | A list of values. Not for `kql`, `sql` or `connection`. In a pivot it takes the distinct values of the selected rows, in first-seen order. |
| `choices` | none | The values allowed. |
| `connection_type` | none | For `kind: connection` only, which it requires. |
| `schema_from` | none | For `kql` and `sql`: the params that scope the editor's schema, a `connection` param and the others whose values the connection type's hook gets as its scope. |
| `from_columns` | none | The result columns a pivot takes the value from; the first non-empty one wins. A row is offered the action when it has one of each required param's columns. A single-valued param takes the value the selected rows agree on; when they disagree it stays empty for the analyst to fill in. |
| `help` | none | Help text. |

Dates and times in a file stay strings, as the browser sends them.

### Columns

An action can declare some or all of its result columns. Each entry takes:

- `name` and `type`: `string`, `number`, `boolean`, `datetime`, `timespan` or `json`;
- optionally `title`, `hidden`, `width` (pixels), `pinned` (`left` or `right`), `sort` (`asc` or `desc`), `group` and `calculated`.

A `calculated` column isn't in the result.

- It is an AG Grid calculated-column expression over the row's other columns.
- The expression names columns in brackets, such as `[Bytes] / 1024`.
- The tab's grid evaluates it, and places it after the declared column before it.
- Analysts can add their own calculated columns from the grid's column menu.

An entry can name one of TIM's own grid columns to set it up: `tim:label`, `tim:tags`, `tim:commentText` or `tim:comments`.

- It gives that column's `title`, `hidden`, `width`, `pinned`, `sort` and `group`.
- It is shown unless it says `hidden: true`, like any declared column, so declaring `tim:tags` or `tim:commentText` without `hidden: true` shows a column TIM otherwise hides.
- Any other `tim:` name is an error, and so is `calculated` on a `tim:` column.
- The grid places it after the declared column before it, like a calculated column.
- It holds no data and isn't one of the run's columns. `dev_rows` makes no value for it.

The Action file panel in an action tab's side bar, and **Copy column settings (action file)** in the grid's menus, give a `columns:` block from the tab's grid ([architecture.md](architecture.md#action-file-panel)).

The tab's grid uses the declared settings as AG Grid's initial column settings.

- `title` is the header.
- `hidden`, `width`, `pinned`, `sort` and `group` become `initialHide`, `initialWidth`, `initialPinned`, `initialSort` and `initialRowGroup`.
- They apply the first time the grid shows the columns.
- A column state that the analyst has changed, and the tab restored, wins over them.

### Sidecars

A query can be written in one of two places. Give one or the other, not both.

- **Inline:** `query: |`.
- **In a sidecar file** next to the action file, where an editor highlights it: `query_file: sign_ins.kql`.
  - The action type marks which of its fields take a sidecar. For a `kql_query` it is `kql_file`.
  - The sidecar is a file name in the same directory as the action file, not a path.

## Connections file

The connections file lists the instance's **connections**: the fixed endpoints actions run against. It is a YAML list, one entry per connection. Analysts never type an endpoint; they pick a connection by its title.

```yaml
# yaml-language-server: $schema=./connections.schema.json
- name: samples                  # lowercase letters, digits and -, unique
  title: Samples (help cluster)
  type: kusto                    # an installed connection type
  auth: obo
  cluster: https://help.kusto.windows.net
  databases: [Samples]           # suggestions only
```

Every entry has `name`, `title`, `type` and `auth`, and a `scope` for `obo` that some connection types default, plus the fields of its connection type. A connection type comes from an installed provider, which adds a hook for it; an unknown `type` or field stops startup, with the file and line.

`auth` says whose identity the system behind the connection sees.

- **`obo`** runs as the analyst.
  - TIM exchanges the analyst's token for the connection's `scope` ([ADR-0009](adr/0009-obo-token-exchange.md)).
  - An instance that has an `obo` connection needs the OBO credential ([configuration.md](configuration.md#authentication)).
- **`workload_identity`** runs as TIM, and so gives every analyst TIM's access. A `scope` on it stops startup: the connections file refuses it with "scope is only for auth obo".
  - The `snowflake` connection type supports it. The `kusto` connection type supports only `obo`.
  - An instance whose connections all use `workload_identity` needs no OBO credential.

Every analyst sees every connection. The system behind it enforces access.

The `kusto` connection type, from the `kusto` extra of `tim-actions`:

| Field | Required | Description |
|---|---|---|
| `cluster` | yes | The cluster's https URL, checked and normalised to `https://<host>` at startup. |
| `databases` | no | Database names suggested for the `database` param of actions on this connection. The analyst can type another. |
| `scope` | no | The OBO scope, `{cluster}/.default` when left out. |

The `snowflake` connection type, from the `snowflake` extra of `tim-actions`:

| Field | Required | Description |
|---|---|---|
| `auth` | yes | `obo` or `workload_identity`. |
| `account` | yes | The account identifier, such as `myorg-myaccount`. A URL or host name stops startup. |
| `warehouse` | yes | The warehouse that runs the queries. |
| `role` | no | The role to use. Without it, the user's default role. |
| `scope` | for `obo` | The OBO scope, such as `api://<app id>/session:role-any`. There is no default. |

- With `obo`, TIM logs in to Snowflake as the analyst, with an Entra token for `scope` that Snowflake's External OAuth security integration accepts. [deployment.md](deployment.md#snowflake-app-registration-and-external-oauth) sets it up.
- With `workload_identity`, TIM logs in as itself through Snowflake workload identity federation, with a service user the operator creates ([deployment.md](deployment.md#snowflake-workload-identity)).

An action names its connections in two ways:

- **A fixed one.** The action type's `connections()` returns each name, with the connection type it must be. Startup fails when a fixed connection is missing or of the wrong type.
- **A `connection` param.** The analyst picks among the connections of the param's `connection_type`. A connection param whose type has no connection leaves its action out of the catalogue.

Before a run exists TIM gets each `obo` token it needs, so a consent or sign-in problem answers the start request. A hook gets a `token_for(scope)` callable and never sees the analyst's own token.

## Labels file

The labels file lists the instance's **labels**: what analysts can mark a row with. It is a YAML list, one entry per label. Without it the instance has Malicious (red, skull), Suspicious (amber, warning) and Benign (green, check).

```yaml
# yaml-language-server: $schema=./labels.schema.json
- {key: malicious, name: Malicious, colour: red, symbol: skull}
- {key: escalated, name: Escalated, colour: blue, symbol: flag}
- {key: benign, name: Benign, colour: green, symbol: check}
```

| Field | Required | Description |
| --- | --- | --- |
| `key` | yes | What annotations store: 1 to 64 characters, no whitespace, unique in the file. |
| `name` | yes | What analysts see, 1 to 100 characters. |
| `colour` | yes | `red`, `amber`, `green`, `teal`, `blue`, `purple`, `pink` or `grey`. |
| `symbol` | no | `skull`, `warning`, `check`, `flag`, `star`, `question`, `block`, `bug` or `eye`. |

- The file lists at least one label, and no other fields.
- The first nine labels take the keys 1 to 9 in the grid.
- A label is set on an `id`, so a row needs an `id` to be labelled (the `id` field of an action file, or `idColumn` of Run KQL or Run SQL).
- Keep a `key` for good. Annotations store it, so renaming it leaves the old key on every `id` that has it, shown grey. Change `name`, `colour` or `symbol` instead.

## Built-in actions

The built-in provider adds, for each extra of `tim-actions` that is installed, the connection type and actions in this table, and the `kql_query` action type for `kusto`.

| Extra | Adds |
|---|---|
| `kusto` | The `kusto` connection type, the `kql_query` action type and **Run KQL**. |
| `snowflake` | The `snowflake` connection type and **Run SQL**. |

### Run KQL

**Run KQL** (`tim.run_kql`) runs ad-hoc KQL on a Kusto connection, as the analyst. It is in the catalogue when the `kusto` extra is installed and the connections file has a `kusto` connection.

| Param | Description |
|---|---|
| `connection` | A `kusto` connection. When there is exactly one, a new tab fills it in. |
| `database` | The database to query. The tab suggests the chosen connection's `databases`. |
| `kql` | The query, written in the tab's Query editor, scoped by the `connection` and `database` params. |
| `idColumn` | Optional. The result column that gives each row its `id`; without it rows have no `id`. |
| `parameters` | Optional, `json`, titled "Query parameters". The query's [query parameters](#query-parameters-of-run-kql). |

The run's time limit is passed to Kusto as the server timeout, cancelling the run cancels the query, and Kusto's execution metrics (`executionTime`, `cpuTime`, `memoryPeakPerNode`, `extentsScanned` and `extentsTotal`) appear in the run's details. Run KQL is not offered as a pivot.

#### Query parameters of Run KQL

`parameters` is a list of `{name, type, value}`. The `type` is `string`, `long`, `real`, `bool`, `datetime`, `timespan` or `dynamic`.

- TIM puts `declare query_parameters(Name:type, ...);` and a newline before the KQL, and sends the values as Kusto query parameters. The KQL uses the names as it would any query parameter.
- A bad value answers `422` with `errors["params.parameters.<name>"]`, such as "Must be an ISO 8601 datetime", "Required" or, for a `long`, "Must be a whole number".
- A structural problem answers `422` with `errors["params.parameters"]`: a bad name, a bad type, a duplicate name or a value that is not a list.
- A [preset](../GLOSSARY.md) of Run KQL can have query parameters as inputs, and be copied as an action file: [GET /api/presets/{presetId}/actionFile](api.md#get-apipresetspresetidactionfile).

### `kql_query`

A `kql_query` action runs fixed KQL in a database of a fixed `kusto` connection, as the analyst. Besides the common fields it takes:

| Field | Required | Description |
|---|---|---|
| `connection` | yes | The name of a `kusto` connection. Startup fails when it is missing or of another type. |
| `database` | yes | The database to query. |
| `kql` or `kql_file` | one of them | The query, inline or in a sidecar next to the action file. |

```yaml
type: kql_query
key: acme.storms
name: Storms
menu: Weather
pivot: rows
connection: security
database: Samples
kql_file: storms.kql
id: EventId
params:
  - name: states
    kind: string
    many: true
    from_columns: [State]
  - name: since
    kind: datetime
    required: false
---
type: kql_query
key: acme.storm_count
name: Storm count
pivot: none
connection: security
database: Samples
kql: |
  StormEvents | count
```

`storms.kql`:

```kusto
declare query_parameters(states: dynamic, since: datetime = datetime(2007-01-01));
StormEvents
| where State in (states) and StartTime >= since
```

The run's time limit, cancelling and the execution metrics work as for Run KQL.

#### How Kusto binds params

Values are never spliced into the KQL text ([ADR-0019](adr/0019-params-are-bound.md)).

- The KQL text is sent unchanged.
- Each param is sent to Kusto by name as a query parameter.
- The KQL declares the params it uses with `declare query_parameters(...)`, with the names and types of the action's params.
- A param's `kind` is `string`, `number`, `boolean`, `datetime`, `timespan` or `json`. A `kql`, `sql` or `connection` param stops startup.

| Kind | Sent as |
|---|---|
| `string` | Its own text. Kusto reads a string parameter as it is, so there is no quoting. |
| `number` | Its decimal text; NaN and infinity are `real(nan)`, `real(+inf)` and `real(-inf)`. |
| `boolean` | `true` or `false`. |
| `datetime` | `datetime(yyyy-mm-ddThh:mm:ss.fffffffZ)`, in UTC. |
| `timespan` | `timespan([-][d.]hh:mm:ss[.fffffff])`. |
| `json` | `dynamic(<compact JSON>)`. |
| `many` of any kind | `dynamic([...])`. Elements are JSON; `datetime`, `timespan` and non-finite `number` elements are the Kusto literals above. |

Declare `many` and `json` params as `dynamic`, and the others as their Kusto type.

An optional param without a value is not sent, so the default in `declare query_parameters` applies.

### Run SQL

**Run SQL** (`tim.run_sql`) runs ad-hoc SQL on a Snowflake connection, as the analyst or, for a `workload_identity` connection, as TIM. It is in the catalogue when the `snowflake` extra is installed and the connections file has a `snowflake` connection.

| Param | Description |
|---|---|
| `connection` | A `snowflake` connection. |
| `sql` | The query, written in the tab's Query editor. It completes databases, and the columns of the tables the query names in `FROM` and `JOIN` (`db.schema.table`, the path perhaps shortened, with an optional alias), from the connection. After `DB.` it offers schemas, after a table's alias or name its columns; `DB.SCHEMA.` gives tables and `DB.SCHEMA.TABLE.` gives columns. |
| `idColumn` | Optional. The result column that gives each row its `id`; without it rows have no `id`. |

- The query is sent as written, with the numeric parameter style.
- The run's time limit is the session's `STATEMENT_TIMEOUT_IN_SECONDS`, and cancelling the run aborts the query on Snowflake.
- Column types become TIM column types. A Snowflake error ends the run with Snowflake's message.
- An `obo` error answers the start request, and no run starts. A login or query failure is a run error.
- Run SQL is not offered as a pivot.

## Checking files

The api image prints the JSON Schema of the action types, connection types and labels installed in it, and validates action files, the connections file and the labels file the way startup does, without a database or credentials ([operations.md](operations.md#tim-api-check)):

```bash
docker run --rm <api image> tim-api schema actions > action-file.schema.json
docker run --rm <api image> tim-api schema connections > connections.schema.json
docker run --rm <api image> tim-api schema labels > labels.schema.json
docker run --rm -v "$PWD/actions:/actions:ro" -v "$PWD/connections.yaml:/connections.yaml:ro" -v "$PWD/labels.yaml:/labels.yaml:ro" <api image> tim-api check --actions /actions --connections /connections.yaml --labels /labels.yaml
```

- **In the editor:** commit `action-file.schema.json` next to the files, and point `yaml-language-server` at it.
  - Point it with a `# yaml-language-server: $schema=./action-file.schema.json` line at the top of each file, or with a `yaml.schemas` setting.
  - It completes and checks the fields of each document by its `type`.
  - Do the same with `connections.schema.json` for the connections file and `labels.schema.json` for the labels file.
  - Regenerate them when the image's providers change.
- **In CI:** run `tim-api check --actions <dir> --connections <file> --labels <file>` with the image you deploy. It prints the actions left out of the catalogue, then `OK: <n> actions, <m> connections, <k> labels`, or the same `<file>:<line>: <field>: <message>` problems startup reports and exits 1.

## Building and deploying

Files and providers reach an instance as follows.

- **Providers.** Build a [derived image](deployment.md#derived-images): the backend image with the providers installed. Tag it `<tim version>-<revision>`, and rebuild it on each TIM release.
- **Compose.** Put the files in `TIM_CONFIG_DIR` and name them with `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE` and `TIM_LABELS_FILE` ([deployment.md](deployment.md#instance-files)). Set `TIM_API_IMAGE` and `TIM_API_IMAGE_TAG` for a derived image.
- **Helm.** Set `actions.files` (or `actions.existingConfigMap`), `connections` and `labels` in values ([deployment.md](deployment.md#instance-files-under-helm)). For a derived image, set `api.image.repository` and `api.image.tag` or `api.image.digest`.
- **Before you deploy.** Run `tim-api check` in the image you deploy ([Checking files](#checking-files)).
- **After a change.** The api reads the files at startup, so restart it. In Helm, a change to `actions.files`, `connections` or `labels` restarts the api pods. A change to an `actions.existingConfigMap` needs `kubectl rollout restart deployment/<release>-tim-api`.

## Writing file-capable action types

An action type can be written as files when it sets `type_name` and a `File` model, a subclass of `tim_actions.ActionDocument` with the action type's own fields. A field annotated `Sidecar()` takes a sidecar.

```python
from typing import Annotated

from tim_actions import Action, ActionDocument, Sidecar


class AcmeQueryFile(ActionDocument):
    connection: str
    query: Annotated[str, Sidecar()]


class AcmeQuery(Action):
    """A fixed query on an Acme connection."""

    type_name = "acme_query"
    File = AcmeQueryFile

    connection: str
    query: str

    def run(self, params, ctx):
        ...
```

TIM validates each document against the `File` model, then builds the action with `AcmeQuery.from_file(file)`.

- The default passes the file's fields, all but `type`, to the action by name.
- Override `from_file` when the action's fields differ from the file's.
- The action type's docstring becomes the type's description in the schema.

### Checking params

`Action.check_params(values, *, connections=None)` validates the values of a run when it starts and returns them converted, by param name. It raises `ParamsError`.

- The default is `tim_actions.validate_params`.
- Override it to check more, such as the entries of a `json` param. Run KQL does so for `parameters`.

### Presets as action files

An action type can say how a preset of its actions becomes an action file by overriding `Action.preset_file(*, key, name, menu, params, query_parameters)`.

- It returns an `ActionDocument`, or `None`, the default, when a preset of the action has no action file.
  - `RunKql.preset_file` returns `None` for a preset that lacks a connection, database or query.
  - Its document pivots on `rows` when the preset has From row query parameters and every one of them has columns. Otherwise it has `pivot: none`.
- `params` are the preset's fixed values, and `query_parameters` its `tim_actions.QueryParameter(name, type, value, from_columns)` entries.
- `Action.has_preset_file` is whether the type overrides it. It becomes `actionFile` in the catalogue.
- `tim_actions.action_file_yaml(document)` writes the document as the YAML of an action file.

### Sinks

A sink type subclasses `tim_actions.Sink` instead of `Action`. It writes the rows it is given and returns nothing. Its `File` model is a `SinkDocument`, which has only `type`, `key`, `name`, `menu` and `description`, plus the type's own fields.

```python
from tim_actions import Sink, SinkDocument


class AcmeTicketsFile(SinkDocument):
    queue: str


class AcmeTickets(Sink):
    """Writes the rows to an Acme ticket queue."""

    type_name = "acme_tickets"
    File = AcmeTicketsFile

    queue: str

    def run(self, columns, rows, ctx):
        ...
```

- `columns` lists the names and types of the rows' columns. `rows` are the selected rows, every column of each.
- Raise `RunError` to end the run in error with a message the analyst sees. Report facts with `ctx.detail`.
- A sink has no `params`, `pivot`, `columns` or `id`. It is offered on any selected rows, in the Annotate dialog and the grid's context menu ([architecture.md](architecture.md#sinks)).
- TIM ships no sinks.

### Pivots

An action type can change how a pivot fills the params by overriding two methods of `Action`.

- **`pivot_columns()`** returns the groups of alternative columns a row needs one of each to be offered the action. The default makes each required param's `from_columns` a group.
- **`resolve(context)`** returns a `tim_actions.Resolved` from a `tim_actions.PivotContext`.
  - `context.rows` holds the selected rows, and `context.cell` the right-clicked `PivotCell(column, value)`, or `None`.
  - `Resolved.params` maps param names to wire values.
  - `Resolved.missing` maps the name of each param it couldn't fill to the reason shown to the analyst, or `None`.
  - The default takes each param's value from its `from_columns`.
- **Columns seen.** `resolve()` sees only the columns of `pivot_columns()` and every param's `from_columns`.

## Testing

`tim_actions.testing` runs actions, sinks, pivots and action files as TIM does, without a server, a database or credentials. It is for provider authors' tests.

- **`run_action(action, params, connections=, analyst=, timeout=)`** runs an action and returns a `RunResult`.
  - It validates `params` as wire values, like TIM, and raises `ParamsError` for ones TIM would refuse.
  - `RunResult.rows` are the rows as yielded.
  - `RunResult.ids` are each row's `id` in the text form TIM stores, or `None` for none. An `id` over 512 characters is `None`.
  - `RunResult.columns` are the declared columns only. TIM adds the undeclared columns of the rows after them.
  - `RunResult.details` are the run details. As in TIM, an `id` column missing from the results, or an `id` that is too long, adds to the `warning` detail.
  - A connection the action didn't declare is refused.
  - A row that isn't a mapping, or a bad run detail, raises `TypeError`.
- **`run_sink(sink, rows, columns=, connections=, analyst=, timeout=)`** runs a sink and returns a `SinkResult` with its `details`. Without `columns`, each key of the rows is a `string` column.
- **`resolve_pivot(action, rows, cell=None)`** resolves a pivot into an action as TIM's resolve endpoint does. It raises `PivotRefused` when the action has pivot `none`, or pivot `row` and several rows are selected. It doesn't check the instance's limit on selected rows.
- **`load_actions(directory, action_types)`** loads the action files in `directory` with `action_types` installed, and returns the actions by key.
  - It checks what startup checks in the files, duplicate keys and the reserved `tim.` prefix included. It checks no connections.
  - It raises `ActionFilesError`, whose `problems` name each file, line and field.
- **`Connections`** holds the connections a run reaches.
  - `add(connection, hook=None)` adds a connection, answered by `hook`, a `Hook` class.
  - `answer(connection_type, hook)` sets the hook for connections of that type added without one.
  - Hooks are built with `token_for`, which returns `token for <scope>` unless `Connections(token_for=...)` gives another.

There is no hook conformance suite.

### Fixtures

The package registers a `pytest11` plugin, so the fixtures need no import.

- **`tim_analyst`** is the analyst a run gets by default. Pass another as `analyst=` to `run_action` or `run_sink`.
- **`tim_connections`** is an empty `Connections`. Override it in `conftest.py` to add connections every test has.
- **`tim_kusto`** is a fake of the Kusto hook, and needs the `kusto` extra. It answers the Kusto connections added to `tim_connections` without a hook.
  - `respond(rows, columns=, details=)` queues an answer, and `fail(message)` or `fail(exception)` queues a failure. A message ends the run with it.
  - `calls` lists each query as `KustoCall(connection, database, kql, parameters)`.
  - A query with no answer queued fails the test, and so does reaching a Kusto cluster, as the editor schema does.
- **`tim_snowflake`** is a fake of the Snowflake hook, and needs the `snowflake` extra. It answers the Snowflake connections added to `tim_connections` without a hook.
  - `respond(rows, columns=)` queues an answer, and `fail(message)` or `fail(exception)` queues a failure. A message ends the run with it.
  - `calls` lists each query as `SnowflakeCall(connection, sql)`.
  - A query with no answer queued fails the test, and so does reaching a Snowflake account, as the editor schema does.

```python
from tim_actions.kusto import KqlQuery, KustoConnection
from tim_actions.testing import Connections, load_actions, run_action
from tim_actions.testing.kusto import FakeKusto, KustoCall

SECURITY = KustoConnection(
    name="security", title="Security", type="kusto", auth="obo",
    cluster="https://help.kusto.windows.net",
)
STORMS = """\
type: kql_query
key: acme.storms
name: Storms
pivot: rows
connection: security
database: Samples
kql: StormEvents | where State in (states)
id: EventId
params: [{name: states, kind: string, many: true, from_columns: [State]}]
"""


def test_the_params_reach_kusto(tmp_path, tim_kusto: FakeKusto, tim_connections: Connections):
    (tmp_path / "storms.yaml").write_text(STORMS)
    action = load_actions(tmp_path, [KqlQuery])["acme.storms"]
    tim_connections.add(SECURITY)
    tim_kusto.respond([{"EventId": 61032, "State": "TEXAS"}])
    result = run_action(action, {"states": ["TEXAS"]}, connections=tim_connections)
    assert tim_kusto.calls == [
        KustoCall(
            "security", "Samples", "StormEvents | where State in (states)",
            {"states": 'dynamic(["TEXAS"])'},
        )
    ]
    assert result.ids == ["61032"]
```

## Providers

A provider lists its file-capable action types in `Provider(action_types=[...])`, and can ship action files as package data in `Provider(action_files=...)`, a directory read like `TIM_ACTIONS_DIR`:

```python
from importlib.resources import files

from tim_actions import Provider


def provider() -> Provider:
    return Provider(action_types=[AcmeQuery], action_files=files("acme_tim") / "actions")
```

The files must be in the package's wheel, as `acme_tim/actions/*.yaml`. A provider's files can name any installed action type, not only its own.

Depend on `tim-actions` as `>=1,<2`. Test the provider with [`tim_actions.testing`](#testing). An instance installs the provider in a derived image ([Building and deploying](#building-and-deploying)).
