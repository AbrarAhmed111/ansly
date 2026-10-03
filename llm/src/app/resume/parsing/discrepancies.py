"""
Profile <-> Master Resume Discrepancies.

Conflicts are flagged, never resolved silently: the user picks a side (or keeps
both as they are) on the web app's discrepancies screen.
"""

import re
from typing import Any, Dict, List, Optional, Set

from src.app.answers.profile_context import canonicalize
from src.app.schemas.resume import ResumeDiscrepancy, StructuredResume

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def _key(text: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def _company_key(text: Optional[str]) -> str:
    """"Nizam LLC" and "Nizam, LLC." are the same company."""
    key = re.sub(r"\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pvt|private)\b\.?", "", (text or "").lower())
    return _key(key)


def resume_month(text: Optional[str]) -> Optional[str]:
    """"Mar 2022" / "03/2022" / "2022-03" -> "2022-03"; "2022" -> "2022"; Present/unknown -> None."""
    if not text:
        return None
    t = text.lower().strip()
    if re.match(r"present|current|now", t):
        return None
    m = re.search(r"([a-z]{3})[a-z]*\.?\s+(\d{4})", t)
    if m and m.group(1) in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"
    m = re.search(r"\b(\d{1,2})[/.-](\d{4})", t)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{m.group(2)}-{int(m.group(1)):02d}"
    m = re.search(r"(\d{4})-(\d{2})", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.search(r"\b(\d{4})\b", t)
    return m.group(1) if m else None


def _profile_month(date: Optional[str], precision: Optional[str]) -> Optional[str]:
    if not date:
        return None
    return date[:4] if precision and len(precision) == 4 else date[:7]


def _same_date(resume_value: Optional[str], profile_value: Optional[str]) -> bool:
    r = resume_month(resume_value)
    p = _profile_month(profile_value, r)
    if r is None or p is None:
        return True  # Only flag dates both sides actually state.
    return r == p


def find_discrepancies(resume: StructuredResume, data: Dict[str, Any], dismissed: Optional[Set[str]] = None) -> List[ResumeDiscrepancy]:
    """`data` holds the profile rows: profile, experiences, skills, education."""
    dismissed = dismissed or set()
    out: List[ResumeDiscrepancy] = []

    def add(d: ResumeDiscrepancy) -> None:
        if d.key not in dismissed:
            out.append(d)

    profile = data.get("profile") or {}
    for field_name, label in (("email", "Email"), ("phone", "Phone")):
        r, p = getattr(resume.contact, field_name), profile.get(field_name)
        if r and p and _key(r) != _key(p):
            add(ResumeDiscrepancy(key=f"contact:{field_name}", field="contact", resume_value=r, profile_value=p,
                                  label=f"{label} differs"))

    experiences = data.get("experiences") or []
    by_company = {_company_key(e.get("company")): e for e in experiences}
    resume_companies = set()
    for item in resume.experience:
        ck = _company_key(item.company)
        resume_companies.add(ck)
        row = by_company.get(ck)
        if row is None:
            add(ResumeDiscrepancy(key=f"company:{ck}", field="company", resume_value=item.company, profile_value=None,
                                  label=f"{item.title} at {item.company} is on your resume but not in your profile"))
            continue
        if row.get("title") and _key(row["title"]) != _key(item.title):
            add(ResumeDiscrepancy(key=f"title:{ck}", field="title", resume_value=item.title,
                                  profile_value=row["title"], label=f"Job title at {item.company} differs"))
        start_ok = _same_date(item.start_date, row.get("start_date"))
        end_ok = item.is_current == bool(row.get("is_current")) if (item.is_current or row.get("is_current")) \
            else _same_date(item.end_date, row.get("end_date"))
        if not (start_ok and end_ok):
            profile_range = f"{(row.get('start_date') or '?')[:7]} – {'Present' if row.get('is_current') else (row.get('end_date') or '?')[:7]}"
            add(ResumeDiscrepancy(key=f"dates:{ck}", field="dates",
                                  resume_value=f"{item.start_date or '?'} – {item.end_date or '?'}",
                                  profile_value=profile_range, label=f"Dates at {item.company} differ"))
    for ck, row in by_company.items():
        if ck and ck not in resume_companies:
            add(ResumeDiscrepancy(key=f"company:{ck}", field="company", resume_value=None, profile_value=row["company"],
                                  label=f"{row.get('title') or 'Role'} at {row['company']} is in your profile but not on your resume"))

    profile_skills = {canonicalize(s["name"]) for s in data.get("skills") or [] if s.get("level") != "none"}
    declined = {canonicalize(s["name"]) for s in data.get("skills") or [] if s.get("level") == "none"}
    seen: Set[str] = set()
    for group in resume.skills:
        for skill in group.items:
            c = canonicalize(skill)
            if not c or c in seen:
                continue
            seen.add(c)
            if c in declined:
                add(ResumeDiscrepancy(key=f"skill:{c}", field="skill", resume_value=skill, profile_value="Marked as a skill you don't have",
                                      label=f"{skill} is on your resume, but your profile says you don't have it"))
            elif c not in profile_skills:
                add(ResumeDiscrepancy(key=f"skill:{c}", field="skill", resume_value=skill, profile_value=None,
                                      label=f"{skill} is on your resume but not in your profile skills"))

    institutions = {_key(e.get("institution")) for e in data.get("education") or []}
    for item in resume.education:
        if institutions and _key(item.institution) not in institutions:
            add(ResumeDiscrepancy(key=f"education:{_key(item.institution)}", field="education",
                                  resume_value=item.institution, profile_value=None,
                                  label=f"{item.institution} is on your resume but not in your profile"))
    return out
