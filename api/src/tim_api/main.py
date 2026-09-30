import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status

from tim_api.config import get_settings

logger = logging.getLogger("tim_api")


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Loading settings here makes startup fail fast on invalid config, including
    # TIM_AUTH_DISABLED=true with TIM_ENVIRONMENT=production.
    settings = get_settings()
    if settings.auth_disabled:
        logger.warning(
            "*** AUTHENTICATION IS DISABLED (TIM_AUTH_DISABLED=true): every request runs as a "
            "fixed dev user. Development only. ***"
        )
    yield


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
    def readiness() -> Response:
        # TODO: check the database connection once storage exists
        # (legacy never probed dependencies).
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return app


app = create_app()
