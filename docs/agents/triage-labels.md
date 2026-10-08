# Triage labels

A triaged issue carries one category label and one state label.

Category: `bug` (something is broken) or `enhancement` (a new feature or improvement). The issue templates apply it.

State:

| State | Label | Meaning |
|---|---|---|
| Needs triage | `needs-triage` | A maintainer needs to evaluate this issue |
| Needs info | `needs-info` | Waiting on the reporter for more information |
| Ready for agent | `ready-for-agent` | Fully specified; an agent can implement it without further input |
| Ready for human | `ready-for-human` | Needs a human to implement it |
| Won't fix | `wontfix` | Will not be actioned |

An issue without a state label has not been triaged; triage gives it `needs-triage` first. From there it moves to `needs-info`, `ready-for-agent`, `ready-for-human` or `wontfix`, and `needs-info` returns to `needs-triage` when the reporter replies. Planning-map issues carry only `wayfinder:` labels ([issue tracker](issue-tracker.md#planning-maps-and-tickets)). Change the state with `gh issue edit <number> --add-label ... --remove-label ...` ([issue tracker](issue-tracker.md)).
