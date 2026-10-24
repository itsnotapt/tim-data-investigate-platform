"""Connections: the fixed endpoints of an instance, configured by the operator in the connections
file (ADR-0018)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from tim_actions._common import NonBlankStr

ConnectionName = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]+$")]
"""Lowercase letters, digits and ``-``."""

Auth = Literal["obo", "workload_identity"]
"""Whose identity the system behind the connection sees: ``obo``, the analyst's, through an
on-behalf-of token for the connection's scope; ``workload_identity``, TIM's own."""


class Connection(BaseModel):
    """One connection in the connections file. A connection type's hook subclasses this with the
    type's own fields, narrows ``type`` to its name and ``auth`` to the mechanisms it supports.

    ``scope`` is what an ``obo`` token is exchanged for, and only ``obo`` takes one; a connection
    type may give a default (``default_scope``), and without one ``scope`` is required.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: ConnectionName
    title: NonBlankStr
    type: str
    auth: Auth
    scope: NonBlankStr | None = None

    def default_scope(self) -> str | None:
        """The ``obo`` scope when the file gives none."""
        return None

    @property
    def obo_scope(self) -> str | None:
        """The scope an ``obo`` connection's token is for, or ``None`` for other auth."""
        if self.auth != "obo":
            return None
        return self.scope or self.default_scope()

    def database_suggestions(self) -> tuple[str, ...] | None:
        """Databases the browser suggests for this connection, if the type has any."""
        return None

    @model_validator(mode="after")
    def _scope(self) -> Connection:
        if self.auth == "obo" and self.obo_scope is None:
            raise ValueError("scope is required for auth obo")
        if self.auth != "obo" and self.scope is not None:
            raise ValueError("scope is only for auth obo")
        return self
