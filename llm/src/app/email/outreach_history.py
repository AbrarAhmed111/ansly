"""Shared recipient and role matching for successful outreach sent through Gmail."""

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence

from src.app.db.rest import SupabaseRest
from src.app.schemas.outreach_history import PreviousContact

STALE_SEND_AFTER = timedelta(minutes=5)


@dataclass(frozen=True)
class OutreachCandidate:
    email: str
    role_title: str
    company_name: Optional[str] = None


def normalize_email(value: str) -> str:
    return value.strip().casefold()


def normalize_company(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\b(?:incorporated|inc|limited|ltd|llc|corp|corporation|company|co)\b", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or None


def normalize_role(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"\bfull[\s-]*stack\b", "fullstack", normalized)
    normalized = re.sub(r"\bnode[\s.-]*js\b", "nodejs", normalized)
    normalized = re.sub(r"\barchitect[\s-]+level\b", " ", normalized)
    normalized = re.sub(
        r"\b(?:senior|sr|junior|jr|lead|principal|staff|mid(?:dle)?|associate|"
        r"developer|development|engineer|engineering|software|level)\b",
        " ",
        normalized,
    )
    normalized = re.sub(r"[^a-z0-9+#]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or "general"


def roles_match(first: Optional[str], second: Optional[str], *, strict: bool = False) -> bool:
    first_role, second_role = normalize_role(first), normalize_role(second)
    if not first_role or not second_role:
        return False
    if first_role == second_role:
        return True
    left, right = set(first_role.split()), set(second_role.split())
    overlap = len(left & right) / len(left | right)
    threshold = 0.82 if strict else 0.6
    return overlap >= threshold


def candidates_match(candidate: OutreachCandidate, history: Dict[str, object]) -> bool:
    previous_company = normalize_company(str(history.get("company_name") or ""))
    candidate_company = normalize_company(candidate.company_name)
    if previous_company and candidate_company and previous_company != candidate_company:
        return False
    return roles_match(
        candidate.role_title,
        str(history.get("role_title") or ""),
        strict=not (previous_company and candidate_company),
    )


def _in_filter(values: Iterable[str]) -> str:
    return "in.(" + ",".join(sorted(set(values))) + ")"


async def find_previous_contacts(
    rest: SupabaseRest,
    candidates: Sequence[OutreachCandidate],
) -> Dict[str, List[PreviousContact]]:
    """Return all successful, same-recipient and equivalent-role matches, grouped by candidate email."""
    email_keys = {normalize_email(item.email) for item in candidates if item.email}
    if not email_keys:
        return {}
    rows = await rest.select("outreach_contact_history", {
        "normalized_email": _in_filter(email_keys),
        "status": "eq.sent",
        "order": "sent_at.desc",
        "limit": "1000",
    })
    matches: Dict[str, List[PreviousContact]] = {key: [] for key in email_keys}
    seen = set()
    for candidate in candidates:
        key = normalize_email(candidate.email)
        for row in rows:
            if row.get("normalized_email") != key or not candidates_match(candidate, row):
                continue
            dedupe_key = (key, str(row.get("id") or row.get("email_send_attempt_id")), row.get("source"))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            matches[key].append(PreviousContact(
                history_id=str(row.get("id")) if row.get("id") else None,
                recipient_email=str(row.get("recipient_email") or candidate.email),
                role_title=str(row.get("role_title") or ""),
                company_name=row.get("company_name"),
                source=str(row.get("source") or ""),
                sent_at=str(row["sent_at"]) if row.get("sent_at") else None,
            ))
    return matches


async def find_in_progress_contacts(
    rest: SupabaseRest,
    candidates: Sequence[OutreachCandidate],
) -> List[Dict[str, object]]:
    email_keys = {normalize_email(item.email) for item in candidates if item.email}
    if not email_keys:
        return []
    rows = await rest.select("outreach_contact_history", {
        "normalized_email": _in_filter(email_keys),
        "status": "in.(sending,outcome_unknown)",
        "order": "created_at.desc",
        "limit": "1000",
    })
    matching = [
        row for candidate in candidates for row in rows
        if row.get("normalized_email") == normalize_email(candidate.email)
        and candidates_match(candidate, row)
    ]
    stale_before = datetime.now(timezone.utc) - STALE_SEND_AFTER
    for row in matching:
        if row.get("status") != "sending" or not row.get("created_at"):
            continue
        started = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
        if started < stale_before:
            await rest.update(
                "outreach_contact_history",
                {"id": f"eq.{row['id']}", "status": "eq.sending"},
                {"status": "outcome_unknown"},
            )
            row["status"] = "outcome_unknown"
    return matching
