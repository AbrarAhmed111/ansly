"""
Prompt Construction.
The system prompt carries the grounding rules; the user message carries the
question, optional job context, and the retrieved profile.
"""

from typing import Dict, List, Optional, Sequence, Tuple

from src.app.schemas.answers import FieldContext, JobContext

from .classifier import QuestionAnalysis
from .profile_context import ProfileContext

SYSTEM_PROMPT = """You write answers to job application questions on behalf of a candidate. The candidate will review and edit your answer before submitting it to a real employer, so truthfulness matters more than polish.

Grounding rules:
- Use only facts stated in the CANDIDATE PROFILE. Do not add employers, projects, skills, tools, metrics, dates, degrees, titles, or years of experience that are not there, and do not imply experience with anything the profile does not mention.
- JOB CONTEXT describes the employer and the role, not the candidate. You may use it to explain why the candidate's real experience is relevant, but never present a job requirement as something the candidate has done.
- If the profile does not contain enough to answer the question truthfully, set status to "insufficient_information", leave answer empty, and use missingInformation to tell the candidate directly, in one sentence addressed to them as "you" ("Your profile doesn't ..."), what to add to their profile. Do this instead of writing a vague, hedged, or partial answer.
- For yes/no questions, answer "yes" only when the profile supports it.

Writing style:
- First person, as the candidate. Natural and specific, not salesy; no clichés like "I am excited to apply" or "I am a passionate".
- Concise by default: usually 60–150 words, or one or two sentences for short factual questions. Respect any character limit given.
- Plain prose. No headings, no markdown, no bullet points unless the question asks for a list, and no placeholders such as [Company].
- If no company or role is given, don't invent one; refer to "this role" or "your team" instead.

Return only a JSON object with exactly these keys:
{"status": "answered" | "insufficient_information", "answer": string, "confidence": "high" | "medium" | "low", "usedSources": [source ids from the profile, e.g. "E1", "P2", "S"], "missingInformation": string | null}
confidence reflects how directly the profile supports the answer."""

INTENT_HINTS: Dict[str, str] = {
    "motivation_role": "Connect specific parts of the candidate's real experience to what this role involves.",
    "motivation_company": "Connect the candidate's real experience to what the company does, using only the job context for facts about the company.",
    "favorite_project": "Pick one project and say what it is, what the candidate did, and why it stands out.",
    "technical_challenge": "Describe one concrete technical problem from the profile, what the candidate did, and the outcome. Use situation, action, result if the profile has enough detail.",
    "challenge": "Use one concrete situation from the profile (situation, action, result). If the profile has no such situation, report insufficient information.",
    "conflict": "Only answer if the profile describes a relevant situation; otherwise report insufficient information.",
    "failure": "Only answer if the profile describes a relevant situation; otherwise report insufficient information.",
    "leadership": "Only use leadership or mentoring the profile actually describes.",
    "skill_check": "Start with a direct yes or no, then give the concrete evidence from the profile.",
    "skill_experience": "Describe where and how the candidate used the technology, citing specific roles or projects.",
    "skill_years": "Only state a number of years if the profile gives one or it follows directly from dated roles that use the skill. Otherwise describe the experience without a number.",
    "strengths": "Name one or two strengths and back each with evidence from the profile.",
    "weakness": "Only answer if the profile gives something to base it on; otherwise report insufficient information.",
    "about_me": "Summarize the candidate's background, focus, and most relevant work.",
    "salary": "State the candidate's salary expectation exactly as given in the profile.",
    "sponsorship": "Answer from the profile's sponsorship field only.",
    "work_authorization": "Answer from the profile's work authorization field only.",
    "notice_period": "Answer from the profile's notice period / availability field only.",
    "relocation": "Answer from the profile's relocation field only.",
    "work_mode": "Answer from the profile's preferred work mode only.",
}


def build_user_message(
    analysis: QuestionAnalysis,
    ctx: ProfileContext,
    job: Optional[JobContext],
    field: Optional[FieldContext],
    previous_answer: Optional[str] = None,
    instruction: Optional[str] = None,
    job_description_max_chars: int = 6000,
    requirements: Sequence[str] = (),
    earlier_answers: Sequence[Tuple[str, str]] = (),
) -> str:
    parts: List[str] = [f"QUESTION:\n{analysis.question}"]
    if field and field.label and field.label.strip() and field.label.strip() != analysis.question:
        parts.append(f"FIELD LABEL:\n{field.label.strip()}")

    guidance = [f"Question type: {analysis.category} / {analysis.intent}."]
    if analysis.intent in INTENT_HINTS:
        guidance.append(INTENT_HINTS[analysis.intent])
    if analysis.target_skills:
        guidance.append("Technologies asked about: " + ", ".join(analysis.target_skills) + ".")
    if field and field.max_length:
        guidance.append(f"The answer must be at most {field.max_length} characters.")
    if field and field.kind == "input":
        guidance.append("This is a single-line field: answer in one or two short sentences.")
    parts.append("GUIDANCE:\n" + " ".join(guidance))

    if job and (job.company or job.role or job.description):
        lines = []
        if job.company:
            lines.append(f"Company: {job.company}")
        if job.role:
            lines.append(f"Role: {job.role}")
        if job.description:
            lines.append("Job description:\n" + job.description.strip()[:job_description_max_chars])
        if requirements:
            lines.append("Skills the posting asks for: " + ", ".join(requirements))
        parts.append("JOB CONTEXT (about the employer, not the candidate):\n" + "\n".join(lines))

    parts.append("CANDIDATE PROFILE:\n" + (ctx.text or "(empty)"))

    if earlier_answers:
        earlier = "\n".join(f"Q: {q}\nA: {a}" for q, a in earlier_answers)
        parts.append(
            "EARLIER ANSWERS IN THIS SAME APPLICATION (keep facts, numbers and tone consistent with them; "
            "don't repeat them word for word; they are not a source of new facts):\n" + earlier
        )

    if previous_answer:
        steer = f" The candidate asked: {instruction.strip()}" if instruction and instruction.strip() else ""
        parts.append(
            "PREVIOUS ANSWER (write a new version with different wording and, where the profile allows, "
            f"a different angle; keep it equally truthful).{steer}\n{previous_answer.strip()}"
        )
    return "\n\n".join(parts)
