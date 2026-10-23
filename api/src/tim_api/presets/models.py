"""Preset models."""

from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from tim_api.models_common import ApiModel, NonBlankStr, UtcDatetime, omitted

Visibility = Literal["private", "shared"]
InputSource = Literal["param"]


class FixedInput(ApiModel):
    """An input whose value is saved with the preset."""

    name: NonBlankStr
    source: InputSource
    type: str | None = omitted()
    fixed: Literal[True]
    value: Any


class FromRowInput(ApiModel):
    """An input filled from the first of ``fromColumns`` the rows have. With no columns, the
    form asks the analyst for it."""

    name: NonBlankStr
    source: InputSource
    type: str | None = omitted()
    fixed: Literal[False]
    from_columns: list[NonBlankStr]


PresetInput = FixedInput | FromRowInput


class PresetFields(ApiModel):
    """The fields the owner writes: the ``POST`` and ``PUT`` body."""

    name: NonBlankStr
    menu_path: list[NonBlankStr] = Field(default_factory=list)
    visibility: Visibility = "private"
    action: NonBlankStr
    params: dict[str, Any] = Field(default_factory=dict)
    inputs: list[PresetInput] = Field(default_factory=list)


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
