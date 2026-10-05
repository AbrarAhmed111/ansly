"""
Application Memory Service.

The one place that decides which learned fact applies to an application, how
it ranks against the structured profile, when two sources disagree, and how
facts are saved, edited and removed. Endpoints and the answer engine call
these helpers; none of them re-implement the rules.

Resolution precedence for a keyed fact (first match wins):

1. memory scoped to this job        (the user said it for this application)
2. memory scoped to this company
3. the structured profile column     (the user's explicit, current profile)
4. global / preference memory        (learned earlier, still active)

Then, for everything else, skills and experience evidence, saved answers and
finally generation. Only explicit user input becomes memory; generated
answers never do. Facts the profile has since changed are 'superseded' (a DB
trigger, so web edits count too) and never answer again.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.app.db.rest import SupabaseRest

from .keys import FACT_KEYS, answer_value, display, label_for, normalize_value

ACTIVE = "active"
# Narrower scopes answer first.
_SPECIFICITY = {"job": 0, "company": 1, "category": 2, "global": 2}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(text: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def is_active(row: Dict[str, Any]) -> bool:
    return (row.get("status") or ACTIVE) == ACTIVE


def applies_to(row: Dict[str, Any], company: Optional[str], job_key: Optional[str]) -> bool:
    """Whether a fact counts for an application to `company` (job `job_key`)."""
    scope = row.get("scope") or "global"
    if scope == "job":
        return bool(job_key) and row.get("job_key") == job_key
    if scope == "company":
        return bool(_norm(company)) and _norm(row.get("company")) == _norm(company)
    return True


def scope_facts(facts: List[Dict[str, Any]], company: Optional[str] = None,
                job_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """The active facts that apply to this application, most specific first, newest first within a scope.
    Facts for another job or company are dropped: they must never leak into this application."""
    kept = [f for f in facts if is_active(f) and applies_to(f, company, job_key)]
    kept.sort(key=lambda f: str(f.get("updated_at") or ""), reverse=True)
    kept.sort(key=lambda f: _SPECIFICITY.get(f.get("scope") or "global", 2))
    return kept


@dataclass
class Resolved:
    key: str
    # In the form the answer engine compares (bool for yes/no, a work-mode code, else text).
    value: Any
    # As the user reads it.
    text: str
    # job_memory | company_memory | profile | memory
    source: str
    row: Optional[Dict[str, Any]] = None

    @property
    def from_memory(self) -> bool:
        return self.source != "profile"


def resolve_fact(key: str, profile: Optional[Dict[str, Any]], facts: List[Dict[str, Any]]) -> Optional[Resolved]:
    """The value for `key` by the precedence above. `facts` must already be scoped (scope_facts)."""
    spec = FACT_KEYS.get(key)
    rows = [f for f in facts if f.get("key") == key and is_active(f) and str(f.get("answer") or "").strip()]

    def from_row(row: Dict[str, Any], source: str) -> Resolved:
        text = str(row["answer"]).strip()
        return Resolved(key, answer_value(key, text), text, source, row)

    for scope, source in (("job", "job_memory"), ("company", "company_memory")):
        hit = next((r for r in rows if r.get("scope") == scope), None)
        if hit:
            return from_row(hit, source)
    if spec and spec.profile_field and profile:
        value = profile.get(spec.profile_field)
        if value not in (None, ""):
            return Resolved(key, value, display(key, value), "profile")
    hit = next((r for r in rows if (r.get("scope") or "global") in ("global", "category")), None)
    return from_row(hit, "memory") if hit else None


@dataclass
class Conflict:
    key: str
    label: str
    # The value that answers (the rule's choice) and the one it overrides.
    winner: str
    winner_source: str
    other: str
    other_source: str
    other_id: Optional[str]
    rule: str


def _same(key: str, a: Any, b: Any) -> bool:
    return _norm(display(key, a)) == _norm(display(key, b))


def _skill_norm(name: Any) -> str:
    return re.sub(r"[^a-z0-9+#]+", "", str(name or "").lower().replace(".js", "js"))


def skill_conflicts(skills: List[Dict[str, Any]], experiences: List[Dict[str, Any]],
                    projects: List[Dict[str, Any]]) -> List[Conflict]:
    """A skill the user said they don't have ("I don't have this") that their own experience or projects list. The
    profile evidence wins: answers already treat the skill as present, so the "No" is the stale part."""
    out: List[Conflict] = []
    sources = [(f"{r.get('title')} at {r.get('company')}", r) for r in experiences] + \
              [(str(r.get("name") or "a project"), r) for r in projects]
    for skill in skills:
        if skill.get("level") != "none":
            continue
        name = _skill_norm(skill.get("name"))
        where = next((label for label, row in sources
                      if name and any(_skill_norm(t) == name for t in (row.get("technologies") or []))), None)
        if where:
            out.append(Conflict(f"skill:{name}", str(skill.get("name")), f"Used at {where}", "profile",
                                "You said you don't have it", "memory", f"skill:{skill.get('id')}",
                                "Your experience is used: it lists this skill."))
    return out


def find_conflicts(profile: Optional[Dict[str, Any]], facts: List[Dict[str, Any]],
                   skills: Optional[List[Dict[str, Any]]] = None, experiences: Optional[List[Dict[str, Any]]] = None,
                   projects: Optional[List[Dict[str, Any]]] = None) -> List[Conflict]:
    """Active global/preference memory that disagrees with the profile (the profile wins), or with newer memory
    for the same fact (the newer one wins); and skills declined but listed in the profile's own work. Job and
    company facts are exceptions by design, not conflicts."""
    out: List[Conflict] = skill_conflicts(skills or [], experiences or [], projects or [])
    wide = [f for f in facts if is_active(f) and f.get("key") in FACT_KEYS
            and (f.get("scope") or "global") in ("global", "category")]
    wide.sort(key=lambda f: str(f.get("updated_at") or ""), reverse=True)
    seen: Dict[str, Dict[str, Any]] = {}
    for row in wide:
        key = row["key"]
        spec = FACT_KEYS[key]
        text = str(row.get("answer") or "")
        value = profile.get(spec.profile_field) if profile and spec.profile_field else None
        if value not in (None, "") and not _same(key, answer_value(key, text), value):
            out.append(Conflict(key, spec.label, display(key, value), "profile", text, "memory", row.get("id"),
                                "Your profile is used: it always wins over older Application Memory."))
            continue
        newer = seen.get(key)
        if newer is not None and not _same(key, newer.get("answer"), text):
            out.append(Conflict(key, spec.label, str(newer.get("answer")), "memory", text, "memory", row.get("id"),
                                "The most recently confirmed answer is used."))
        seen.setdefault(key, row)
    return out


def is_stale(row: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """A drifting preference nobody confirmed for a while (see FactKey.stale_days). Stable facts never are."""
    spec = FACT_KEYS.get(row.get("key") or "")
    if spec is None or spec.stale_days is None or not is_active(row):
        return False
    stamp = row.get("last_confirmed_at") or row.get("updated_at") or row.get("created_at")
    try:
        when = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (now or datetime.now(timezone.utc)) - when > timedelta(days=spec.stale_days)


# --- writes ----------------------------------------------------------------------------------------------------

async def save_fact(
    rest: SupabaseRest,
    *,
    value: Any,
    key: Optional[str] = None,
    prompt: Optional[str] = None,
    category: Optional[str] = None,
    scope: str = "global",
    company: Optional[str] = None,
    job_key: Optional[str] = None,
    source_type: str = "ask_and_learn",
    source_label: Optional[str] = None,
    existing: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Saves what the user explicitly told Ansly. Saving a fact it already has for the same scope updates that
    row (and re-confirms it) instead of adding a duplicate. `existing`: the user's facts, when already loaded."""
    text = normalize_value(key, value)
    if not text:
        raise ValueError("Expected a non-empty answer")
    spec = FACT_KEYS.get(key or "")
    scope = scope if scope in _SPECIFICITY else "global"
    company = (company or "").strip()[:200] or None
    if scope == "company" and not company:
        scope = "category" if spec and spec.default_scope == "category" else "global"
    if scope == "job" and not job_key:
        scope = "global"
    row = {
        "key": key,
        "category": (category or (spec.group if spec else None) or "general")[:50],
        "prompt": (label_for(key, prompt) or text)[:1000],
        "answer": text[:5000],
        "value_type": spec.input if spec and spec.input in ("text", "boolean", "number", "choice") else "text",
        "scope": scope,
        "company": company if scope == "company" else None,
        "job_key": job_key if scope == "job" else None,
        "source": "extension" if source_type == "ask_and_learn" else "web",
        "source_type": source_type,
        "source_label": (source_label or "")[:300] or None,
        "confirmed": True,
        "status": ACTIVE,
        "last_confirmed_at": now_iso(),
    }
    rows = existing if existing is not None else await rest.select("profile_facts", {"limit": "500"})
    match = next((r for r in rows if is_active(r) and (r.get("scope") or "global") == scope
                  and r.get("job_key") == row["job_key"] and _norm(r.get("company")) == _norm(row["company"])
                  and ((key and r.get("key") == key)
                       or (not key and not r.get("key") and _norm(r.get("prompt")) == _norm(row["prompt"])))), None)
    if match is not None:
        updated = await rest.update("profile_facts", {"id": f"eq.{match['id']}"}, row)
        saved = updated[0] if updated else {**match, **row}
        if existing is not None:
            existing[existing.index(match)] = saved
        return saved
    saved = await rest.insert("profile_facts", row)
    if existing is not None:
        existing.append(saved)
    return saved


async def supersede(rest: SupabaseRest, key: str, facts: List[Dict[str, Any]]) -> None:
    """Retires global/preference memory for `key` after the profile took the fact over (the DB trigger does the
    same for edits made elsewhere; this keeps the API's own view consistent)."""
    for row in facts:
        if row.get("key") == key and is_active(row) and (row.get("scope") or "global") in ("global", "category"):
            await rest.update("profile_facts", {"id": f"eq.{row['id']}"}, {"status": "superseded"})
            row["status"] = "superseded"


async def update_fact(rest: SupabaseRest, fact: Dict[str, Any], changes: Dict[str, Any]) -> Dict[str, Any]:
    """Applies an edit from the memory page or a popover. The user is confirming it, so it's re-confirmed."""
    values: Dict[str, Any] = {}
    key = fact.get("key")
    if "value" in changes and changes["value"] is not None:
        text = normalize_value(key, changes["value"])
        if not text:
            raise ValueError("Expected a non-empty answer")
        values["answer"] = text[:5000]
        values["source_type"] = "memory_edit"
    if changes.get("scope"):
        scope = changes["scope"]
        company = (changes.get("company") or fact.get("company") or "").strip() or None
        if scope == "company" and not company:
            raise ValueError("Choose the company this applies to")
        if scope == "job" and not fact.get("job_key"):
            raise ValueError("This fact wasn't learned for a specific job")
        values.update(scope=scope, company=company if scope == "company" else None,
                      job_key=fact.get("job_key") if scope == "job" else None)
    if changes.get("status") in ("active", "outdated"):
        values["status"] = changes["status"]
    values["last_confirmed_at"] = now_iso()
    rows = await rest.update("profile_facts", {"id": f"eq.{fact['id']}"}, values)
    return rows[0] if rows else {**fact, **values}


async def mark_used(rest: SupabaseRest, fact_ids: List[str]) -> None:
    """Stamps last_used_at on the facts that just answered a question (best effort, after the response)."""
    ids = sorted({i for i in fact_ids if i and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", i)})
    if ids:
        await rest.update("profile_facts", {"id": f"in.({','.join(ids)})"}, {"last_used_at": now_iso()})


async def delete_fact(rest: SupabaseRest, fact_id: str) -> bool:
    return bool(await rest.delete("profile_facts", {"id": f"eq.{fact_id}"}))
