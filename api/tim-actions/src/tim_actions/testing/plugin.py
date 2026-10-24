"""The ``pytest11`` plugin of ``tim_actions.testing``: fixtures for provider authors' tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tim_actions.run import Analyst
from tim_actions.testing.runs import DEFAULT_ANALYST, Connections

if TYPE_CHECKING:
    from tim_actions.testing.kusto import FakeKusto
    from tim_actions.testing.snowflake import FakeSnowflake


@pytest.fixture
def tim_analyst() -> Analyst:
    """The analyst a run gets by default; pass another as ``analyst=``."""
    return DEFAULT_ANALYST


@pytest.fixture
def tim_connections() -> Connections:
    """The test's connections, empty. Override it to add connections every test has."""
    return Connections()


@pytest.fixture
def tim_kusto(tim_connections: Connections) -> FakeKusto:
    """A recording fake of the Kusto hook, answering ``tim_connections``' Kusto connections.
    Needs the ``kusto`` extra."""
    from tim_actions.testing.kusto import FakeKusto

    fake = FakeKusto()
    tim_connections.answer("kusto", fake.hook)
    return fake


@pytest.fixture
def tim_snowflake(tim_connections: Connections) -> FakeSnowflake:
    """A recording fake of the Snowflake hook, answering ``tim_connections``' Snowflake
    connections. Needs the ``snowflake`` extra."""
    from tim_actions.testing.snowflake import FakeSnowflake

    fake = FakeSnowflake()
    tim_connections.answer("snowflake", fake.hook)
    return fake
