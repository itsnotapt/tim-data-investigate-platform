# TIM

TIM is an investigation platform: analysts run actions against an instance's connections (Kusto, Snowflake), pivot from result rows into other actions, and annotate rows by `id`.

## Language

### Investigations

**Investigation**:
An analyst's tree of tabs. Each pivot adds a child tab under the tab it was made from.
_Avoid_: session, case

**Tab**:
One node of an investigation: an action tab, with its results.
_Avoid_: display component, view

**Action tab**:
A tab that runs an action with the analyst's param values and shows the rows of its run. It keeps those values as they are, so a later change to the action does not change them.

**Column view**:
A named, saved set of the grid's columns and filters, private to its owner or shared with everyone.
_Avoid_: view, layout

**Applied view**:
The column view an analyst has chosen for a preset or action. New tabs opened from it start with this view.

### Actions

**Action**:
A named operation an analyst runs. A query action takes params and returns rows; a sink takes rows and writes them.
_Avoid_: query, query template

**Sink**:
An action that takes the rows an analyst selected and writes them somewhere, such as a ticket queue. It has no params and returns no rows.

**Action default**:
The columns an action declares. A tab starts with them when there's no applied view.

**Action file panel**:
The panel in an action tab's side bar that shows the tab's column layout as an action file's `columns:` block, with Copy. Pasted into the action file, it becomes the action default.

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
The nested, searchable menu of actions and presets from which an analyst starts a tab.

**Param**:
A named, typed value an action takes.
_Avoid_: argument, variable, field, input

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

**Derived image** (for operators):
A container image built `FROM` TIM's backend image that installs providers into it. An instance that uses providers runs one.

### Instance

**Instance**:
One deployment of TIM with its configured actions, connections, labels and limits.

**Instance files**:
The action files, the connections file and the labels file an instance reads at startup.

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

### Running actions

**Pivot**:
Running an action or a preset from a grid row's context menu, with its params filled from the clicked or selected rows. It opens a child tab under the tab it came from.
_Avoid_: drill-down

**Run**:
One execution of an action by the server for the analyst who started it. It ends succeeded, in error, timed out or cancelled.
_Avoid_: action run, query run, job, execution

**Run details**:
The key-value facts a run reports, such as its duration, row count or a warning.

**Share link**:
A link to a run, or to one row of it, that any signed-in analyst holding it can open to see the run's rows.

### Results

**`id`**:
The action-defined key a row is annotated by. It is shared across actions, so rows with the same `id` carry the same annotations. A row without one cannot be annotated.
_Avoid_: EventId, event id, row id

**Row number**:
A row's position in its run's results, unique within the run where `id` can repeat.
_Avoid_: ordinal, row id

### Annotations

**Annotations**:
What is recorded against an `id`: its label, tags and comments together.
_Avoid_: tags, tag state, id state

**Label**:
One of the instance's configured labels, each with a name, a colour and optionally a symbol. An `id` carries at most one, and it colours that `id`'s rows.
_Avoid_: verdict, classification

**Tag**:
A free-text string of 1 to 100 characters on an `id`'s annotations. An `id` has each tag once, and every analyst sees it. A tag is added or removed, and a removed tag is deleted.

**Comment**:
A note on an `id`'s annotations, with its author and time. An `id` can have many. Comments are append-only.

**History**:
The record of an `id`'s label changes and comments, each with who made it and when. Tags are not in it.
_Avoid_: audit log, activity

### Tagging

**Saved event**:
A snapshot of a result row kept so it can be tagged and commented on. A row is saved before it is tagged or commented.

**Event tag**:
A free-text string an analyst attaches to a saved event. It is kept in Kusto, apart from an `id`'s [tags](#annotations).

**Event comment**:
An analyst's note on a saved event, optionally carrying a determination. It is kept in Kusto, apart from an `id`'s [comments](#annotations).

**Tagged event**:
An event that has event tags or event comments. Queries that ask for it show its tags, comments and determination alongside the row.

**Determination**:
An analyst's judgement of whether an event is malicious, suspicious or benign. It colours the event's row in the grid and, when the analyst turns symbols on, marks it with a symbol.
_Avoid_: verdict, classification

**Tag cluster** / **tag database**:
The Kusto cluster and database that hold saved events, tags and comments.
