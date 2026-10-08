# Coding standards

Rules a reviewer judges. Tools already enforce the mechanical rules, so this file does not repeat them.

## Enforced by tools

| Rule area | Tool | Configured in |
|---|---|---|
| TypeScript strictness, unused code, unchecked indexed access | `tsc` | `web/tsconfig.json` |
| Web lint (type-checked rules, React hooks, React refresh) | ESLint | `web/eslint.config.js` |
| Web formatting | Prettier | `web/.prettierrc`, `.editorconfig` |
| API lint and formatting | ruff | `api/pyproject.toml` |
| API type hints | mypy (strict) | `api/pyproject.toml` |
| API test coverage of at least 80% | pytest-cov | `api/pyproject.toml` |
| API contract matches its snapshot and the web copy of the OpenAPI schema | OpenAPI contract test | `api/tests/test_openapi_contract.py` |
| Branch names, PR titles, release scopes | `pr-conventions` workflow | `.github/workflows/pr-conventions.yml` |

Commands are in [docs/development.md](docs/development.md).

## Documentation

- Docs describe the change in the same PR as the code: behaviour, configuration ([docs/configuration.md](docs/configuration.md)), deployment ([docs/deployment.md](docs/deployment.md)), endpoints and architecture. A doc that disagrees with the code is handled as [docs/RULES.md §2](docs/RULES.md#2-sources-of-truth) says.
- Docs and code comments describe the system as it is now: no history ("previously", "used to"), no justification essays. Rationale goes in an ADR ([docs/adr/README.md](docs/adr/README.md)) or the PR description.
- Issue numbers and task IDs appear in issues, PR descriptions and commit messages, not in code comments or in `docs/` outside the ADRs.
- A code comment may link an ADR where the code would otherwise look surprising.
- Domain terms come from [GLOSSARY.md](GLOSSARY.md); code and docs use its terms and avoid the synonyms it lists. A new or renamed concept updates the glossary in the same PR ([docs/agents/domain.md](docs/agents/domain.md#updating-glossarymd)).
- Dates are `YYYY-MM-DD`.

## Security

- No secrets in the repo; configuration comes from environment variables.
- The user identity comes from the access token, never from a request body.

## Frontend (`web/`)

- Components are function components with hooks.
- Every HTTP call to the API goes through the client in `web/src/lib/api/`.
- Only `web/src/lib/auth/` imports MSAL; the rest of the app uses that module.
- A default export is allowed only for a page loaded lazily in `web/src/app/lazyPages.ts`; everything else uses named exports.
- Unit and component tests sit next to the code as `*.test.ts` or `*.test.tsx`. A user flow gets a Playwright spec in `web/e2e/flows/`.

## Backend (`api/`)

- Request and response models extend `ApiModel` (`api/src/tim_api/models_common.py`). A request model is separate from the stored model and leaves out fields the server owns, such as identifiers it assigns and audit fields.
- Kusto queries, on-behalf-of token exchange and tag ingestion sit behind the protocols `KustoQueryClient`, `OboTokenProvider` and `TagIngestClient`; callers depend on the protocol, not the Azure implementation.
- A change to stored data comes with an Alembic migration in `api/migrations/`.
- Every storage implementation passes the shared suite in `api/tests/storage_contract.py`.

## Tests

- A change ships with tests for the behaviour it adds or alters.
- Tests drive behaviour through public interfaces: HTTP endpoints, a module's exports, what a component renders.
- Tests replace only systems outside the repo: Kusto, Entra ID, tag ingestion, the clock.
- A bug fix starts with a test that fails on the bug, written at a seam where the bug occurs. When no such seam exists, the PR says so.
- Every API endpoint has a happy-path test and a test for its main error case.
