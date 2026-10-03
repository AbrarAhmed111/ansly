"""
Profile Retrieval and Context Building.

Fetches only the profile sections a question needs (structured retrieval, no
embeddings), formats them as a compact, source-tagged context for the prompt,
and checks whether specific skills appear anywhere in the profile.
"""

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from src.app.core import metrics
from src.app.core.ttl_cache import TTLCache
from src.app.db.rest import SupabaseRest

from .classifier import QuestionAnalysis

SECTION_LIMITS = {"experiences": 6, "projects": 6, "skills": 60, "education": 4, "achievements": 8}
# A cover letter picks from the whole profile: more rows reach the model, most job-relevant first.
COVER_LETTER_LIMITS = {**SECTION_LIMITS, "experiences": 8, "projects": 10}
# Words that say nothing about what a job or a project is about.
RELEVANCE_STOPWORDS = set("""
a an and are as at be been being but by can do for from has have how i if in into is it its may more most must
not of on or our over per so such than that the their them they this to up us was we were what when where which
while who will with within without would you your yours about across after all also any based both each etc
experience experienced work working worked team teams role roles job jobs candidate company years year strong
skills skill ability able knowledge understanding including include includes new using use used build built
building develop developed developing developer development help helped part plus good great excellent
responsible responsibilities requirements required preferred nice bonus looking join day make made well
""".split())
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
    # The fetched rows per section (all of them, not only those shown to the model), for structured lookups.
    rows: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    corpus_terms: Set[str] = field(default_factory=set)
    # Skills the user said they don't have (skills.level = 'none'), canonicalized.
    declined_skills: Set[str] = field(default_factory=set)
    is_empty: bool = True
    # Keyword retrieval found fewer than two records that clearly support the question(s): the engine may try
    # semantic retrieval, and the text was already filled with the most job-relevant records.
    low_confidence: bool = False
    # When one context serves several questions (a batch): per question, in order, the evidence refs retrieved
    # for it ("E1", "P2"...), so the model knows which shared records back which answer.
    question_refs: List[List[str]] = field(default_factory=list)

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


def relevance_terms(text: str) -> Set[str]:
    """Canonical 1–3-word terms that carry meaning ("full stack" -> "fullstack", "machine learning" -> "ml")."""
    tokens = [t.rstrip(".") for t in re.findall(r"[a-z0-9+#][a-z0-9+#./\-]*", (text or "").lower())]
    tokens = [t for t in tokens if t and t not in RELEVANCE_STOPWORDS]
    terms: Set[str] = set()
    for n in (1, 2, 3):
        for i in range(len(tokens) - n + 1):
            term = canonicalize(" ".join(tokens[i:i + n]))
            if len(term) > 1:
                terms.add(term)
    # "CI/CD" counts as its parts; for ranking, so does "LLM-powered" (skill presence never splits hyphens).
    for t in tokens:
        if "/" in t or "-" in t:
            terms.update(canonicalize(part) for part in re.split(r"[/-]", t)
                         if len(part) > 1 and part not in RELEVANCE_STOPWORDS)
    return terms


def _row_text(row: Dict[str, Any]) -> str:
    return " ".join(" ".join(map(str, v)) if isinstance(v, list) else str(v)
                    for v in row.values() if isinstance(v, (str, list)))


def rank_for_job(rows: List[Dict[str, Any]], job_terms: Set[str],
                 question_terms: Optional[Set[str]] = None) -> List[Dict[str, Any]]:
    """Rows sharing the most terms with the question (weighted 3x) and the job first; the profile's own order
    breaks ties."""
    if not job_terms and not question_terms:
        return rows
    row_terms = [relevance_terms(_row_text(r)) for r in rows]
    scores = [3 * len(t & (question_terms or set())) + len(t & job_terms) for t in row_terms]
    order = sorted(range(len(rows)), key=lambda i: -scores[i])
    return [rows[i] for i in order]


# Evidence retrieval: the model gets the few records that support the question, not a profile. Every experience,
# project, achievement, education row and saved fact is a candidate record, scored by the terms it shares with the
# question (and the skills it names), a bonus for a fact saved for this kind of question, and, capped, the job.
# Only records that support the question are sent; no section is guaranteed a row. When fewer than two records
# clearly do, the context is marked low_confidence and filled with the most job-relevant records instead of being
# sent thin. Budgets are characters of rendered records (~4 per token).
EVIDENCE_BUDGET_CHARS: Dict[str, int] = {
    "skill_check": 1600, "education": 900, "logistics": 0, "achievement": 1600, "about_me": 3600,
    "cover_letter": 4800,
}
DEFAULT_EVIDENCE_BUDGET_CHARS = 2400
MAX_RECORDS: Dict[str, int] = {"skill_check": 3, "education": 2, "about_me": 5, "cover_letter": 6}
DEFAULT_MAX_RECORDS = 4
# Records per question when one context serves several questions (fill all).
RECORDS_PER_QUESTION = 3
BATCH_EVIDENCE_BUDGET_MAX = 6000
# Questions about the candidate as a whole or about the job: the job decides what's relevant, so job overlap counts
# as support, and the profile summary is shown.
JOB_DRIVEN = {"about_me", "cover_letter", "motivation", "strengths", "general"}
SKILLS_SHOWN = 12
LINK_QUESTION = re.compile(r"\b(?:links?|url|github|linkedin|portfolio|website)\b", re.IGNORECASE)
PREFIXES = {"experiences": "E", "projects": "P", "education": "ED", "achievements": "A", "profile_facts": "F"}


# Words that frame a question rather than say what it's about ("Tell us about a time you ..."): matching them
# finds "part-time" roles and "saves people time" facts.
QUESTION_FILLER = set("""
time times example examples tell describe share give walk us me approach approached learned learn lesson resolve
resolved situation moment occasion greatest biggest favorite favourite proud yourself interested interest want
why answer question please briefly detail details
""".split())


def question_relevance_terms(analysis: QuestionAnalysis) -> Set[str]:
    return relevance_terms(" ".join([analysis.question, *analysis.target_skills])) - QUESTION_FILLER


def profile_budget(analysis: QuestionAnalysis) -> int:
    return EVIDENCE_BUDGET_CHARS.get(analysis.category, DEFAULT_EVIDENCE_BUDGET_CHARS)


def batch_budget(analyses: List[QuestionAnalysis]) -> int:
    if not analyses:
        return 0
    return min(BATCH_EVIDENCE_BUDGET_MAX, max(profile_budget(a) for a in analyses) + 800 * (len(analyses) - 1))


@dataclass
class _Record:
    section: str
    row: Dict[str, Any]
    order: int
    terms: Set[str]


@dataclass
class _Scored:
    record: _Record
    score: float
    strong: bool


def _records(data: Dict[str, Any], sections: List[str]) -> List[_Record]:
    out: List[_Record] = []
    for section in [s for s in ("experiences", "projects", "achievements", "education") if s in sections]:
        for i, r in enumerate(data.get(section) or []):
            out.append(_Record(section, r, i, relevance_terms(_row_text(r))))
    for i, r in enumerate((data.get("profile_facts") or [])[:FACTS_LIMIT]):
        out.append(_Record("profile_facts", r, i, relevance_terms(f"{r.get('prompt', '')} {r.get('answer') or ''}")))
    return out


def _score(rec: _Record, analysis: QuestionAnalysis, question_terms: Set[str], job_terms: Set[str],
           boost: Dict[str, float]) -> _Scored:
    q = len(rec.terms & question_terms)
    j = len(rec.terms & job_terms)
    skill = bool(analysis.target_skills) and rec.section != "profile_facts" and _mentions(rec.row, analysis.target_skills)
    kind = rec.section == "profile_facts" and rec.row.get("category") in (analysis.intent, analysis.category) \
        and analysis.intent != "general"
    extra = boost.get(str(rec.row.get("id")), 0.0)
    score = 4 * q + 0.5 * min(j, 8) + (6 if skill else 0) + (6 if kind else 0) + extra
    strong = q > 0 or skill or kind or extra > 0 or (analysis.category in JOB_DRIVEN and j >= 3)
    return _Scored(rec, score, strong)


def _render(rec: _Record, ref: str) -> Tuple[str, str, str]:
    """(prompt line, source type, source label) for one record: one compact line."""
    r = rec.row
    details = []
    if r.get("description"):
        details.append(str(r["description"]).strip())
    if r.get("highlights"):
        details.append("Highlights: " + "; ".join(str(h) for h in r["highlights"]))
    if r.get("technologies"):
        details.append("Tech: " + ", ".join(str(t) for t in r["technologies"]))
    tail = (" — " + " | ".join(details)) if details else ""
    if rec.section == "experiences":
        label = f"{r['title']} at {r['company']}"
        return f"[{ref}] EXPERIENCE: {label}{_date_range(r)}{tail}", "experience", label
    if rec.section == "projects":
        label = r["name"]
        role = f", {r['role']}" if r.get("role") else ""
        return f"[{ref}] PROJECT: {label}{_date_range(r)}{role}{tail}", "project", label
    if rec.section == "education":
        label = ", ".join(x for x in [r.get("degree"), r.get("field_of_study")] if x) or r["institution"]
        label = f"{label} — {r['institution']}" if label != r["institution"] else label
        grade = f", {r['grade']}" if r.get("grade") else ""
        return f"[{ref}] EDUCATION: {label}{_date_range(r)}{grade}{tail}", "education", label
    if rec.section == "achievements":
        label = r["title"]
        date = f" ({r['date'][:7]})" if r.get("date") else ""
        return f"[{ref}] ACHIEVEMENT: {label}{date}{tail}", "achievement", label
    answer = f" — {r['answer']}" if r.get("answer") else ""
    return (f"[{ref}] FACT ({r.get('category') or 'general'}): {r['prompt']}{answer}", "fact",
            str(r.get("prompt", ""))[:80])


def _select(records: List[_Record], analyses: List[QuestionAnalysis], job_terms: Set[str], budget: int,
            boost: Dict[str, float]) -> Tuple[List[_Record], bool, List[List[_Record]]]:
    """The records to show, whether retrieval was confident, and the records retrieved for each question.
    Several questions share one deduplicated set: a record two questions need is shown once."""
    single = len(analyses) == 1
    picked: List[_Record] = []
    per_question: List[List[_Record]] = []
    strong_total = 0
    for analysis in analyses:
        question_terms = question_relevance_terms(analysis)
        scored = [_score(rec, analysis, question_terms, job_terms, boost) for rec in records
                  if rec.section == "profile_facts" or rec.section in analysis.sections]
        scored.sort(key=lambda s: (-s.score, s.record.order))
        limit = MAX_RECORDS.get(analysis.category, DEFAULT_MAX_RECORDS) if single else RECORDS_PER_QUESTION
        strong = [s.record for s in scored if s.strong][:limit]
        strong_total += len(strong)
        mine = list(strong)
        if len(strong) < min(2, limit):
            # Not enough clear support: add the most job-relevant records (saved facts included) rather than answer
            # from too little.
            mine += [s.record for s in scored if not s.strong][: limit - len(strong)]
        picked += mine
        per_question.append(mine)
    low = strong_total < 2 * len(analyses) if not single else strong_total < 2
    chosen: List[_Record] = []
    used = 0
    for record in picked:
        if any(record is c for c in chosen):
            continue
        cost = len(_render(record, "X0")[0]) + 1
        if chosen and used + cost > budget:
            continue
        chosen.append(record)
        used += cost
    return chosen, low, [[r for r in mine if any(r is c for c in chosen)] for mine in per_question]


def _relevant_skills(skills: List[Dict[str, Any]], analyses: List[QuestionAnalysis], job_terms: Set[str]) -> List[Dict[str, Any]]:
    wanted = {canonicalize(s) for a in analyses for s in a.target_skills}
    question_terms = set().union(*(question_relevance_terms(a) for a in analyses)) if analyses else set()
    broad = any(a.category in ("about_me", "cover_letter", "strengths") for a in analyses)
    hits = [r for r in skills if canonicalize(r["name"]) in wanted | question_terms
            or (broad and canonicalize(r["name"]) in job_terms)]
    if broad and len(hits) < SKILLS_SHOWN:
        hits += [r for r in skills if r not in hits][: SKILLS_SHOWN - len(hits)]
    return hits[:SKILLS_SHOWN]


def build_context(
    data: Dict[str, Any],
    analysis: QuestionAnalysis,
    additional_facts: Optional[List[str]] = None,
    include_logistics: Optional[bool] = None,
    job_text: Optional[str] = None,
    budget_chars: Optional[int] = None,
    analyses: Optional[List[QuestionAnalysis]] = None,
    boost: Optional[Dict[str, float]] = None,
) -> ProfileContext:
    """Grounding data plus the evidence text for one question (or `analyses`, the questions one context serves).
    `data` maps section -> rows, plus "profile" -> row and "profile_facts" -> rows. `additional_facts` are what
    the candidate just told us without saving. `boost` raises rows by id (semantic retrieval's hits). Skill
    presence and the empty-profile check always read every fetched row, not only the ones shown."""
    targets = analyses if analyses is not None else [analysis]
    job_terms = relevance_terms(job_text) if job_text and job_text.strip() else set()
    question_terms = set().union(*(question_relevance_terms(a) for a in targets)) \
        if targets else set()
    budget = (profile_budget(analysis) if analyses is None else batch_budget(targets)) \
        if budget_chars is None else budget_chars
    ctx = ProfileContext(text="")
    # "I don't have this skill" rows are knowledge, not skills: keep them out of the text and the corpus.
    skills = data.get("skills") or []
    ctx.declined_skills = {canonicalize(r["name"]) for r in skills if r.get("level") == "none"}
    data = {**data, "skills": [r for r in skills if r.get("level") != "none"]}
    out: List[str] = []
    corpus: List[str] = []
    profile = data.get("profile") or {}
    ctx.profile = profile
    ctx.rows = {s: data.get(s) or [] for s in SECTION_LIMITS}
    all_facts = (data.get("profile_facts") or [])[:FACTS_LIMIT]

    if profile:
        ref = "PR"
        ctx.sources[ref] = Source(ref, "profile", profile.get("id", ""), "Profile")
        if targets:
            name = " — ".join(str(x) for x in [profile.get("full_name"), profile.get("headline")] if x)
            out.append(f"[{ref}] CANDIDATE: {name or 'the candidate'}")
            broad = any(a.category in JOB_DRIVEN for a in targets)
            if broad:
                out += _lines("Location", profile.get("location"))
                out += _lines("Summary", profile.get("summary"))
            extra = profile.get("additional_context") or ""
            if extra and (broad or relevance_terms(extra) & question_terms
                          or any(_mentions({"x": extra}, a.target_skills) for a in targets if a.target_skills)):
                out += _lines("More about the candidate", extra)
            links = {k: v for k, v in (profile.get("links") or {}).items() if v}
            if links and any(LINK_QUESTION.search(a.question) for a in targets):
                out.append("  Links: " + ", ".join(f"{k}: {v}" for k, v in links.items()))
        if any(a.category == "logistics" for a in targets) if include_logistics is None else include_logistics:
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

    if data["skills"]:
        ctx.sources["S"] = Source("S", "skill", "", "Skills")
    open_targets = [a for a in targets if a.category != "logistics"]
    if open_targets:
        if any("skills" in a.sections for a in open_targets):
            shown = _relevant_skills(data["skills"], open_targets, job_terms)
            if shown:
                parts = []
                for r in shown:
                    detail = ", ".join(x for x in [r.get("level"), f"{r['years']:g} yrs" if r.get("years") else None] if x)
                    parts.append(f"{r['name']} ({detail})" if detail else r["name"])
                out.append("[S] SKILLS: " + "; ".join(parts))

        sections = sorted({s for a in open_targets for s in a.sections})
        records = _records({**data, "profile_facts": all_facts}, sections)
        chosen, ctx.low_confidence, per_question = _select(records, open_targets, job_terms, budget, boost or {})
        if job_terms and any(a.category == "cover_letter" for a in open_targets):
            out.append("(Experience and projects are listed most relevant to this job first.)")
        order = ["experiences", "projects", "achievements", "education", "profile_facts"]
        counters: Dict[str, int] = {}
        refs: Dict[int, str] = {}
        for section in order:
            for rec in [r for r in chosen if r.section == section]:
                counters[section] = counters.get(section, 0) + 1
                ref = f"{PREFIXES[section]}{counters[section]}"
                refs[id(rec)] = ref
                line, type_name, label = _render(rec, ref)
                out.append(line)
                ctx.sources[ref] = Source(ref, type_name, rec.row.get("id", ""), label)
        # Logistics questions get no evidence of their own (they're answered from the profile's fields).
        mapped = iter(per_question)
        ctx.question_refs = [[refs[id(r)] for r in next(mapped)] if a.category != "logistics" else []
                             for a in targets]

    # Skill presence reads every saved fact, not only the ones shown to the model.
    corpus += [r.get("answer") or "" for r in all_facts]
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
        and not all_facts
        and not any(f.strip() for f in additional_facts or [])
    )
    return ctx


# Profile rows per (user id, table), so answering several fields in a row reads the profile once.
# Short-lived because the web app edits the profile directly in Supabase; API writes drop it at once.
PROFILE_CACHE_SECONDS = 30
_profile_cache: TTLCache[List[Dict[str, Any]]] = TTLCache(PROFILE_CACHE_SECONDS, max_entries=2000)


def invalidate_profile_cache(user_id: str) -> None:
    _profile_cache.invalidate_user(user_id)


async def _rows(rest: SupabaseRest, user_id: Optional[str], table: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    key = (user_id, table)
    if user_id:
        cached = _profile_cache.get(key)
        metrics.record_cache("profile", hit=cached is not None)
        if cached is not None:
            return cached
    rows = await rest.select(table, params)
    if user_id:
        _profile_cache.set(key, rows)
    return rows


async def fetch_profile_data(rest: SupabaseRest, analysis: QuestionAnalysis,
                             user_id: Optional[str] = None) -> Dict[str, Any]:
    """Fetches the profile row plus the sections the question needs (and skills, for skill checks), in parallel.
    With `user_id`, recently fetched rows are reused (see PROFILE_CACHE_SECONDS)."""
    sections = list(analysis.sections)
    # Skill presence is checked against every section that can mention a technology.
    if analysis.target_skills:
        sections += [s for s in ("skills", "experiences", "projects", "achievements") if s not in sections]
    queries: Dict[str, Tuple[str, Dict[str, str]]] = {"profile": ("profiles", {"limit": "1"})}
    for section in sections:
        queries[section] = (section, {"order": SECTION_ORDER[section],
                                      "limit": str(max(SECTION_LIMITS[section] * 3, 20))})
    if analysis.category != "logistics":
        queries["profile_facts"] = ("profile_facts", {"order": "updated_at.desc", "limit": str(FACTS_LIMIT)})
    results = await asyncio.gather(*(_rows(rest, user_id, table, params) for table, params in queries.values()))
    data: Dict[str, Any] = dict(zip(queries, results))
    data["profile"] = data["profile"][0] if data["profile"] else None
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
