# Working rules

Process rules for everyone working on TIM, human or agent.

## 2. Sources of truth

- If you find a doc that disagrees with the code, report it; do not decide yourself which one is right. Tell the user what disagrees, let them choose the correct side, and fix the other side in the same change.
- Your own changes must not create a disagreement. If you change documented behaviour, update that doc in the same change, and add an ADR if the behaviour was a recorded decision ([docs/adr/README.md](adr/README.md)). Never edit a doc to match code you have just written without saying so.
- Ask the user before implementing a choice that is hard to reverse: datastore, auth model, licensing, a breaking API change, dropping a feature.

## 6. Git

- Commit, push or open a PR only when the user asks.
- Never commit directly to `main`. Branch off `main` as `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>` or `refactor/<short-name>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/), optionally scoped, e.g. `feat(web): …`.
- Do not merge with failing or skipped tests unless the user agrees.
- PRs into `main` are squash-merged: the PR title is the release commit and its first changelog entry. Mark a breaking change with `!` in the title, not with a footer.
- **Squash body:** for each further user-visible change, add one Conventional Commit line to the squash body; release-please makes each line a changelog entry in every package whose files the PR changes, and counts its type toward the version like the title's (a `feat` line under a `fix` title makes a minor release). Write each line for the changelog reader, with the UI's own labels, e.g. `fix: colour contrast of the snackbar Dismiss button`. Use `feat`, `fix` or `perf`, with no scope and no `!`: a breaking change goes in the title. The body holds only these lines, one per line: replace GitHub's pre-filled text. Tests, refactors and CI changes get no line. When a PR has such lines, list them under **Changelog entries** in the PR description; otherwise the title alone is the entry.
- **Releasing:** merge the release PRs release-please opens against `main`.

[ADR-0016](adr/0016-release-versions.md) records the branch flow and why; [development.md](development.md#ci-and-releases) describes the checks and repository settings.

## 7. Releases

- Keep a breaking change in its own PR, out of any package that should not go major. Its title's scope names every package whose files the PR changes: `frontend` (`web/`), `backend` (`api/`), `chart` (`deploy/helm/tim`), e.g. `feat(backend,chart)!: …`.
- Versions come from the commit types. Never edit versions by hand; release-please owns them.

[ADR-0016](adr/0016-release-versions.md) describes the packages and which commits bump them.
