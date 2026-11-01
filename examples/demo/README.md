# Demo instance

The demo instance: TIM with sample security data in a local Kusto emulator, to try on your own machine. It needs only Docker, no accounts. [ADR-0026](../../docs/adr/0026-a-demo-instance-needs-no-accounts.md) records why.

- **`config/`**: the action files, the connections file and the labels file, mounted at `/etc/tim`. The connection uses `auth: none`.
- **`kusto/`**: the loader, `load.py`, and the Kusto scripts it runs. `tables/*.kql` create the `Events` table and its ingestion mapping. `functions/alerts.kql` defines the function the Alerts action calls.
- **`tests/`**: the action tests, run in the image.
- **`data/`**: `SHA256SUMS` for the dataset's files, with its `LICENSE` and `NOTICE`. See [data/README.md](data/README.md).
- **`Dockerfile`**: the demo image, TIM's api image with the instance files, the dataset and the loader.
- **`compose.yaml`**: the emulator, the loader, PostgreSQL, the api and the web container.
- **`ci.sh`**: the checks that `.github/workflows/build-api.yml` runs, `./ci.sh <api image>`. They need Docker.

## Start it

From this folder, run:

```bash
docker compose up --build
```

- **First start:** the loader loads the data into the emulator, then logs "Ready" with the address to open.
- **Later starts:** the loader attaches the data from the `kusto-data` volume.
- **Address:** it listens on `127.0.0.1:8081`, this machine only. `TIM_DEMO_PORT` changes the port.
- **Reset:** `docker compose down -v` deletes the data, the database and the volumes.
- **Licence:** starting it accepts Microsoft's licence for the Kusto emulator. Its text is `/EULA-Container.txt` in the emulator image.

Sign in on the "Who are you?" screen, for example as `alice@demo.example`, and open Alerts.

## Credit

The data's authors and licence are in [data/NOTICE](data/NOTICE) and [data/LICENSE](data/LICENSE).
