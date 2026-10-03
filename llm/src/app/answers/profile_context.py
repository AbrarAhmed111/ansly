"""
Profile Retrieval and Context Building.

Fetches only the profile sections a question needs (structured retrieval, no
embeddings), formats them as a compact, source-tagged context for the prompt,
and checks whether specific skills appear anywhere in the profile.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from src.app.db.rest import SupabaseRest

from .classifier import QuestionAnalysis

SECTION_LIMITS = {"experiences": 6, "projects": 6, "skills": 60, "education": 4, "achievements": 8}
# Facts the user gave when Ansly asked (or on /profile/additional). Always fetched: they are few and short.
FACTS_LIMIT = 30
SECTION_ORDER = {
    "experiences": "is_current.desc,start_date.desc.nullslast,sort_order.asc",
    "projects": "sort_order.asc,start_date.desc.nullslast",
    "skills": "sort_order.asc,name.asc",
    "education": "end_date.desc.nullslast,sort_order.asc",
    "achievements": "date.desc.nullslast,sort_order.asc",
}

# Canonical names for common spellings, applied after canonicalize().
ALIASES = {
    "k8s": "kubernetes", "js": "javascript", "ts": "typescript", "postgres": "postgresql", "psql": "postgresql",
    "reactjs": "react", "node": "nodejs", "next": "nextjs", "vue": "vuejs", "golang": "go",
    "amazonwebservices": "aws", "googlecloud": "gcp", "googlecloudplatform": "gcp", "azurecloud": "azure",
    "largelanguagemodels": "llm", "llms": "llm", "artificialintelligence": "ai", "machinelearning": "ml",
    "tailwindcss": "tailwind", "mongo": "mongodb", "cicd": "cicd", "ci-cd": "cicd",
}
# Generic trailing words: "CI/CD pipelines" is satisfied by "CI/CD".
GENERIC_SUFFIXES = {"pipelines", "pipeline", "development", "apps", "applications", "services", "systems",
                    "framework", "frameworks", "programming", "stack", "ecosystem", "platform", "tools"}


def canonicalize(term: str) -> str:
    text = term.lower().strip()
    text = re.sub(r"\.js\b", "js", text)
    text = re.sub(r"[\s.\-_/]+", "", text)
    return ALIASES.get(text, text)


@dataclass
class Source:
    ref: str      # short id used in the prompt, e.g. "E1"
    type: str     # profile | experience | project | skill | education | achievement
    id: str
    label: str


@dataclass
class ProfileContext:
    text: str
    sources: Dict[str, Source] = field(default_factory=dict)
    profile: Dict[str, Any] = field(default_factory=dict)
    corpus_terms: Set[str] = field(default_factory=set)
    # Skills the user said they don't have (skills.level = 'none'), canonicalized.
    declined_skills: Set[str] = field(default_factory=set)
    is_empty: bool = True

    def declined(self, skill: str) -> bool:
        return canonicalize(skill) in self.declined_skills and not self.has_skill(skill)

    def has_skill(self, skill: str) -> bool:
        canonical = canonicalize(skill)
        if canonical in self.corpus_terms:
            return True
        words = skill.lower().split()
        while words and words[-1] in GENERIC_SUFFIXES:
            words = words[:-1]
            if words and canonicalize(" ".join(words)) in self.corpus_terms:
                return True
        return False


def _date_range(row: Dict[str, Any]) -> str:
    start = (row.get("start_date") or "")[:7]
    if row.get("is_current"):
        end = "present"
    else:
        end = (row.get("end_date") or "")[:7]
    if not start and not end:
        return ""
    return f" ({start or '?'} – {end or '?'})"


def _lines(label: str, value: Any) -> List[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, list):
        return [f"  {label}: " + "; ".join(str(v) for v in value)]
    return [f"  {label}: {value}"]


def _term_ngrams(text: str) -> Set[str]:
    tokens = re.findall(r"[a-z0-9+#][a-z0-9+#./\-]*", text.lower())
    tokens = [t.rstrip(".") for t in tokens]
    terms: Set[str] = set()
    for n in (1, 2, 3):
        for i in range(len(tokens) - n + 1):
            terms.add(canonicalize(" ".join(tokens[i:i + n])))
    # "CI/CD" and "React/Next.js" also count as their parts.
    for t in tokens:
        if "/" in t:
            terms.update(canonicalize(part) for part in t.split("/") if part)
    return terms


def _mentions(row: Dict[str, Any], skills: List[str]) -> bool:
    text = " ".join(str(v) for v in row.values() if isinstance(v, (str, list)))
    terms = _term_ngrams(text)
    return any(canonicalize(s) in terms for s in skills)


def build_context(
    data: Dict[str, Any],
    analysis: QuestionAnalysis,
    additional_facts: Optional[List[str]] = None,
    include_logistics: Optional[bool] = None,
) -> ProfileContext:
    """Formats fetched rows into prompt text. `data` maps section -> rows, plus "profile" -> row,
    and "profile_facts" -> rows. `additional_facts` are what the candidate just told us without saving."""
    ctx = ProfileContext(text="")
    # "I don't have this skill" rows are knowledge, not skills: keep them out of the text and the corpus.
    skills = data.get("skills") or []
    ctx.declined_skills = {canonicalize(r["name"]) for r in skills if r.get("level") == "none"}
    data = {**data, "skills": [r for r in skills if r.get("level") != "none"]}
    out: List[str] = []
    corpus: List[str] = []
    profile = data.get("profile") or {}
    ctx.profile = profile

    if profile:
        ref = "PR"
        ctx.sources[ref] = Source(ref, "profile", profile.get("id", ""), "Profile")
        out.append(f"[{ref}] PROFILE")
        for label, key in [("Name", "full_name"), ("Headline", "headline"), ("Location", "location"),
                           ("Summary", "summary"), ("More about the candidate", "additional_context")]:
            out += _lines(label, profile.get(key))
        links = {k: v for k, v in (profile.get("links") or {}).items() if v}
        if links:
            out.append("  Links: " + ", ".join(f"{k}: {v}" for k, v in links.items()))
        if analysis.category == "logistics" if include_logistics is None else include_logistics:
            for label, key in [("Work authorization", "work_authorization"),
                               ("Requires visa sponsorship", "requires_sponsorship"),
                               ("Notice period / availability", "notice_period"),
                               ("Salary expectation", "salary_expectation"),
                               ("Willing to relocate", "willing_to_relocate"),
                               ("Preferred work mode", "preferred_work_mode")]:
                value = profile.get(key)
                if isinstance(value, bool):
                    value = "yes" if value else "no"
                out += _lines(label, value)
        corpus += [profile.get("headline") or "", profile.get("summary") or "", profile.get("additional_context") or ""]

    prefixes = {"experiences": "E", "projects": "P", "skills": "S", "education": "ED", "achievements": "A"}
    for section in analysis.sections:
        rows = data.get(section) or []
        if not rows:
            continue
        # Rows that mention the skill being asked about go first.
        if analysis.target_skills:
            rows = sorted(rows, key=lambda r: not _mentions(r, analysis.target_skills))
        rows = rows[: SECTION_LIMITS[section]]

        if section == "skills":
            ref = "S"
            ctx.sources[ref] = Source(ref, "skill", "", "Skills")
            parts = []
            for r in rows:
                detail = ", ".join(x for x in [r.get("level"), f"{r['years']:g} yrs" if r.get("years") else None] if x)
                parts.append(f"{r['name']} ({detail})" if detail else r["name"])
            out.append(f"[{ref}] SKILLS: " + "; ".join(parts))
            continue

        for i, r in enumerate(rows, start=1):
            ref = f"{prefixes[section]}{i}"
            if section == "experiences":
                label = f"{r['title']} at {r['company']}"
                out.append(f"[{ref}] EXPERIENCE: {label}{_date_range(r)}")
                out += _lines("Location", r.get("location"))
                type_name = "experience"
            elif section == "projects":
                label = r["name"]
                out.append(f"[{ref}] PROJECT: {label}{_date_range(r)}")
                out += _lines("Role", r.get("role"))
                out += _lines("URL", r.get("url"))
                type_name = "project"
            elif section == "education":
                label = ", ".join(x for x in [r.get("degree"), r.get("field_of_study")] if x) or r["institution"]
                label = f"{label} — {r['institution']}" if label != r["institution"] else label
                out.append(f"[{ref}] EDUCATION: {label}{_date_range(r)}")
                out += _lines("Grade", r.get("grade"))
                type_name = "education"
            else:
                label = r["title"]
                out.append(f"[{ref}] ACHIEVEMENT: {label}" + (f" ({r['date'][:7]})" if r.get("date") else ""))
                type_name = "achievement"
            out += _lines("Description", r.get("description"))
            out += _lines("Highlights", r.get("highlights"))
            out += _lines("Technologies", r.get("technologies"))
            ctx.sources[ref] = Source(ref, type_name, r.get("id", ""), label)

    facts = (data.get("profile_facts") or [])[:FACTS_LIMIT]
    for i, r in enumerate(facts, start=1):
        ref = f"F{i}"
        out.append(f"[{ref}] FACT ({r.get('category') or 'general'}): {r['prompt']}")
        out += _lines("Answer", r.get("answer"))
        ctx.sources[ref] = Source(ref, "fact", r.get("id", ""), r["prompt"][:80])
        corpus.append(r.get("answer") or "")
    for i, fact in enumerate(additional_facts or [], start=1):
        if not fact.strip():
            continue
        ref = f"N{i}"
        out.append(f"[{ref}] FACT (from the candidate, just now): {fact.strip()}")
        ctx.sources[ref] = Source(ref, "fact", "", "What you told Ansly")
        corpus.append(fact)

    ctx.text = "\n".join(out)
    # Skill presence looks at every fetched section, not only the ones shown to the model.
    for section in SECTION_LIMITS:
        for r in data.get(section) or []:
            corpus.append(" ".join(str(v) for v in r.values() if isinstance(v, (str, list))))
    ctx.corpus_terms = _term_ngrams(" ".join(str(c) for c in corpus))
    ctx.is_empty = (
        not any(data.get(s) for s in SECTION_LIMITS)
        and not (profile.get("summary") or "").strip()
        and not (profile.get("additional_context") or "").strip()
        and not facts
        and not any(f.strip() for f in additional_facts or [])
    )
    return ctx


async def fetch_profile_data(rest: SupabaseRest, analysis: QuestionAnalysis) -> Dict[str, Any]:
    """Fetches the profile row plus the sections the question needs (and skills, for skill checks)."""
    profiles = await rest.select("profiles", {"limit": "1"})
    data: Dict[str, Any] = {"profile": profiles[0] if profiles else None}
    sections = list(analysis.sections)
    # Skill presence is checked against every section that can mention a technology.
    if analysis.target_skills:
        sections += [s for s in ("skills", "experiences", "projects", "achievements") if s not in sections]
    for section in sections:
        data[section] = await rest.select(
            section, {"order": SECTION_ORDER[section], "limit": str(max(SECTION_LIMITS[section] * 3, 20))}
        )
    if analysis.category != "logistics":
        data["profile_facts"] = await rest.select(
            "profile_facts", {"order": "updated_at.desc", "limit": str(FACTS_LIMIT)}
        )
    return data


def missing_skills(ctx: ProfileContext, skills: List[str]) -> List[str]:
    return [s for s in skills if not ctx.has_skill(s)]


def logistics_value(profile: Optional[Dict[str, Any]], intent: str) -> Any:
    """The profile field that answers a logistics question, or None if it is not filled in."""
    if not profile:
        return None
    field_for_intent = {
        "salary": "salary_expectation",
        "sponsorship": "requires_sponsorship",
        "work_authorization": "work_authorization",
        "notice_period": "notice_period",
        "relocation": "willing_to_relocate",
        "work_mode": "preferred_work_mode",
    }
    key = field_for_intent.get(intent)
    value = profile.get(key) if key else None
    return None if value in (None, "") else value
