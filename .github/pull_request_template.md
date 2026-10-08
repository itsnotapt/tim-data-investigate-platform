<!-- Open feature PRs against `development`; they are squash-merged, so the PR title is the commit release-please reads.
The title must be a Conventional Commit: `feat(web): ...`, `fix(api): ...`, `feat(backend)!: ...` for breaking changes.
The files the PR changes decide which package it releases, not the scope. A `!` title bumps the major of every package whose files the PR changes (frontend `web/`, backend `api/`, chart `deploy/helm/tim`), so its scope must name each of them, comma-separated: `feat(backend,chart)!: ...`.
`development` -> `main` PRs are merged with a merge commit: their title must not start with a Conventional Commit type (use `Release: ...`), and keep the merge message as GitHub proposes it. -->

## Summary

<!-- The smallest diagram, diff sketch, call tree or file tree that shows the change. Link related issues. -->

## Evidence

<!-- Output, test run or screenshot, before and after the change. -->

- **Before:**
  **After:**

## Merge Danger

**Door:** <!-- one-way or two-way: can the merge be walked back cheaply? -->
**Blast Radius:** <!-- one word, then optional ramifications -->

## Checklist

- [ ] Tests added or updated
- [ ] Lint, format, typecheck and tests pass ([docs/development.md](../docs/development.md))
- [ ] A breaking title's scope names every package the PR changes (e.g. `feat(backend,chart)!:`), and the PR only touches packages meant to go major
- [ ] Docs updated in the same change ([docs/RULES.md](../docs/RULES.md))
