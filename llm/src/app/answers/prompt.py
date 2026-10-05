"""
Prompt Construction.
The system prompt carries the grounding rules; the user message carries the
question, optional job context, and the evidence retrieved for the question.
"""

from typing import Dict, List, Optional, Tuple

from src.app.schemas.answers import AnswerStyle, FieldContext, JobContext

from .classifier import QuestionAnalysis
from .job_digest import digest
from .profile_context import ProfileContext

# Shared rules, kept short: every answer call sends them. Stable text first, so providers can cache the prefix.
_RULES = """You write job-application answers as the candidate, in first person. The candidate reviews them before a real employer sees them, so truth beats polish.

Grounding (always wins over STYLE):
- Candidate facts come only from CANDIDATE EVIDENCE. Never add or imply employers, projects, skills, tools, metrics, dates, degrees, titles or years it doesn't state.
- JOB CONTEXT is about the employer and role, not the candidate: use it to show relevance, never as something the candidate did.
- If the evidence can't support a truthful answer, set status "insufficient_information", leave answer empty, put in missingInformation one sentence to the candidate ("Your profile doesn't ...") saying what to add, and in missingQuestion one short question whose answer would let you answer. Never write a vague or hedged answer instead.
- Yes/no: "yes" only when the evidence supports it.
- STYLE changes wording, never claims. Never add a fact to sound more enthusiastic, confident or detailed; if the evidence can't fill the length, write less. A character limit is hard.

Writing: like a person, not an AI: direct, specific, contractions if tone allows; no em or en dashes, clichés, sales talk, "passionate about"/"leverage" filler or closing summary. Plain prose, paragraphs split by a blank line; no markdown, headings, bullets (unless asked) or placeholders. No company or role given: say "this role".
"""

_FIELDS = ('"status": "answered" | "insufficient_information", "answer": string, "confidence": "high" | "medium" | "low" '
           '(how directly the evidence supports it), "usedSources": [evidence ids, e.g. "E1", "F2", "S"], '
           '"missingInformation": string | null, "missingQuestion": string | null')

SYSTEM_PROMPT = _RULES + "\nReturn only a JSON object: {" + _FIELDS + "}"

BATCH_SYSTEM_PROMPT = _RULES + """
Several questions from one form come at once, each with an id, GUIDANCE and STYLE, sharing one CANDIDATE EVIDENCE. Each question's EVIDENCE line lists the records retrieved for it: ground its answer in those first, and use another record only if it directly supports that answer. Answer each on its own terms. Do not reuse the same example or project in more than one answer unless asked; they are read together.

Return only a JSON object: {"answers": [one object per question, in order, each {"id": the question's id, """ + _FIELDS + "}]}"

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
        "needs, and never claim a need the profile doesn't support. Write 3-4 paragraphs: an opening tied to the role "
        "and company; one or two paragraphs mapping the job's needs to that real work; a short closing. Use the "
        "company and role from JOB CONTEXT when given; without a job description, build it around the candidate's "
        "strongest work. No greeting or signature unless the question asks for a complete letter; then open with "
        "\"Dear Hiring Manager,\" and sign off with the candidate's name from the profile."
    ),
}

# Word targets per length. Cover letters get their own "detailed".
LENGTH_TARGETS: Dict[str, str] = {
    "concise": "1-3 sentences, about 40-80 words",
    "standard": "about 80-150 words",
    "detailed": "about 180-300 words",
}
COVER_LETTER_DETAILED = "about 250-400 words in 3-4 paragraphs"

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

# Characters of the job description each question type gets (capped by JOB_DESCRIPTION_MAX_CHARS). The
# description is trimmed to the lines most relevant to the question (answers/job_digest.py), so this is a budget
# for relevant text, not a cut-off. Logistics are answered from the profile alone; a skill check or a degree needs
# the role's gist; motivation and cover letters need the company and the role's main needs.
JOB_DESCRIPTION_CHARS: Dict[str, int] = {
    "logistics": 0, "skill_check": 600, "education": 400, "achievement": 800, "behavioral": 600,
    "strengths": 1000, "project": 1000, "experience": 1000, "general": 1000, "about_me": 1200,
    "motivation": 1600, "cover_letter": 2400,
}
INTRO_CATEGORIES = {"motivation", "cover_letter", "about_me"}


def job_description_budget(analyses: List[QuestionAnalysis], max_chars: int) -> int:
    return min(max_chars, max((JOB_DESCRIPTION_CHARS.get(a.category, 1000) for a in analyses), default=1000))


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
        target += f", but never more than {max_length} characters (roughly {words} words); the limit wins"
    return target


def _field_parts(analysis: QuestionAnalysis, field: Optional[FieldContext], style: Optional[AnswerStyle]) -> List[str]:
    """FIELD LABEL, GUIDANCE and STYLE for one question."""
    parts: List[str] = []
    if field and field.label and field.label.strip() and field.label.strip() != analysis.question:
        parts.append(f"FIELD LABEL:\n{field.label.strip()}")

    guidance: List[str] = []
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
    if guidance:
        parts.append("GUIDANCE:\n" + " ".join(guidance))

    if not (field and (field.is_choice or field.kind == "number")):
        max_length = field.max_length if field else None
        style_lines = [f"Tone: {TONE_HINTS[style.tone if style else 'professional']}."]
        if not (field and field.single_line):
            style_lines.insert(0, f"Length: {length_target(resolve_length(style, analysis), analysis, max_length)}.")
        parts.append("STYLE (wording only; the grounding rules still apply):\n" + "\n".join(style_lines))
    return parts


def _job_part(job: Optional[JobContext], analyses: List[QuestionAnalysis], max_chars: int) -> Optional[str]:
    """Company, role and the parts of the description that matter for these questions."""
    if not (job and (job.company or job.role or job.description)):
        return None
    lines = []
    if job.company:
        lines.append(f"Company: {job.company}")
    if job.role:
        lines.append(f"Role: {job.role}")
    query = " ".join([a.question for a in analyses] + [s for a in analyses for s in a.target_skills])
    description = digest(job.description, job_description_budget(analyses, max_chars), query,
                         prefer_intro=any(a.category in INTRO_CATEGORIES for a in analyses))
    if description:
        lines.append("Job description (most relevant parts):\n" + description)
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
    for i, (item_id, analysis, field) in enumerate(items):
        block = [f"QUESTION id={item_id}:\n{analysis.question}"]
        refs = ctx.question_refs[i] if i < len(ctx.question_refs) else []
        if refs:
            block.append("EVIDENCE: " + ", ".join(refs))
        parts.append("\n".join(block + _field_parts(analysis, field, style)))
    job_part = _job_part(job, [analysis for _, analysis, _ in items], job_description_max_chars)
    if job_part:
        parts.append(job_part)
    parts.append("CANDIDATE EVIDENCE:\n" + (ctx.text or "(empty)"))
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
    job_part = _job_part(job, [analysis], job_description_max_chars)
    if job_part:
        parts.append(job_part)

    parts.append("CANDIDATE EVIDENCE:\n" + (ctx.text or "(empty)"))

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
