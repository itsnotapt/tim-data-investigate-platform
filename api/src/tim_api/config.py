"""Backend runtime configuration (pydantic-settings, env vars only).

All variables use the ``TIM_`` prefix and may also come from a ``.env`` file in the working
directory.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

ENV_PREFIX = "TIM_"

Environment = Literal["development", "production"]
"""``TIM_ENVIRONMENT``: development-only modes refuse to run in ``production`` (ADR-0011)."""


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
    environment: Environment = "production"
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = "INFO"

    # --- auth (Entra ID, ADR-0005) -----------------------------------------------------
    auth_tenant_id: str = Field(min_length=1)
    auth_client_id: str = Field(min_length=1)  # API audience is api://{client id}
    auth_client_secret: SecretStr | None = None  # else federated/managed-identity assertion
    auth_authority_host: str = "https://login.microsoftonline.com"  # sovereign clouds override
    # Dev-only bypass. Rejected in production.
    auth_disabled: bool = False

    # --- actions (ADR-0017) --------------------------------------------------------------
    # One flat directory of action files, read at startup.
    actions_dir: Path | None = None
    # The connections file (ADR-0018): the instance's connections, read at startup.
    connections_file: Path | None = None
    # Dev only: registers the development actions (ADR-0011). Rejected in production.
    dev_actions: bool = False

    # --- annotations (ADR-0020) ---------------------------------------------------------
    # The labels file: the instance's labels, read at startup. Unset means the default labels.
    labels_file: Path | None = None
    # Distinct ids one PATCH /api/annotations may change.
    max_annotation_ids: int = Field(default=10_000, gt=0)
    # How often browsers poll the change feed.
    annotation_poll_seconds: int = Field(default=30, gt=0)

    # --- storage (ADR-0004) ------------------------------------------------------------
    database_url: SecretStr
    run_retention_sweep_seconds: int = Field(default=300, gt=0)  # expired-run cleanup interval

    # --- HTTP --------------------------------------------------------------------------
    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Hard cap on any request body, such as a sink's input; larger requests get 413 before
    # parsing.
    max_request_bytes: int = Field(default=64 * 1024 * 1024, gt=0)

    # --- run limits (ADR-0012) ----------------------------------------------------------
    # Caps on a run's result.
    max_result_rows: int = Field(default=1_000_000, gt=0)
    max_result_bytes: int = Field(default=512 * 1024 * 1024, gt=0)
    run_timeout_seconds: int = Field(default=600, gt=0)
    run_retention_seconds: int = Field(default=86_400, gt=0)
    # Runs executing at once in this process; further runs wait, `running`.
    max_concurrent_runs: int = Field(default=16, gt=0)
    # Rows per page of GET /api/runs/{runId}/rows.
    rows_page_size: int = Field(default=10_000, gt=0)
    # Rows a pivot may be resolved from (POST /api/actions/{key}/resolve).
    max_pivot_rows: int = Field(default=100, gt=0)

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _parse_lists(cls, value: object) -> object:
        return _split_list(value)

    @field_validator(
        "auth_client_secret",
        "actions_dir",
        "connections_file",
        "labels_file",
        mode="before",
    )
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        """Compose/Helm pass unset optional variables as empty strings."""
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("actions_dir")
    @classmethod
    def _existing_directory(cls, value: Path | None) -> Path | None:
        if value is not None and not value.is_dir():
            raise ValueError(f"no directory {value}")
        return value

    @field_validator("connections_file", "labels_file")
    @classmethod
    def _existing_file(cls, value: Path | None) -> Path | None:
        if value is not None and not value.is_file():
            raise ValueError(f"no file {value}")
        return value

    @field_validator("auth_authority_host")
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

    @model_validator(mode="after")
    def _no_dev_actions_in_production(self) -> Settings:
        if self.dev_actions and self.environment == "production":
            raise ValueError(
                f"{ENV_PREFIX}DEV_ACTIONS must not be enabled when "
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
