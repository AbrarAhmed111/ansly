"""
FastAPI Application Entrypoint.
Initializes FastAPI, configures CORS, and mounts API routes.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from src.app.api.router import api_router
from src.app.api.routes.health import router as health_router
from src.app.core import metrics
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


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    """Logs one timing line per API request (see core/metrics.py)."""
    if not settings.PERF_LOG or not request.url.path.startswith("/api/"):
        return await call_next(request)
    request_metrics = metrics.start_request()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
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
