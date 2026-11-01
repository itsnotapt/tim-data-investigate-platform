"""Loads the demo dataset into the Kusto emulator, or attaches it when it's already loaded.

Run once per start, before the api. Each step is idempotent:

- **Database:** attached from the emulator's volume when its files are there, created otherwise.
- **Tables:** ``tables/*.kql``, in name order, run on every start.
- **Events:** each dataset file is ingested once, tagged ``ingest-by:<dataset>/<file>``. Events from
  another dataset version are dropped first, so a new version replaces the old.
- **Functions:** ``functions/*.kql``, in name order, run on every start, so a new release updates them.

The emulator reads the files from the ``ingest`` volume, which this container shares with it.
"""

import ipaddress
import logging
import os
import shutil
import sys
from pathlib import Path

from azure.kusto.data import KustoClient, KustoConnectionStringBuilder
from azure.kusto.data.response import KustoResponseDataSet

CLUSTER = os.environ["DEMO_KUSTO_CLUSTER"]
DATASET = os.environ["DEMO_DATASET"]
WEB_ADDRESS = os.environ["DEMO_WEB_ADDRESS"]
# The host address the web container's port is published on.
WEB_HOST_IP = os.environ["DEMO_WEB_HOST_IP"]
# The Kusto emulator's licence, which the emulator's ACCEPT_EULA setting accepts.
LICENCE = "https://aka.ms/adx.emulator.license"
# The emulator's built-in database, where database commands run.
DEFAULT_DATABASE = "NetDefaultDB"
DATABASE = "Security"
TABLE = "Events"

HERE = Path(__file__).parent
DATASET_FILES = Path("/demo/data")
# The emulator's data volume, mounted read-only here at the path the emulator mounts it, and the
# database's folder in it.
KUSTO_DATA = Path("/kustodata")
DATABASE_FOLDER = KUSTO_DATA / "dbs" / DATABASE
# The volume both containers mount at the same path.
INGEST = Path("/ingest")

log = logging.getLogger("demo")


def main() -> None:
    logging.basicConfig(format="%(message)s", level=logging.INFO, stream=sys.stdout)
    client = KustoClient(KustoConnectionStringBuilder.with_no_authentication(CLUSTER))
    open_database(client)
    run_files(client, sorted((HERE / "tables").glob("*.kql")))
    load_events(client)
    run_files(client, sorted((HERE / "functions").glob("*.kql")))
    [events] = rows(client.execute_query(DATABASE, f"{TABLE} | count"))
    log.info("%s events in the %s database.", f"{events[0]:,}", DATABASE)
    log.info("Ready: TIM opens at %s once its api and web containers have started.", WEB_ADDRESS)
    if not ipaddress.ip_address(WEB_HOST_IP).is_loopback:
        log.warning(
            "Warning: TIM listens on %s, so anyone who can reach it can sign in as anyone.",
            WEB_HOST_IP,
        )


def open_database(client: KustoClient) -> None:
    databases = rows(
        client.execute_mgmt(DEFAULT_DATABASE, ".show databases | project DatabaseName")
    )
    if [DATABASE] in databases:
        log.info("The %s database is already attached.", DATABASE)
    elif (DATABASE_FOLDER / "md").is_dir():
        client.execute_mgmt(
            DEFAULT_DATABASE, f'.attach database {DATABASE} from @"{DATABASE_FOLDER}/md"'
        )
        log.info("Attached the %s database from the emulator's volume.", DATABASE)
    else:
        client.execute_mgmt(
            DEFAULT_DATABASE,
            f".create database {DATABASE} persist "
            f'(@"{DATABASE_FOLDER}/md", @"{DATABASE_FOLDER}/data")',
        )
        log.info("Created the %s database.", DATABASE)
        log.info(
            "Starting the demo accepts Microsoft's licence for the Kusto emulator: %s", LICENCE
        )


def run_files(client: KustoClient, files: list[Path]) -> None:
    for file in files:
        client.execute_mgmt(DATABASE, file.read_text())


def load_events(client: KustoClient) -> None:
    dropped = rows(
        client.execute_mgmt(
            DATABASE,
            f".drop extents <| .show table {TABLE} extents "
            f'| where Tags !contains "ingest-by:{DATASET}/"',
        )
    )
    if dropped:
        log.info("Dropped the events of another dataset version.")
    extents = client.execute_mgmt(DATABASE, f".show table {TABLE} extents | project Tags")
    loaded = {extent_tag for [tags] in rows(extents) for extent_tag in str(tags or "").split()}
    files = sorted(DATASET_FILES.glob("*.jsonl.gz"))
    to_load = [file for file in files if f"ingest-by:{tag(file)}" not in loaded]
    if not to_load:
        log.info("All %d dataset files are already loaded.", len(files))
        return
    log.info("Loading %d of %d dataset files into the %s table.", len(to_load), len(files), TABLE)
    for number, file in enumerate(to_load, 1):
        staged = INGEST / file.name
        shutil.copyfile(file, staged)
        try:
            response = client.execute_mgmt(
                DATABASE,
                f'.ingest into table {TABLE} (@"{staged}") with (format = "json", '
                f'ingestionMappingReference = "{TABLE}", '
                f"tags = '[\"ingest-by:{tag(file)}\"]', ingestIfNotExists = '[\"{tag(file)}\"]')",
            )
        finally:
            staged.unlink()
        if any(row["HasErrors"] for row in response.primary_results[0]):
            raise SystemExit(f"The emulator could not load {file.name}.")
        log.info("Loaded %d/%d: %s", number, len(to_load), file.name)


def tag(file: Path) -> str:
    """The part of a file's ``ingest-by:`` tag after the prefix."""
    return f"{DATASET}/{file.name}"


def rows(response: KustoResponseDataSet) -> list[list[object]]:
    return [list(row) for row in response.primary_results[0]]


if __name__ == "__main__":
    main()
