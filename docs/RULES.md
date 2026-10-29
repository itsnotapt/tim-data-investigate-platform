# Working rules

Process rules for everyone working on TIM, human or agent.

## 2. Sources of truth

- If you find a doc that disagrees with the code, report it; do not decide yourself which one is right. Tell the user what disagrees, let them choose the correct side, and fix the other side in the same change.
- Your own changes must not create a disagreement. If you change documented behaviour, update that doc in the same change, and add an ADR if the behaviour was a recorded decision ([docs/adr/README.md](adr/README.md)). Never edit a doc to match code you have just written without saying so.
- Ask the user before implementing a choice that is hard to reverse: datastore, auth model, licensing, a breaking API change, dropping a feature.

## 6. Git

- Commit, push or open a PR only when the user asks.
- Never commit directly to `main`. Branch off `main` as `<type>/<ticket>-<short-name>`, e.g. `feat/114-annotate-dialog`.
  - `<type>` is `feat`, `fix`, `docs`, `chore` or `refactor`.
  - `<ticket>` is the number of the issue the branch implements. Work without an issue leaves it out, e.g. `docs/worktree-naming`.
  - A worktree for the branch sits in `.claude/worktrees/<ticket>-<short-name>`: the branch name without its type.
- Use [Conventional Commits](https://www.conventionalcommits.org/), optionally scoped, e.g. `feat(web): …`.
- Do not merge with failing or skipped tests unless the user agrees.
- PRs into `main` are squash-merged: the PR title is the release commit and its first changelog entry. Mark a breaking change with `!` in the title, not with a footer.
- **Squash body:** for each further user-visible change, add one Conventional Commit line to the squash body.
  - release-please makes each line a changelog entry in TIM's changelog, and in `tim-actions`' when the PR changes `api/tim-actions`.
  - It counts the line's type toward the version like the title's. A `feat` line under a `fix` title makes a minor release.
  - Write each line for the changelog reader, with the UI's own labels, e.g. `fix: colour contrast of the snackbar Dismiss button`.
  - Use `feat`, `fix` or `perf`, with no scope and no `!`. A breaking change goes in the title.
  - The body holds only these lines, one per line. Replace GitHub's pre-filled text.
  - Tests, refactors and CI changes get no line.
  - When a PR has such lines, list them under **Changelog entries** in the PR description. Otherwise the title alone is the entry.
- **Releasing:** merge the release PRs release-please opens against `main`.

[ADR-0024](adr/0024-one-release-version.md) records the branch flow and why; [development.md](development.md#ci-and-releases) describes the checks and repository settings.

## 7. Releases

- **TIM** has one version for the api image, the web image and the Helm chart. It is tagged `vX.Y.Z`.
- **`tim-actions`** has its own version, tagged `tim-actions-vX.Y.Z`.
- A commit's type counts toward TIM's next version unless all its files are under `.claude`, `.github`, `docs`, `examples`, `api/tests`, `api/tim-actions/tests`, `web/e2e` or `deploy/helm/tim/ci`.
- A breaking title (`!`) always makes TIM a major release.
- A breaking title on a PR that changes `api/tim-actions` (outside `api/tim-actions/tests`) is a breaking `tim-actions` release too, so its scope must name `tim-actions`, e.g. `feat(api,tim-actions)!: …`. Keep `api/tim-actions` out of a breaking PR when its interface doesn't break.
- While `tim-actions` is 0.x, its breaking release bumps the minor (0.1 → 0.2), and `feat` or `fix` the patch.
- Other scopes are optional and free-form. By convention they name `web`, `api`, `chart` or `tim-actions`.
- Versions come from the commit types. Never edit versions by hand; release-please owns them.
- Releasing is merging the release PR. It publishes both images and the chart.

[ADR-0024](adr/0024-one-release-version.md) describes the packages and which commits bump them.
