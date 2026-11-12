---
status: accepted
date: 2026-11-11
---

# Run titles from `{…}` title templates, filled in by the browser

Tabs opened from the same action or preset need titles that tell them apart. Actions and presets now share one title template: plain text with `{…}` placeholders, which the browser fills in by plain substitution. Analysts write a preset's as easily as authors write an action's, and there is no template engine to learn or to keep in step between the server and the browser.

- **One syntax for actions and presets.** A placeholder names a param, such as `{host}`, or a pivot row column, such as `{row.Image}`. A preset's can also name its query parameters. Everything else is plain text, including the action's or preset's name. There are no filters, conditionals, fallbacks or escapes: every `{…}` is a placeholder.
- **Values as written.** A string is shown as it is, and any other value as JSON; a connection is shown by its name. A list is shown as `[a]`, `[a, b]` or `[a, b, … +3]`. An unset value is shown as `<not set>`: no value, `null`, `""` or `[]`.
- **`{row.X}`: the pivot rows' column `X`.** It is the value the rows agree on, or their distinct values as a list when they differ. It is `<not set>` when the run has no pivot rows. The columns an action's title template names are its title columns, the only columns a tab keeps of its pivot rows.
- **An action's title template.** An action file's optional `title:` holds it. An action without one gives its name. It is checked when the action file is loaded: each placeholder must be a param or `row.` and a column.
- **A preset's title template.** It is saved with the preset, and replaces the Show in title switches. It defaults to the preset's name, then a placeholder for each From row input. Until the owner edits it, it follows the preset's name. Saving rejects a placeholder that names none of the action's params, the preset's query parameters or `row.` and a column. Copy as action file copies it as the action's `title:`.
- **The browser fills it in, the server stores the result.** The browser sends the filled-in title with each run, and the server stores it as the run's title, for share links. A run created without a title, or with a blank one, is titled with the action's name. The server cuts off titles past a 1,000-character safety limit. Pivot rows stay in the browser.
- **Display text only.** A title is never sent to a connection. Params are still bound and never templated into a query ([0019](0019-params-are-bound.md)).
- **Truncated where it is shown.** The tree clamps a title to two lines and the app bar to one, each with the full title in a tooltip.

Decided by the user, after prototyping the Save preset dialog on the `prototype/save-preset-dialog` branch. Related: [0017](0017-actions-from-providers.md), [0019](0019-params-are-bound.md), [0030](0030-a-param-has-only-a-name.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Jinja templates for actions, rendered on the server; Show in title switches for presets | Filters such as `basename`, defaults and conditionals; an action type can override how its titles render | Two ways to title a run; a preset owner can only pick values to follow the name; a preset copied as an action file needs its titles translated to Jinja |
| `{…}` templates for presets only, Jinja kept for actions | Actions keep filters and defaults | Two template syntaxes; a preset of an action cannot reuse the action's title template |
| Templates stored in the browser only | No API change | A shared preset arrives without its title, and so does its owner in another browser |
| The server fills in titles too | Share-link tabs and runs created through the API get filled-in titles | The substitution is implemented twice and has to match; pivot rows are sent to the server for every run |
| An unset value shown as nothing | Matches the titles before this decision | A title hides that its run had no value, and leaves dangling words such as "on" |
| A list shown as `a, b +3` | Shorter | Reads as prose rather than as a list value |

## Consequences

- `tim-actions` no longer depends on `jinja2`, and an action type can no longer override how its titles render.
- Paths are shown in full: `{row.Image}` gives `C:\Windows\System32\cmd.exe`, not `cmd.exe`.
- A tab opened from the New menu has no pivot rows, so its `{row.X}` placeholders show `<not set>`.
- A run's title is text the browser chose. It is only ever shown as text.
