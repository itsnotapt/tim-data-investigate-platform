import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Response, status
from tim_actions import Provider

from tim_api.actions import build_instance, build_registry, load_providers
from tim_api.actions.router import router as instance_router
from tim_api.annotations.router import router as annotations_router
from tim_api.annotations.router import tags_router
from tim_api.auth.obo import build_obo_provider
from tim_api.column_views.router import router as column_views_router
from tim_api.config import Settings, get_settings
from tim_api.connections.router import router as connections_router
from tim_api.deps import get_storage
from tim_api.errors import register_exception_handlers
from tim_api.observability import (
    BodySizeLimitMiddleware,
    LazyCORSMiddleware,
    RequestLoggingMiddleware,
    configure_logging,
)
from tim_api.openapi_meta import install_openapi
from tim_api.presets.router import router as presets_router
from tim_api.runs.connections import Connections
from tim_api.runs.router import router as runs_router
from tim_api.runs.runner import RACE_SECONDS, Runner
from tim_api.storage import Storage, StorageUnavailableError, build_storage, start_retention_loop

logger = logging.getLogger("tim_api")


StorageFactory = Callable[[Settings], Storage]


@asynccontextmanager
async def _lifespan(
    app: FastAPI, storage_factory: StorageFactory, providers: Sequence[Provider] | None
) -> AsyncIterator[None]:
    # Loading settings here makes startup fail fast on invalid config, including
    # TIM_AUTH_DISABLED=true with TIM_ENVIRONMENT=production.
    settings = get_settings()
    configure_logging(settings.log_level)
    if settings.auth_disabled:
        logger.warning(
            "*** AUTHENTICATION IS DISABLED (TIM_AUTH_DISABLED=true): every request runs as the "
            "analyst its stub token (dev:<upn>) names, or a fixed dev user. Development only. ***"
        )
    # Any problem with the installed providers, the action files, the connections file or the
    # labels file stops startup (ADR-0017, ADR-0018, ADR-0020).
    if settings.dev_actions:
        logger.warning(
            "Development actions are registered (TIM_DEV_ACTIONS=true). Development only."
        )
    registry = build_registry(
        load_providers(providers, dev_actions=settings.dev_actions),
        settings.actions_dir,
        connections_file=settings.connections_file,
        labels_file=settings.labels_file,
    )
    for reason in registry.left_out:
        logger.info(reason)
    app.state.instance = build_instance(registry, settings)
    app.state.actions = registry.actions
    app.state.connections = Connections(registry.connections, registry.hooks)
    # Fails fast when auth is enabled, a connection uses obo and no OBO client credential is
    # configured.
    app.state.obo_provider = build_obo_provider(
        settings,
        credential_required=any(c.obo_scope for c in registry.connections.values()),
    )
    storage = storage_factory(settings)
    app.state.storage = storage
    runner = Runner(
        storage.runs,
        settings,
        slots=asyncio.Semaphore(settings.max_concurrent_runs),
        race_seconds=app.state.race_seconds,
    )
    app.state.runner = runner
    await runner.mark_stale()
    runner.start_watching()
    stop_retention = start_retention_loop(storage, settings.run_retention_sweep_seconds)
    try:
        yield
    finally:
        await stop_retention()
        await runner.aclose()
        await storage.aclose()


def create_app(
    *,
    storage_factory: StorageFactory = build_storage,
    race_seconds: float = RACE_SECONDS,
    providers: Sequence[Provider] | None = None,
) -> FastAPI:
    """Build the app. ``storage_factory`` and ``race_seconds`` default to production behaviour.

    ``providers`` replaces discovery through the ``tim.actions`` entry points.
    """
    app = FastAPI(
        title="TIM API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lambda app: _lifespan(app, storage_factory, providers),
    )

    app.state.race_seconds = race_seconds

    @app.get("/api/healthChecks/liveness", status_code=status.HTTP_204_NO_CONTENT)
    def liveness() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/healthChecks/readiness", status_code=status.HTTP_204_NO_CONTENT)
    async def readiness(storage: Annotated[Storage, Depends(get_storage)]) -> Response:
        # Store only; Kusto reachability is deliberately not part of readiness.
        try:
            healthy = await storage.health()
        except Exception:
            logger.warning("Readiness: storage health check raised", exc_info=True)
            healthy = False
        if not healthy:
            raise StorageUnavailableError("storage health check failed")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    app.include_router(instance_router)
    app.include_router(annotations_router)
    app.include_router(tags_router)
    app.include_router(column_views_router)
    app.include_router(connections_router)
    app.include_router(presets_router)
    app.include_router(runs_router)
    register_exception_handlers(app)
    install_openapi(app)
    # Added last = outermost: CORS wraps logging so even error responses carry CORS headers.
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(LazyCORSMiddleware)

    return app


app = create_app()
