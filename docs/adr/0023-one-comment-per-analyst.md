---
status: accepted
date: 2026-10-27
---

# One comment per analyst per `id`, with every version kept

Comments were append-only, so a typo, a wrong conclusion or a comment on the wrong rows could only be fixed by adding another comment. An `id` now has at most one comment per analyst, which only that analyst replaces or clears, and History keeps every version. Each analyst's finding on an `id` stays correct without the record losing anything.

- **Whose comment.** A comment is keyed by its author's UPN, as label changes and preset owners are.
- **The wire.** `PATCH /api/annotations` keeps its shape, and `comment` works like `label`: a text sets the caller's comment, `null` clears it, and leaving it out keeps it. `null` used to mean "keep"; TIM's web app is the only client, so the change breaks nothing.
- **What's sent.** `Annotations.comments` holds one comment per author. History keeps its entry shapes: each version is a comment entry, and a clear is a comment entry with empty text.
- **Many `id`s at once.** A comment given for many `id`s replaces the caller's comment on each.
- **Existing comments.** Each analyst's newest comment on an `id` became theirs; their older ones are earlier versions in History.
- **Removal.** Clearing a comment hides it, and History keeps its text. Removing text for good, such as a pasted secret, is an operator's manual step.

Decided by the user. Amends [0020](0020-annotations-in-postgres.md), whose comments were append-only.

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Keep append-only | Nothing changes; the thread is a faithful record | Corrections pile up; a comment on the wrong rows stays |
| Edit and delete your own comments in a thread | Keeps conversation | Comments need an identity on the wire; a comment on many `id`s is one copy per `id`, so editing one or all is ambiguous; delete needs a tombstone or loses the record |
| Clearing deletes the text | A pasted secret goes for good | History stops being a record |
| `comment: ""` clears | Safe for a client that sends `null` to mean "keep" | Differs from `label`; there is no such client |
| A new History entry kind for a clear | Explicit | Breaks a client that switches on `kind` |
| Key by `oid` | Survives a UPN change | Differs from label changes and presets |

## Consequences

- An `id` has no conversation: a reply means rewriting your own comment. A longer discussion belongs in the ticket a sink writes to.
- An analyst whose UPN changes can't edit the comments made under the old one.
- The same analyst saving in two tabs: the last save wins.
