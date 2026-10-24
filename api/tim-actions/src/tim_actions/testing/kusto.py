"""``tim_kusto``: a recording fake of the Kusto hook, answering queries from a queue."""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from tim_actions.columns import Column
from tim_actions.kusto import KustoHook, KustoResult, SdkClient
from tim_actions.run import DetailValue, RunError


@dataclass(frozen=True)
class KustoCall:
    """A query a run sent: the connection, database, KQL and query parameters."""

    connection: str
    database: str
    kql: str
    parameters: dict[str, str] = field(default_factory=dict)


class FakeKusto:
    """Answers the Kusto connections' queries with the answers queued by ``respond`` and
    ``fail``, in order, and records each query in ``calls``."""

    def __init__(self) -> None:
        self.calls: list[KustoCall] = []
        self._answers: deque[KustoResult | BaseException] = deque()
        fake = self

        class Hook(KustoHook):
            def get_conn(self) -> SdkClient:
                raise AssertionError("tim_kusto reaches no Kusto cluster")

            def query(
                self,
                database: str,
                kql: str,
                *,
                deadline: datetime,
                parameters: Mapping[str, str] | None = None,
            ) -> KustoResult:
                return fake._query(self.connection.name, database, kql, parameters or {})

        self.hook: type[KustoHook] = Hook
        """The hook class that answers for Kusto connections."""

    def respond(
        self,
        rows: Sequence[Mapping[str, Any]],
        *,
        columns: Sequence[Column] = (),
        details: Mapping[str, DetailValue] | None = None,
    ) -> None:
        """Queue an answer: ``rows``, with ``columns`` as Kusto's columns and ``details`` as its
        execution metrics."""
        self._answers.append(
            KustoResult(tuple(columns), [dict(row) for row in rows], dict(details or {}))
        )

    def fail(self, error: str | BaseException) -> None:
        """Queue a failure: a message ends the run with it, as Kusto's error message does; an
        exception is raised as it is."""
        self._answers.append(RunError(error) if isinstance(error, str) else error)

    def _query(
        self, connection: str, database: str, kql: str, parameters: Mapping[str, str]
    ) -> KustoResult:
        self.calls.append(KustoCall(connection, database, kql, dict(parameters)))
        if not self._answers:
            raise AssertionError(f"no answer queued for Kusto query {kql}")
        answer = self._answers.popleft()
        if isinstance(answer, BaseException):
            raise answer
        return answer
