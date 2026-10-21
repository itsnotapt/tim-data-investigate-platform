# Subagents

Which work an agent session hands to a subagent, and on which model. The agents are defined in [`.claude/agents/`](../../.claude/agents/).

The main session keeps the work that needs judgement: agreeing seams, the red-green loop, behaviour changes and review findings. Work that fills the context but needs little judgement goes to a Sonnet subagent.

## Agents

| Agent         | Model  | For                                                                                           |
| ------------- | ------ | --------------------------------------------------------------------------------------------- |
| `explorer`    | Sonnet | Read-only: finds the files, patterns, tests and docs a task touches, as `file:line` pointers  |
| `implementer` | Sonnet | Doc updates to match a diff, the full checks with only failures reported, mechanical fixes    |

## In `/implement`

Spawning these needs no further ask:

1. **Before the seams:** an `explorer` reads the ticket and reports where the change lands. The main session reads only the files it points to.
2. **Once the code is done:** an `implementer` gets the diff and updates every doc that describes the changed behaviour ([CODING_STANDARDS.md](../../CODING_STANDARDS.md#documentation)).
3. **The full checks:** an `implementer` runs every check in [development.md](../development.md#checks) and reports only failures. Single test files and typechecks during the loop stay in the main session.
4. **After `/code-review`:** an `implementer` applies the mechanical findings: wording, renames, comments. A finding that changes behaviour is fixed in the main session, test-first.

The `/code-review` reviewers stay on the main model.

## Writing the prompt

Point, don't paste: give the ticket number, the fixed point for the diff, the files and the exact task. The agents read `CLAUDE.md` and the standards themselves.
