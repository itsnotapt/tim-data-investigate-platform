"""PROTOTYPE, throwaway: action files, YAML that configures one action of a named action type.

An action type that can be written as a file gives itself a ``type_name`` and a ``File`` model:
the fields every action has (``ActionFile``) plus its own (connection, KQL, ...). TIM validates
each file against that model at startup and builds the action from it, so a file is only ever
an instance of an installed action type; code (``run``, a custom ``resolve``) stays in Python.

Files come from a package's data directory or an instance directory (``TIM_ACTION_FILES``);
later the same models could validate actions stored in Postgres.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Annotated, Any, ClassVar, Literal, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from interface import (
    Action,
    Column,
    ColumnType,
    IdFn,
    Param,
    ParamKind,
    Provider,
    first_of,
    from_columns,
    hash_values,
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ParamSpec(_Strict):
    name: str
    kind: ParamKind = "string"
    label: str | None = None
    required: bool = True
    default: Any = None
    many: bool = False
    choices: list[str] = []
    backend: str | None = None
    schema_from: list[str] = []
    from_columns: list[str] = []

    def build(self) -> Param:
        return Param(
            self.name, self.kind, label=self.label, required=self.required, default=self.default,
            many=self.many, choices=tuple(self.choices), backend=self.backend,
            schema_from=tuple(self.schema_from), from_columns=tuple(self.from_columns),
        )


class ColumnSpec(_Strict):
    name: str
    type: ColumnType = "string"
    hidden: bool = False


class IdColumns(_Strict):
    """``id: {columns: [UUID]}``: the value of one column, or a hash of several."""

    columns: list[str] = Field(min_length=1)


class IdFirstOf(_Strict):
    """``id: {first_of: [CorrelationId]}``: the first column present, else a hash of the row."""

    first_of: list[str] = Field(min_length=1)


IdSpec = Literal["hash_values"] | IdColumns | IdFirstOf


def _id_fn(spec: IdSpec) -> IdFn:
    if spec == "hash_values":
        return hash_values
    if isinstance(spec, IdColumns):
        return from_columns(*spec.columns)
    assert isinstance(spec, IdFirstOf)
    return first_of(*spec.first_of)


class ActionFile(_Strict):
    """The fields every action file has, whatever its type."""

    type: str
    key: str
    name: str
    menu: list[str] = []
    description: str = ""
    pivot: Literal["none", "row", "rows"] = "row"
    params: list[ParamSpec] = []
    columns: list[ColumnSpec] | None = None
    id: IdSpec = Field(description="Required: hash_values, {columns: [...]} or {first_of: [...]}")

    def action_fields(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "menu": tuple(self.menu),
            "description": self.description,
            "pivot": self.pivot,
            "params": tuple(p.build() for p in self.params),
            "columns": None if self.columns is None else tuple(
                Column(c.name, c.type, c.hidden) for c in self.columns),
            "id": _id_fn(self.id),
        }

    def type_fields(self, directory: Path) -> dict[str, Any]:
        """The action type's own fields, as its constructor takes them."""
        common = set(ActionFile.model_fields)
        return {k: v for k, v in self if k not in common}


def text_or_file(text: str | None, file: str | None, directory: Path, what: str) -> str:
    """``kql: |`` inline, or ``kql_file: x.kql`` next to the action file (editor highlighting)."""
    if (text is None) == (file is None):
        raise ValueError(f"give exactly one of {what} and {what}_file")
    if text is not None:
        return text
    assert file is not None
    path = directory / file
    if not path.is_file():
        raise ValueError(f"{what}_file {file}: no such file next to the action file")
    return path.read_text()


class FileActionType:
    """Mixin for action types that can be written as files."""

    type_name: ClassVar[str]
    File: ClassVar[type[ActionFile]]

    @classmethod
    def from_file(cls, spec: ActionFile, directory: Path) -> Action:
        return cls(**spec.action_fields(), **spec.type_fields(directory))  # type: ignore[call-arg, return-value]


# --- loading ---------------------------------------------------------------------------------


class ActionFileError(Exception):
    pass


def load_action_file(path: Path, types: dict[str, type[FileActionType]]) -> list[Action]:
    """Every action in one file: one per YAML document (``---`` between them). Each document is
    validated against its type's model; errors name the file, the line and the field."""
    source = path.read_text()
    try:
        nodes = list(yaml.compose_all(source))
        documents = list(yaml.safe_load_all(source))
    except yaml.MarkedYAMLError as exc:
        line = exc.problem_mark.line + 1 if exc.problem_mark else "?"
        raise ActionFileError(f"{path.name}:{line}: not valid YAML: {exc.problem}") from None
    actions, problems = [], []
    for node, data in zip(nodes, documents, strict=True):
        try:
            actions.append(_load_document(path, node, data, types))
        except ActionFileError as exc:
            problems.append(str(exc))
    if problems:
        raise ActionFileError("\n".join(problems))
    return actions


def _load_document(
    path: Path, node: yaml.Node, data: Any, types: dict[str, type[FileActionType]]
) -> Action:
    if not isinstance(data, dict):
        raise ActionFileError(f"{path.name}:{_line(node, ())}: expected a mapping of fields")
    type_name = data.get("type")
    action_type = types.get(type_name)  # type: ignore[arg-type]
    if action_type is None:
        raise ActionFileError(
            f"{path.name}:{_line(node, ('type',))}: type {type_name!r} is not an installed "
            f"action type (installed: {', '.join(sorted(types))})")
    try:
        spec = action_type.File.model_validate(data)
        return action_type.from_file(spec, path.parent)
    except ValidationError as exc:
        problems = [
            f"{path.name}:{_line(node, e['loc'])}: {'.'.join(map(str, e['loc'])) or '(file)'}: "
            f"{e['msg']}"
            for e in exc.errors()
        ]
        raise ActionFileError("\n".join(problems)) from None
    except ValueError as exc:
        raise ActionFileError(f"{path.name}:{_line(node, ())}: {exc}") from None


def _line(node: yaml.Node | None, loc: Sequence[str | int]) -> int:
    """The line of the deepest node along ``loc`` (pydantic's error path) that exists."""
    line = node.start_mark.line + 1 if node else 1
    for part in loc:
        if isinstance(node, yaml.MappingNode):
            node = next((v for k, v in node.value if k.value == part), None)
        elif isinstance(node, yaml.SequenceNode) and isinstance(part, int) and part < len(node.value):
            node = node.value[part]
        else:
            break
        if node is None:
            break
        line = node.start_mark.line + 1
    return line


def file_provider(
    name: str, directory: Path, types: dict[str, type[FileActionType]]
) -> Provider:
    """A provider for every ``*.yaml`` in a directory: a package's data or the instance's."""
    actions = [a for p in sorted(directory.glob("*.yaml")) for a in load_action_file(p, types)]
    return Provider(name=name, actions=actions)


def file_schema(types: dict[str, type[FileActionType]]) -> dict[str, Any]:
    """JSON Schema for every installed type's files, for the editor (yaml-language-server)."""
    files = tuple(t.File for t in types.values())
    union = Annotated[Union[files], Field(discriminator="type")]  # type: ignore[valid-type]  # noqa: UP007
    return TypeAdapter(union).json_schema()
