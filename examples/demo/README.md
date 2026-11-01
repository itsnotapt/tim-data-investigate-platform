# Demo instance

The demo instance is TIM with sample security data, on your own machine. It needs only Docker, no accounts. [ADR-0026](../../docs/adr/0026-a-demo-instance-needs-no-accounts.md) records why.

## What your machine needs

| Need | |
|---|---|
| **Docker** | Docker Desktop 4.40 or later. On Linux, Docker Engine with Docker Compose 2.34.0 or later. |
| **Processor** | amd64 (x86-64). The Kusto emulator has no arm64 image. |
| **Memory** | About 1.5 GB for the demo's containers. The emulator uses about 1.3 GB of it. |
| **Disk** | About 7 GB. The emulator's image is a 1.2 GB download that takes 4.6 GB. |
| **Network** | The first start downloads the images. |

## Start it

Run:

<!-- x-release-please-start-version -->

```bash
docker compose -f oci://ghcr.io/itsnotapt/tim-data-investigate-platform/compose/demo:2.0.0 up
```

<!-- x-release-please-end -->

- **Variables:** Compose lists the file's variables and asks before it starts. Press Enter.
- **First start:** Compose downloads the images. The loader then loads the data into the emulator, which takes a minute or two.
- **Ready:** the loader logs "Ready: TIM opens at http://localhost:8081". Open that address.
- **Later starts:** the loader attaches the data it loaded before, in seconds.
- **Stop:** press Ctrl+C. The data and your annotations stay.
- **Address:** TIM listens on this machine only. `TIM_DEMO_PORT` changes the port from 8081.
- **Licence:** starting it accepts Microsoft's [licence for the Kusto emulator](https://aka.ms/adx.emulator.license). The loader says so on the first start.

## Sign in

The demo has no passwords. TIM asks "Who are you?".

- **A demo analyst:** choose `alice@demo.example` or `bob@demo.example`.
- **By name:** type a name or an email address.
- **Remembered:** the browser remembers who you are. To be a second analyst, use a private window or another browser.

## Walk through an investigation

The data is from a staged attack on a company called Frothly, in August 2018. Sign in as `alice@demo.example`.

### Find the alert

1. Choose **Get Started**, then **Actions** ▸ **Alerts** ▸ **Alerts**, then **Run**. There are 48 alerts.
2. Type `PsEmpire` in **Filter rows**. Symantec Endpoint Protection raised **Backdoor.PsEmpire** on the host BGIST-L, on 2018-08-20 at 10:00 UTC.

### Pivot to the host

3. Right-click the alert's **Host** cell. Choose **Pivot** ▸ **Endpoint** ▸ **Process creations**.
4. TIM shows "Running Process creations". Choose **Go to**.
5. BGIST-L started only Edge and a Dropbox install. Symantec deleted the file before it ran.

### Follow the file to other hosts

6. Go back to the Alerts tab. Right-click the alert's **SHA256** cell, the file's hash. Choose **Pivot** ▸ **Endpoint** ▸ **Hash seen anywhere**.
7. The same file is on ABUNGST-L, BSTOLL-L and FYODOR-L. SEPM, Symantec's server, logged it too.
8. Right-click a FYODOR-L row. Choose **Pivot** ▸ **Endpoint** ▸ **Process creations**.
9. Type `-enc` in **Filter rows**. The first row is PowerShell, started at 10:01:41. Its command is `-noP -sta -w 1 -enc` and a long encoded script. Its parent is `browser_broker.exe`, the browser.
10. The other rows are what encoded PowerShell ran on FYODOR-L that morning:
    - `whoami /groups`, to see the user's rights;
    - `fodhelper.exe`, to get past User Account Control;
    - `net user /add svcvnc`, a new user;
    - `net localgroup administrators svcvnc /add`, which makes it an administrator;
    - `schtasks`, a scheduled task, and `hdoor.exe`;
    - `netsh advfirewall set allprofiles state off`, which turns off the firewall.

### Find the attacker's server

11. Right-click the 10:01:41 PowerShell row. Choose **Pivot** ▸ **Endpoint** ▸ **Child processes**. It started a second PowerShell at 10:01:44.
12. Right-click that row. Choose **Pivot** ▸ **Endpoint** ▸ **Process activity**. It connected to `45.77.53.176` on port 443, again and again.
13. Right-click a **DestinationIp** cell of `45.77.53.176`. Choose **Pivot** ▸ **Endpoint** ▸ **Connections to IP**. ABUNGST-L connects to it too.

### Label it and share it

14. Go back to the FYODOR-L Process creations tab. Click the 10:01:41 PowerShell row and press `t`.
15. In **Annotate**, choose **Malicious**. Type a comment, such as `Empire stager from the browser`. Choose **Save**. The row turns red.
16. Right-click the row. Choose **Copy link**. TIM shows "Copied a link to this row".
17. Open a private window and paste the link. Choose `bob@demo.example`.
18. Bob sees the same rows, with that row open in **Row detail**. It shows Alice's Malicious label and her comment.

Every action pivots from the columns in [Actions](#actions). Try others from any row.

## Let colleagues join

Colleagues on your network can use your demo.

1. Stop it with Ctrl+C.
2. Set `TIM_DEMO_ADDRESS` to `0.0.0.0`: `export TIM_DEMO_ADDRESS=0.0.0.0` in bash or zsh, `$env:TIM_DEMO_ADDRESS="0.0.0.0"` in PowerShell.
3. Start it again, in the same shell.
4. Colleagues open `http://<your machine's name or address>:8081`.

**Warning:** anyone who can reach that address can sign in as anyone, and read and change every annotation. Do this only on a network you trust. The loader logs a warning when TIM listens beyond this machine.

## Update it

Run the start command of a newer TIM release, from its copy of this file.

- **Kept:** the data and your annotations.
- **Applied:** the release's actions, and the loader's functions on the data.

## Reset it

Run the start command with `down -v` in place of `up`.

- **Deleted:** the data, the annotations and the volumes.
- **Next start:** loads the data again, like the first start.

## Add an AG Grid key

The result grids use AG Grid Enterprise. Without a key, it runs in trial mode, with a watermark over the grid.

1. Set `AGGRID_LICENSE` to your key: `export AGGRID_LICENSE=<key>` in bash or zsh, `$env:AGGRID_LICENSE="<key>"` in PowerShell.
2. Start it, in the same shell.

## Licences and credit

- **Kusto emulator:** Microsoft's [licence for the Kusto emulator](https://aka.ms/adx.emulator.license). Starting the demo accepts it.
- **Data:** the BOTSv3 dataset, written in 2018 by Ryan Kovar, David Herrald, James Brodsky, John Stoner, Jim Apger, David Veuve, Lily Lee and Matt Valites.
- **Data licence:** its authors dedicated it to the public domain under CC0 1.0 Universal. See [data/NOTICE](data/NOTICE) and [data/LICENSE](data/LICENSE).

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

## In this folder

- **`config/`**: the action files, the connections file and the labels file, mounted at `/etc/tim`. The connection uses `auth: none`.
- **`kusto/`**: the loader, `load.py`, and the Kusto scripts it runs.
  - **`tables/*.kql`**: create the `Events` table and its ingestion mapping.
  - **`functions/*.kql`**: define the functions the actions call. `Alerts` is in `alerts.kql`. The Endpoint functions are `SysmonEvents`, `ProcessCreations`, `NetworkConnections`, `FileCreations` and `RegistryEvents`.
  - **Order:** the loader runs the `functions/` files in name order. `1-sysmon-events.kql` comes before the `2-` files, which are built on it.
  - **Runs:** the loader runs the `functions/` files on every start, so a newer release's functions apply to the loaded data.
  - **Hosts:** every alert's `Host` is the host its events are logged under. A GuardDuty finding names an EC2 instance id, so `Alerts` gives it the host ending in that id, such as `gacrux.i-0cc93bade2b3cba63`.
  - **Hashes:** an alert's `SHA256` is the hash of the file a Symantec risk event names. Other products' alerts leave it empty.
  - **Columns:** the Endpoint functions parse the Sysmon events. They expose the short `Host` beside Sysmon's FQDN `Computer`, and `EventId`. `Timestamp` is the time column. Sysmon's `UtcTime` is an ordinary column.
- **`tests/`**: the action tests, run in the image. They check Raw logs by sourcetype's list of sourcetypes against `data/SHA256SUMS`.
- **`data/`**: `SHA256SUMS` for the dataset's files, with its `LICENSE` and `NOTICE`. See [data/README.md](data/README.md).
- **`Dockerfile`**: the demo image, TIM's api image with the instance files, the dataset and the loader.
- **`compose.yaml`**: the emulator, the loader, PostgreSQL, the api and the web container. Each release publishes it.
- **`compose.override.yaml`**: builds TIM's images from this checkout, for `docker compose up --build`.
- **`ci.sh`**: the checks that `.github/workflows/build-api.yml` runs, `./ci.sh <api image>`. They need Docker.
- **`smoke.sh`**: the smoke test that `.github/workflows/demo-smoke.yml` runs, `./smoke.sh`. It builds the images, starts the demo, checks it and restarts it. It needs Docker and Python 3, and pulls the 4.6 GB emulator image. It runs as the Compose project `tim-demo-smoke`.
- **`smoke.py`**: the checks over HTTP that `smoke.sh` runs. `TIM_DEMO_PORT` sets the port.

### From this checkout

From this folder, run:

```bash
docker compose up --build
```

`compose.override.yaml` builds the api, web and demo images from the checkout, in place of the released ones.
