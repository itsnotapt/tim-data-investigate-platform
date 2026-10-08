# Domain docs

How the engineering skills consume TIM's domain documentation when exploring the codebase. TIM is a single-context repo.

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root: the domain vocabulary of record. It defines domain terms only (definitions plus `_Avoid_` synonyms); [architecture.md](../architecture.md#domain-terms-in-code) maps each term to the code.
- **[`docs/adr/`](../adr/README.md)**: read the ADRs that touch the area you're about to work in. Only **Accepted** ADRs are binding.

## File structure

```
/
├── GLOSSARY.md                ← domain vocabulary
├── docs/
│   ├── architecture.md        ← "Domain terms in code" section
│   └── adr/
│       ├── README.md          ← ADR index table
│       ├── 0000-template.md
│       └── NNNN-short-title.md
├── web/
└── api/
```

## Updating GLOSSARY.md

When `/domain-modeling` resolves a term, update `GLOSSARY.md` in the same change, in the skill's format. Keep implementation details (stores, tables, field names, environment variables) out of it; put them in the [Domain terms in code](../architecture.md#domain-terms-in-code) table in `docs/architecture.md`. If `GLOSSARY.md` disagrees with the code, the code wins ([RULES.md §2](../RULES.md#2-sources-of-truth)); fix the doc in the same change.

## Writing ADRs

Write ADRs the way [RULES.md §3](../RULES.md#3-documentation) describes, not in the `/domain-modeling` skill's own ADR format:

1. Copy `docs/adr/0000-template.md` to `NNNN-short-title.md` with the next free number. Numbers are never reused or renumbered.
2. Fill in context, decision, alternatives and consequences.
3. Set the status to **Proposed**, or **Accepted** once the user agrees.
4. Add a row to the table in `docs/adr/README.md`.
5. To replace a decision, write a new ADR and set the old one to **Superseded by NNNN**. Don't delete ADRs.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it. Don't drift to synonyms the glossary lists under `_Avoid_`.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an Accepted ADR, say so explicitly rather than silently overriding it:

> _Contradicts ADR-0010 (Kusto cluster allow-list), but worth reopening because…_

Changing what an ADR decided needs a new ADR that supersedes it.
