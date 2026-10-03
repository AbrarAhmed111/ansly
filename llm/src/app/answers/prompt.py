"""
Prompt Construction.
The system prompt carries the grounding rules; the user message carries the
question, optional job context, and the retrieved profile.
"""

from typing import Dict, List, Optional, Tuple

from src.app.schemas.answers import AnswerStyle, FieldContext, JobContext

from .classifier import QuestionAnalysis
from .profile_context import ProfileContext

SYSTEM_PROMPT = """You write answers to job application questions on behalf of a candidate. The candidate will review and edit your answer before submitting it to a real employer, so truthfulness matters more than polish.

Grounding rules:
- Use only facts stated in the CANDIDATE PROFILE. Do not add employers, projects, skills, tools, metrics, dates, degrees, titles, or years of experience that are not there, and do not imply experience with anything the profile does not mention.
- JOB CONTEXT describes the employer and the role, not the candidate. You may use it to explain why the candidate's real experience is relevant, but never present a job requirement as something the candidate has done.
- If the profile does not contain enough to answer the question truthfully, set status to "insufficient_information", leave answer empty, and use missingInformation to tell the candidate directly, in one sentence addressed to them as "you" ("Your profile doesn't ..."), what to add to their profile. Do this instead of writing a vague, hedged, or partial answer.
- For yes/no questions, answer "yes" only when the profile supports it.

The grounding rules above always win over the STYLE section of the message: tone and length change how the answer is worded, never what it claims. Never add a fact to sound more enthusiastic, confident or detailed; if the profile can't fill the target length truthfully, write less.

Writing style:
- First person, as the candidate. Natural and specific, not salesy; no clichés like "I am excited to apply" or "I am a passionate".
- Follow the length target and tone in STYLE. Any character limit given is a hard limit and beats the length target.
- Plain prose, in paragraphs separated by a blank line when there is more than one. No headings, no markdown, no bullet points unless the question asks for a list, and no placeholders such as [Company].
- If no company or role is given, don't invent one; refer to "this role" or "your team" instead.

Return only a JSON object with exactly these keys:
{"status": "answered" | "insufficient_information", "answer": string, "confidence": "high" | "medium" | "low", "usedSources": [source ids from the profile, e.g. "E1", "P2", "S"], "missingInformation": string | null, "missingQuestion": string | null}
confidence reflects how directly the profile supports the answer. When status is "insufficient_information", missingQuestion is one short question to ask the candidate whose answer would let you answer truthfully (e.g. "Describe a time you led a team: what was the situation and what did you do?"); otherwise null."""

BATCH_SYSTEM_PROMPT = SYSTEM_PROMPT.split("Return only a JSON object")[0] + """Several questions from the same application form come at once, each with its own id, GUIDANCE and STYLE, and one shared CANDIDATE PROFILE.
- Answer each question on its own terms.
- Do not reuse the same example or project in more than one answer unless the question asks for it; the answers will be read together.

Return only a JSON object: {"answers": [one object per question, in the same order]} where each object has exactly these keys:
{"id": the question's id, "status": "answered" | "insufficient_information", "answer": string, "confidence": "high" | "medium" | "low", "usedSources": [source ids], "missingInformation": string | null, "missingQuestion": string | null}
confidence reflects how directly the profile supports the answer. missingQuestion follows the same rule as for a single question: one short question to ask the candidate when the profile isn't enough, otherwise null."""

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
    "cover_letter": (
        "This is a cover letter field. Write it for this job: first work out the two or three main needs in the JOB "
        "CONTEXT's description (for example AI/ML or LLM work, full-stack product development, open-source work, a "
        "domain or industry). Then, for each need, cite the candidate's matching work from the profile by name: their "
        "AI projects for AI needs; their professional full-stack work and open-source projects for full-stack needs; "
        "and so on. Profile items are listed most relevant to the job first. Leave out work unrelated to what the job "
        "needs, and never claim a need the profile doesn't support. Write 3–4 paragraphs: an opening tied to the role "
        "and company; one or two paragraphs mapping the job's needs to that real work; a short closing. Use the "
        "company and role from JOB CONTEXT when given; without a job description, build it around the candidate's "
        "strongest work. No greeting or signature unless the question asks for a complete letter; then open with "
        "\"Dear Hiring Manager,\" and sign off with the candidate's name from the profile."
    ),
}

# Word targets per length. Cover letters get their own "detailed".
LENGTH_TARGETS: Dict[str, str] = {
    "concise": "1–3 sentences, about 40–80 words",
    "standard": "about 80–150 words",
    "detailed": "about 180–300 words",
}
COVER_LETTER_DETAILED = "about 250–400 words in 3–4 paragraphs"

# Default length when the user leaves it on "auto".
CATEGORY_DEFAULT_LENGTH: Dict[str, str] = {
    "cover_letter": "detailed",
    "skill_check": "concise",
    "logistics": "concise",
}

TONE_HINTS: Dict[str, str] = {
    "professional": "professional: clear, measured and direct",
    "friendly": "friendly: warm and approachable, still professional",
    "enthusiastic": "enthusiastic: show genuine interest through specifics, not exclamation marks or superlatives",
    "confident": "confident: state real accomplishments plainly, without hedging or overstating",
    "formal": "formal: polished business register, no contractions or casual phrasing",
    "technical": "technical: precise about technologies, systems and trade-offs that the profile mentions",
}

# Rough characters per word, used to fit a word target into a character limit.
CHARS_PER_WORD = 6


def resolve_length(style: Optional[AnswerStyle], analysis: QuestionAnalysis) -> str:
    """The concrete length: the user's choice, or the category default for "auto"."""
    length = style.length if style else "auto"
    if length == "auto":
        return CATEGORY_DEFAULT_LENGTH.get(analysis.category, "standard")
    return length


def length_target(length: str, analysis: QuestionAnalysis, max_length: Optional[int]) -> str:
    target = COVER_LETTER_DETAILED if length == "detailed" and analysis.category == "cover_letter" else LENGTH_TARGETS[length]
    if max_length:
        words = max(max_length // CHARS_PER_WORD, 5)
        target += f", but never more than {max_length} characters (roughly {words} words) — the limit wins"
    return target


def _field_parts(analysis: QuestionAnalysis, field: Optional[FieldContext], style: Optional[AnswerStyle]) -> List[str]:
    """FIELD LABEL, GUIDANCE and STYLE for one question."""
    parts: List[str] = []
    if field and field.label and field.label.strip() and field.label.strip() != analysis.question:
        parts.append(f"FIELD LABEL:\n{field.label.strip()}")

    guidance = [f"Question type: {analysis.category} / {analysis.intent}."]
    if analysis.intent in INTENT_HINTS:
        guidance.append(INTENT_HINTS[analysis.intent])
    if analysis.target_skills:
        guidance.append("Technologies asked about: " + ", ".join(analysis.target_skills) + ".")
    if field and field.max_length:
        guidance.append(f"The answer must be at most {field.max_length} characters.")
    if field and field.is_choice:
        options = "; ".join(f'"{o}"' for o in field.options or [])
        if field.kind == "choice_multi":
            guidance.append(
                f"This is a multiple-choice field. Options: {options}. The answer is every option the profile supports, "
                'copied exactly and separated by " | ". If the profile supports none, report insufficient information.'
            )
        else:
            guidance.append(
                f"This is a choice field. Options: {options}. The answer is exactly one option, copied exactly, with "
                "nothing else. If the profile doesn't support any option, report insufficient information."
            )
    elif field and field.kind == "number":
        guidance.append(
            "This is a number field: the answer is a number only (digits, no words or units). Only give a number the "
            "profile supports; otherwise report insufficient information."
        )
    elif field and field.single_line:
        guidance.append("This is a single-line field: answer in one or two short sentences.")
    parts.append("GUIDANCE:\n" + " ".join(guidance))

    if not (field and (field.is_choice or field.kind == "number")):
        max_length = field.max_length if field else None
        style_lines = [f"Tone: {TONE_HINTS[style.tone if style else 'professional']}."]
        if not (field and field.single_line):
            style_lines.insert(0, f"Length: {length_target(resolve_length(style, analysis), analysis, max_length)}.")
        parts.append("STYLE (wording only; the grounding rules still apply):\n" + "\n".join(style_lines))
    return parts


def _job_part(job: Optional[JobContext], job_description_max_chars: int) -> Optional[str]:
    if not (job and (job.company or job.role or job.description)):
        return None
    lines = []
    if job.company:
        lines.append(f"Company: {job.company}")
    if job.role:
        lines.append(f"Role: {job.role}")
    if job.description:
        lines.append("Job description:\n" + job.description.strip()[:job_description_max_chars])
    return "JOB CONTEXT (about the employer, not the candidate):\n" + "\n".join(lines)


def build_batch_message(
    items: List[Tuple[str, QuestionAnalysis, Optional[FieldContext]]],
    ctx: ProfileContext,
    job: Optional[JobContext],
    style: Optional[AnswerStyle],
    job_description_max_chars: int = 6000,
) -> str:
    """One message for several questions: per-question blocks, then the shared job context and profile."""
    parts: List[str] = []
    for item_id, analysis, field in items:
        block = [f"QUESTION id={item_id}:\n{analysis.question}"] + _field_parts(analysis, field, style)
        parts.append("\n".join(block))
    job_part = _job_part(job, job_description_max_chars)
    if job_part:
        parts.append(job_part)
    parts.append("CANDIDATE PROFILE:\n" + (ctx.text or "(empty)"))
    instruction = (style.instruction or "").strip() if style else ""
    if instruction:
        parts.append(f"CANDIDATE'S INSTRUCTION (applies to every answer, unless it conflicts with the grounding rules):\n{instruction}")
    return "\n\n".join(parts)


def build_user_message(
    analysis: QuestionAnalysis,
    ctx: ProfileContext,
    job: Optional[JobContext],
    field: Optional[FieldContext],
    previous_answer: Optional[str] = None,
    instruction: Optional[str] = None,
    job_description_max_chars: int = 6000,
    style: Optional[AnswerStyle] = None,
) -> str:
    parts: List[str] = [f"QUESTION:\n{analysis.question}"]
    parts += _field_parts(analysis, field, style)
    job_part = _job_part(job, job_description_max_chars)
    if job_part:
        parts.append(job_part)

    parts.append("CANDIDATE PROFILE:\n" + (ctx.text or "(empty)"))

    # The style's instruction (popover / panel) and regenerate's own instruction are the same thing.
    instruction = (instruction or "").strip() or ((style.instruction or "").strip() if style else "")
    if instruction and not previous_answer:
        parts.append(f"CANDIDATE'S INSTRUCTION (follow it unless it conflicts with the grounding rules):\n{instruction}")

    if previous_answer:
        steer = f" The candidate asked: {instruction}" if instruction else ""
        parts.append(
            "PREVIOUS ANSWER (write a new version with different wording and, where the profile allows, "
            f"a different angle; keep it equally truthful).{steer}\n{previous_answer.strip()}"
        )
    return "\n\n".join(parts)
