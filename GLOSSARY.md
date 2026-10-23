# TIM

TIM is a Kusto investigation platform: analysts run KQL, pivot from result rows into actions and query templates, and tag and comment on events.

## Language

### Investigations

**Investigation**:
An analyst's tree of tabs. Each pivot adds a child tab under the tab it was made from.
_Avoid_: session, case

**Tab**:
One node of an investigation: a Kusto tab, a template tab or an action tab, with its results.
_Avoid_: display component, view

**Kusto tab**:
A tab holding free KQL with a cluster, a database and a time range.
_Avoid_: ad-hoc tab

**Template tab**:
A tab that runs a snapshot of a query template with the analyst's params. Later edits to the template do not change it.

**Action tab**:
A tab that runs an action with the analyst's param values and shows the rows of its run. It keeps those values as they are, so a later change to the action does not change them.

**Column view**:
A named, saved arrangement of the results grid's columns, usable in any tab.

### Actions

**Action**:
A named operation an analyst runs, which takes params and returns rows.

**Preset**:
An action with some of its params fixed and the rest filled in by the analyst or from rows, saved by an analyst under a name and a menu folder. It is private to its owner or shared with everyone. An analyst can hide someone else's preset for themselves.
_Avoid_: saved action, favourite

**Fixed input**:
An input of a preset whose value is saved with the preset. An input is a param that rows can fill (it declares `from_columns`) or a query parameter.

**From row input**:
An input of a preset, a param or a query parameter, that takes its value from a column of the row the analyst pivots on. With no columns, the tab asks the analyst for the value.

**Bookmark**:
A preset whose inputs are all fixed. Opening it needs nothing more from the analyst.

**New menu**:
The nested, searchable menu of actions and presets, with query templates beside them, from which an analyst starts a tab.

**Param**:
A named, typed value an action takes, or one a query template's form asks the analyst for.
_Avoid_: argument, variable

**Query parameter**:
A name declared in the KQL of an action tab of Run KQL and sent to Kusto as a Kusto query parameter, with a type. It is not a param of the action. In a preset it is an input, fixed or From row, and the preset can be copied as an action file.
_Avoid_: KQL variable

**Action type** (for action authors):
The reusable Python code behind a family of actions. Each action names one action type and gives its configuration.

**Action file** (for action authors):
A YAML file holding one or more actions, each naming an action type and giving its configuration.

**Sidecar** (for action authors):
A file next to an action file that holds the text of one of an action's fields, such as its query.

**Provider** (for action authors):
An installable package that adds action types, actions and connection types to an instance.
_Avoid_: action package, plugin, extension

### Instance

**Instance**:
One deployment of TIM with its configured actions, connections, labels and limits.

**Connection type**:
A kind of system TIM can connect to, such as Kusto or Snowflake.
_Avoid_: backend, source, data source

**Connection**:
One fixed endpoint of a connection type, configured for the instance with its auth mechanism.
_Avoid_: cluster

**Connections file**:
The YAML file named by `TIM_CONNECTIONS_FILE` that lists the instance's connections. Each entry names its connection type, and that type's `Connection` model validates it. It is loaded at startup and checked with `tim-api check --connections`.

**Labels file**:
The YAML file that lists the instance's labels. Each entry gives a label's key, name, colour and optionally a symbol.

### Query templates

**Query template**:
A shared definition of a parameterised KQL query: its cluster and database, its params and fields, and its place in the menus.
_Avoid_: saved query, stored query

**View**:
A query template that is a starting point for an investigation, offered in the New menu.

**Query** (template type):
A query template whose fields are filled from grid rows, offered as a pivot in the grid's context menu.

**Field**:
A template input filled from the clicked or selected grid rows when pivoting.

**Pivot**:
Running an action or a query template from a grid row's context menu, with its params filled from the clicked or selected rows. It opens a child tab under the tab it came from.
_Avoid_: drill-down

**Managed template**:
A query template maintained outside TIM; it is read-only in the Query Manager.

**Query Manager**:
The page where query templates are created, edited and deleted.

**Query options**:
An analyst's own settings for a query template, such as hiding it from the menus.

**Share link**:
A link that opens a query template with given params, and optionally runs it.

### Running actions

**Run**:
One execution of an action by the server for the analyst who started it. It ends succeeded, in error, timed out or cancelled.
_Avoid_: action run, job, execution

**Run details**:
The key-value facts a run reports, such as its duration, row count or a warning.

**Query run**:
One execution of a Kusto tab's or template tab's KQL by the server on behalf of the analyst who started it. It ends completed, failed with an error, or timed out.
_Avoid_: job

### Results

**`id`**:
The action-defined key a row is annotated by. It is shared across actions, so rows with the same `id` carry the same annotations. A row without one cannot be annotated.
_Avoid_: EventId, event id, row id

**Row number**:
A row's position in its run's results, unique within the run where `id` can repeat.
_Avoid_: ordinal, row id

### Annotations

**Annotations**:
What is recorded against an `id`: its label, tags and comments together._Avoid_: tags, tag state, id state

**Label**:
One of the instance's configured labels, each with a name, a colour and optionally a symbol. An `id` carries at most one, and it colours that `id`'s rows.
_Avoid_: verdict, classification

### Tagging

**Saved event**:
A snapshot of a result row kept so it can be tagged and commented on. A row is saved before it is tagged or commented.

**Tag**:
A free-text string an analyst attaches to a saved event.

**Comment**:
An analyst's note on a saved event, optionally carrying a determination.

**Tagged event**:
An event that has tags or comments. Queries that ask for it show its tags, comments and determination alongside the row.

**Determination**:
An analyst's judgement of whether an event is malicious, suspicious or benign. It colours the event's row in the grid and, when the analyst turns symbols on, marks it with a symbol.
_Avoid_: verdict, classification

**Tag cluster** / **tag database**:
The Kusto cluster and database that hold saved events, tags and comments.
