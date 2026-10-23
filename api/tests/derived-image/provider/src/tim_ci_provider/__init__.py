"""A connection type with nothing behind it: `tim-api check` accepts a `ci_static` connection only
when this provider is installed."""

from typing import Literal

from tim_actions import Connection, Hook, Provider


class CiStaticConnection(Connection):
    type: Literal["ci_static"]
    auth: Literal["workload_identity"]


class CiStaticHook(Hook):
    connection_type = "ci_static"
    Connection = CiStaticConnection

    def cancel(self) -> None:
        pass


def provider() -> Provider:
    return Provider(hooks=[CiStaticHook])
