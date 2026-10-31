"""A preset as an action file: the YAML of an action that runs what the preset runs."""

import re

from tim_actions import Action, QueryParameter, Sink, action_file_yaml

from tim_api.presets.models import FixedInput, FixedQueryParameter, FromRowQueryParameter, Preset


class NoActionFileError(Exception):
    """The preset has no action file: its action has none, or the preset lacks what it needs."""


def _key(name: str) -> str:
    """The action key for a preset named ``name``: its letters and digits, lowercase, in runs
    joined by ``-``."""
    return "-".join(re.findall(r"[a-z0-9]+", name.lower())) or "preset"


def preset_action_file(preset: Preset, action: Action | Sink | None) -> str:
    """The action file of ``preset``, a preset of ``action``; raises ``NoActionFileError`` when
    the action is gone or is a sink, or it gives the preset none."""
    if action is None or isinstance(action, Sink):
        raise NoActionFileError
    params = dict(preset.params)
    params.update({i.name: i.value for i in preset.inputs if isinstance(i, FixedInput)})
    query_parameters = [
        QueryParameter(i.name, i.type, value=i.value)
        if isinstance(i, FixedQueryParameter)
        else QueryParameter(i.name, i.type, from_columns=tuple(i.from_columns))
        for i in preset.inputs
        if isinstance(i, FixedQueryParameter | FromRowQueryParameter)
    ]
    document = action.preset_file(
        key=_key(preset.name),
        name=preset.name,
        menu="/".join(preset.menu_path),
        params=params,
        query_parameters=query_parameters,
        id_column=preset.id_column,
    )
    if document is None:
        raise NoActionFileError
    return action_file_yaml(document)
