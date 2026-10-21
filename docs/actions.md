# Actions

The guide for operators and action authors: what configures an instance's actions, how to write action files, and how to check them. How TIM loads them is in [architecture.md](architecture.md#actions-and-providers); the decision is [ADR-0017](adr/0017-actions-from-providers.md).

## What an instance holds

- **Providers**, installed packages that add action types, Python actions and action files of their own, found through the `tim.actions` entry-point group.
- **Action files**, YAML in one flat directory, `TIM_ACTIONS_DIR` ([configuration.md](configuration.md#actions)).

Both are read once, at startup. Any problem stops startup ([operations.md](operations.md#startup-failures-from-the-files)), so a change to a file takes a restart.

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
| `pivot` | yes | `row` or `rows` offers the action in the grid's context menu on one or several selected rows; `none` keeps it out. |
| `params` | no | The params, below. |
| `id` | no | The column that gives each row its `id`, or a list of alternative columns. Leave it out and the rows have no `id`. |
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
| `many` | `false` | A list of values. Not for `kql`, `sql` or `connection`. |
| `choices` | none | The values allowed. |
| `connection_type` | none | For `kind: connection` only, which it requires. |
| `schema_from` | none | For `kql` and `sql`: the params that scope the editor's schema. |
| `from_columns` | none | The result columns a pivot takes the value from; the first non-empty one wins. A row is offered the action when it has one of each required param's columns. |
| `help` | none | Help text. |

Dates and times in a file stay strings, as the browser sends them.

### Columns

An action can declare some or all of its result columns. Each entry takes `name` and `type` (`string`, `number`, `boolean`, `datetime`, `timespan` or `json`), and optionally `title`, `hidden`, `width` (pixels), `pinned` (`left` or `right`), `sort` (`asc` or `desc`), `group` and `calculated`. A `calculated` column isn't in the result: it is an AG Grid calculated-column expression over the row's other columns, which names columns in brackets, such as `[Bytes] / 1024`. The tab's grid evaluates it, placed after the declared column before it. Analysts can add their own calculated columns from the grid's column menu.

The tab's grid uses the declared settings as AG Grid's initial column settings: `title` is the header, and `hidden`, `width`, `pinned`, `sort` and `group` become `initialHide`, `initialWidth`, `initialPinned`, `initialSort` and `initialRowGroup`. They apply the first time the grid shows the columns; a column state the analyst has changed and the tab restored wins over them.

### Sidecars

A query can be written inline (`query: |`) or in a sidecar file next to the action file, where an editor highlights it: `query_file: sign_ins.kql`. Give one or the other, not both. The action type marks which of its fields take a sidecar. The sidecar is a file name in the same directory as the action file, not a path.

## Checking files

The api image prints the JSON Schema of the action types installed in it, and validates action files the way startup does, without a database or credentials ([operations.md](operations.md#tim-api-check)):

```bash
docker run --rm <api image> tim-api schema actions > action-file.schema.json
docker run --rm -v "$PWD/actions:/actions:ro" <api image> tim-api check --actions /actions
```

- **In the editor:** commit `action-file.schema.json` next to the files and point `yaml-language-server` at it, with a `# yaml-language-server: $schema=./action-file.schema.json` line at the top of each file or a `yaml.schemas` setting. It completes and checks the fields of each document by its `type`. Regenerate it when the image's providers change.
- **In CI:** run `tim-api check --actions <dir>` with the image you deploy. It prints `OK: <n> actions`, or the same `<file>:<line>: <field>: <message>` problems startup reports and exits 1.

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

TIM validates each document against the `File` model, then builds the action with `AcmeQuery.from_file(file)`. The default passes the file's fields, all but `type`, to the action by name; override `from_file` when the action's fields differ from the file's. The action type's docstring becomes the type's description in the schema.

## Providers

A provider lists its file-capable action types in `Provider(action_types=[...])`, and can ship action files as package data in `Provider(action_files=...)`, a directory read like `TIM_ACTIONS_DIR`:

```python
from importlib.resources import files

from tim_actions import Provider


def provider() -> Provider:
    return Provider(action_types=[AcmeQuery], action_files=files("acme_tim") / "actions")
```

The files must be in the package's wheel, as `acme_tim/actions/*.yaml`. A provider's files can name any installed action type, not only its own.
