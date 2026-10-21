"""Building the instance description served by ``GET /api/instance``."""

from __future__ import annotations

import hashlib
import json

from tim_actions import Action, Param

from tim_api.actions.models import (
    CatalogueAction,
    CatalogueParam,
    CataloguePivot,
    Instance,
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
    )


def build_instance(registry: Registry, settings: Settings) -> Instance:
    unversioned = Instance(
        version="",
        actions=[_action(action) for action in registry.actions.values()],
        connections=[],
        labels=[],
        limits=Limits(
            max_result_rows=settings.max_result_rows,
            max_result_bytes=settings.max_result_bytes,
            rows_page_size=settings.rows_page_size,
            run_timeout_seconds=settings.run_timeout_seconds,
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
