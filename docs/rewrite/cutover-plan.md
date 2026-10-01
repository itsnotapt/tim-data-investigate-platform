# Replace legacy in the repo (P5-10)

Status: **Done 2026-09-30** (P5-11/P5-12 executed together at the user's request; CI gate still pending a PR run). Drafted 2026-09-30. Decision (Q-034, user 2026-09-30): there is no production, no analysts, no migration and no rollback, so there is no cut-over environment, parallel run, pilot, comms, data or export carry-over, or template carry-over. What is left is making `web/` + `api/` the only stack in the repo. Superseded by this: Q-031 to Q-033 (not applicable).

## 1. Gate: CI green on a real PR

`build-api.yml` and `build-web.yml` (P1-05/06) have never run on GitHub. The user opens a PR from this branch; the agent fixes anything that fails. P5-11 starts after this is green.

## 2. P5-11: retarget release automation

| Step                                                                                                                                                                            | Owner                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `release-please-config.json` and `.release-please-manifest.json`: drop `frontend`/`backend` packages and the `helm/Chart.yaml` extra-files; keep `.`, `web`, `api`              | agent                                |
| `release-please.yml`: today it only builds legacy `frontend`, `frontend-enterprise`, `backend` images; add `tim-web` / `tim-api` image build and push on `web` / `api` releases | agent                                |
| Disable legacy pipelines: `build-frontend.yml`, `build-backend.yml` (delete in P5-12; in P5-11 disable or restrict) and the legacy jobs in `release-please.yml`                 | agent (edit), user (GitHub settings) |
| Confirm CI green on `main` with the new workflows                                                                                                                               | user                                 |
| Update `docs/README.md` status and `work-breakdown.md`                                                                                                                          | agent                                |

Acceptance: release workflows build `web`/`api`; legacy pipelines disabled.

## 3. P5-12: remove legacy

| Step                                                                                                                 | Owner                |
| -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Delete `frontend/`, `backend/`, `helm/`, legacy compose files (root `compose.yaml` if legacy-only), legacy workflows | agent                |
| Revise RULES.md section 3 (legacy read-only rule) and `CLAUDE.md`                                                    | agent                |
| Mark `docs/current-system/` as a historical archive (README Status, work-breakdown); fix links to deleted paths      | agent                |
| Repo builds and CI green without legacy folders                                                                      | agent, user confirms |

## 4. When someone first deploys for real (recommended, not a gate)

Real Entra sign-in and real Kusto have never been tested (only mocks and dummy values, P5-08). On the first real deployment, run this smoke checklist:

- Sign-in popup works and the API validates the token.
- OBO to a real cluster works; `.show schema as json` returns a schema (Q-018, Q-028).
- Run and poll a query; template create, edit, delete.
- Tag write, then read back (run `create-tables` first, Q-015).
- Grid renders and Monaco loads under the CSP.

AG Grid runs as the trial (watermark, console warning) unless `AGGRID_LICENSE` is set; the key is optional (Q-027).
