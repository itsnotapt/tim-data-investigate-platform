"""The labels file: YAML, a list of the instance's labels in the order the browser lists them.
Without one, the instance has ``DEFAULT_LABELS``."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from tim_actions.files import (
    JSON_SCHEMA_DIALECT,
    ReadFile,
    _Document,
    _documents,
    _duplicate_keys,
    _yaml_problem,
)

# The palette colours and symbols the browser draws; web/src/app/theme.ts defines each one.
LabelColour = Literal["red", "amber", "green", "teal", "blue", "purple", "pink", "grey"]
LabelSymbol = Literal[
    "skull", "warning", "check", "flag", "star", "question", "block", "bug", "eye"
]


class Label(BaseModel):
    """One of the instance's labels. ``key`` is what annotations store."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str = Field(min_length=1, max_length=64, pattern=r"^\S+$")
    name: str = Field(min_length=1, max_length=100)
    colour: LabelColour
    symbol: LabelSymbol | None = None


DEFAULT_LABELS: tuple[Label, ...] = (
    Label(key="malicious", name="Malicious", colour="red", symbol="skull"),
    Label(key="suspicious", name="Suspicious", colour="amber", symbol="warning"),
    Label(key="benign", name="Benign", colour="green", symbol="check"),
)


@dataclass
class LoadedLabels:
    """What loading the labels file gave: its labels in file order, the file read, and the
    problems, each naming the file, line and field."""

    labels: list[Label] = field(default_factory=list)
    files: list[ReadFile] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def _load_entry(doc: _Document, index: int, data: Any) -> Label | None:
    if not isinstance(data, dict):
        doc.problem((index,), "a label is a mapping of its fields")
        return None
    try:
        return Label.model_validate(data)
    except ValidationError as exc:
        doc.validation_errors(exc, prefix=(index,))
        return None


def load_labels_file(path: Path) -> LoadedLabels:
    """Load the labels file at ``path``. Each label is validated on its own, so one file can
    report several problems."""
    loaded = LoadedLabels()
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
    if len(documents) != 1:
        loaded.problems.append(f"{path}: give the labels in one YAML document")
        return loaded
    for node, data in documents:
        doc = _Document(str(path), node)
        _duplicate_keys(node, (), doc)
        if not isinstance(data, list):
            doc.problem((), "the labels file is a list of labels")
        elif not data:
            doc.problem((), "the labels file lists at least one label")
        else:
            keys: set[str] = set()
            for index, entry in enumerate(data):
                label = _load_entry(doc, index, entry)
                if label is None:
                    continue
                if label.key in keys:
                    doc.problem((index, "key"), f"duplicate label key {label.key}")
                else:
                    keys.add(label.key)
                    loaded.labels.append(label)
        loaded.problems.extend(doc.problems)
    return loaded


def labels_file_schema() -> dict[str, Any]:
    """A JSON Schema for the labels file, for ``yaml-language-server``."""
    schema: dict[str, Any] = TypeAdapter(list[Label]).json_schema()
    return {
        "$schema": JSON_SCHEMA_DIALECT,
        "title": "TIM labels file",
        **{k: v for k, v in schema.items() if k != "title"},
        "minItems": 1,
    }
