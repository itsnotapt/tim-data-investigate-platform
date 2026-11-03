import sys

import pytest
from database import postgres_server


def test_without_a_postgres_the_tests_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "pgserver", None)  # import pgserver raises ImportError
    with (
        pytest.raises(pytest.fail.Exception, match=r"TIM_TEST_DATABASE_URL.*pgserver"),
        postgres_server(None),
    ):
        pass


def test_a_test_database_url_is_used_as_asyncpg() -> None:
    with postgres_server("postgresql://u:p@db:5432/tim") as url:
        assert url == "postgresql+asyncpg://u:p@db:5432/tim"
