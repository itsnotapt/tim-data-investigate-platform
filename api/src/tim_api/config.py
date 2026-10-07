"""Backend runtime configuration (pydantic-settings, env vars only).

All variables use the ``TIM_`` prefix and may also come from a ``.env`` file in the working
directory.
The app identity for Kusto ingest/admin is read by ``azure-identity`` from the standard
``AZURE_CLIENT_ID`` / ``AZURE_TENANT_ID`` / ``AZURE_CLIENT_SECRET`` variables and is
deliberately not part of ``Settings``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

ENV_PREFIX = "TIM_"

_DEFAULT_SUFFIXES = [".kusto.windows.net", ".kusto.fabric.microsoft.com"]


def _split_list(value: object) -> object:
    """Accept comma-separated strings (or a JSON-ish list) for list settings."""
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class SettingsError(RuntimeError):
    """Raised when configuration is missing or invalid. Never contains secret values."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix=ENV_PREFIX,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- mode -------------------------------------------------------------------------
    environment: Literal["development", "production"] = "production"
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = "INFO"

    # --- auth (Entra ID, ADR-0005) -----------------------------------------------------
    auth_tenant_id: str = Field(min_length=1)
    auth_client_id: str = Field(min_length=1)  # API audience is api://{client id}
    auth_client_secret: SecretStr | None = None  # else federated/managed-identity assertion
    auth_authority_host: str = "https://login.microsoftonline.com"  # sovereign clouds override
    # Dev-only bypass. Rejected in production.
    auth_disabled: bool = False

    # --- Kusto -------------------------------------------------------------------------
    # OBO scope template. "{cluster}" is replaced by the cluster base URI.
    kusto_obo_scope: str = "{cluster}/.default"
    tag_cluster_uri: str = Field(min_length=1)
    tag_database: str = "Research"
    tag_ingest_url: str | None = None  # optional; derived from tag_cluster_uri when unset
    # Dev only: in-memory fake instead of real ingestion (needs environment=development).
    tag_ingest_fake: bool = False

    # --- cluster allow-list --------------------------------------------
    allowed_kusto_suffixes: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(_DEFAULT_SUFFIXES)
    )
    allowed_kusto_hosts: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # --- storage (ADR-0004) ------------------------------------------------------------
    database_url: SecretStr
    run_retention_sweep_seconds: int = Field(default=300, gt=0)  # expired-run cleanup interval

    # --- HTTP --------------------------------------------------------------------------
    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Hard cap on any request body; larger requests get 413 before parsing.
    max_request_bytes: int = Field(default=16 * 1024 * 1024, gt=0)

    # --- query-run limits ------------------------------------------------------
    max_result_rows: int = Field(default=100_000, gt=0)
    max_result_bytes: int = Field(default=64 * 1024 * 1024, gt=0)
    query_timeout_seconds: int = Field(default=600, gt=0)
    run_retention_seconds: int = Field(default=86_400, gt=0)
    # Runs executing at once in this process; further runs wait in `created`.
    max_concurrent_runs: int = Field(default=16, gt=0)

    @field_validator(
        "allowed_kusto_suffixes", "allowed_kusto_hosts", "cors_allowed_origins", mode="before"
    )
    @classmethod
    def _parse_lists(cls, value: object) -> object:
        return _split_list(value)

    @field_validator("auth_client_secret", "tag_ingest_url", mode="before")
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        """Compose/Helm pass unset optional variables as empty strings."""
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("allowed_kusto_suffixes", "allowed_kusto_hosts")
    @classmethod
    def _lowercase(cls, value: list[str]) -> list[str]:
        return [item.lower() for item in value]

    @field_validator("tag_cluster_uri", "tag_ingest_url", "auth_authority_host")
    @classmethod
    def _require_https(cls, value: str | None) -> str | None:
        if value is not None and urlparse(value).scheme != "https":
            raise ValueError("must be an https URL")
        return value

    @field_validator("database_url")
    @classmethod
    def _asyncpg_dsn(cls, value: SecretStr) -> SecretStr:
        url = value.get_secret_value()
        # memory:// is the in-memory store (data lost on restart); production check below.
        if not url.startswith(("memory://", "postgresql+asyncpg://")):
            raise ValueError("must start with postgresql+asyncpg:// (or memory:// in development)")
        return value

    @model_validator(mode="after")
    def _no_memory_store_in_production(self) -> Settings:
        if (
            self.database_url.get_secret_value().startswith("memory://")
            and self.environment == "production"
        ):
            raise ValueError(
                f"{ENV_PREFIX}DATABASE_URL=memory:// is not allowed when "
                f"{ENV_PREFIX}ENVIRONMENT=production"
            )
        return self

    @model_validator(mode="after")
    def _no_auth_bypass_in_production(self) -> Settings:
        if self.auth_disabled and self.environment == "production":
            raise ValueError(
                f"{ENV_PREFIX}AUTH_DISABLED must not be enabled when "
                f"{ENV_PREFIX}ENVIRONMENT=production"
            )
        return self


def _format_errors(exc: ValidationError) -> str:
    lines: list[str] = []
    for err in exc.errors(include_input=False, include_url=False, include_context=False):
        loc = err["loc"]
        name = f"{ENV_PREFIX}{loc[0]}".upper() if loc else ENV_PREFIX.rstrip("_")
        kind = "missing" if err["type"] == "missing" else "invalid"
        # Message text comes from our validators / pydantic and never embeds input values.
        lines.append(f"  - {name}: {kind} ({err['msg']})")
    return "Invalid configuration:\n" + "\n".join(lines)


@lru_cache
def get_settings() -> Settings:
    """Cached settings; use as a FastAPI dependency (``Depends(get_settings)``)."""
    try:
        return Settings()
    except ValidationError as exc:
        raise SettingsError(_format_errors(exc)) from None
