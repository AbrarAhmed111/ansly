"""
FastAPI Application Entrypoint.
Initializes FastAPI, configures CORS, and mounts API routes.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.app.api.router import api_router
from src.app.api.routes.health import router as health_router
from src.app.core import llm_usage, metrics
from src.app.core.config import get_settings
from src.app.core.http import close_shared_client
from src.app.core.logging import setup_logging

settings = get_settings()
setup_logging(settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await close_shared_client()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Ansly answer engine: grounded answers to job application questions from the user's profile.",
    lifespan=lifespan,
)


def _safe_error_text(value: Any) -> Any:
    if isinstance(value, str):
        return value.encode("utf-8", errors="replace").decode("utf-8")
    if isinstance(value, list):
        return [_safe_error_text(item) for item in value]
    if isinstance(value, dict):
        return {
            _safe_error_text(key): _safe_error_text(item)
            for key, item in value.items()
            if key != "input"
        }
    return value


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Keep malformed Unicode in validation input from breaking the 422 response itself."""
    return JSONResponse(
        status_code=422,
        content={"detail": _safe_error_text(jsonable_encoder(exc.errors()))},
    )


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    """Collects the request's LLM calls (core/llm_usage.py) and logs one timing line per API request (see
    core/metrics.py). The request id ties the line, the llm_calls rows and the X-Request-Id header together."""
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    request_metrics = metrics.start_request()
    llm_usage.start_collecting()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-Id"] = request_metrics.request_id
        return response
    finally:
        if settings.PERF_LOG:
            route = request.scope.get("route")
            path = getattr(route, "path", request.url.path)
            metrics.logger.info(request_metrics.summary(f"{request.method} {path}", status))

# -----------------------------------------------------------------------------
# CORS Middleware
# The extension calls the API from its background service worker, which is not
# subject to CORS; this list is for browser pages such as the web app.
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# Mount root health check (e.g. for container health checks)
app.include_router(health_router)

# Mount versioned API routes under /api/v1
app.include_router(api_router)


@app.get("/", summary="Root index")
async def root():
    """Returns basic service status and documentation link."""
    return {
        "service": settings.APP_NAME,
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "health": "/health",
            "generate": "/api/v1/answers/generate",
            "regenerate": "/api/v1/answers/regenerate",
            "generate_batch": "/api/v1/answers/generate-batch",
            "match_saved_answer": "/api/v1/saved-answers/match",
            "match_saved_batch": "/api/v1/saved-answers/match-batch",
            "save_missing": "/api/v1/profile/missing",
            "save_answer": "/api/v1/saved-answers",
            "events": "/api/v1/events",
        },
    }
