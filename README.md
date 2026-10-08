# TIM

TIM is a Kusto investigation platform. Analysts run KQL against Azure Data Explorer clusters, pivot between data sources with shared query templates, and tag and comment on events so findings are shared with the team.

- **`web/`**: React single-page app (TypeScript, Vite, AG Grid Enterprise, Monaco), served by nginx.
- **`api/`**: FastAPI service (Python 3.12) that runs Kusto queries on behalf of the signed-in user, stores query templates and query runs in PostgreSQL, and records tagged events in Kusto.
- Sign-in is Microsoft Entra ID.

## Quickstart

Run the whole stack (PostgreSQL, api, web) in containers:

```bash
cp .env.example .env        # optional; every variable has a development default
docker compose up --build
```

Open http://localhost:8081. The api runs with authentication disabled, but the web container signs in with Entra ID, so the UI needs a real app registration (see [docs/configuration.md](docs/configuration.md)). To work on the UI without one, use the edit-reload loop with stub sign-in described in [docs/development.md](docs/development.md), which also covers tests and linting.

## Repository layout

| Path | Contents |
|---|---|
| [`web/`](web/) | React single-page app |
| [`api/`](api/) | FastAPI service, Alembic migrations |
| [`deploy/`](deploy/) | Production deployment assets |
| [`docs/`](docs/README.md) | Documentation and architecture decision records |
| `compose.yaml` | Local development stack (PostgreSQL, migrations, api, web) |
| `.github/workflows/` | CI and release automation |

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md) and [HTTP API](docs/api.md)
- [Development](docs/development.md): local setup, tests, linting
- [Configuration](docs/configuration.md): environment variables
- [Deployment](docs/deployment.md) and [Operations](docs/operations.md)
- [Working rules](docs/RULES.md) for contributors and agents

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
