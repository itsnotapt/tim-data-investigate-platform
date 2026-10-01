# Working rules for the TIM rewrite

These rules are for **every agent or human** working on the rewrite of TIM from Vue 2 + .NET 6 to **React (frontend) + Python (backend)**. The legacy code has been removed from the repo (P5-12); only `web/` and `api/` remain. Read this file fully before doing anything; then read [README.md](README.md) for current status.

---

## 1. Orientation (do this first, every session)

1. Read `docs/README.md` → **Status** section: which phase is active, what's in progress.
2. Read `docs/open-questions.md` → anything marked **Answered** since your last session changes the plan; anything **Blocking** your task means stop and ask.
3. Read `docs/rewrite/work-breakdown.md` → pick the lowest-numbered task whose dependencies are `done` and whose status is `todo`. Don't start a task another agent has marked `in-progress` unless the user says so.
4. Read the legacy spec docs relevant to that task (`docs/current-system/*`, a historical archive) **before** reading legacy source. The docs cite `file:line` as of commit `8a2ff2e` — read source (`git show 8a2ff2e:frontend/<path>`) only to confirm or fill a gap.

## 2. Sources of truth (in priority order)

1. **The user's explicit answers** — recorded in `open-questions.md` (Answered) or an ADR in `docs/decisions/`.
2. **Accepted ADRs** in `docs/decisions/`.
3. **Legacy behaviour** as documented in `docs/current-system/` and shown in `docs/current-system/screenshots/`.
4. **Legacy source code** at commit `8a2ff2e` (`git show 8a2ff2e:frontend/...`, `git show 8a2ff2e:backend/...`; the folders are no longer in the tree) — authoritative for behaviour when the docs are silent or wrong. If docs and code disagree, code wins; **fix the doc** in the same change.
5. Your own judgement — only for things nobody would reasonably care about (naming of a private helper, etc.).

Never silently "improve" legacy behaviour. Parity first; deviations need a decision (see §4).

## 3. Legacy code is gone (archive only)

- `frontend/`, `backend/`, `helm/`, the legacy compose files and `tools/legacy-screenshots/` were removed in P5-12. Do **not** re-add them.
- For legacy behaviour, read `docs/current-system/` (historical archive; its paths refer to commit `8a2ff2e`) or the code at that commit: `git show 8a2ff2e:frontend/src/...`, `git show 8a2ff2e:backend/...`.
- `docs/current-system/` is not maintained for new behaviour; fix it only where it is wrong about legacy.
- The repo contains only the new apps: `web/` (React) and `api/` (Python) — see [ADR-0003](decisions/0003-repo-layout.md).

## 4. Handling questions and decisions

There will be many. Use this flow:

| Situation | Action |
|---|---|
| Behaviour question answerable from legacy code | Answer it from code, cite `file:line`, update the relevant doc. Don't ask the user. |
| Legacy **bug** (listed in `current-system/known-issues.md` or newly found) | Don't reproduce it. Note in the task/PR which bug ID you fixed. If fixing changes user-visible behaviour significantly, raise a question first. |
| Product/architecture choice with a sensible default | Pick the default, **record it** in `open-questions.md` as `Assumed` with your reasoning, and continue. The user can overturn it. |
| Choice that is expensive to reverse (datastore, auth model, licensing, API contract break, dropping a feature) | Add to `open-questions.md` as **Blocking**, stop that task, pick another. |
| A question gets answered | Move it to *Answered* with the answer + date. If it's architectural, write an ADR (`docs/decisions/NNNN-title.md`, use the template) and link it. |

Question IDs are permanent (`Q-001`, `Q-002`, …). Never renumber. Reference them in code comments only where the code would otherwise look wrong (`# Q-014: legacy returns 200 on query error; kept for parity`).

## 5. Documentation rules

- **Update docs in the same change as the code.** A task isn't done until docs reflect it.
- Keep `docs/README.md` → Status current (phase, last updated date, what's next).
- Every task in `work-breakdown.md` has a status: `todo` → `in-progress (agent/date)` → `review` → `done`. Update it when you start and finish.
- Cite legacy code as `path/to/file.ext:line` relative to the repo root at commit `8a2ff2e`.
- Don't paste large legacy code blocks into docs; describe behaviour and cite lines. Short excerpts for subtle logic are fine.
- New screenshots go in `docs/rewrite/screenshots/` (new app) and are indexed in the folder README. `docs/current-system/screenshots/` (legacy) is frozen.
- Dates in `YYYY-MM-DD`.

## 6. Engineering rules for the new code

These are defaults until an ADR says otherwise.

**General**
- Parity is the bar for phase 1: same features, same workflows, recognisably similar UI (see screenshots). Visual polish/redesign is a later, explicit decision.
- Everything the legacy app kept only in the browser (IndexedDB) stays client-side unless Q-005 decides otherwise.
- The API contract in `current-system/backend-api.md` is the starting point. Changes to paths/shapes must be recorded in `docs/rewrite/api-contract.md` (create when first needed) with the reason.
- No secrets in the repo. Config via env vars, documented in the relevant README.

**Frontend (React)**
- TypeScript, strict mode. Vite. Function components + hooks.
- One legacy component → one (or a few) React components; record the mapping in `rewrite/component-mapping.md`.
- All API access through a single typed client module; all auth through a single auth module (mirrors `apiClient.js` / `auth.js`).
- Tests: component/unit tests (Vitest + Testing Library) for logic-heavy pieces (template param building, tag dialog logic, time ranges, tree selection).

**Backend (Python)**
- Python 3.12+, FastAPI, Pydantic v2 models mirroring `current-system/data-models.md` with the same JSON field names.
- Type hints everywhere; `ruff` + `mypy` (or pyright) clean.
- Tests: pytest; every endpoint gets at least happy-path + main error case tests. Kusto and Azure AD are mocked behind interfaces.
- The user identity is taken **from the token**, never from the request body (fixes legacy trust issues — see known-issues).

## 7. Git

- Work on a branch per task (`rewrite/<task-id>-short-name`), never commit directly to `main`.
- Commit/push/PR only when the user asks or has durably authorised it.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`) — the repo uses release-please.

## 8. When you finish a session

1. Update task status in `work-breakdown.md`.
2. Update `docs/README.md` Status (date + one-line summary + next step).
3. Make sure any new questions are in `open-questions.md`.
4. Leave the tree in a state where the next agent can pick up without re-deriving context.
