"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from coach_api.config import get_settings
from coach_api.infrastructure.auth import (
    auth_backend,
    fastapi_users,
)
from coach_api.infrastructure.security import install_security
from coach_api.interfaces.routers import router as api_router
from coach_api.interfaces.schemas import UserCreate, UserRead, UserUpdate
from coach_api.logging_config import configure_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Coach Assistant API",
        version="0.1.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        # We sit behind Caddy at /api/* — tell FastAPI so generated URLs
        # (e.g. the Swagger UI's reference to openapi.json) include the prefix.
        root_path="/api",
        lifespan=lifespan,
    )

    install_security(app)

    # Auth routes — only login. Self-registration is intentionally disabled;
    # admins create accounts through /admin/users.
    app.include_router(
        fastapi_users.get_auth_router(auth_backend),
        prefix="/auth/jwt",
        tags=["auth"],
    )
    app.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix="/users",
        tags=["users"],
    )

    # Domain routes
    app.include_router(api_router, prefix="", tags=["coach-assistant"])

    # ---- Diagnostic exception handler ----
    # Until we have full Sentry integration, surface the actual exception
    # type & message in the response body for any uncaught 500. This makes
    # it trivial to diagnose problems from the browser/chat UI instead of
    # having to dig through container logs every time.
    import logging
    import traceback

    @app.exception_handler(Exception)
    async def _diag_exception_handler(request: Request, exc: Exception):
        logging.getLogger("coach_api.unhandled").exception(
            "Unhandled exception on %s %s", request.method, request.url.path
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": (
                    f"{type(exc).__name__}: {exc}"
                    if str(exc)
                    else type(exc).__name__
                ),
                "path": request.url.path,
                "trace": traceback.format_exception_only(type(exc), exc),
            },
        )

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
