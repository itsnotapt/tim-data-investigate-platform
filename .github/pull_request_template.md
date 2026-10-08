<!-- The PR title must be a Conventional Commit: `feat(web): ...`, `fix(api): ...`, `feat(api)!: ...` for breaking changes.
Release notes and versions are generated from it.
The files a commit touches decide which package it releases, not the scope. `!` (or a `BREAKING CHANGE:` footer) on any commit bumps the major of every package whose files it touches (frontend `web/`, backend `api/`, chart `deploy/helm/tim`) and needs the label `release:major-<package>`.
Merge with a merge commit, not squash or rebase. -->

## Summary

<!-- What changes and why. Link related issues. -->

## Checklist

- [ ] Tests added or updated
- [ ] Lint, format, typecheck and tests pass ([docs/development.md](../docs/development.md))
- [ ] Breaking commits only touch packages meant to go major; `release:major-<package>` labels added
- [ ] Docs updated in the same change ([docs/RULES.md](../docs/RULES.md))
