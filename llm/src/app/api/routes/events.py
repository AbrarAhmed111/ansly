"""
Usage Event Endpoint (analytics from the extension).
Events carry only a kind and a question category — never question or answer text.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.app.api.deps import get_rest
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.schemas.answers import TrackEventRequest

router = APIRouter(prefix="/events", tags=["Events"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT, summary="Record a usage event")
async def track_event(request: TrackEventRequest, rest: SupabaseRest = Depends(get_rest)) -> Response:
    try:
        event = {"kind": request.kind, "category": request.category}
        # Only "fill" carries these: the user's wait for the answer, and whether they edited it before filling.
        if request.kind == "fill":
            if request.duration_ms is not None:
                event["duration_ms"] = request.duration_ms
            if request.edited is not None:
                event["edited"] = request.edited
        await rest.insert("usage_events", event)
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not record event: {e}") from e
    return Response(status_code=status.HTTP_204_NO_CONTENT)
