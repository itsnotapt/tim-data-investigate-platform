<!-- Title, branch and merge rules: docs/RULES.md §6–7 (Git, Releases). -->

## Summary

<!-- The smallest diagram, diff sketch, call tree or file tree that shows the change. Link related issues. -->

## Evidence

<!-- Output, test run or screenshot, before and after the change. -->

- **Before:**
  **After:**

## Changelog entries

<!-- Only when the PR adds changelog lines beyond its title: the squash body for the merger to paste, one Conventional Commit line per further user-visible change (docs/RULES.md §6). Otherwise delete this section; the title is the only entry. -->

```
```

## Merge Danger

**Door:** <!-- one-way or two-way: can the merge be walked back cheaply? -->
**Blast Radius:** <!-- one word, then optional ramifications -->

## Checklist

- [ ] Tests added or updated
- [ ] Lint, format, typecheck and tests pass ([docs/development.md](../docs/development.md))
- [ ] Title, any squash-body lines, branch and any breaking scope follow [docs/RULES.md §6–7](../docs/RULES.md#6-git)
- [ ] Docs updated in the same change ([CODING_STANDARDS.md](../CODING_STANDARDS.md#documentation))
