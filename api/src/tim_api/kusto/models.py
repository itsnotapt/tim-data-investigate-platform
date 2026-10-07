"""Kusto schema request/response models.

Cluster policy (https, host allow-list patterns) is enforced by `kusto/validation.py`,
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
