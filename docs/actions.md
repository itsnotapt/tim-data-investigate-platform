# Actions

The guide for operators and action authors. It covers what an instance holds, how to write and check its files, how to write action types, connection types and providers, and how to test, build and deploy them. It walks through [`examples/instance/`](../examples/instance/README.md).

- How TIM loads them is in [architecture.md](architecture.md#actions-and-providers).
- The decisions are [ADR-0017](adr/0017-actions-from-providers.md) and, for connections, [ADR-0018](adr/0018-fixed-connections.md).

## What an instance holds

- **Providers**, installed packages that add action types, Python actions, connection types with their hooks, and action files of their own, found through the `tim.actions` entry-point group. They are installed in a derived image ([Building and deploying](#building-and-deploying)).
- **Action files**, YAML in one flat directory, `TIM_ACTIONS_DIR` ([configuration.md](configuration.md#actions)).
- **The connections file**, YAML, `TIM_CONNECTIONS_FILE` ([configuration.md](configuration.md#connections)).
- **The labels file**, YAML, `TIM_LABELS_FILE` ([configuration.md](configuration.md#labels-and-annotations)).

The three kinds of file are mounted under `/etc/tim`. All are read once, at startup. Any problem stops startup ([operations.md](operations.md#startup-failures-from-the-files)), so a change to a file takes a restart.

## Action files

The examples here are from [`examples/instance/`](../examples/instance/README.md), an instance laid out as its own repository. An action file holds one or more actions, one YAML document each, with `---` between them. Each action names an installed, file-capable action type in `type`, and gives its `key` and the rest of its configuration. Each document is validated on its own.

[`config/actions/storm-events.yaml`](../examples/instance/config/actions/storm-events.yaml) holds two `kql_query` actions, shown here without some of their params, columns and KQL:

```yaml
# yaml-language-server: $schema=../../schema/actions.schema.json
type: kql_query
key: example.storm_events
name: Storm events
menu: Weather
description: Storm events in the selected states
pivot: rows
connection: samples
database: Samples
kql_file: storm-events.kql
params:
  - name: states
    kind: string
    title: States
    many: true
    from_columns: [State]
  - name: since
    kind: datetime
    title: Since
    required: false       # left out, the KQL's declared default applies
id: EventId
columns:
  - {name: StartTime, type: datetime, title: Start, pinned: left, sort: desc}
  - {name: EventNarrative, type: string, title: Narrative, hidden: true}
---
type: kql_query
key: example.storm_episode
name: Storm episode
pivot: row
connection: samples
database: Samples
params:
  - name: episode
    kind: number
    from_columns: [EpisodeId]
id: EventId
kql: |
  declare query_parameters(episode: long);
  StormEvents
  | where EpisodeId == episode
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
| `id` | no | The column that gives each row its `id`, or a list of alternative columns. |
| `columns` | no | Declared result columns, below. |

The action type adds fields of its own, such as a connection and a query.

### The `id` of a row

Annotations are kept by `id`, so a row needs one to be annotated.

- `id: EventId` takes the `id` from one column.
- `id: [CorrelationId, RequestId]` lists alternatives. The first non-empty value wins, and the coalesce skips `null` and `""`.
- Without `id`, the rows have no `id` and cannot be annotated.
- A type with a different scheme overrides `row_id` ([Writing action types](#writing-action-types)).

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

A `number` param accepts a whole number written as a string of digits (`-?[0-9]+`) and turns it into an integer. The web sends one beyond ±(2^53 − 1) that way, from a pivot on a `bigint` column or a number typed in a pill.

### Columns

An action can declare some or all of its result columns. Each entry takes:

- `name` and `type`: `string`, `number`, `boolean`, `datetime`, `timespan`, `json` or `bigint`;
- optionally `title`, `hidden`, `width` (pixels), `pinned` (`left` or `right`), `sort` (`asc` or `desc`), `group` and `calculated`.

A `bigint` column holds whole numbers that a `number` column would round.

- Only an action file declares it; Kusto and Snowflake columns are never `bigint`.
- The API serves its whole-number values as strings of digits, such as `"12345678901234567890"`, and other values as they are.
- The grid shows `BigInt` values, and sorts, copies and filters them exactly. A value that isn't a whole number shows as "Invalid BigInt".
- The browser rounds a whole number beyond ±(2^53 − 1) in a `number` column. Such a column shows a warning icon in its header, whose tooltip suggests declaring it `bigint`.

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

- **Inline:** `kql: |`, as `example.storm_episode` does.
- **In a sidecar file** next to the action file, where an editor highlights it: `kql_file: storm-events.kql`, as `example.storm_events` does.
  - The action type marks which of its fields take a sidecar. For a `kql_query` it is `kql_file`.
  - The sidecar is a file name in the same directory as the action file, not a path.

The sidecar [`storm-events.kql`](../examples/instance/config/actions/storm-events.kql) declares the params it uses:

```kusto
declare query_parameters(states: dynamic, since: datetime = datetime(2007-01-01),
    until: datetime = datetime(2008-01-01));
StormEvents
| where State in (states) and StartTime between (since .. until)
```

Kusto binds each param by name from `declare query_parameters`, and an optional param left out takes the declared default ([How Kusto binds params](#how-kusto-binds-params)).

### Several actions in a file

One file can hold several actions, as `storm-events.yaml` does. Each has its own `key`. A sidecar sits next to the file and can be used by any action in it.

## Connections file

The connections file lists the instance's **connections**: the fixed endpoints actions run against. It is a YAML list, one entry per connection. Analysts never type an endpoint; they pick a connection by its title. The example's [`connections.yaml`](../examples/instance/config/connections.yaml) holds a Kusto connection and a `lookup` one:

```yaml
# yaml-language-server: $schema=../schema/connections.schema.json
- name: samples                  # lowercase letters, digits and -, unique
  title: Samples (help cluster)
  type: kusto                    # an installed connection type
  auth: obo
  cluster: https://help.kusto.windows.net
  databases: [Samples]           # suggestions only
# A lookup table runs as TIM, so every analyst sees all of it.
- name: regions
  title: US regions
  type: lookup
  auth: workload_identity
  entries:
    TEXAS: {Region: South, Division: West South Central}
```

Every entry has `name`, `title`, `type` and `auth`, and a `scope` for `obo` that some connection types default, plus the fields of its connection type. A connection type comes from an installed provider, which adds a hook for it ([Writing connection types and hooks](#writing-connection-types-and-hooks)); an unknown `type` or field stops startup, with the file and line.

`auth` says whose identity the system behind the connection sees.

- **`obo`** runs as the analyst.
  - TIM exchanges the analyst's token for the connection's `scope` ([ADR-0009](adr/0009-obo-token-exchange.md)).
  - An instance that has an `obo` connection needs the OBO credential ([configuration.md](configuration.md#authentication)).
- **`workload_identity`** runs as TIM, so every analyst gets TIM's access. The example's `regions` connection is one. A connection type lists the `auth` values it supports; `snowflake` supports both, `kusto` only `obo`.
  - A `scope` on it stops startup: the connections file refuses it with "scope is only for auth obo".
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

The example's [`labels.yaml`](../examples/instance/config/labels.yaml):

```yaml
# yaml-language-server: $schema=../schema/labels.schema.json
- {key: damaging, name: Damaging, colour: red, symbol: warning}
- {key: follow-up, name: Follow up, colour: amber, symbol: flag}
- {key: reviewed, name: Reviewed, colour: green, symbol: check}
- {key: duplicate, name: Duplicate, colour: grey, symbol: block}
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

The built-in provider adds, for each extra of `tim-actions` that is installed, the connection type and actions in this table, and the `kql_query` action type for `kusto` and the `snowflake_query` action type for `snowflake`.

| Extra | Adds |
|---|---|
| `kusto` | The `kusto` connection type, the `kql_query` action type and **Run KQL**. |
| `snowflake` | The `snowflake` connection type, the `snowflake_query` action type and **Run SQL**. |

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

`parameters` is an ordered list of `{name, type, value}`. The `type` is `string`, `long`, `real`, `bool`, `datetime`, `timespan` or `dynamic`.

- TIM puts `declare query_parameters(Name:type, ...);` and a newline before the KQL, with the parameters in the list's order, and sends the values as Kusto query parameters. The KQL uses the names as it would any query parameter.
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

[Action files](#action-files) shows two `kql_query` actions, one with a sidecar and one inline.

The run's time limit, cancelling and the execution metrics work as for Run KQL.

#### How Kusto binds params

The sidecar of the example's `storm-events.yaml` declares its params with `declare query_parameters(...)`. Values are never spliced into the KQL text ([ADR-0019](adr/0019-params-are-bound.md)).

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
| `parameters` | Optional, `json`, titled "Query parameters". The query's [query parameters](#query-parameters-of-run-sql). |

- The query is sent as written, with its query parameters bound by position ([How Snowflake binds params](#how-snowflake-binds-params)).
- The run's time limit is the session's `STATEMENT_TIMEOUT_IN_SECONDS`, and cancelling the run aborts the query on Snowflake.
- Column types become TIM column types. A Snowflake error ends the run with Snowflake's message.
- An `obo` error answers the start request, and no run starts. A login or query failure is a run error.
- Run SQL is not offered as a pivot.

#### Query parameters of Run SQL

`parameters` is an ordered list of `{name, type, value}`, with the types of [Run KQL](#query-parameters-of-run-kql) but `timespan`: `string`, `long`, `real`, `bool`, `datetime` or `dynamic`.

- The entries are bound by position, in the list's order: `:1` is the first, `:2` the second. The SQL uses `:1`, `:2` and so on, and the names are only labels.
- A `dynamic` value is bound as JSON text, which the SQL parses with `PARSE_JSON(:N)`.
- Bad entries answer `422` as for Run KQL, at `params.parameters` and `params.parameters.<name>`.
- A [preset](../GLOSSARY.md) of Run SQL can have query parameters as inputs, and be copied as an action file unless one of them is a `timespan`: [GET /api/presets/{presetId}/actionFile](api.md#get-apipresetspresetidactionfile).

### `snowflake_query`

A `snowflake_query` action runs fixed SQL on a fixed `snowflake` connection, as the analyst or, for a `workload_identity` connection, as TIM. Besides the common fields it takes:

| Field | Required | Description |
|---|---|---|
| `connection` | yes | The name of a `snowflake` connection. Startup fails when it is missing or of another type. |
| `sql` or `sql_file` | one of them | The query, inline or in a sidecar next to the action file. |

```yaml
type: snowflake_query
key: example.recent_orders
name: Recent orders
pivot: rows
connection: warehouse
params:
  - name: customers
    kind: string
    many: true
    from_columns: [CustomerId]
  - name: since
    kind: datetime
    required: false
sql: |
  SELECT * FROM SALES.PUBLIC.ORDERS
  WHERE CUSTOMER_ID IN (SELECT value::string FROM TABLE(FLATTEN(PARSE_JSON(:1))))
    AND (:2 IS NULL OR ORDERED_AT >= :2)
```

The run's time limit, cancelling and the column types work as for Run SQL.

#### How Snowflake binds params

The SQL is sent unchanged, and the values are bound server-side by position ([ADR-0019](adr/0019-params-are-bound.md)).

- `:1` is the first param in the file, `:2` the second, and so on. The params' names are not used in the SQL.
- A param's `kind` is `string`, `number`, `boolean`, `datetime` or `json`. A `timespan`, `sql`, `kql` or `connection` param stops startup.
- A position with no param is Snowflake's own run-time error, "Bind variable :N not set".

| Kind | Bound as |
|---|---|
| `string`, `number`, `boolean` | Itself. |
| `datetime` | A UTC datetime. The session's `TIMEZONE` is always `UTC`, so Snowflake reads it in UTC. |
| `json` | Compact JSON text. The SQL parses it with `PARSE_JSON(:N)`. |
| `many` of any kind | JSON text of the list, with `datetime` elements as ISO 8601 with `Z`. The SQL parses it, e.g. `SELECT value::string FROM TABLE(FLATTEN(PARSE_JSON(:1)))`. |

An optional param without a value is bound as `NULL`.

## Checking files

The api image prints the JSON Schema of the action types, connection types and labels installed in it, and validates action files, the connections file and the labels file the way startup does, without a database or credentials ([operations.md](operations.md#tim-api-check)):

```bash
docker run --rm <api image> tim-api schema actions > action-file.schema.json
docker run --rm <api image> tim-api schema connections > connections.schema.json
docker run --rm <api image> tim-api schema labels > labels.schema.json
docker run --rm -v "$PWD/actions:/actions:ro" -v "$PWD/connections.yaml:/connections.yaml:ro" -v "$PWD/labels.yaml:/labels.yaml:ro" <api image> tim-api check --actions /actions --connections /connections.yaml --labels /labels.yaml
```

- **In the editor:** run `tim-api schema` in the derived image, so the schemas include the providers' types, and commit the output for `yaml-language-server`.
  - The example's [`schema.sh`](../examples/instance/schema.sh) builds the image and writes `schema/actions.schema.json`, `schema/connections.schema.json` and `schema/labels.schema.json`.
  - Each file starts with a `# yaml-language-server: $schema=...` line that points at its schema, such as `$schema=../../schema/actions.schema.json`. A `yaml.schemas` setting does the same.
  - The editor completes and checks the fields of each document by its `type`.
  - Regenerate the schemas when the image's providers or the TIM version change.
- **In CI:** run `tim-api check --actions <dir> --connections <file> --labels <file>` with the image you deploy. It prints the actions left out of the catalogue, then `OK: <n> actions, <m> connections, <k> labels`, or the same `<file>:<line>: <field>: <message>` problems startup reports and exits 1.
  - The example's [`ci.sh`](../examples/instance/ci.sh) runs `tim-api check` on `config/`.
  - It compares each committed schema with the image's, and fails when one is stale.
  - It validates each YAML document, those of the package data included, against its schema, as an editor does.

## Writing action types

An action type is a subclass of `tim_actions.Action`. Its fields are its configuration, and each instance is one action, with its `key`, `name`, `menu`, `description`, `params`, `pivot`, `columns` and `id`. [`storm_summary.py`](../examples/instance/src/example_provider/storm_summary.py) is the example.

- **`Param`** declares a param as data, with the fields of [Params](#params). `Column` declares a result column the same way, with the fields of [Columns](#columns). An invalid declaration fails when it is constructed.
- **`run(params, ctx)`** is synchronous and yields rows as mappings.
  - `params` holds the validated values.
  - `ctx` is the `RunContext`: `analyst`, `deadline`, `hook(name)`, `detail(key, value)` and `declare_columns(columns)`.
  - Raise `RunError` with a message safe to show the analyst. Any other exception ends the run with a generic message.
- **`connections()`** returns the fixed connections, each name with the connection type it must be.

```python
class StormSummary(Action):
    """Storm events counted by state and event type over a time window."""

    type_name = "storm_summary"
    File = StormSummaryFile

    params: Sequence[Param] = PARAMS
    connection: ConnectionName
    database: str

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "kusto"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        hook = ctx.hook(self.connection)
        if not isinstance(hook, KustoHook):
            raise RunError(f"{self.connection} is not a Kusto connection")
        result = hook.query(
            self.database, KQL, deadline=ctx.deadline,
            parameters=query_parameters(self.params, params),
        )
        ctx.declare_columns(result.columns)
        yield from result.rows
```

### File-capable action types

An action type can be written as files when it sets `type_name` and a `File` model, a subclass of `tim_actions.ActionDocument` with the action type's own fields. A field annotated `Sidecar()` takes a sidecar. `StormSummaryFile` has `connection` and `database`, and refuses `params`:

```python
class StormSummaryFile(ActionDocument):
    connection: ConnectionName
    database: str

    @field_validator("params")
    @classmethod
    def _no_params(cls, value: tuple[Param, ...]) -> tuple[Param, ...]:
        if value:
            raise ValueError("storm_summary declares its own params")
        return value
```

TIM validates each document against the `File` model, then builds the action with `StormSummary.from_file(file)`.

- The default passes the file's fields, all but `type`, to the action by name.
- Override `from_file` when the action's fields differ from the file's. `StormSummary` keeps its own params:

  ```python
  @classmethod
  def from_file(cls, file: DocumentBase) -> Self:
      return cls.model_validate(
          {name: value for name, value in file if name not in ("type", "params")}
      )
  ```

- The action type's docstring becomes the type's description in the schema.

The action file [`storm-summary.yaml`](../examples/instance/src/example_provider/actions/storm-summary.yaml) then needs no `params`. A field of the `File` model annotated `Sidecar()` reads `<field>_file:`; `kql_query` does so for `kql`.

### Pivots

An action type can change how a pivot fills the params by overriding two methods of `Action`.

- **`pivot_columns()`** returns the groups of alternative columns a row needs one of each to be offered the action. The default makes each required param's `from_columns` a group.
- **`resolve(context)`** returns a `tim_actions.Resolved` from a `tim_actions.PivotContext`.
  - `context.rows` holds the selected rows, and `context.cell` the right-clicked `PivotCell(column, value)`, or `None`.
  - `Resolved.params` maps param names to wire values.
  - `Resolved.missing` maps the name of each param it couldn't fill to the reason shown to the analyst, or `None`.
  - The default takes each param's value from its `from_columns`.
- **Columns seen.** `resolve()` sees only the columns of `pivot_columns()` and every param's `from_columns`.

`StormSummary` offers the action on rows with a state, a start and an end, and takes the window from the earliest `StartTime` and the latest `EndTime`:

```python
def pivot_columns(self) -> list[list[str]]:
    return [["State"], ["StartTime"], ["EndTime"]]

def resolve(self, context: PivotContext) -> Resolved:
    resolved = super().resolve(context)
    starts = [row["StartTime"] for row in context.rows if row.get("StartTime")]
    ends = [row["EndTime"] for row in context.rows if row.get("EndTime")]
    if starts:
        resolved.params["since"] = min(starts, key=_instant)
        resolved.missing.pop("since", None)
    if ends:
        resolved.params["until"] = max(ends, key=_instant)
        resolved.missing.pop("until", None)
    return resolved
```

### Row ids

`Action.row_id(params)` returns the `RowId` that gives each row of a run its `id`, or `None` for no `id`.

- The default is `tim_actions.IdColumns` over the action's `id` column or list of alternatives. It takes the first value that isn't `None` or `""`.
- A `RowId` is called with a row, returns its `id` or `None`, and lists the result `columns` it reads. A missing column adds to the run's `warning` detail and never fails the run.
- `StormSummary` ids each row by its state, event type and the run's window, so an annotation stays with the window it counted:

  ```python
  def row_id(self, params: Mapping[str, Any]) -> RowId:
      return _SummaryId(params["since"], params["until"])
  ```

### Checking params

`Action.check_params(values, *, connections=None)` validates the values of a run when it starts and returns them converted, by param name. It raises `ParamsError`.

- The default is `tim_actions.validate_params`.
- Override it to check more, such as the entries of a `json` param. Run KQL and Run SQL do so for `parameters`.

### Presets as action files

An action type can say how a preset of its actions becomes an action file by overriding `Action.preset_file(*, key, name, menu, params, query_parameters)`.

- It returns an `ActionDocument`, or `None`, the default, when a preset of the action has no action file.
  - `RunKql.preset_file` returns `None` for a preset that lacks a connection, database or query.
  - `RunSql.preset_file` returns `None` for a preset that lacks a connection or SQL, or has a `timespan` query parameter.
  - The document of `RunSql.preset_file` is a `snowflake_query`, with a param per query parameter in the preset's order.
  - Its document pivots on `rows` when the preset has From row query parameters and every one of them has columns. Otherwise it has `pivot: none`.
- `params` are the preset's fixed values, and `query_parameters` its `tim_actions.QueryParameter(name, type, value, from_columns)` entries, in order.
- `tim_actions.query_parameters` holds what Run KQL and Run SQL share. `TakesQueryParameters` is their base class: it checks `parameters` against its `parameter_types`, each query parameter type with the param kind of its value. `checked_parameters` does the check, and `preset_file_params` turns a preset's query parameters into the file's params.
- `Action.has_preset_file` is whether the type overrides it. It becomes `actionFile` in the catalogue.
- `tim_actions.action_file_yaml(document)` writes the document as the YAML of an action file.

## Writing connection types and hooks

A connection type has two parts: a `Connection` model for its entries in the connections file, and a `Hook` that gives actions access to the system behind the connection. [`lookup.py`](../examples/instance/src/example_provider/lookup.py) is the example.

`Connection` is a subclass of `tim_actions.Connection`. It narrows `type` to the type's name and `auth` to the mechanisms it supports, and adds the type's fields:

```python
class LookupConnection(Connection):
    """A lookup table: each key's fields. Nothing is behind it, so it runs as TIM."""

    type: Literal["lookup"]
    auth: Literal["workload_identity"]
    entries: dict[str, dict[str, str]]
```

- It also takes `name`, `title` and `scope`.
- `default_scope()` gives the `obo` scope when the file has none. An `obo` connection without a scope fails validation.
- `database_suggestions()` gives the databases the browser suggests.

`Hook` is a subclass of `tim_actions.Hook`, built per run for one connection:

```python
class LookupHook(Hook):
    """Access to one lookup connection's table."""

    connection_type = "lookup"
    Connection = LookupConnection

    connection: LookupConnection

    def get_conn(self) -> Mapping[str, Mapping[str, str]]:
        return self.connection.entries

    def cancel(self) -> None:
        """Nothing to stop: a lookup returns at once."""
```

- **`connection_type`** is the `type` of the connections it serves.
- **`Connection`** is the model that validates those entries.
- **`editor`** is the kind of editor its queries are written in (`kql`, `sql`), or `None`.
- **`cancel()`** stops the work in progress. TIM calls it from another thread on timeout or cancel.
- **`editor_schema(scope)`** gives the `EditorSchema` the editor completes from, or `None`, the default. `scope` holds the values of the editor param's `schema_from` params, without its `connection` param. It raises `RunError` when the schema can't be had.
- **`token_for`** is the callable the hook is built with. `token_for(scope)` gives a token for the analyst, and the hook never sees the analyst's own token.
- **`get_conn()`** is not on `Hook`. It is the convention for how a hook hands actions its client: `KustoHook.get_conn()` gives an SDK client, and `LookupHook.get_conn()` its table.

An action reaches the hook with `ctx.hook(name)` and checks its type, as `LookupAction` does:

```python
hook = ctx.hook(self.connection)
if not isinstance(hook, LookupHook):
    raise RunError(f"{self.connection} is not a lookup connection")
table = hook.get_conn()
```

## Providers

A provider is what a package adds to TIM. `Provider` takes four lists, all optional. The example's [`__init__.py`](../examples/instance/src/example_provider/__init__.py):

```python
def provider() -> Provider:
    return Provider(
        actions=[STATE_REGIONS],
        action_types=[StormSummary],
        hooks=[LookupHook],
        action_files=files("example_provider") / "actions",
    )
```

- **`actions`** are Python actions, instances of an `Action` subclass.
- **`action_types`** are the file-capable action types.
- **`hooks`** are the hooks of the connection types the package adds.
- **`action_files`** is a directory of action files in the package data, read like `TIM_ACTIONS_DIR`. Its files can name any installed action type, not only the package's own.

TIM finds the provider through the `tim.actions` entry-point group. The callable that returns it is named in [`pyproject.toml`](../examples/instance/pyproject.toml):

```toml
[project]
dependencies = ["tim-actions[kusto]>=1,<2"]

[project.entry-points."tim.actions"]
example = "example_provider:provider"

[tool.hatch.build.targets.wheel]
packages = ["src/example_provider"]
```

- The action files must be in the package's wheel, here as `example_provider/actions/*.yaml`.
- Depend on `tim-actions` as `>=1,<2`, with the `kusto` extra when the package uses Kusto.
- TIM's built-in provider registers the same way (`tim_actions.builtin:provider`).

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
  - `calls` lists each query as `SnowflakeCall(connection, sql, params)`, where `params` is a tuple of the values bound, `:1` first.
  - A query with no answer queued fails the test, and so does reaching a Snowflake account, as the editor schema does.

The tests in [`examples/instance/tests/`](../examples/instance/tests/) show them.

- **A fake Kusto.** `tim_kusto` records the KQL and parameters sent, so a test of `StormSummary` checks that the params are bound by name:

  ```python
  def test_a_run_binds_the_params_by_name_and_ids_each_row_by_its_window(
      tim_connections: Connections, tim_kusto: FakeKusto
  ) -> None:
      tim_connections.add(KustoConnection(name="samples", title="Samples", type="kusto", auth="obo",
                                          cluster="https://help.kusto.windows.net"))
      tim_kusto.respond([{"State": "TEXAS", "EventType": "Hail", "Events": 3}])

      result = run_action(
          SUMMARY,
          {"states": ["TEXAS"], "since": "2007-05-04T21:00:00Z", "until": "2007-08-19T00:00:00Z"},
          connections=tim_connections,
      )

      [call] = tim_kusto.calls
      assert call.parameters["states"] == 'dynamic(["TEXAS"])'
      assert result.ids == ['["TEXAS","Hail","2007-05-04T21:00:00Z","2007-08-19T00:00:00Z"]']
  ```

- **A hook as it is.** A hook with nothing behind it needs no fake. `Connections.add(connection, hook)` takes the `LookupHook` class itself:

  ```python
  connections = Connections()
  connections.add(REGIONS, LookupHook)
  result = run_action(STATE_REGIONS, {"keys": ["TEXAS", "GUAM"]}, connections=connections)
  ```

- **A pivot.** `resolve_pivot(SUMMARY, rows)` gives the params a pivot fills, and `.missing` the ones it couldn't.
- **Action files.** `load_actions(CONFIG / "actions", [KqlQuery])` loads the instance's own files, and a test pivots from a row into one of them. `load_actions(files("example_provider") / "actions", provider().action_types)` loads the provider's package data. A file that breaks a rule, such as `params` on a `storm_summary`, raises `ActionFilesError`.

The tests also run inside the derived image ([Building and deploying](#building-and-deploying)).

## Building and deploying

An instance's providers reach it in a [derived image](deployment.md#derived-images), and its files are mounted under `/etc/tim`.

The example's [`Dockerfile`](../examples/instance/Dockerfile) installs the provider into the backend image against its constraints, and has a `test` stage:

```dockerfile
ARG BASE
FROM ${BASE} AS instance
COPY --chown=tim:tim pyproject.toml /tmp/provider/
COPY --chown=tim:tim src /tmp/provider/src
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt /tmp/provider

# The tests run against the tim-actions the image ships.
FROM instance AS test
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt pytest
COPY --chown=tim:tim tests /tmp/provider/tests
COPY --chown=tim:tim config /tmp/provider/config
WORKDIR /tmp/provider
RUN python -m pytest -p no:cacheprovider

FROM instance
```

- **Constraints.** A provider can't move TIM's pins.
- **Tests in the image.** `docker build --build-arg BASE=<backend image> --target test .` runs the tests against the `tim-actions` the image ships. The last stage is the image.
- **Tags.** Name the image `<tim version>-<revision>`, such as `5.0.0-example.1`, and rebuild it on each TIM release.
- **Before you deploy.** Run `tim-api check` in the image you deploy ([Checking files](#checking-files)).

Then deploy it with Helm or Compose.

- **Helm.** [`deploy/helm/values.yaml`](../examples/instance/deploy/helm/values.yaml) goes on top of the operator's values:
  - `helm upgrade --install tim oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim --version X.Y.Z -n tim -f <your values> -f values.yaml`.
  - `api.image.repository` and `api.image.tag` name the derived image. `api.image.digest` also works.
  - `actions.files` holds the files of `config/actions/`, sidecars included, by file name. `actions.existingConfigMap` is the alternative.
  - `connections` and `labels` hold the other two files as YAML ([deployment.md](deployment.md#instance-files-under-helm)).
  - A change to `actions.files`, `connections` or `labels` restarts the api pods. A change to an `actions.existingConfigMap` needs `kubectl rollout restart deployment/<release>-tim-api`.
- **Compose.** [`deploy/compose/.env`](../examples/instance/deploy/compose/.env) is a second `--env-file`, after the operator's own, for TIM's `deploy/compose.prod.yaml` ([deployment.md](deployment.md#instance-files)):
  - `docker compose -f deploy/compose.prod.yaml --env-file deploy/.env --env-file <this file> up -d --no-build`.
  - `TIM_API_IMAGE` and `TIM_API_IMAGE_TAG` name the derived image.
  - `TIM_CONFIG_DIR` is the host directory holding a copy of `config/`, here `/srv/tim-instance/config`. `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE` and `TIM_LABELS_FILE` name the files under `/etc/tim` ([deployment.md](deployment.md#instance-files)).
- **After a change.** The api reads the files at startup, so restart it.

## A sink

A sink type subclasses `tim_actions.Sink` instead of `Action`. It writes the rows it is given and returns nothing. TIM ships no sinks. Its `File` model is a `SinkDocument`, which has only `type`, `key`, `name`, `menu` and `description`, plus the type's own fields.

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
- Test it with `run_sink` ([Testing](#testing)).
