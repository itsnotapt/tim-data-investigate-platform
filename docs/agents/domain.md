# Domain docs

How TIM's domain vocabulary and decisions are recorded, and how to use them. TIM has one domain context: one glossary and one set of ADRs.

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root: the only place domain terms are defined.
- **[`docs/adr/`](../adr/README.md)**: the ADRs that touch the area you're about to work in. Only **Accepted** ADRs are binding.

## File structure

```
/
├── GLOSSARY.md                ← domain vocabulary
├── docs/
│   └── adr/
│       ├── README.md          ← when to write an ADR, how, and the index
│       ├── 0000-template.md
│       └── NNNN-short-title.md
├── web/
└── api/
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it. Don't drift to synonyms the glossary lists under `_Avoid_`.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (add the term to `GLOSSARY.md`).

## Updating GLOSSARY.md

Update `GLOSSARY.md` in the same change as soon as a term is settled: a new concept, a renamed one, or a synonym to retire.

- Each entry is a bold term, a definition of one or two sentences saying what it is (not what it does), and an optional `_Avoid_:` line listing synonyms not to use.
- Pick one word per concept and list the others under `_Avoid_`.
- Only terms specific to TIM belong; general programming concepts don't.
- Group entries under subheadings when natural clusters emerge.
- The glossary holds definitions only. Stores, tables, field names and environment variables are described in [architecture.md](../architecture.md), [api.md](../api.md) and [configuration.md](../configuration.md), which use the glossary's terms without redefining them.

If `GLOSSARY.md` disagrees with the code, the code wins ([RULES.md §2](../RULES.md#2-sources-of-truth)).

## Recording decisions

When a decision is settled, check it against the three tests in [docs/adr/README.md](../adr/README.md) and, if it passes all three, write the ADR as described there.

## Flag ADR conflicts

If your output contradicts an Accepted ADR, say so explicitly rather than silently overriding it:

> _Contradicts ADR-0010 (Kusto cluster allow-list), but worth reopening because…_
