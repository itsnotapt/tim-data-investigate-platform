"""FastAPI dependencies exposing the storage wired in the app lifespan."""

from __future__ import annotations

from fastapi import Request

from tim_api.storage import (
    PostgresAnnotationStore,
    PostgresColumnViewStore,
    PostgresPresetStore,
    PostgresRunStore,
    PostgresStorage,
)


def get_storage(request: Request) -> PostgresStorage:
    storage: PostgresStorage = request.app.state.storage
    return storage


def get_run_store(request: Request) -> PostgresRunStore:
    return get_storage(request).runs


def get_preset_store(request: Request) -> PostgresPresetStore:
    return get_storage(request).presets


def get_column_view_store(request: Request) -> PostgresColumnViewStore:
    return get_storage(request).column_views


def get_annotation_store(request: Request) -> PostgresAnnotationStore:
    return get_storage(request).annotations
