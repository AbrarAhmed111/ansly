"""
Shared data for tailoring tests: a profile that matches the full-stack fixture
resume, a job analysis, and plans (honest and adversarial).
"""

import json
from pathlib import Path
from typing import Any, Dict

from src.app.schemas.job import JobAnalysis
from src.app.schemas.resume import StructuredResume

FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "types" / "fixtures" / "structured-resume"


def master() -> StructuredResume:
    return StructuredResume.model_validate(json.loads((FIXTURES / "full-stack-engineer.json").read_text(encoding="utf-8")))


def profile_rows() -> Dict[str, Any]:
    """The candidate behind the full-stack fixture: no Kubernetes, no AWS certification, no "40%"."""
    return {
        "profile": {"id": "u1", "headline": "Full Stack Engineer",
                    "summary": "Full stack engineer building SaaS web applications with React, TypeScript and Node.js."},
        "experiences": [
            {"id": "e1", "company": "Northwind Labs", "title": "Software Engineer", "start_date": "2022-03-01",
             "end_date": None, "is_current": True, "location": "Remote",
             "description": "Built the SaaS billing dashboard and REST APIs for 200 business customers.",
             "highlights": ["Reduced API response times by 35% with PostgreSQL indexes"],
             "technologies": ["React", "Node.js", "TypeScript", "PostgreSQL"]},
            {"id": "e2", "company": "Contoso Digital", "title": "Junior Developer", "start_date": "2020-06-01",
             "end_date": "2022-02-01", "is_current": False, "location": "Austin, TX",
             "description": "Maintained marketing sites and dashboards.", "highlights": [],
             "technologies": ["JavaScript", "Python"]},
        ],
        "projects": [
            {"id": "p1", "name": "TaskBoard", "role": "Creator", "description": "Open-source collaboration tool.",
             "highlights": [], "technologies": ["Next.js", "Supabase", "TypeScript"]},
        ],
        "skills": [
            {"id": "s1", "name": "React", "level": "expert", "years": 4},
            {"id": "s2", "name": "TypeScript", "level": "advanced", "years": 3},
            {"id": "s3", "name": "Kubernetes", "level": "none", "years": None},
            {"id": "s4", "name": "Docker", "level": "intermediate", "years": None},
        ],
        "education": [],
        "achievements": [],
        "profile_facts": [],
    }


def analysis() -> JobAnalysis:
    return JobAnalysis.model_validate({
        "role": "Senior Full Stack Engineer", "company": "Company X",
        "mustHave": [
            {"id": "req_1", "requirement": "React", "type": "skill"},
            {"id": "req_2", "requirement": "TypeScript", "type": "skill"},
            {"id": "req_3", "requirement": "Kubernetes", "type": "skill"},
            {"id": "req_4", "requirement": "Building SaaS platforms", "type": "experience"},
            {"id": "req_5", "requirement": "5+ years of professional experience", "type": "experience"},
        ],
        "niceToHave": [
            {"id": "req_6", "requirement": "AWS EKS", "type": "skill"},
            {"id": "req_7", "requirement": "AWS Certified Solutions Architect", "type": "certification"},
            {"id": "req_8", "requirement": "Docker", "type": "skill"},
        ],
        "responsibilities": ["Build product features end to end"],
        "minYearsExperience": 5,
    })


def semantic_answer(user: str) -> Dict[str, Any]:
    """An over-eager matcher: claims everything, cites a fake id for the years requirement."""
    return {"matches": [
        {"requirementId": "req_4", "support": "strong", "evidenceIds": ["E1", "X99"], "note": "SaaS billing dashboard"},
        {"requirementId": "req_5", "support": "strong", "evidenceIds": ["X99"], "note": "Lots of experience"},
    ]}


HONEST_PLAN = {"changes": [
    {"section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b1",
     "text": "Built SaaS web applications using React, TypeScript and Node.js.", "evidenceIds": ["E1", "R:exp_1"],
     "reason": "SaaS + TypeScript requirements"},
    {"section": "projects", "item": "proj_1", "action": "reorder", "position": 0, "reason": "Collaboration match"},
    {"section": "skills", "item": "skills_1", "action": "emphasize", "values": ["TypeScript", "Docker"],
     "reason": "Required skills"},
    {"section": "summary", "action": "update_summary", "evidenceIds": ["PR", "E1"],
     "text": "Full stack engineer building SaaS web applications with React, TypeScript and Node.js.",
     "reason": "Match the role"},
]}

# Every way a model might try to fabricate. None of it may reach the tailored document.
ADVERSARIAL_PLAN = {"changes": [
    # Invented metric (the job asks for "40%+ performance improvements").
    {"section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b3",
     "text": "Improved page load performance by 40%.", "evidenceIds": ["R:exp_1_b3"], "reason": "Performance"},
    # Invented technology.
    {"section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b1",
     "text": "Built web applications using React, Node.js and Kubernetes on AWS EKS.", "evidenceIds": ["R:exp_1_b1"],
     "reason": "Kubernetes requirement"},
    # Invented certification, team size and years in the summary; one honest sentence.
    {"section": "summary", "action": "update_summary", "evidenceIds": ["PR"],
     "text": "Full stack engineer building SaaS web applications with React and TypeScript. "
             "AWS Certified Solutions Architect. Led a team of 12 engineers over 8 years.",
     "reason": "Seniority"},
    # Rewrite with no evidence at all.
    {"section": "experience", "item": "exp_2", "action": "rewrite_bullet", "bulletId": "exp_2_b2",
     "text": "Owned the data platform's Python automation strategy.", "evidenceIds": [], "reason": "Leadership"},
    # Rewrite citing evidence that doesn't exist.
    {"section": "experience", "item": "exp_2", "action": "rewrite_bullet", "bulletId": "exp_2_b1",
     "text": "Maintained high-traffic marketing sites.", "evidenceIds": ["E42"], "reason": "Scale"},
    # Emphasize a skill the candidate said they don't have.
    {"section": "skills", "action": "emphasize", "values": ["Kubernetes"], "reason": "Required"},
    # Remove a job.
    {"section": "experience", "item": "exp_2", "action": "reduce", "reason": "Not relevant"},
    # Drop a skill without saying why.
    {"section": "skills", "action": "reduce", "values": ["Python"], "reason": ""},
]}
