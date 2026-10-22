"""Building the instance description served by ``GET /api/instance``."""

from __future__ import annotations

import hashlib
import json

from tim_actions import Action, Column, Connection, Hook, Param
from tim_actions.labels_file import Label

from tim_api.actions.models import (
    CatalogueAction,
    CatalogueColumn,
    CatalogueParam,
    CataloguePivot,
    Instance,
    InstanceConnection,
    InstanceLabel,
    Limits,
)
from tim_api.actions.registry import Registry
from tim_api.config import Settings


def _param(param: Param) -> CatalogueParam:
    return CatalogueParam(
        name=param.name,
        title=param.title or param.name,
        kind=param.kind,
        required=param.required,
        default=param.default,
        many=param.many,
        choices=list(param.choices) or None,
        connection_type=param.connection_type,
        from_columns=list(param.from_columns) or None,
        schema_from=list(param.schema_from) or None,
        help=param.help,
    )


def _column(column: Column) -> CatalogueColumn:
    return CatalogueColumn(
        name=column.name,
        type=column.type,
        title=column.title,
        hidden=column.hidden,
        width=column.width,
        pinned=column.pinned,
        sort=column.sort,
        group=column.group,
        calculated=column.calculated,
    )


def _action(action: Action) -> CatalogueAction:
    pivot = (
        None
        if action.pivot == "none"
        else CataloguePivot(rows=action.pivot, columns=action.pivot_columns())
    )
    return CatalogueAction(
        key=action.key,
        kind="query",
        name=action.name,
        description=action.description,
        menu_path=action.menu_path,
        connections=list(action.connections()),
        params=[_param(param) for param in action.params],
        pivot=pivot,
        columns=None if action.columns is None else [_column(c) for c in action.columns],
    )


def _connection(connection: Connection, hook: type[Hook]) -> InstanceConnection:
    databases = connection.database_suggestions()
    return InstanceConnection(
        name=connection.name,
        type=connection.type,
        title=connection.title,
        editor=hook.editor,
        databases=None if databases is None else list(databases),
    )


def _label(label: Label) -> InstanceLabel:
    return InstanceLabel(key=label.key, name=label.name, colour=label.colour, symbol=label.symbol)


def build_instance(registry: Registry, settings: Settings) -> Instance:
    unversioned = Instance(
        version="",
        actions=[_action(action) for action in registry.actions.values()],
        connections=[_connection(c, registry.hooks[c.type]) for c in registry.connections.values()],
        labels=[_label(label) for label in registry.labels],
        limits=Limits(
            max_result_rows=settings.max_result_rows,
            max_result_bytes=settings.max_result_bytes,
            rows_page_size=settings.rows_page_size,
            run_timeout_seconds=settings.run_timeout_seconds,
            max_annotation_ids=settings.max_annotation_ids,
            annotation_poll_seconds=settings.annotation_poll_seconds,
        ),
    )
    content = json.dumps(
        [
            registry.packages,
            [(file.name, file.sha256) for file in registry.files],
            unversioned.model_dump(mode="json"),
        ],
        sort_keys=True,
    ).encode()
    return unversioned.model_copy(update={"version": hashlib.sha256(content).hexdigest()[:16]})
