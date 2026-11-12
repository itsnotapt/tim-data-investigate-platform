---
status: accepted
date: 2026-11-11
---

# A param has only a name

A param had a name for the query, title templates and presets, and an optional `title` for analysts, so placeholders in title templates could be written two ways. A param now has only its name, which analysts see as written, like a variable: in its pill, in the Save preset dialog and in `{…}` placeholders. Authors give params descriptive names, such as `process_guid` rather than `process`.

- **Shown as written.** No prettifying: the pill reads `process_guid`, not "Process guid", which could not have given "GUID" either.
- **No `title:`.** An action file that gives a param a `title:` fails to load, like any other unknown key. There is no deprecation period, because no instance was deployed when this was decided.
- **Params only.** Connections keep their titles. A connection's name is an identifier in the connections file, not something analysts type.

Decided by the user. Related: [0029](0029-run-titles-from-title-templates-filled-in-by-the-browser.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| A name and an optional title | A short name for the query, and words such as "Process GUID" for analysts | Two names for one thing; a placeholder by title breaks when an author renames the title, and two params can share one |
| Placeholders by name, titles kept for display | Placeholders are stable | Analysts type a name they never see elsewhere |
| A name, prettified for display | Nothing for authors to write | Cannot give "GUID" or "IP"; still two spellings |

## Consequences

- Renaming a param to make it descriptive breaks the presets of its action, as any param rename does.
