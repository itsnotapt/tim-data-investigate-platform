---
status: accepted
date: 2026-11-01
---

# Run titles: Jinja templates for actions, Show in title for presets

Tabs opened from the same action or preset all had its name as their title, so an investigation tree could hold several "Host timeline" tabs with nothing to tell them apart. A tab now shows its run title, made from the params of its latest run. An action's author writes it as a Jinja template. A preset's owner switches on the inputs whose values follow the preset's name.

- **Actions: a Jinja template, rendered on the server.** An action file's optional `title:` is a template rendered in Jinja's sandbox with the run's resolved params by name and `action_name`. It is checked when the action file is loaded. Its result is the run's title. An action without one gives its name. An action type can override the method that renders it. The author has full control: lists, dates and defaults are formatted with Jinja's filters, and the title need not start with the action's name.
- **Presets: Show in title, formatted in the browser.** Presets are an analyst's starting point and their owners write no templates. Each input has a Show in title switch, on by default for From row inputs. A preset tab's title is the preset's name, then the switched-on inputs' values, with a list shown as `a, b +N`. The server never learns which preset a run came from, so the browser composes it. When copied as an action file, the switched-on inputs become a `title:` template. A preset that outgrows the switches becomes an action.
- **`row` and `cols`: the rows a run was pivoted from.** A title template can also name `row.X`, the value of column `X` the pivot's selected rows agree on, and `cols.X`, their distinct values of `X` as a list. Both are undefined when the rows disagree (`row` only), have no value, or the run has no pivot rows. The columns a template names are the action's title columns, checked when it is loaded. The browser sends the selected rows as `pivotRows`, only the title columns, and the server never stores them. A tab keeps them for its reruns until an analyst edits a param, so a title never names a row the params no longer came from.
- **Display text only.** A title is never sent to a connection. Params are still bound and never templated into a query ([0019](0019-params-are-bound.md)).
- **Truncated where it is shown.** The tree clamps a title to two lines and the app bar to one, each with the full title in a tooltip. The server cuts off only titles past a 1,000-character safety limit.

Decided by the user. Related: [0017](0017-actions-from-providers.md), [0019](0019-params-are-bound.md), [0021](0021-tim-actions-and-derived-images.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Python `str.format` templates | No dependency | A list renders as `['a', 'b']`; no filters for dates or defaults |
| Mustache templates | Analysts know the syntax | Logic-less: joining a list leaves a trailing separator; no date formats or defaults |
| TIM appends every param filled from rows | Nothing for authors to write | Noisy: Host timeline would add its timestamp, and some actions fill five params from rows |
| The preset's name sent with each run, the title built on the server | Share-link tabs keep the preset's name | A private preset's name reaches whoever opens the link; runs would depend on presets |
| Rendering templates in the browser | No rows sent to the server | A second template engine that must match Jinja; it bypasses an action type's `title_for` override |
| Title-only params: a param the analyst fills that only the title uses | The title can name any value | An input the analyst sees that changes nothing, and it must be declared for every such value |
| `rows` as a mapping named `rows` | Familiar name | `rows \| length` counts columns; `cols` reads as a column's values |
| A list of rows | Familiar shape | A template needs a loop to read one column, and the title columns cannot be collected statically from a loop |

## Consequences

- `tim-actions` depends on `jinja2`, and so does every provider.
- Simple Jinja templates read like mustache: `{{ host }}`.
- A tab opened from a share link shows the run's title from its action, never the preset's name.
- A template that fails when a run starts doesn't stop the run: the run is titled with the action's name and the error is logged.
