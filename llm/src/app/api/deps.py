"""
Shared Route Dependencies.
"""

from fastapi import Depends

from src.app.answers.engine import AnswerEngine
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.db.rest import SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.gateway import LLMGateway
from src.app.resume.pipeline import TailoringPipeline

_settings = get_settings()

gateway = LLMGateway(
    max_attempts=_settings.GATEWAY_MAX_ATTEMPTS,
    cooldown_seconds=_settings.GATEWAY_COOLDOWN_SECONDS,
)
answer_engine = AnswerEngine(gateway)
tailoring_pipeline = TailoringPipeline(gateway)


def get_rest(user: AuthUser = Depends(get_current_user)) -> SupabaseRest:
    """A Supabase client acting as the signed-in user (row-level security applies)."""
    return SupabaseRest(get_settings(), user.token)


def get_answer_engine() -> AnswerEngine:
    return answer_engine


def get_storage(user: AuthUser = Depends(get_current_user)) -> SupabaseStorage:
    """Supabase Storage acting as the signed-in user (bucket policies apply)."""
    return SupabaseStorage(get_settings(), user.token)


def get_gateway() -> LLMGateway:
    return gateway


def get_pipeline() -> TailoringPipeline:
    return tailoring_pipeline
