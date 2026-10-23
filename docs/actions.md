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

Every entry has `name`, `title`, `type` and `auth`, and an optional `scope`, plus the fields of its connection type. A connection type comes from an installed provider, which adds a hook for it; an unknown `type` or field stops startup, with the file and line.

`auth` says whose identity the system behind the connection sees.

- **`obo`** runs as the analyst.
  - TIM exchanges the analyst's token for the connection's `scope` ([ADR-0009](adr/0009-obo-token-exchange.md)).
  - An instance that has an `obo` connection needs the OBO credential ([configuration.md](configuration.md#authentication)).
- **`workload_identity`** would run as TIM, and so give every analyst TIM's access. It is in the connection model, but the `kusto` connection type supports only `obo`.

Every analyst sees every connection. The system behind it enforces access.

The `kusto` connection type, from the `kusto` extra of `tim-actions`:

| Field | Required | Description |
|---|---|---|
| `cluster` | yes | The cluster's https URL, checked and normalised to `https://<host>` at startup. |
| `databases` | no | Database names suggested for the `database` param of actions on this connection. The analyst can type another. |
| `scope` | no | The OBO scope, `{cluster}/.default` when left out. |

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
- A label is set on an `id`, so a row needs an `id` to be labelled (the `id` field of an action file, or `idColumn` of Run KQL).
- Keep a `key` for good. Annotations store it, so renaming it leaves the old key on every `id` that has it, shown grey. Change `name`, `colour` or `symbol` instead.

## Built-in actions

The built-in provider adds the `kql_query` action type and the **Run KQL** action. Both need the `kusto` extra.

### Run KQL

**Run KQL** (`tim.run_kql`) runs ad-hoc KQL on a Kusto connection, as the analyst. It is in the catalogue when the `kusto` extra is installed and the connections file has a `kusto` connection.

| Param | Description |
|---|---|
| `connection` | A `kusto` connection. When there is exactly one, a new tab fills it in. |
| `database` | The database to query. The tab suggests the chosen connection's `databases`. |
| `kql` | The query, written in the tab's Query editor, scoped by the `connection` and `database` params. |
| `idColumn` | Optional. The result column that gives each row its `id`; without it rows have no `id`. |

The run's time limit is passed to Kusto as the server timeout, cancelling the run cancels the query, and Kusto's execution metrics (`executionTime`, `cpuTime`, `memoryPeakPerNode`, `extentsScanned` and `extentsTotal`) appear in the run's details. Run KQL is not offered as a pivot.

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

### Pivots

An action type can change how a pivot fills the params by overriding two methods of `Action`.

- **`pivot_columns()`** returns the groups of alternative columns a row needs one of each to be offered the action. The default makes each required param's `from_columns` a group.
- **`resolve(context)`** returns a `tim_actions.Resolved` from a `tim_actions.PivotContext`.
  - `context.rows` holds the selected rows, and `context.cell` the right-clicked `PivotCell(column, value)`, or `None`.
  - `Resolved.params` maps param names to wire values.
  - `Resolved.missing` maps the name of each param it couldn't fill to the reason shown to the analyst, or `None`.
  - The default takes each param's value from its `from_columns`.
- **Columns seen.** `resolve()` sees only the columns of `pivot_columns()` and every param's `from_columns`.

## Providers

A provider lists its file-capable action types in `Provider(action_types=[...])`, and can ship action files as package data in `Provider(action_files=...)`, a directory read like `TIM_ACTIONS_DIR`:

```python
from importlib.resources import files

from tim_actions import Provider


def provider() -> Provider:
    return Provider(action_types=[AcmeQuery], action_files=files("acme_tim") / "actions")
```

The files must be in the package's wheel, as `acme_tim/actions/*.yaml`. A provider's files can name any installed action type, not only its own.
