"""Kusto schema request/response models (api-contract.md 3.2, 4).

Cluster policy (https, host suffix/allow-list) is enforced by `kusto/validation.py` (P2-04),
not here; the models only require a non-blank string.
"""

from typing import Any

from pydantic import Field

from tim_api.models_common import ApiModel, Database, NonBlankStr


class KustoClusterDatabase(ApiModel):
    """Request body of `POST /api/kusto/schema`."""

    cluster: NonBlankStr
    database: Database


SchemaRequest = KustoClusterDatabase


class SchemaResponse(ApiModel):
    """`{schema: <parsed .show schema as json document>}`, passed through untouched."""

    # Python attribute is `schema_` because `schema` shadows a BaseModel attribute.
    schema_: dict[str, Any] = Field(alias="schema")
