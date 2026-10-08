# Domain docs

How TIM's domain vocabulary and decisions are recorded, and how to use them. TIM has one domain context: one glossary and one set of ADRs.

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

When a term is settled (a new concept, a renamed one, or a synonym to retire), update `GLOSSARY.md` in the same change. Each entry is a bold term, a definition of one or two sentences saying what it is, and an optional `_Avoid_:` line listing synonyms not to use; group entries under subheadings. Keep implementation details (stores, tables, field names, environment variables) out of it; put them in the [Domain terms in code](../architecture.md#domain-terms-in-code) table in `docs/architecture.md`. If `GLOSSARY.md` disagrees with the code, the code wins ([RULES.md §2](../RULES.md#2-sources-of-truth)); fix the doc in the same change.

## Writing ADRs

Write ADRs the way [RULES.md §3](../RULES.md#3-documentation) describes:

1. Copy `docs/adr/0000-template.md` to `NNNN-short-title.md` with the next free number. Numbers are never reused or renumbered.
2. Fill in context, decision, alternatives and consequences.
3. Set the status to **Proposed**, or **Accepted** once the user agrees.
4. Add a row to the table in `docs/adr/README.md`.
5. To replace a decision, write a new ADR and set the old one to **Superseded by NNNN**. Don't delete ADRs.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it. Don't drift to synonyms the glossary lists under `_Avoid_`.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (propose the term and add it to `GLOSSARY.md`).

## Flag ADR conflicts

If your output contradicts an Accepted ADR, say so explicitly rather than silently overriding it:

> _Contradicts ADR-0010 (Kusto cluster allow-list), but worth reopening because…_

Changing what an ADR decided needs a new ADR that supersedes it.
