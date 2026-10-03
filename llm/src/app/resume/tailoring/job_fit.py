"""
Fitting the Resume's Framing to the Job.

Two deterministic rules that run with validation:

- headline  the title line under the name becomes the job's role ("Full Stack AI
            Engineer" -> "Full Stack Engineer"). The plan's proposal is used when it
            is a clean title; otherwise the role is derived from the job analysis.
            A seniority word is only kept if the candidate's own job titles have it,
            and a tagline after a separator ("... | Building LLM apps") is kept.
- skills    must-have skills the evidence doesn't show are added to the skills list,
            and reported, so the user confirms or removes them before sending.
            Skills the user said they don't have are never added.
"""

import re
from typing import List, Optional, Tuple

from src.app.answers.profile_context import canonicalize
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.schemas.job import JobAnalysis
from src.app.schemas.matching import RequirementMatch
from src.app.schemas.resume import ResumeSkillGroup, StructuredResume

MAX_HEADLINE = 80
MAX_ADDED_SKILLS = 8
SENIORITY = {"senior", "sr", "lead", "staff", "principal", "head", "chief", "junior", "jr", "intern", "associate",
             "mid", "mid-level", "i", "ii", "iii", "iv", "v"}
NOISE = {"remote", "hybrid", "onsite", "on-site", "contract", "freelance", "full-time", "part-time", "fulltime",
         "m/f/d", "f/m/d", "m/w/d", "w/m/d"}
# " | ", " - ", " · ", " — " and friends: what separates a title from a tagline or a location.
SEPARATOR = re.compile(r"\s+[|\-–—·•/@:]\s+|\s*[|·•]\s*|,\s*")
SKILL_GROUP_LABEL = re.compile(r"skill|tech|tool|stack|framework|language", re.IGNORECASE)


def _words(text: str) -> List[str]:
    return [w for w in re.split(r"\s+", text.strip()) if w]


def _bare(word: str) -> str:
    return word.lower().strip(".,()")


def _split(headline: str) -> Tuple[str, str]:
    """("Full Stack AI Engineer", " | Building LLM apps"): the title and whatever follows it."""
    match = SEPARATOR.search(headline)
    return (headline[: match.start()], headline[match.start():]) if match else (headline, "")


# A proposed title is rejected outright, not trimmed, if it says more than a role.
NOT_A_TITLE = re.compile(r"\d|\b(?:at|for|since|with|years?)\b|[@()]|https?:", re.IGNORECASE)


def clean_title(text: str, own_titles: List[str], strict: bool = False) -> Optional[str]:
    """The role's plain name, or None when nothing usable is left. `strict`: None for anything but a plain title."""
    if strict and NOT_A_TITLE.search(text or ""):
        return None
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", text or "")
    text, _ = _split(text.strip())
    own = {_bare(w) for t in own_titles for w in _words(t)}
    kept = [w for w in _words(text)
            if _bare(w) not in NOISE and not any(c.isdigit() for c in w)
            and (_bare(w) not in SENIORITY or _bare(w) in own)]
    title = " ".join(kept).strip(" -–—,|")
    if not title or len(title) > MAX_HEADLINE or len(kept) > 8 or "@" in title or "http" in title.lower():
        return None
    return title


def fit_headline(master: Optional[str], proposed: Optional[str], role: Optional[str],
                 own_titles: List[str]) -> Optional[str]:
    """The headline to use. Without a headline in the master there's nothing in the document to change."""
    if not master or not master.strip():
        return master
    old_title, tagline = _split(master)
    candidate = None
    if proposed and proposed.strip() != master.strip():
        candidate = clean_title(_split(proposed)[0], own_titles, strict=True)
    if candidate is None and role:
        candidate = clean_title(role, own_titles)
    if candidate is None or canonicalize(candidate) == canonicalize(old_title):
        return master
    return f"{candidate}{tagline}"


def _target_group(resume: StructuredResume) -> Optional[ResumeSkillGroup]:
    if not resume.skills:
        return None
    labelled = [g for g in resume.skills if g.label and SKILL_GROUP_LABEL.search(g.label)]
    return (labelled or sorted(resume.skills, key=lambda g: -len(g.items)))[0]


def add_job_skills(resume: StructuredResume, analysis: JobAnalysis, matches: List[RequirementMatch],
                   corpus: EvidenceCorpus) -> Tuple[Optional[str], List[str]]:
    """Adds the job's must-have skills that have no evidence. Returns (group id, skills added)."""
    group = _target_group(resume)
    if group is None:
        return None, []
    skill_ids = {r.id for r in analysis.must_have if r.type == "skill"}
    present = {canonicalize(s) for g in resume.skills for s in g.items}
    added: List[str] = []
    for m in matches:
        name = m.requirement.strip()
        key = canonicalize(name)
        if m.requirement_id not in skill_ids or m.support != "none" or not key:
            continue
        if key in present or key in corpus.declined or len(name) > 40 or len(_words(name)) > 4:
            continue
        group.items.append(name)
        present.add(key)
        added.append(name)
        if len(added) >= MAX_ADDED_SKILLS:
            break
    return group.id, added
