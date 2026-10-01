"""
Application Preparation.

"Prepare application" builds a reviewable package for one tracked job:

- the profile items most relevant to the job (deterministic)
- which uploaded resume fits best (deterministic)
- matched and missing skills (deterministic, same as job matching)
- a tailored resume summary, a cover letter and likely interview questions
  (one grounded LLM call, with a deterministic fallback for the questions)
- answers to common application questions (the V1 answer engine)

Nothing is invented: generated text uses only the profile, and the posting is
treated as context about the employer.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.app.answers.classifier import CATEGORY_SECTIONS, QuestionAnalysis
from src.app.answers.engine import AnswerEngine
from src.app.answers.profile_context import build_context, term_in_corpus, term_ngrams
from src.app.db.rest import SupabaseRest
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.jobs.matching import build_candidate, title_tokens
from src.app.jobs.service import load_profile_data
from src.app.schemas.answers import GenerateAnswerRequest

from .context import load_application_context

logger = logging.getLogger("ApplicationPrep")

COMMON_QUESTIONS = [
    "Why are you interested in this role?",
    "Why do you want to work at {company}?",
    "Tell us about yourself.",
    "Describe a project you're proud of.",
]
MAX_RELEVANT = 4

PREP_SYSTEM_PROMPT = """You help a candidate prepare a job application. The candidate reviews and edits everything before using it, so truthfulness matters more than polish.

Rules:
- Use only facts stated in the CANDIDATE PROFILE. Never add employers, projects, skills, metrics, dates, degrees or years of experience that are not there.
- JOB CONTEXT describes the employer and role, not the candidate. Use it to choose which real experience to emphasize, never as something the candidate has done.
- Write in the first person as the candidate for the summary and cover letter. Plain prose, no placeholders like [Company], no clichés such as "I am excited to apply".
- If the profile is too thin to write a truthful cover letter, set cover_letter to null.

Return only a JSON object with exactly these keys:
{"tailored_summary": string (2-3 sentences, a resume summary aimed at this role),
 "cover_letter": string | null (150-250 words, 3-4 short paragraphs),
 "interview_questions": [{"question": string, "why": string}] (5 questions this interviewer is likely to ask, each with a short reason tied to the posting or to a gap in the profile),
 "usedSources": [source ids from the profile]}"""


class PrepError(Exception):
    pass


@dataclass
class PrepResult:
    application: Dict[str, Any]
    answers: List[Dict[str, Any]]
    llm_available: bool


def _row_text(row: Dict[str, Any]) -> str:
    return " ".join(str(v) for v in row.values() if isinstance(v, (str, list)))


def rank_relevant(data: Dict[str, Any], skills: List[str], role: str) -> List[Dict[str, Any]]:
    """Experiences and projects that show the job's skills or a similar role, strongest first."""
    role_words = title_tokens(role) - {"senior", "junior", "lead", "staff", "principal", "engineer"}
    scored = []
    for kind, rows, label_of in [
        ("experience", data.get("experiences") or [], lambda r: f"{r.get('title')} at {r.get('company')}"),
        ("project", data.get("projects") or [], lambda r: str(r.get("name"))),
    ]:
        for i, row in enumerate(rows):
            terms = term_ngrams(_row_text(row))
            shown = [s for s in skills if term_in_corpus(s, terms)]
            similar_role = kind == "experience" and bool(role_words & title_tokens(row.get("title") or ""))
            score = len(shown) + (1.5 if similar_role else 0) + (0.5 if row.get("is_current") else 0) - i * 0.05
            if shown or similar_role:
                why = (f"Shows {', '.join(shown[:4])}" if shown else "") + \
                      ("; similar role" if similar_role and shown else "Similar role" if similar_role else "")
                scored.append((score, {"type": kind, "id": str(row.get("id")), "label": label_of(row), "why": why}))
    scored.sort(key=lambda x: -x[0])
    return [item for _, item in scored[:MAX_RELEVANT]]


def choose_resume(resumes: List[Dict[str, Any]], role: str) -> Optional[Dict[str, Any]]:
    """The resume whose target roles best fit the job, else the default, else the newest."""
    if not resumes:
        return None
    wanted = title_tokens(role)
    best, best_overlap = None, 0
    for r in resumes:
        overlap = max((len(wanted & title_tokens(t)) for t in r.get("target_roles") or []), default=0)
        if overlap > best_overlap:
            best, best_overlap = r, overlap
    if best:
        return {"resume_id": best["id"], "reason": f"“{best['name']}” targets roles like this one"}
    default = next((r for r in resumes if r.get("is_default")), None)
    if default:
        return {"resume_id": default["id"], "reason": f"“{default['name']}” is your default resume"}
    newest = max(resumes, key=lambda r: r.get("updated_at") or r.get("created_at") or "")
    return {"resume_id": newest["id"], "reason": f"“{newest['name']}” is your most recent resume"}


def fallback_questions(role: str, relevant: List[Dict[str, Any]], matched: List[str], missing: List[str]) -> List[Dict[str, str]]:
    questions = []
    if relevant:
        questions.append({"question": f"Walk us through {relevant[0]['label']}. What did you build, and what was hardest?",
                          "why": "It's the part of your profile closest to this role."})
    for skill in matched[:2]:
        questions.append({"question": f"How have you used {skill} in production, and what would you do differently?",
                          "why": f"The posting asks for {skill}."})
    for skill in missing[:2]:
        questions.append({"question": f"This role uses {skill}. How would you get up to speed?",
                          "why": f"{skill} isn't in your profile yet."})
    questions.append({"question": f"Why this {role} role, and why now?", "why": "Asked in almost every first interview."})
    return questions[:5]


def parse_prep(text: str) -> Dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in preparation output")
    data = json.loads(cleaned[start:end + 1])
    summary = str(data.get("tailored_summary") or "").strip()
    if not summary:
        raise ValueError("Missing tailored_summary")
    letter = data.get("cover_letter")
    letter = str(letter).strip() if letter else None
    questions = [
        {"question": str(q.get("question", "")).strip(), "why": str(q.get("why", "")).strip()}
        for q in data.get("interview_questions") or [] if isinstance(q, dict) and q.get("question")
    ]
    if not questions:
        raise ValueError("Missing interview_questions")
    return {"tailored_summary": summary, "cover_letter": letter, "interview_questions": questions[:6]}


async def prepare_application(rest: SupabaseRest, engine: AnswerEngine, gateway: LLMGateway, user_id: str,
                              application_id: str, temperature: float = 0.4, max_tokens: int = 2048,
                              job_description_max_chars: int = 6000) -> PrepResult:
    app_ctx = await load_application_context(rest, application_id)
    if app_ctx is None:
        raise PrepError("Application not found")
    app = app_ctx.application
    job_context = app_ctx.job_context()
    role, company = app["role"], app["company"]

    data = await load_profile_data(rest, user_id)
    candidate = build_candidate(data)
    skills = app_ctx.requirements
    matched = [s for s in skills if candidate.has_skill(s)]
    missing = [s for s in skills if s not in matched]
    relevant = rank_relevant(data, skills, role)
    resume = choose_resume(await rest.select("resumes", {"user_id": f"eq.{user_id}"}), role)

    # Generated parts: one grounded call over the whole profile.
    analysis = QuestionAnalysis(question="Prepare application", category="general", intent="general",
                                sections=list(CATEGORY_SECTIONS["general"]), target_skills=[])
    ctx = build_context(data, analysis)
    job_lines = [f"Company: {company}", f"Role: {role}"]
    if skills:
        job_lines.append("Skills the posting asks for: " + ", ".join(skills))
    if job_context.description:
        job_lines.append("Job description:\n" + job_context.description.strip()[:job_description_max_chars])
    message = (
        "JOB CONTEXT (about the employer, not the candidate):\n" + "\n".join(job_lines)
        + "\n\nSKILLS IN THE PROFILE THAT THE POSTING ASKS FOR: " + (", ".join(matched) or "none")
        + "\nASKED FOR BUT NOT IN THE PROFILE (never claim these): " + (", ".join(missing) or "none")
        + "\n\nCANDIDATE PROFILE:\n" + (ctx.text or "(empty)")
    )
    generated: Optional[Dict[str, Any]] = None
    if not ctx.is_empty:
        try:
            result = await gateway.generate(system=PREP_SYSTEM_PROMPT, messages=[{"role": "user", "content": message}],
                                            temperature=temperature, max_tokens=max_tokens, validate=parse_prep)
            generated = result.value
        except GatewayUnavailableError as e:
            logger.warning(f"Preparation without LLM for application {application_id}: {e}")

    # Answers to common questions, reusing the V1 engine with this application's context.
    questions = [q.format(company=company) for q in COMMON_QUESTIONS]
    if skills:
        questions.append(f"Describe your experience with {skills[0]}.")
    responses = await asyncio.gather(
        *(engine.answer(rest, GenerateAnswerRequest(question=q, application_id=application_id)) for q in questions),
        return_exceptions=True,
    )
    answer_rows = [
        {"user_id": user_id, "application_id": application_id, "question": q, "answer": r.answer,
         "category": r.category, "source": "prepared"}
        for q, r in zip(questions, responses)
        if not isinstance(r, BaseException) and r.status == "answered" and r.answer
    ]
    if answer_rows:
        await rest.upsert("application_answers", answer_rows, on_conflict="application_id,question_key")

    now = datetime.now(timezone.utc).isoformat()
    prep = {
        "relevant": relevant,
        "resume": resume,
        "tailored_summary": generated["tailored_summary"] if generated else None,
        "matched_skills": matched,
        "missing_skills": missing,
        "interview_questions": generated["interview_questions"] if generated
        else fallback_questions(role, relevant, matched, missing),
        "generated_at": now,
    }
    values: Dict[str, Any] = {"prep": prep, "prepared_at": now}
    if generated and generated.get("cover_letter"):
        values["cover_letter"] = generated["cover_letter"]
    if app.get("status") == "interested":
        values["status"] = "preparing"
    if resume and not app.get("resume_id"):
        values["resume_id"] = resume["resume_id"]
    updated = await rest.update("applications", {"id": f"eq.{application_id}"}, values)
    await rest.insert("application_events", {
        "user_id": user_id, "application_id": application_id, "kind": "prepared",
        "title": "Application prepared",
        "details": f"{len(answer_rows)} answers, {len(prep['interview_questions'])} interview questions"
                   + ("" if generated else " (cover letter unavailable: AI providers were busy)"),
    })
    answers = await rest.select("application_answers", {"application_id": f"eq.{application_id}", "order": "created_at.asc"})
    return PrepResult(application=updated[0] if updated else {**app, **values}, answers=answers,
                      llm_available=generated is not None)
