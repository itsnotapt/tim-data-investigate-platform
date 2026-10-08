# Triage labels

Every open issue in TIM's GitHub Issues is in one triage state, shown by its label.

| State | Label | Meaning |
|---|---|---|
| Needs triage | `needs-triage` | A maintainer needs to evaluate this issue |
| Needs info | `needs-info` | Waiting on the reporter for more information |
| Ready for agent | `ready-for-agent` | Fully specified; an agent can implement it without further input |
| Ready for human | `ready-for-human` | Needs a human to implement it |
| Won't fix | `wontfix` | Will not be actioned |

New issues start as `needs-triage`. Change the state with `gh issue edit <number> --add-label ... --remove-label ...` ([issue tracker](issue-tracker.md)).
