# Issue tracker

Issues, specs, plans and tickets for TIM are published as GitHub issues in `itsnotapt/tim-data-investigate-platform`, using the `gh` CLI.

Where issue numbers may appear is set in [CODING_STANDARDS.md](../../CODING_STANDARDS.md#documentation).

## Sub-issues

Make an issue a sub-issue of a parent with `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards. List a parent's sub-issues with `gh issue view <parent> --json subIssues`.

## Dependencies

When one issue genuinely waits on another, consider GitHub's native issue dependencies over a "depends on" line in the body: the edge shows as **Blocked by** / **Blocking** in the issue sidebar and in project views, and the issue stops counting as blocked once its blockers close. Add one with `gh issue edit <issue> --add-blocked-by <blocker>` (or `gh issue create --blocked-by <blocker> ...`), and list an issue's blockers with `gh issue view <issue> --json blockedBy`.

Dependencies link issues only. When an issue waits on a pull request, name the PR in the body rather than adding a blocker for whichever issue that PR closes, and update or remove the line once the PR merges.

## Tickets

A ticket's tests and acceptance criteria name its test seams, already confirmed: `/tdd` starts from them.

## Pull requests

**PRs as a request surface: no.** Issues are the only request surface; PRs are reviewed as code, not labelled with the [triage labels](triage-labels.md).

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Planning maps and tickets

Work too large for one session is planned as a **map**: one parent issue whose **child** issues are tickets. Each ticket is a question whose answer is a decision; the map is done when nothing is left to decide. The `wayfinder:` label strings below are fixed, because tooling queries them.

- **Map**: a single issue labelled `wayfinder:map`. Its body has five sections: **Destination** (what the end of the plan looks like), **Notes** (domain, standing preferences), **Decisions so far** (one line per closed ticket, linking it), **Not yet specified** (questions expected but not yet sharp enough to become tickets) and **Out of scope** (work ruled out, with the reason). Open tickets are not listed in the body; they are the map's open child issues.
- **Child ticket**: a sub-issue of the map (see [Sub-issues](#sub-issues)). The ticket body is the question. Each ticket has exactly one type label and no triage label:
  - `wayfinder:research`: find a fact the decision depends on (documentation, third-party APIs, knowledge bases).
  - `wayfinder:prototype`: build a rough, throwaway artifact to react to; the ticket links it.
  - `wayfinder:grilling`: a question-by-question discussion with a person to settle a plan or decision.
  - `wayfinder:task`: practical work that must happen before a decision can be made, such as getting access or moving data.
- **Blocking**: [dependencies](#dependencies) between tickets. A ticket is unblocked when every blocker is closed.
- **Next ticket**: of the map's open children, drop any with an open blocker or an assignee; the first remaining one in map order is next.
- **Claim**: assign the ticket to yourself before any other change to it.
- **Resolve**: comment the answer, close the ticket, then add a one-line summary linking it under the map's **Decisions so far**.
