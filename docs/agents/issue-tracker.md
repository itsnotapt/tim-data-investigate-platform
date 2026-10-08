# Issue tracker

Issues, specs, plans and tickets for TIM are published as GitHub issues in `itsnotapt/tim-data-investigate-platform`, using the `gh` CLI.

Issue numbers belong in issues, PR descriptions and commit messages, never in `docs/` or code comments ([RULES.md §3](../RULES.md#3-documentation)).

## Sub-issues

Make an issue a sub-issue of a parent with `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.

## Pull requests

**PRs as a request surface: no.** Issues are the only request surface; PRs are reviewed as code, not labelled with the [triage labels](triage-labels.md).

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Planning maps and tickets

Work too large for one session is planned as a **map**: one parent issue whose **child** issues are tickets. Each ticket is a question whose answer is a decision; the map is done when nothing is left to decide. The `wayfinder:` label strings below are fixed, because tooling queries them.

- **Map**: a single issue labelled `wayfinder:map`. Its body has five sections: **Destination** (what the end of the plan looks like), **Notes** (domain, standing preferences), **Decisions so far** (one line per closed ticket, linking it), **Not yet specified** (questions expected but not yet sharp enough to become tickets) and **Out of scope** (work ruled out, with the reason). Open tickets are not listed in the body; they are the map's open child issues.
- **Child ticket**: a sub-issue of the map (see [Sub-issues](#sub-issues)); where sub-issues aren't enabled, also add it to a task list in the map body. The ticket body is the question. Each ticket has exactly one type label and no triage label:
  - `wayfinder:research`: find a fact the decision depends on (documentation, third-party APIs, knowledge bases).
  - `wayfinder:prototype`: build a rough, throwaway artifact to react to; the ticket links it.
  - `wayfinder:grilling`: a question-by-question discussion with a person to settle a plan or decision.
  - `wayfinder:task`: practical work that must happen before a decision can be made, such as getting access or moving data.
- **Blocking**: GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the `#number` or `node_id`). `issue_dependencies_summary.blocked_by` counts open blockers only. Where dependencies aren't available, put a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Next ticket**: of the map's open children, drop any with an open blocker or an assignee; the first remaining one in map order is next.
- **Claim**: assign the ticket to yourself before any other change to it.
- **Resolve**: comment the answer, close the ticket, then add a one-line summary linking it under the map's **Decisions so far**.
