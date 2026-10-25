"""FastAPI dependencies exposing the storage wired in the app lifespan."""

from __future__ import annotations

from fastapi import Request

from tim_api.storage import (
    AnnotationStore,
    ColumnViewStore,
    PresetStore,
    QueryRunStore,
    RunStore,
    Storage,
)


def get_storage(request: Request) -> Storage:
    storage: Storage = request.app.state.storage
    return storage


def get_query_run_store(request: Request) -> QueryRunStore:
    return get_storage(request).query_runs


def get_run_store(request: Request) -> RunStore:
    return get_storage(request).runs


def get_preset_store(request: Request) -> PresetStore:
    return get_storage(request).presets


def get_column_view_store(request: Request) -> ColumnViewStore:
    return get_storage(request).column_views


def get_annotation_store(request: Request) -> AnnotationStore:
    return get_storage(request).annotations
