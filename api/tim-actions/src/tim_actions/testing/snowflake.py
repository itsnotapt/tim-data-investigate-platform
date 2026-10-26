"""``tim_snowflake``: a recording fake of the Snowflake hook, answering queries from a queue."""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from tim_actions.columns import Column
from tim_actions.run import RunError
from tim_actions.snowflake import SdkConnection, SnowflakeHook, SnowflakeResult


@dataclass(frozen=True)
class SnowflakeCall:
    """A query a run sent: the connection and the SQL."""

    connection: str
    sql: str


class FakeSnowflake:
    """Answers the Snowflake connections' queries with the answers queued by ``respond`` and
    ``fail``, in order, and records each query in ``calls``."""

    def __init__(self) -> None:
        self.calls: list[SnowflakeCall] = []
        self._answers: deque[SnowflakeResult | BaseException] = deque()
        fake = self

        class Hook(SnowflakeHook):
            def get_conn(self, *, deadline: datetime | None = None) -> SdkConnection:
                raise AssertionError("tim_snowflake reaches no Snowflake account")

            def query(self, sql: str, *, deadline: datetime) -> SnowflakeResult:
                return fake._query(self.connection.name, sql)

        self.hook: type[SnowflakeHook] = Hook
        """The hook class that answers for Snowflake connections."""

    def respond(self, rows: Sequence[Mapping[str, Any]], *, columns: Sequence[Column] = ()) -> None:
        """Queue an answer: ``rows``, with ``columns`` as Snowflake's columns."""
        self._answers.append(SnowflakeResult(tuple(columns), [dict(row) for row in rows]))

    def fail(self, error: str | BaseException) -> None:
        """Queue a failure: a message ends the run with it, as Snowflake's error message does; an
        exception is raised as it is."""
        self._answers.append(RunError(error) if isinstance(error, str) else error)

    def _query(self, connection: str, sql: str) -> SnowflakeResult:
        self.calls.append(SnowflakeCall(connection, sql))
        if not self._answers:
            raise AssertionError(f"no answer queued for Snowflake query {sql}")
        answer = self._answers.popleft()
        if isinstance(answer, BaseException):
            raise answer
        return answer
