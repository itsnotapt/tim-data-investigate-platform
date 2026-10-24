"""Action files: YAML that configures actions of file-capable action types.

A file-capable action type sets ``type_name`` and a ``File`` model, a subclass of
``ActionDocument``. Each YAML document in a file is one action: its ``type`` picks the action type,
the type's ``File`` model validates the document, and ``Action.from_file`` builds the action.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from importlib.resources.abc import Traversable
from pathlib import PurePosixPath
from typing import Annotated, Any, Literal, TypeGuard, Union, cast

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    GetJsonSchemaHandler,
    TypeAdapter,
    ValidationError,
    create_model,
    field_validator,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema

from tim_actions._common import NonBlankStr
from tim_actions.action import Action, ActionKey, ActionType, Pivot, Sink
from tim_actions.columns import Column
from tim_actions.params import Param

ACTION_FILE_SUFFIXES = (".yaml", ".yml")
RESERVED_PREFIX = "tim."
"""The key prefix of TIM's built-in actions."""
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"


@dataclass(frozen=True)
class Sidecar:
    """Marks a ``str`` field of a ``File`` model whose text may instead come from a file next to
    the action file: ``kql: Annotated[str, Sidecar()]`` takes ``kql: |`` inline or
    ``kql_file: query.kql``, never both."""


def sidecar_key(name: str) -> str:
    """The key that gives the sidecar of field ``name``."""
    return f"{name}_file"


def sidecar_fields(model: type[BaseModel]) -> list[str]:
    """The names of ``model``'s fields marked ``Sidecar``."""
    return [
        name
        for name, info in model.model_fields.items()
        if any(isinstance(item, Sidecar) for item in info.metadata)
    ]


_ColumnName = Annotated[str, Field(min_length=1)]


class DocumentBase(BaseModel):
    """The fields of every action in an action file, one YAML document each."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: str
    key: ActionKey
    name: NonBlankStr
    menu: str = ""
    description: NonBlankStr | None = None

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        target = handler.resolve_ref_schema(json_schema)
        for name in sidecar_fields(cls):
            sidecar = sidecar_key(name)
            target["properties"][sidecar] = {
                "type": "string",
                "title": sidecar.replace("_", " ").capitalize(),
                "description": f"A file next to the action file that holds {name}",
            }
            required: list[str] = target.get("required", [])
            rule: dict[str, Any]
            if name in required:
                required.remove(name)
                rule = {"oneOf": [{"required": [name]}, {"required": [sidecar]}]}
            else:
                rule = {"not": {"required": [name, sidecar]}}
            target.setdefault("allOf", []).append(rule)
        return json_schema


class ActionDocument(DocumentBase):
    """A query action in an action file. A query action type's ``File`` model subclasses this
    and adds the type's own fields.

    ``id`` is a column name, or a list of alternative columns where the first non-empty value
    wins; leaving it out means the rows have no ``id``.
    """

    pivot: Pivot
    params: tuple[Param, ...] = ()
    columns: tuple[Column, ...] | None = None
    id: _ColumnName | Annotated[tuple[_ColumnName, ...], Field(min_length=1)] | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _id(cls, value: Any) -> Any:
        names = [value] if isinstance(value, str) else value
        if value is None:
            return value
        if (
            not isinstance(names, list)
            or not names
            or not all(isinstance(name, str) and name.strip() for name in names)
        ):
            raise ValueError(
                "give a column name, or a list of column names where the first non-empty value wins"
            )
        return value


class SinkDocument(DocumentBase):
    """A sink in an action file. A sink type's ``File`` model subclasses this and adds the type's
    own fields; a sink has no ``pivot``, ``params``, ``columns`` or ``id``."""


@dataclass(frozen=True)
class FileAction:
    """An action built from an action file; ``location`` is the ``<file>:<line>`` of its key."""

    action: Action | Sink
    location: str


@dataclass(frozen=True)
class ReadFile:
    """A file the loader read, an action file or a sidecar, named relative to its directory."""

    name: str
    sha256: str

    @classmethod
    def of(cls, name: str, content: bytes) -> ReadFile:
        return cls(name, hashlib.sha256(content).hexdigest())


@dataclass
class LoadedFiles:
    """What loading a directory of action files gave: its actions, every file read, and the
    problems, each naming the file, line and field."""

    actions: list[FileAction] = field(default_factory=list)
    files: list[ReadFile] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


class _Loader(yaml.SafeLoader):
    """Safe YAML that keeps timestamps as strings, the wire values params take."""


_Loader.yaml_implicit_resolvers = {
    first: [(tag, regexp) for tag, regexp in resolvers if tag != "tag:yaml.org,2002:timestamp"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}

_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _field(loc: Sequence[str | int]) -> str:
    """Pydantic's error location as a field path, ``params[0].kind``, without its union tags."""
    path = ""
    for part in loc:
        if isinstance(part, int):
            path += f"[{part}]"
        elif _FIELD_NAME.match(part):
            path += f".{part}" if path else part
    return path


def _child(node: yaml.Node, part: str | int) -> tuple[yaml.Node, yaml.Node] | None:
    """The node ``part`` names in ``node``, with the node its line is read from: the key, for
    a field."""
    if isinstance(node, yaml.MappingNode) and isinstance(part, str):
        keys = {
            key.value: (key, value) for key, value in node.value if isinstance(key, yaml.ScalarNode)
        }
        return keys.get(part, keys.get(sidecar_key(part)))
    if isinstance(node, yaml.SequenceNode) and isinstance(part, int) and part < len(node.value):
        item: yaml.Node = node.value[part]
        return item, item
    return None


def _line(node: yaml.Node, loc: Sequence[str | int]) -> int:
    """The line of the deepest field or item along ``loc`` that the document has."""
    marked = node
    for part in loc:
        child = _child(node, part)
        if child is None:
            break
        marked, node = child
    return marked.start_mark.line + 1


class _Document:
    """One YAML document of an action file, collecting its problems by line."""

    def __init__(self, path: str, node: yaml.Node) -> None:
        self.path = path
        self.node = node
        self._problems: list[tuple[int, str]] = []

    @property
    def problems(self) -> list[str]:
        return [text for _, text in sorted(self._problems, key=lambda problem: problem[0])]

    def location(self, loc: Sequence[str | int] = ()) -> str:
        return f"{self.path}:{_line(self.node, loc)}"

    def problem(self, loc: Sequence[str | int], message: str, line: int | None = None) -> None:
        """Report a problem at the field ``loc`` names, or at ``line`` when given."""
        line = _line(self.node, loc) if line is None else line
        name = _field(loc)
        text = (
            f"{self.path}:{line}: {name}: {message}" if name else f"{self.path}:{line}: {message}"
        )
        if (line, text) not in self._problems:
            self._problems.append((line, text))

    def validation_errors(
        self, exc: ValidationError, skip: Sequence[str] = (), prefix: Sequence[str | int] = ()
    ) -> None:
        """Report each error of ``exc``, at its location under ``prefix``, but none whose first
        field is in ``skip``."""
        for error in exc.errors(include_url=False, include_input=False):
            loc = error["loc"]
            if loc and loc[0] in skip:
                continue
            self.problem((*prefix, *loc), error["msg"].removeprefix("Value error, "))


def _duplicate_keys(node: yaml.Node, loc: tuple[str | int, ...], doc: _Document) -> None:
    """Report a mapping key given twice, which YAML would otherwise resolve to the last one."""
    if isinstance(node, yaml.MappingNode):
        seen: set[str] = set()
        for key, value in node.value:
            if isinstance(key, yaml.ScalarNode):
                if key.value in seen:
                    doc.problem((*loc, key.value), "given twice", key.start_mark.line + 1)
                seen.add(key.value)
                _duplicate_keys(value, (*loc, key.value), doc)
    elif isinstance(node, yaml.SequenceNode):
        for index, item in enumerate(node.value):
            _duplicate_keys(item, (*loc, index), doc)


def _is_file_name(value: Any) -> TypeGuard[str]:
    return (
        isinstance(value, str)
        and value not in ("", ".", "..")
        and PurePosixPath(value).name == value
        and "\\" not in value
    )


def _sidecar_text(
    doc: _Document, sidecar: str, value: Any, directory: Traversable, loaded: LoadedFiles
) -> str | None:
    """The text of the sidecar ``value`` names, or ``None`` with the problem reported."""
    if not _is_file_name(value):
        doc.problem((sidecar,), "give the name of a file next to the action file")
        return None
    entry = directory / value
    try:
        content = entry.read_bytes() if entry.is_file() else None
    except OSError:
        content = None
    if content is None:
        doc.problem((sidecar,), f"no file {value} next to the action file")
        return None
    loaded.files.append(ReadFile.of(value, content))
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        doc.problem((sidecar,), f"{value} is not UTF-8 text")
        return None


def _read_sidecars(
    doc: _Document,
    data: dict[str, Any],
    model: type[DocumentBase],
    directory: Traversable,
    loaded: LoadedFiles,
) -> list[str]:
    """Replace each ``<field>_file`` with the sidecar's text; return the fields that failed."""
    failed: list[str] = []
    for name in sidecar_fields(model):
        sidecar = sidecar_key(name)
        if sidecar not in data:
            continue
        value = data.pop(sidecar)
        if name in data:
            doc.problem((sidecar,), f"give {name} or {sidecar}, not both")
            failed.append(name)
            continue
        text = _sidecar_text(doc, sidecar, value, directory, loaded)
        if text is None:
            failed.append(name)
        else:
            data[name] = text
    return failed


def _installed(action_types: Mapping[str, ActionType]) -> str:
    return ", ".join(sorted(action_types)) or "none"


def _load_document(
    doc: _Document,
    data: Any,
    directory: Traversable,
    action_types: Mapping[str, ActionType],
    loaded: LoadedFiles,
) -> FileAction | None:
    _duplicate_keys(doc.node, (), doc)
    if not isinstance(data, dict):
        doc.problem((), "an action is a mapping of its fields")
        return None
    type_name = data.get("type")
    action_type = action_types.get(type_name) if isinstance(type_name, str) else None
    if action_type is None or action_type.File is None:
        message = "required" if type_name is None else f"unknown action type {type_name!r}"
        doc.problem(("type",), f"{message} (installed action types: {_installed(action_types)})")
        return None
    data = dict(data)
    failed = _read_sidecars(doc, data, action_type.File, directory, loaded)
    try:
        file = action_type.File.model_validate(data)
    except ValidationError as exc:
        doc.validation_errors(exc, skip=failed)
        return None
    try:
        action = action_type.from_file(file)
    except ValidationError as exc:
        doc.validation_errors(exc)
        return None
    return None if doc.problems else FileAction(action, doc.location(("key",)))


def _documents(text: str) -> Iterator[tuple[yaml.Node, Any]]:
    loader = _Loader(text)
    try:
        while loader.check_node():
            node = loader.get_node()
            if node is not None:
                yield node, loader.construct_document(node)
    finally:
        loader.dispose()


def _yaml_problem(path: str, exc: yaml.YAMLError) -> str:
    if isinstance(exc, yaml.MarkedYAMLError) and exc.problem_mark is not None:
        return f"{path}:{exc.problem_mark.line + 1}: not valid YAML: {exc.problem}"
    return f"{path}: not valid YAML: {exc}"


def _load_file(
    entry: Traversable,
    directory: Traversable,
    action_types: Mapping[str, ActionType],
    loaded: LoadedFiles,
) -> None:
    path = str(entry)
    content = entry.read_bytes()
    loaded.files.append(ReadFile.of(entry.name, content))
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        loaded.problems.append(f"{path}: not UTF-8 text")
        return
    try:
        for node, data in _documents(text):
            if data is None:
                continue
            doc = _Document(path, node)
            action = _load_document(doc, data, directory, action_types, loaded)
            loaded.problems.extend(doc.problems)
            if action is not None:
                loaded.actions.append(action)
    except yaml.YAMLError as exc:
        loaded.problems.append(_yaml_problem(path, exc))


def action_file_entries(directory: Traversable) -> list[Traversable]:
    """The action files in ``directory``, by name: ``*.yaml`` and ``*.yml``, not recursing and
    skipping dot-entries (such as a ConfigMap's ``..data``)."""
    return sorted(
        (
            entry
            for entry in directory.iterdir()
            if not entry.name.startswith(".")
            and entry.name.endswith(ACTION_FILE_SUFFIXES)
            and entry.is_file()
        ),
        key=lambda entry: entry.name,
    )


def load_action_files(
    directory: Traversable, action_types: Mapping[str, ActionType]
) -> LoadedFiles:
    """Load every action file in ``directory``. ``action_types`` are the file-capable action
    types, by ``type_name``. Each document is validated on its own, so one file can report
    several problems."""
    loaded = LoadedFiles()
    for entry in action_file_entries(directory):
        _load_file(entry, directory, action_types, loaded)
    return loaded


def add_file_actions(
    actions: dict[str, tuple[Action | Sink, str]], loaded: LoadedFiles, *, builtin: bool
) -> list[str]:
    """Add the actions ``loaded`` gave to ``actions``, keyed with where each comes from, and
    return the problems: ``loaded``'s own, then each key that is taken or, unless ``builtin``,
    has the reserved prefix."""
    problems = list(loaded.problems)
    for item in loaded.actions:
        key = item.action.key
        if key.startswith(RESERVED_PREFIX) and not builtin:
            problems.append(
                f"{item.location}: key: the {RESERVED_PREFIX} prefix is reserved for TIM's "
                "built-ins"
            )
        elif key in actions:
            problems.append(
                f"{item.location}: key: duplicate action key {key}, also in {actions[key][1]}"
            )
        else:
            actions[key] = (item.action, item.location)
    return problems


def action_files_schema(action_types: Mapping[str, ActionType]) -> dict[str, Any]:
    """A JSON Schema for one document of an action file, for ``yaml-language-server``."""
    header = {"$schema": JSON_SCHEMA_DIALECT, "title": "TIM action file"}
    models: list[type[DocumentBase]] = [
        create_model(
            name,
            __base__=action_type.File,
            __doc__=action_type.__doc__,
            type=(cast(Any, Literal)[name], ...),
        )
        for name, action_type in sorted(action_types.items())
        if action_type.File is not None
    ]
    if not models:
        return {**header, "description": "No file-capable action types are installed", "not": {}}
    shape: Any = (
        models[0]
        if len(models) == 1
        else Annotated[Union[tuple(models)], Field(discriminator="type")]  # noqa: UP007
    )
    schema: dict[str, Any] = TypeAdapter(shape).json_schema()
    return {**header, **{k: v for k, v in schema.items() if k != "title"}}
