# Issue tracker

Issues and specs for TIM live as GitHub issues in `itsnotapt/tim-data-investigate-platform`. Use the `gh` CLI for every operation; run inside a clone, `gh` infers the repo from `git remote -v`.

Issue numbers belong in issues, PR descriptions and commit messages, never in `docs/` or code comments ([RULES.md §3](../RULES.md#3-documentation)).

## Commands

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Publishing and fetching work

- **Publishing work** (a spec, a plan, a ticket): create a GitHub issue.
- **Fetching a ticket**: read the issue as in **Read an issue** above.

## Pull requests

**External PRs are not triaged as requests.** Issues are the only request surface; PRs are reviewed as code, not labelled with the [triage labels](triage-labels.md).

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Planning maps and tickets

Larger pieces of work are planned as a **map**: one parent issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, whose body has three parts: Notes, Decisions so far, and Fog (what is still unknown). `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Each ticket has one type label: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` (stress-test a plan or decision) or `wayfinder:task`. A claimed ticket is assigned to the person working on it.
- **Blocking**: GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the `#number` or `node_id`). `issue_dependencies_summary.blocked_by` counts open blockers only. Where dependencies aren't available, put a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Next ticket**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues or task list) and drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; the first remaining one in map order is next.
- **Claim**: `gh issue edit <n> --add-assignee @me`, before any other change to the ticket.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then add a one-line summary with a link to the ticket under the map's Decisions so far.
