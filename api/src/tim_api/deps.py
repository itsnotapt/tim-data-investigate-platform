"""FastAPI dependencies exposing the storage wired in the app lifespan."""

from __future__ import annotations

from fastapi import Request

from tim_api.storage import PresetStore, QueryRunStore, RunStore, Storage, TemplateStore


def get_storage(request: Request) -> Storage:
    storage: Storage = request.app.state.storage
    return storage


def get_template_store(request: Request) -> TemplateStore:
    return get_storage(request).templates


def get_query_run_store(request: Request) -> QueryRunStore:
    return get_storage(request).query_runs


def get_run_store(request: Request) -> RunStore:
    return get_storage(request).runs


def get_preset_store(request: Request) -> PresetStore:
    return get_storage(request).presets
