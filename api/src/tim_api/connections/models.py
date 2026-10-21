"""``/api/connections``: the editor schema of a connection."""

from __future__ import annotations

from pydantic import Field, JsonValue

from tim_api.models_common import ApiModel


class EditorSchemaRequest(ApiModel):
    """Body of ``POST /api/connections/{name}/schema``: the values of the editor param's
    ``schemaFrom`` params, by name, without its connection param."""

    scope: dict[str, JsonValue] = Field(default_factory=dict)


class EditorSchemaResponse(ApiModel):
    """What the editor completes from: ``kind`` picks the browser's adapter. Both are ``null``
    when the connection type has no schema for the scope."""

    kind: str | None
    # Python attribute is `schema_` because `schema` shadows a BaseModel attribute.
    schema_: JsonValue = Field(alias="schema")
