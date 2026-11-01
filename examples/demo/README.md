# Demo instance

The demo instance: TIM with sample security data in a local Kusto emulator, to try on your own machine. It needs only Docker, no accounts. [ADR-0026](../../docs/adr/0026-a-demo-instance-needs-no-accounts.md) records why.

- **`config/`**: the action files, the connections file and the labels file, mounted at `/etc/tim`. The connection uses `auth: none`.
- **`kusto/`**: the loader, `load.py`, and the Kusto scripts it runs.
  - **`tables/*.kql`**: create the `Events` table and its ingestion mapping.
  - **`functions/*.kql`**: define the functions the actions call. `Alerts` is in `alerts.kql`. The Endpoint functions are `SysmonEvents`, `ProcessCreations`, `NetworkConnections`, `FileCreations` and `RegistryEvents`.
  - **Order:** the loader runs the `functions/` files in name order. `1-sysmon-events.kql` comes before the `2-` files, which are built on it.
  - **Hosts:** every alert's `Host` is the host its events are logged under. A GuardDuty finding names an EC2 instance id, so `Alerts` gives it the host ending in that id, such as `gacrux.i-0cc93bade2b3cba63`.
  - **Columns:** the Endpoint functions parse the Sysmon events. They expose the short `Host` beside Sysmon's FQDN `Computer`, and `EventId`. `Timestamp` is the time column. Sysmon's `UtcTime` is an ordinary column.
- **`tests/`**: the action tests, run in the image. They check Raw logs by sourcetype's list of sourcetypes against `data/SHA256SUMS`.
- **`data/`**: `SHA256SUMS` for the dataset's files, with its `LICENSE` and `NOTICE`. See [data/README.md](data/README.md).
- **`Dockerfile`**: the demo image, TIM's api image with the instance files, the dataset and the loader.
- **`compose.yaml`**: the emulator, the loader, PostgreSQL, the api and the web container. Each release publishes it.
- **`compose.override.yaml`**: builds TIM's images from this checkout, for `docker compose up --build`.
- **`ci.sh`**: the checks that `.github/workflows/build-api.yml` runs, `./ci.sh <api image>`. They need Docker.
- **`smoke.sh`**: the smoke test that `.github/workflows/demo-smoke.yml` runs, `./smoke.sh`. It builds the images, starts the demo, checks it and restarts it. It needs Docker and Python 3, and pulls the 4.6 GB emulator image. It runs as the Compose project `tim-demo-smoke`.
- **`smoke.py`**: the checks over HTTP that `smoke.sh` runs. `TIM_DEMO_PORT` sets the port.

## Start it

With Docker Desktop 4.40 or later, or Docker Compose 2.34.0 or later, run:

<!-- x-release-please-start-version -->

```bash
docker compose -f oci://ghcr.io/itsnotapt/tim-data-investigate-platform/compose/demo:2.0.0 up
```

<!-- x-release-please-end -->

- **What it runs:** the Compose file each TIM release publishes. It pulls that release's images, so it needs no checkout.
- **Variables:** Compose can list the file's variables and their values, and ask before it starts. Press Enter to go on.
- **First start:** the loader loads the data into the emulator, then logs "Ready" with the address to open.
- **Later starts:** the loader attaches the data from the `kusto-data` volume.
- **Address:** it listens on `127.0.0.1:8081`, this machine only. `TIM_DEMO_PORT` changes the port.
- **On the network:** `TIM_DEMO_ADDRESS=0.0.0.0` listens on every interface. Anyone who can reach it can sign in as anyone, and the loader logs a warning that says so.
- **Reset:** `docker compose -f oci://… down -v` deletes the data, the database and the volumes.
- **Licence:** starting it accepts Microsoft's [licence for the Kusto emulator](https://aka.ms/adx.emulator.license). The loader says so on the first start.

### From this checkout

From this folder, run:

```bash
docker compose up --build
```

`compose.override.yaml` builds the api, web and demo images from the checkout, in place of the released ones.

Sign in on the "Who are you?" screen, for example as `alice@demo.example`, and open Alerts.

## Actions

The demo has the Alerts, Endpoint, Host and Logs menus.

| Action | Menu | Pivots from | Default window |
|---|---|---|---|
| Alerts | Alerts | Nothing; it is a starting point | `since` 2018-08-01 to `until` 2018-09-01 |
| Process creations | Endpoint | `Host`, `Timestamp` | ±1 hour |
| By user | Endpoint | `User`, `Timestamp` | ±1 hour |
| Parent process | Endpoint | `Host`, `ParentProcessGuid`, `Timestamp` | ±1 day |
| Child processes | Endpoint | `Host`, `ProcessGuid`, `Timestamp` | ±1 day |
| Process activity | Endpoint | `Host`, `ProcessGuid`, `Timestamp` | ±1 day |
| Connections to IP | Endpoint | `DestinationIp`, `Timestamp` | ±1 day |
| File created, then run? | Endpoint | `Host`, `TargetFilename`, `Timestamp` | 1 day after the file was created |
| Hash seen anywhere | Endpoint | `SHA256` or `MD5`, `Timestamp` | ±1 day |
| Host timeline | Host | `Host`, `Timestamp` | ±15 minutes |
| Host's other logs | Host | `Host`, `Timestamp` | ±1 hour |
| Raw logs by sourcetype | Logs | Nothing; it is a starting point, with a list of every sourcetype | `since` 2018-08-01 to `until` 2018-09-01 |

- **Window:** every action is bounded by a time window. The analyst can change it.
- **Row limit:** every action keeps at most 10,000 rows, with `take 10000`.
  - Host timeline and Host's other logs keep the events nearest the time, then sort them by `Timestamp`.
- **Id:** every action uses `EventId` as the row's `id`, so an annotation follows an event across actions.

## Credit

The data's authors and licence are in [data/NOTICE](data/NOTICE) and [data/LICENSE](data/LICENSE).
