import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Response, status

from tim_api.auth.obo import build_obo_provider
from tim_api.config import get_settings
from tim_api.deps import get_storage
from tim_api.errors import register_exception_handlers
from tim_api.kusto.router import router as kusto_router
from tim_api.observability import LazyCORSMiddleware, RequestLoggingMiddleware, configure_logging
from tim_api.openapi_meta import install_openapi
from tim_api.query_runs.router import router as query_runs_router
from tim_api.query_runs.runner import cancel_tasks, mark_stale_runs
from tim_api.storage import Storage, StorageUnavailableError, build_storage, start_retention_loop
from tim_api.tagged_events.router import router as tagged_events_router
from tim_api.templates.router import router as templates_router

logger = logging.getLogger("tim_api")


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Loading settings here makes startup fail fast on invalid config, including
    # TIM_AUTH_DISABLED=true with TIM_ENVIRONMENT=production.
    settings = get_settings()
    configure_logging(settings.log_level)
    if settings.auth_disabled:
        logger.warning(
            "*** AUTHENTICATION IS DISABLED (TIM_AUTH_DISABLED=true): every request runs as a "
            "fixed dev user. Development only. ***"
        )
    # Fails fast when auth is enabled but no OBO client credential is configured.
    app.state.obo_provider = build_obo_provider(settings)
    storage = build_storage(settings)
    app.state.storage = storage
    app.state.run_tasks = set()
    await mark_stale_runs(storage.runs, settings)  # BUG-02
    stop_retention = start_retention_loop(storage, settings.run_retention_sweep_seconds)
    try:
        yield
    finally:
        await stop_retention()
        await cancel_tasks(app.state.run_tasks)
        await storage.aclose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="TIM API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=_lifespan,
    )

    @app.get("/api/healthChecks/liveness", status_code=status.HTTP_204_NO_CONTENT)
    def liveness() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/healthChecks/readiness", status_code=status.HTTP_204_NO_CONTENT)
    async def readiness(storage: Annotated[Storage, Depends(get_storage)]) -> Response:
        # Store only; Kusto reachability is deliberately not part of readiness (contract 3.14).
        try:
            healthy = await storage.health()
        except Exception:
            logger.warning("Readiness: storage health check raised", exc_info=True)
            healthy = False
        if not healthy:
            raise StorageUnavailableError("storage health check failed")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    app.include_router(tagged_events_router)
    app.include_router(kusto_router)
    app.include_router(query_runs_router)
    app.include_router(templates_router)
    register_exception_handlers(app)
    install_openapi(app)
    # Added last = outermost: CORS wraps logging so even error responses carry CORS headers.
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(LazyCORSMiddleware)

    return app


app = create_app()
