# TIM

TIM is an investigation platform: analysts run actions against an instance's connections (Kusto, Snowflake), pivot from result rows into other actions, and annotate rows by `id`. It has `web/` (React, TypeScript) and `api/` (Python, FastAPI) backed by PostgreSQL.

- [CODING_STANDARDS.md](CODING_STANDARDS.md): read before writing or reviewing code or docs.
- [docs/RULES.md](docs/RULES.md): sources of truth, git and PR flow.
- [docs/README.md](docs/README.md): documentation index.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `itsnotapt/tim-data-investigate-platform`, managed with the `gh` CLI; larger work is planned as a map issue with child tickets. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

The triage labels and their transitions are in [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single context: domain terms are defined only in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr/](docs/adr/README.md). See [docs/agents/domain.md](docs/agents/domain.md).

### Subagents

In `/implement`, exploration, doc updates, the full checks and mechanical review fixes go to the Sonnet `explorer` and `implementer` agents, without asking first. See [docs/agents/subagents.md](docs/agents/subagents.md).

### Where the work goes

`/implement` runs tickets in parallel, so each ticket gets its own worktree: a fresh branch off `origin/main` ([naming](docs/RULES.md#6-git)) in `.claude/worktrees/`, and the main checkout stays on `main`. Before the first edit, check `git worktree list` for one this ticket already has, and move any of the ticket's uncommitted files into it with `git stash push -u -m <ticket>`, then `git stash apply <sha>` in the worktree: the stash stack is shared by every worktree and session. Confirm the branch name with the user.
