"""``/api/presets``: an analyst's own presets and those shared with everyone."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Path, Response, status
from tim_actions import Action, Sink
from tim_actions.params import PARAM_NAME

from tim_api.auth import Principal, get_current_principal
from tim_api.deps import get_preset_store
from tim_api.errors import UnprocessableError, problem_exception
from tim_api.presets.action_file import preset_action_file
from tim_api.presets.models import Preset, PresetFields, StoredPreset
from tim_api.runs.router import get_actions
from tim_api.storage import PresetStore

router = APIRouter(
    prefix="/api/presets",
    tags=["presets"],
    dependencies=[Depends(get_current_principal)],
)

Store = Annotated[PresetStore, Depends(get_preset_store)]
Caller = Annotated[Principal, Depends(get_current_principal)]
Actions = Annotated[dict[str, Action | Sink], Depends(get_actions)]
PresetId = Annotated[UUID, Path(alias="presetId")]


def _now() -> datetime:
    # Millisecond precision: it is what the JSON form carries.
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def _check(body: PresetFields, actions: dict[str, Action | Sink]) -> None:
    """The preset's ``action`` must be a query action in the catalogue. Each param input must be a
    param of it with ``from_columns``, and each query parameter a name for an action that takes
    them. Values are checked when a run starts."""
    action = actions.get(body.action)
    if action is None:
        raise UnprocessableError({"action": ["Unknown action"]})
    if isinstance(action, Sink):
        raise UnprocessableError({"action": ["A sink has no presets"]})
    params = {p.name: p for p in action.params}
    errors: dict[str, list[str]] = {}
    seen: set[str] = set()
    for index, item in enumerate(body.inputs):
        if item.name in seen:
            errors[f"inputs.{index}.name"] = [f"{item.name} is already an input"]
        seen.add(item.name)
        if item.source == "queryParameter":
            if not action.takes_query_parameters:
                errors[f"inputs.{index}.source"] = [f"{action.name} takes no query parameters"]
            elif not PARAM_NAME.match(item.name):
                errors[f"inputs.{index}.name"] = [
                    "A query parameter's name starts with a letter or _ and holds only letters, "
                    "digits and _"
                ]
            continue
        param = params.get(item.name)
        if param is None:
            errors[f"inputs.{index}.name"] = ["Unknown param"]
        elif not param.from_columns:
            errors[f"inputs.{index}.name"] = [f"{item.name} has no from_columns"]
    if errors:
        raise UnprocessableError(errors)


async def _visible(store: PresetStore, preset_id: UUID, principal: Principal) -> Preset:
    preset = await store.get(preset_id, principal.name)
    if preset is None or (preset.owner != principal.name and preset.visibility == "private"):
        raise problem_exception(404, "Preset not found")
    return preset


async def _owned(store: PresetStore, preset_id: UUID, principal: Principal) -> Preset:
    preset = await _visible(store, preset_id, principal)
    if preset.owner != principal.name:
        raise problem_exception(403, "Only the owner can change a preset")
    return preset


@router.get("")
async def list_presets(store: Store, principal: Caller) -> list[Preset]:
    return await store.list(principal.name)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_preset(
    body: PresetFields, store: Store, principal: Caller, actions: Actions
) -> Preset:
    _check(body, actions)
    now = _now()
    preset = StoredPreset(
        **body.model_dump(by_alias=False),
        preset_id=uuid4(),
        owner=principal.name,
        created_at=now,
        updated_at=now,
    )
    await store.create(preset)
    return Preset(**preset.model_dump(by_alias=False), owned=True, hidden=False)


@router.put("/{presetId}")
async def replace_preset(
    preset_id: PresetId, body: PresetFields, store: Store, principal: Caller, actions: Actions
) -> Preset:
    await _owned(store, preset_id, principal)
    _check(body, actions)
    await store.replace(preset_id, body, updated_at=_now())
    return await _visible(store, preset_id, principal)


@router.delete("/{presetId}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(preset_id: PresetId, store: Store, principal: Caller) -> Response:
    await _owned(store, preset_id, principal)
    await store.delete(preset_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{presetId}/hidden", status_code=status.HTTP_204_NO_CONTENT)
async def hide_preset(preset_id: PresetId, store: Store, principal: Caller) -> Response:
    await _visible(store, preset_id, principal)
    await store.set_hidden(preset_id, principal.name, hidden=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{presetId}/hidden", status_code=status.HTTP_204_NO_CONTENT)
async def unhide_preset(preset_id: PresetId, store: Store, principal: Caller) -> Response:
    await _visible(store, preset_id, principal)
    await store.set_hidden(preset_id, principal.name, hidden=False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{presetId}/actionFile",
    response_class=Response,
    responses={200: {"content": {"application/yaml": {"schema": {"type": "string"}}}}},
)
async def get_action_file(
    preset_id: PresetId, store: Store, principal: Caller, actions: Actions
) -> Response:
    """The YAML of an action that runs what the preset runs, for an operator to add to the
    instance's action files."""
    preset = await _visible(store, preset_id, principal)
    text = preset_action_file(preset, actions.get(preset.action))
    return Response(text, media_type="application/yaml")
