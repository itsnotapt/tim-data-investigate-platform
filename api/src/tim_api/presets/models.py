"""Preset models."""

from typing import Any, Literal
from uuid import UUID

from pydantic import Field
from tim_actions import QueryParameterType

from tim_api.models_common import ApiModel, NonBlankStr, UtcDatetime

Visibility = Literal["private", "shared"]


class FixedInput(ApiModel):
    """A param input whose value is saved with the preset. Its type is the param's."""

    name: NonBlankStr
    source: Literal["param"]
    fixed: Literal[True]
    value: Any


class FromRowInput(ApiModel):
    """A param input filled from the first of ``fromColumns`` the rows have. With no columns, the
    form asks the analyst for it."""

    name: NonBlankStr
    source: Literal["param"]
    fixed: Literal[False]
    from_columns: list[NonBlankStr]


class FixedQueryParameter(ApiModel):
    """A query parameter whose value is saved with the preset: a name in the query, declared
    with ``type``."""

    name: NonBlankStr
    source: Literal["queryParameter"]
    type: QueryParameterType
    fixed: Literal[True]
    value: Any


class FromRowQueryParameter(ApiModel):
    """A query parameter filled from the first of ``fromColumns`` the rows have; a ``dynamic`` one
    takes every distinct value. With no columns, the form asks the analyst for it."""

    name: NonBlankStr
    source: Literal["queryParameter"]
    type: QueryParameterType
    fixed: Literal[False]
    from_columns: list[NonBlankStr]


PresetInput = FixedInput | FromRowInput | FixedQueryParameter | FromRowQueryParameter


class PresetFields(ApiModel):
    """The fields the owner writes: the ``POST`` and ``PUT`` body."""

    name: NonBlankStr
    menu_path: list[NonBlankStr] = Field(default_factory=list)
    visibility: Visibility = "private"
    action: NonBlankStr
    params: dict[str, Any] = Field(default_factory=dict)
    inputs: list[PresetInput] = Field(default_factory=list)
    id_column: NonBlankStr | None = None
    """The Id column its results open with, when it isn't the action's."""


class StoredPreset(PresetFields):
    preset_id: UUID
    owner: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


class Preset(StoredPreset):
    """A preset as one analyst sees it: ``owned`` is whether they own it, ``hidden`` whether
    they hid it."""

    owned: bool
    hidden: bool
