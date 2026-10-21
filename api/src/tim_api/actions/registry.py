"""The action registry: providers discovered through ``tim.actions`` and their action files,
validated at startup."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from importlib.metadata import entry_points
from importlib.resources.abc import Traversable

from pydantic import ValidationError
from tim_actions import ENTRY_POINT_GROUP, Action, Hook, Provider
from tim_actions.files import LoadedFiles, ReadFile, load_action_files

BUILTIN_DISTRIBUTION = "tim-actions"
RESERVED_PREFIX = "tim."


class ActionsConfigError(RuntimeError):
    """The installed providers can't make a valid instance; startup stops with every problem."""

    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__("Invalid actions:\n" + "\n".join(f"  - {p}" for p in problems))
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
    """Everything the providers and action files add, keyed as it is looked up, and every action
    file and sidecar read."""

    actions: dict[str, Action] = field(default_factory=dict)
    action_types: dict[str, type[Action]] = field(default_factory=dict)
    hooks: dict[str, type[Hook]] = field(default_factory=dict)
    packages: tuple[str, ...] = ()
    files: tuple[ReadFile, ...] = ()


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
        raise ActionsConfigError(problems)
    return loaded


def load_providers(providers: Sequence[Provider] | None) -> list[LoadedProvider]:
    """``providers``, named by position, or when ``None`` the discovered ones."""
    if providers is None:
        return discover_providers()
    return [LoadedProvider(f"providers[{i}]", p) for i, p in enumerate(providers)]


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


def build_registry(
    loaded: Sequence[LoadedProvider],
    actions_dir: Traversable | None = None,
    *,
    action_files: bool = True,
) -> Registry:
    """Check the providers against each other, load their action files and those in
    ``actions_dir``, and index what they add. ``action_files=False`` loads no files, for what
    needs only the action types."""
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

    found = [problem for problem in problems if problem]
    if found:
        raise ActionsConfigError(found)
    return Registry(
        actions={key: action for key, (action, _) in actions.items()},
        action_types=types,
        hooks={name: h for name, (h, _) in hooks.items()},
        packages=tuple(sorted({item.package for item in loaded if item.package})),
        files=tuple(files),
    )
