"""Providers discovered through the ``tim.actions`` entry-point group.

Each test installs a provider distribution of its own: a ``.dist-info`` and a module in a
directory put on ``sys.path``, which ``importlib.metadata`` finds like any installed package.
"""

import sys
from pathlib import Path
from textwrap import dedent
from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient

from tim_api.actions import ActionsConfigError

ROWS_PROVIDER = """
    from scripted_actions import Rows
    from tim_actions import Provider

    def provider():
        return Provider(actions=[Rows(key="{key}", name="Users", pivot="none")])
"""


def install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    code: str,
    *,
    version: str = "1.2.0",
    key: str = "acme.users",
) -> None:
    root = tmp_path / version
    dist_info = root / f"acme_tim-{version}.dist-info"
    dist_info.mkdir(parents=True)
    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: acme-tim\nVersion: {version}\n"
    )
    (dist_info / "entry_points.txt").write_text("[tim.actions]\nacme = acme_tim:provider\n")
    (root / "acme_tim.py").write_text(dedent(code).replace("{key}", key))
    monkeypatch.syspath_prepend(str(root))
    monkeypatch.delitem(sys.modules, "acme_tim", raising=False)


def discovered_instance(auth: AuthKit) -> dict[str, Any]:
    app = create_test_app(providers=None)
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        body: dict[str, Any] = client.get("/api/instance").json()
    return body


def startup_problems() -> list[str]:
    with pytest.raises(ActionsConfigError) as caught, TestClient(create_test_app(providers=None)):
        pass
    return caught.value.problems


def test_an_installed_providers_actions_are_in_the_catalogue(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch, ROWS_PROVIDER)
    assert [a["key"] for a in discovered_instance(auth)["actions"]] == ["acme.users"]


def test_the_version_changes_with_a_providers_package_version(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with monkeypatch.context() as patch:
        install(tmp_path, patch, ROWS_PROVIDER, version="1.2.0")
        before = discovered_instance(auth)["version"]
    install(tmp_path, monkeypatch, ROWS_PROVIDER, version="1.3.0")
    assert discovered_instance(auth)["version"] != before


def test_a_provider_that_fails_to_load_stops_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch, "def provider():\n    raise RuntimeError('no config')\n")
    assert startup_problems() == ["entry point acme of acme-tim 1.2.0: RuntimeError: no config"]


def test_an_invalid_action_in_a_provider_stops_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch, ROWS_PROVIDER, key="Users")
    [problem] = startup_problems()
    assert problem.startswith("entry point acme of acme-tim 1.2.0: key: String should match")


def test_an_entry_point_must_return_a_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch, "def provider():\n    return []\n")
    assert startup_problems() == [
        "entry point acme of acme-tim 1.2.0: returned list, not a Provider"
    ]


def test_only_the_built_in_distribution_may_use_the_tim_prefix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch, ROWS_PROVIDER, key="tim.users")
    assert startup_problems() == [
        "entry point acme of acme-tim 1.2.0: action tim.users: the tim. prefix is reserved "
        "for TIM's built-ins"
    ]
