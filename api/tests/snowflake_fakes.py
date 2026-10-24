"""Snowflake as the connector sees it, and a client of TIM with Snowflake connections."""

import threading
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit, create_test_app
from kusto_fakes import ALICE, FakeObo
from snowflake.connector import errors as sf_errors

from tim_api.auth.dependencies import get_obo_provider
from tim_api.storage import MemoryStorage

SCOPE = "api://snowflake/session:role-any"
CONNECTIONS = f"""\
- name: warehouse
  title: Warehouse
  type: snowflake
  auth: obo
  scope: {SCOPE}
  account: myorg-myaccount
  warehouse: ANALYSTS
- name: warehouse-tim
  title: Warehouse as TIM
  type: snowflake
  auth: workload_identity
  account: myorg-myaccount
  warehouse: ANALYSTS
"""

Answer = tuple[list[Any], list[tuple[Any, ...]]]


def described(*columns: tuple[str, int]) -> list[Any]:
    """``cursor.description``, with the connector's type codes."""
    return [SimpleNamespace(name=n, type_code=t) for n, t in columns]


class FakeConnector:
    """``snowflake.connector.connect``: records each login and statement, and answers each
    statement from ``answers``, by the first key it contains, or with ``result``.
    ``login_error`` fails the login; with ``hold``, a query waits until it's aborted."""

    def __init__(self) -> None:
        self.logins: list[dict[str, Any]] = []
        self.executed: list[str] = []
        self.answers: dict[str, Answer | Exception] = {}
        self.result: Answer | Exception = ([], [])
        self.login_error: Exception | None = None
        self.hold = False
        self.aborted: list[str] = []
        self.querying = threading.Event()
        self._aborted = threading.Event()

    def __call__(self, **kwargs: Any) -> "FakeConnector":
        self.logins.append(kwargs)
        if self.login_error is not None:
            raise self.login_error
        return self

    def cursor(self) -> "FakeCursor":
        return FakeCursor(self)

    def close(self) -> None:
        pass

    def answer(self, command: str) -> Answer:
        answer = next((a for k, a in self.answers.items() if k in command), self.result)
        if isinstance(answer, Exception):
            raise answer
        return answer


class FakeCursor:
    def __init__(self, sdk: FakeConnector) -> None:
        self.sdk = sdk
        self.description: list[Any] | None = None
        self._rows: list[tuple[Any, ...]] = []

    def execute(self, command: str, params: Sequence[Any] | None = None) -> "FakeCursor":
        self.sdk.executed.append(command)
        self.description, self._rows = self.sdk.answer(command)
        return self

    def execute_async(self, command: str, params: Sequence[Any] | None = None) -> dict[str, Any]:
        self.sdk.executed.append(command)
        return {"queryId": "01b2-query"}

    def get_results_from_sfqid(self, sfqid: str) -> None:
        self.sdk.querying.set()
        if self.sdk.hold:
            self.sdk._aborted.wait(10)
            raise sf_errors.ProgrammingError("SQL execution canceled")
        self.description, self._rows = self.sdk.answer(self.sdk.executed[-1])

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def abort_query(self, qid: str) -> bool:
        self.sdk.aborted.append(qid)
        self.sdk._aborted.set()
        return True


@asynccontextmanager
async def open_client(
    auth: AuthKit,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    obo: FakeObo | None,
    connections: str = CONNECTIONS,
) -> AsyncIterator[httpx.AsyncClient]:
    """A client of TIM with ``connections``, as ALICE. With ``obo``, the OBO exchange is faked at
    ``token_for``; without, TIM builds its own."""
    path = tmp_path / "connections.yaml"
    path.write_text(connections)
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(path))
    monkeypatch.setenv("TIM_RUN_TIMEOUT_SECONDS", "60")
    app = create_test_app(
        storage_factory=lambda _s: MemoryStorage(), race_seconds=0.5, providers=None
    )
    auth.install(app)
    if obo is not None:
        app.dependency_overrides[get_obo_provider] = lambda: obo
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://t", headers=auth.headers(ALICE, "oid-a")
        ) as client:
            yield client
