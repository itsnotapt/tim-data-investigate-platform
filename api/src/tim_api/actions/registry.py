"""The action registry: providers discovered through ``tim.actions``, their action files, the
connections file and the labels file, validated at startup."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from importlib.metadata import entry_points
from importlib.resources.abc import Traversable
from pathlib import Path

from pydantic import ValidationError
from tim_actions import ENTRY_POINT_GROUP, Action, Connection, Hook, Provider, dev
from tim_actions.connections_file import load_connections_file
from tim_actions.files import LoadedFiles, ReadFile, load_action_files
from tim_actions.labels_file import DEFAULT_LABELS, Label, load_labels_file

BUILTIN_DISTRIBUTION = "tim-actions"
RESERVED_PREFIX = "tim."


class InstanceConfigError(RuntimeError):
    """The installed providers, action files, connections file and labels file can't make a valid
    instance; startup stops with every problem."""

    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__("Invalid instance:\n" + "\n".join(f"  - {p}" for p in problems))
        self.problems = list(problems)


@dataclass(frozen=True)
class LoadedProvider:
    """A provider and where it came from: ``source`` names it in errors, ``package`` is its
    distribution as ``name==version``."""

    source: str
    provider: Provider
    builtin: bool = False
    package: str | None = None


@dataclass(frozen=True)
class Registry:
    """Everything the providers, action files, connections file and labels file add, keyed as it
    is looked up, and every file read.

    ``left_out`` says why each action left out of ``actions`` is: a connection param with no
    connection of its type.
    """

    actions: dict[str, Action] = field(default_factory=dict)
    action_types: dict[str, type[Action]] = field(default_factory=dict)
    hooks: dict[str, type[Hook]] = field(default_factory=dict)
    connections: dict[str, Connection] = field(default_factory=dict)
    labels: tuple[Label, ...] = DEFAULT_LABELS
    packages: tuple[str, ...] = ()
    files: tuple[ReadFile, ...] = ()
    left_out: tuple[str, ...] = ()


def _describe(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return "; ".join(
            f"{'.'.join(str(part) for part in err['loc']) or exc.title}: {err['msg']}"
            for err in exc.errors(include_url=False)
        )
    return f"{type(exc).__name__}: {exc}"


def discover_providers() -> list[LoadedProvider]:
    """Call every ``tim.actions`` entry point, in distribution and entry point name order."""
    problems: list[str] = []
    loaded: list[LoadedProvider] = []
    found = sorted(
        entry_points(group=ENTRY_POINT_GROUP),
        key=lambda ep: (ep.dist.name if ep.dist else "", ep.name),
    )
    for ep in found:
        dist_name = ep.dist.name if ep.dist else "unknown"
        dist_version = ep.dist.version if ep.dist else "unknown"
        source = f"entry point {ep.name} of {dist_name} {dist_version}"
        try:
            provider = ep.load()()
        except Exception as exc:
            problems.append(f"{source}: {_describe(exc)}")
            continue
        if not isinstance(provider, Provider):
            problems.append(f"{source}: returned {type(provider).__name__}, not a Provider")
            continue
        loaded.append(
            LoadedProvider(
                source,
                provider,
                builtin=dist_name == BUILTIN_DISTRIBUTION,
                package=f"{dist_name}=={dist_version}",
            )
        )
    if problems:
        raise InstanceConfigError(problems)
    return loaded


def load_providers(
    providers: Sequence[Provider] | None, *, dev_actions: bool = False
) -> list[LoadedProvider]:
    """``providers``, named by position, or when ``None`` the discovered ones; with
    ``dev_actions``, also the development actions, as built-ins (ADR-0011)."""
    if providers is None:
        loaded = discover_providers()
    else:
        loaded = [LoadedProvider(f"providers[{i}]", p) for i, p in enumerate(providers)]
    if dev_actions:
        loaded.append(LoadedProvider("development actions", dev.provider(), builtin=True))
    return loaded


def _revalidated(action: Action) -> Action:
    """The action validated again from its fields, which catches one built without
    validation (``model_construct``) or changed after it."""
    return type(action).model_validate(dict(action))


def _add[T](
    index: dict[str, tuple[T, str]], what: str, name: str, item: T, source: str
) -> str | None:
    """Index ``item`` under ``name``, or return the problem when the name is taken."""
    if name in index:
        return f"duplicate {what} {name}: {index[name][1]} and {source}"
    index[name] = (item, source)
    return None


def _add_file_actions(
    actions: dict[str, tuple[Action, str]], loaded: LoadedFiles, builtin: bool
) -> list[str]:
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


def _fixed_connection_problems(
    actions: Mapping[str, tuple[Action, str]], connections: Mapping[str, Connection]
) -> list[str]:
    """An action's fixed connection must be configured, and of the type the action expects."""
    problems: list[str] = []
    for key, (action, source) in actions.items():
        for name, connection_type in action.connections().items():
            connection = connections.get(name)
            if connection is None:
                problems.append(f"{source}: action {key}: no connection named {name}")
            elif connection.type != connection_type:
                problems.append(
                    f"{source}: action {key}: connection {name} is {connection.type}, not "
                    f"{connection_type}"
                )
    return problems


def _missing_choice(action: Action, connections: Mapping[str, Connection]) -> str | None:
    """Why ``action`` can't run on this instance: a connection param with no connection of its
    type, or ``None``."""
    types = {connection.type for connection in connections.values()}
    for param in action.params:
        if param.kind == "connection" and param.connection_type not in types:
            return (
                f"Action {action.key} left out: no {param.connection_type} connection for its "
                f"{param.name} param"
            )
    return None


def build_registry(
    loaded: Sequence[LoadedProvider],
    actions_dir: Traversable | None = None,
    *,
    action_files: bool = True,
    connections_file: Path | None = None,
    labels_file: Path | None = None,
) -> Registry:
    """Check the providers against each other, load their action files and those in
    ``actions_dir``, the connections file and the labels file, and index what they add.
    ``action_files=False`` loads no files, for what needs only the action types."""
    problems: list[str | None] = []
    actions: dict[str, tuple[Action, str]] = {}
    action_types: dict[str, tuple[type[Action], str]] = {}
    hooks: dict[str, tuple[type[Hook], str]] = {}

    for item in loaded:
        for action in item.provider.actions:
            key = getattr(action, "key", "?")
            try:
                action = _revalidated(action)
            except ValidationError as exc:
                problems.append(f"{item.source}: action {key}: {_describe(exc)}")
                continue
            if key.startswith(RESERVED_PREFIX) and not item.builtin:
                problems.append(
                    f"{item.source}: action {key}: the {RESERVED_PREFIX} prefix is reserved "
                    "for TIM's built-ins"
                )
            else:
                problems.append(_add(actions, "action key", key, action, item.source))
        for action_type in item.provider.action_types:
            name = action_type.type_name or ""
            problems.append(_add(action_types, "action type", name, action_type, item.source))
        for hook in item.provider.hooks:
            problems.append(_add(hooks, "connection type", hook.connection_type, hook, item.source))

    types = {name: t for name, (t, _) in action_types.items()}
    directories = [
        (item.provider.action_files, item.builtin)
        for item in loaded
        if item.provider.action_files is not None and action_files
    ]
    if actions_dir is not None and action_files:
        directories.append((actions_dir, False))
    files: list[ReadFile] = []
    for directory, builtin in directories:
        from_files = load_action_files(directory, types)
        problems.extend(_add_file_actions(actions, from_files, builtin))
        files.extend(from_files.files)

    installed = {name: h for name, (h, _) in hooks.items()}
    connections: dict[str, Connection] = {}
    if connections_file is not None and action_files:
        from_file = load_connections_file(connections_file, installed)
        problems.extend(from_file.problems)
        connections = from_file.connections
        files.extend(from_file.files)
    if action_files:
        problems.extend(_fixed_connection_problems(actions, connections))
    labels = DEFAULT_LABELS
    if labels_file is not None and action_files:
        from_labels = load_labels_file(labels_file)
        problems.extend(from_labels.problems)
        labels = tuple(from_labels.labels)
        files.extend(from_labels.files)

    found = [problem for problem in problems if problem]
    if found:
        raise InstanceConfigError(found)
    available: dict[str, Action] = {}
    left_out: list[str] = []
    for key, (action, _) in actions.items():
        reason = _missing_choice(action, connections)
        if reason is None:
            available[key] = action
        else:
            left_out.append(reason)
    return Registry(
        actions=available,
        action_types=types,
        hooks=installed,
        connections=connections,
        labels=labels,
        packages=tuple(sorted({item.package for item in loaded if item.package})),
        files=tuple(files),
        left_out=tuple(left_out),
    )
