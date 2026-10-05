"""
Central API Router.
Mounts versioned domain routes under /api/v1.
"""

from fastapi import APIRouter

from src.app.api.routes.answers import router as answers_router
from src.app.api.routes.events import router as events_router
from src.app.api.routes.jobs import router as jobs_router
from src.app.api.routes.memory import router as memory_router
from src.app.api.routes.profile import router as profile_router
from src.app.api.routes.resumes import router as resumes_router
from src.app.api.routes.saved_answers import router as saved_answers_router
from src.app.api.routes.tailorings import router as tailorings_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(answers_router)
api_router.include_router(saved_answers_router)
api_router.include_router(events_router)
api_router.include_router(profile_router)
api_router.include_router(memory_router)
api_router.include_router(resumes_router)
api_router.include_router(jobs_router)
api_router.include_router(tailorings_router)
