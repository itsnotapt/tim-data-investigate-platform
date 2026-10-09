# TIM

TIM is a Kusto investigation platform: analysts run KQL, pivot from result rows into other queries through shared query templates, and tag and comment on events.

## Language

### Investigations

**Investigation**:
An analyst's tree of tabs. Each pivot adds a child tab under the tab it was made from.
_Avoid_: session, case

**Tab**:
One node of an investigation: either a Kusto tab or a template tab, with its results.
_Avoid_: display component, view

**Kusto tab**:
A tab holding free KQL with a cluster, a database and a time range.
_Avoid_: ad-hoc tab

**Template tab**:
A tab that runs a snapshot of a query template with the analyst's params. Later edits to the template do not change it.

**Column view**:
A named, saved arrangement of the results grid's columns, usable in any tab.

### Query templates

**Query template**:
A shared definition of a parameterised KQL query: its cluster and database, its params and fields, and its place in the menus.
_Avoid_: saved query, stored query

**View**:
A query template that is a starting point for an investigation, offered in the New menu.

**Query** (template type):
A query template whose fields are filled from grid rows, offered as a pivot in the grid's context menu.

**Param**:
A template input the analyst fills in a form.
_Avoid_: argument, variable

**Field**:
A template input filled from the clicked or selected grid rows when pivoting.

**Pivot**:
Choosing a query template from a grid row's context menu. It creates a child template tab, which runs at once when every param is filled.
_Avoid_: drill-down

**Managed template**:
A query template maintained outside TIM; it is read-only in the Query Manager.

**Query Manager**:
The page where query templates are created, edited and deleted.

**Query options**:
An analyst's own settings for a query template, such as hiding it from the menus.

**Share link**:
A link that opens a query template with given params, and optionally runs it.

### Running queries

**Query run**:
One execution of a query by the server on behalf of the analyst who started it. It ends completed, failed with an error, or timed out.
_Avoid_: job

### Tagging

**Saved event**:
A snapshot of a result row kept so it can be tagged and commented on. A row is saved before it is tagged or commented.

**Tag**:
A label an analyst attaches to a saved event.

**Comment**:
An analyst's note on a saved event, optionally carrying a determination.

**Tagged event**:
An event that has tags or comments. Queries that ask for it show its tags, comments and determination alongside the row.

**Determination**:
The verdict on an event: malicious, suspicious or benign. It marks the event's row in the grid with a colour and a symbol.
_Avoid_: verdict, classification

**Tag cluster** / **tag database**:
The Kusto cluster and database that hold saved events, tags and comments.
