"""
Saved (Preferred) Answer Endpoints used by the extension.
The web app manages saved answers directly through Supabase.
"""

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.answers.classifier import classify_question
from src.app.answers.saved import invalidate_saved_answers, load_saved_answers
from src.app.answers.similarity import best_match
from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.schemas.answers import CreateSavedAnswerRequest, MatchSavedAnswerRequest, MatchSavedBatchRequest

router = APIRouter(prefix="/saved-answers", tags=["Saved answers"])


def _upstream(e: SupabaseError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach your saved answers: {e}")


@router.post("/match", summary="Find a saved answer for a similar question")
async def match_saved_answer(request: MatchSavedAnswerRequest, user: AuthUser = Depends(get_current_user),
                             rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    try:
        saved = await load_saved_answers(rest, user.id)
    except SupabaseError as e:
        raise _upstream(e) from e
    match, score = best_match(request.question, saved)
    return {"match": match, "score": score}


@router.post("/match-batch", summary="Find saved answers for several questions at once")
async def match_saved_batch(request: MatchSavedBatchRequest, user: AuthUser = Depends(get_current_user),
                            rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    try:
        saved = await load_saved_answers(rest, user.id)
    except SupabaseError as e:
        raise _upstream(e) from e
    results = []
    for item in request.items:
        match, score = best_match(item.question, saved)
        results.append({"id": item.id, "match": match, "score": score})
    return {"results": results}


@router.post("", status_code=status.HTTP_201_CREATED, summary="Save a preferred answer")
async def create_saved_answer(request: CreateSavedAnswerRequest, user: AuthUser = Depends(get_current_user),
                              rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    row = request.model_dump()
    row["category"] = row["category"] or classify_question(request.question).category
    try:
        saved = await rest.insert("saved_answers", row)
        invalidate_saved_answers(user.id)
        await rest.insert_many("usage_events", [{"kind": "save_answer", "category": row["category"]}])
    except SupabaseError as e:
        raise _upstream(e) from e
    return saved


@router.post("/{answer_id}/use", summary="Record that a saved answer was used")
async def use_saved_answer(answer_id: str, user: AuthUser = Depends(get_current_user),
                           rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    try:
        rows = await rest.select("saved_answers", {"id": f"eq.{answer_id}", "limit": "1"})
        if not rows:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved answer not found")
        row = rows[0]
        updated = await rest.update(
            "saved_answers",
            {"id": f"eq.{answer_id}"},
            {"use_count": row["use_count"] + 1, "last_used_at": datetime.now(timezone.utc).isoformat()},
        )
        invalidate_saved_answers(user.id)
        await rest.insert_many("usage_events", [{"kind": "use_saved_answer", "category": row.get("category")}])
    except SupabaseError as e:
        raise _upstream(e) from e
    return updated[0] if updated else row
