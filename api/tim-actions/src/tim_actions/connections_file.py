"""The connections file: YAML, a list of connections. Each one names its connection type in
``type``, and that type's hook's ``Connection`` model validates it."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, Literal, Union, cast

import yaml
from pydantic import Field, TypeAdapter, ValidationError, create_model

from tim_actions.connections import Connection
from tim_actions.files import (
    JSON_SCHEMA_DIALECT,
    ReadFile,
    _Document,
    _documents,
    _duplicate_keys,
    _yaml_problem,
)
from tim_actions.hooks import Hook


@dataclass
class LoadedConnections:
    """What loading the connections file gave: its connections by name, the file read, and the
    problems, each naming the file, line and field."""

    connections: dict[str, Connection] = field(default_factory=dict)
    files: list[ReadFile] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def _installed(hooks: Mapping[str, type[Hook]]) -> str:
    return ", ".join(sorted(hooks)) or "none"


def _load_entry(
    doc: _Document, index: int, data: Any, hooks: Mapping[str, type[Hook]]
) -> Connection | None:
    if not isinstance(data, dict):
        doc.problem((index,), "a connection is a mapping of its fields")
        return None
    type_name = data.get("type")
    hook = hooks.get(type_name) if isinstance(type_name, str) else None
    if hook is None:
        message = "required" if type_name is None else f"unknown connection type {type_name!r}"
        doc.problem((index, "type"), f"{message} (installed connection types: {_installed(hooks)})")
        return None
    try:
        return hook.Connection.model_validate(data)
    except ValidationError as exc:
        doc.validation_errors(exc, prefix=(index,))
        return None


def load_connections_file(path: Path, hooks: Mapping[str, type[Hook]]) -> LoadedConnections:
    """Load the connections file at ``path``. ``hooks`` are the installed hooks, by connection
    type. Each connection is validated on its own, so one file can report several problems."""
    loaded = LoadedConnections()
    content = path.read_bytes()
    loaded.files.append(ReadFile.of(path.name, content))
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        loaded.problems.append(f"{path}: not UTF-8 text")
        return loaded
    try:
        documents = list(_documents(text))
    except yaml.YAMLError as exc:
        loaded.problems.append(_yaml_problem(str(path), exc))
        return loaded
    if len(documents) > 1:
        loaded.problems.append(f"{path}: give the connections in one YAML document")
        return loaded
    for node, data in documents:
        doc = _Document(str(path), node)
        _duplicate_keys(node, (), doc)
        if not isinstance(data, list):
            doc.problem((), "the connections file is a list of connections")
        else:
            for index, entry in enumerate(data):
                connection = _load_entry(doc, index, entry, hooks)
                if connection is None:
                    continue
                if connection.name in loaded.connections:
                    doc.problem((index, "name"), f"duplicate connection name {connection.name}")
                else:
                    loaded.connections[connection.name] = connection
        loaded.problems.extend(doc.problems)
    return loaded


def connections_file_schema(hooks: Mapping[str, type[Hook]]) -> dict[str, Any]:
    """A JSON Schema for the connections file, for ``yaml-language-server``."""
    header = {"$schema": JSON_SCHEMA_DIALECT, "title": "TIM connections file"}
    models: list[type[Connection]] = [
        create_model(
            name,
            __base__=hook.Connection,
            __doc__=hook.Connection.__doc__,
            type=(cast(Any, Literal)[name], ...),
        )
        for name, hook in sorted(hooks.items())
    ]
    if not models:
        return {**header, "description": "No connection types are installed", "maxItems": 0}
    item: Any = (
        models[0]
        if len(models) == 1
        else Annotated[Union[tuple(models)], Field(discriminator="type")]  # noqa: UP007
    )
    schema: dict[str, Any] = TypeAdapter(list[item]).json_schema()
    return {**header, **{k: v for k, v in schema.items() if k != "title"}}
