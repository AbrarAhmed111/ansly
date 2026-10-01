"""
Question Classification.

Rule-based, zero-token understanding of an application question:
- category: what kind of question it is (decides which profile sections to retrieve)
- intent: a finer label (used for wording and for matching saved answers)
- target skills: technologies the question asks about ("experience with Kubernetes")
"""

import re
from dataclasses import dataclass, field
from typing import List, Tuple

# Profile sections each category draws on, most relevant first.
CATEGORY_SECTIONS = {
    "about_me": ["experiences", "projects", "skills", "education", "achievements"],
    "motivation": ["experiences", "projects", "skills"],
    "project": ["projects", "experiences", "skills"],
    "experience": ["experiences", "projects", "skills"],
    "skill_check": ["skills", "experiences", "projects"],
    "behavioral": ["experiences", "projects", "achievements"],
    "strengths": ["skills", "experiences", "achievements", "projects"],
    "education": ["education", "achievements"],
    "achievement": ["achievements", "projects", "experiences"],
    "logistics": [],
    "general": ["experiences", "projects", "skills", "education", "achievements"],
}

# (category, intent, patterns). First match wins, so order matters.
RULES: List[Tuple[str, str, List[str]]] = [
    ("logistics", "salary", [r"\bsalary\b", r"\bcompensation\b", r"\bpay (?:range|expectation)", r"\bexpected (?:ctc|pay)\b", r"\bctc\b"]),
    ("logistics", "sponsorship", [r"\bsponsor(?:ship)?\b", r"\bvisa\b"]),
    ("logistics", "work_authorization", [r"\b(?:legally )?authori[sz]ed to work\b", r"\bwork (?:authori[sz]ation|permit)\b", r"\bright to work\b"]),
    ("logistics", "notice_period", [r"\bnotice period\b", r"\bwhen can you start\b", r"\bstart date\b", r"\bearliest (?:start|available)\b", r"\bavailab(?:le|ility) to start\b"]),
    ("logistics", "relocation", [r"\breloca\w*\b"]),
    ("logistics", "work_mode", [r"\b(?:remote|hybrid|on-?site|in[- ]office)\b.*\b(?:prefer|comfortable|open|willing|able)\b", r"\b(?:prefer|comfortable|open|willing|able)\b.*\b(?:remote|hybrid|on-?site|in[- ]office)\b"]),
    ("behavioral", "failure", [r"\b(?:fail(?:ed|ure)?|mistake|went wrong|setback)\b"]),
    ("behavioral", "conflict", [r"\b(?:conflict|disagree\w*|difficult (?:colleague|coworker|stakeholder|person))\b"]),
    ("behavioral", "leadership", [r"\b(?:led|lead(?:ing|ership)?|mentor\w*|took (?:the )?initiative)\b.*\b(?:time|example|situation|team)\b"]),
    ("project", "technical_challenge", [r"\b(?:technical(?:ly)?|engineering)\b.*\b(?:challeng\w*|difficult|hard\w*|complex)\b", r"\b(?:challeng\w*|difficult|hardest|complex)\b.*\b(?:technical|bug|system|problem you solved)\b"]),
    ("behavioral", "challenge", [r"\b(?:tell (?:us|me) about|describe|share|give (?:us|me)? ?an example of) a (?:time|situation|moment)\b", r"\bchalleng\w*\b", r"\bunder pressure\b", r"\btight deadline\b"]),
    ("project", "favorite_project", [r"\bproject\b.*\b(?:proud|favou?rite|enjoy\w*|love\w*|best|most)\b", r"\b(?:proud|favou?rite|enjoy\w*|love\w*|best|most)\b.*\bproject\b", r"\bproud of\b"]),
    ("project", "project", [r"\bprojects?\b", r"\b(?:something|anything) you(?:'ve| have)? built\b", r"\bside project\b", r"\bportfolio\b"]),
    ("motivation", "motivation_company", [r"\bwhy (?:do you want to |would you like to )?(?:work|join)\b.*\b(?:us|here|company|team)\b", r"\bwhy (?:do you want to|would you like to) (?:work (?:at|for|with)|join)\b", r"\bwhy (?:us|our company)\b", r"\bwhat (?:do you know|interests you) about (?:us|our|the company)\b"]),
    ("motivation", "motivation_role", [r"\bwhy (?:are you|do you|would you)\b.*\b(?:interest\w*|want|apply\w*|excit\w*|attract\w*)\b", r"\bwhat (?:excites|attracts|interests|motivates) you\b", r"\binterest(?:ed)? in (?:this|the) (?:role|position|job|opportunity)\b", r"\bwhy this (?:role|position|job)\b"]),
    ("strengths", "weakness", [r"\bweakness\w*\b", r"\barea(?:s)? (?:for|of) improvement\b"]),
    ("strengths", "strengths", [r"\bstrength\w*\b", r"\bwhy should we hire\b", r"\bwhat makes you (?:unique|stand out|a good fit|the right)\b", r"\bwhat (?:would you|can you) bring\b", r"\bgood fit\b"]),
    ("education", "education", [r"\b(?:degree|education|university|college|school|studied|coursework|gpa|certification)\b"]),
    ("achievement", "achievement", [r"\b(?:achievement|accomplishment|award|recognition|proudest)\b"]),
    ("about_me", "about_me", [r"\btell (?:us|me) (?:a bit |a little )?about yourself\b", r"\bintroduce yourself\b", r"\bdescribe yourself\b", r"\b(?:professional )?summary\b", r"\bcover letter\b", r"\babout you\b"]),
    ("skill_check", "skill_years", [r"\bhow many years\b"]),
    ("skill_check", "skill_check", [r"\b(?:do|have) you (?:have )?(?:any )?(?:professional |hands-on |prior )?(?:experience|familiarity|exposure|knowledge)\b", r"\bhave you (?:ever )?(?:used|worked with|built with|deployed|written)\b", r"\bare you (?:familiar|proficient|comfortable|experienced)\b", r"\brate your\b"]),
    ("experience", "experience", [r"\bexperience\b", r"\bbackground\b", r"\b(?:current|previous|past) (?:role|job|position|employer)\b", r"\bresponsibilities\b", r"\bwork history\b"]),
]

_SKILL_PATTERNS = [
    r"\byears of (?:professional |hands-on )?experience (?:do you have |have you had )?(?:with|in|using)\s+(?P<skill>[^?;:!]+)",
    r"\b(?:experience|familiarity|exposure|expertise|knowledge|proficiency|background|skills?)\s+(?:with|in|using|of|on|working with)\s+(?P<skill>[^?;:!]+)",
    r"\b(?:familiar|proficient|comfortable|experienced|skilled)\s+(?:with|in|using)\s+(?P<skill>[^?;:!]+)",
    r"\bhave you (?:ever )?(?:used|worked with|built with|built (?:anything|something) (?:with|in)|deployed|written)\s+(?P<skill>[^?;:!]+)",
    r"\b(?:worked|work|built|develop(?:ed)?) (?:with|in|using)\s+(?P<skill>[^?;:!]+)",
    r"\brate your\s+(?P<skill>[^?;:!]+?)\s+(?:skills?|experience|proficiency)\b",
]

# Words that mean the phrase is about a situation, not a technology.
_NON_SKILL_WORDS = {
    "team", "teams", "environment", "environments", "customer", "customers", "client", "clients",
    "startup", "startups", "people", "deadline", "deadlines", "pressure", "stakeholder", "stakeholders",
    "leadership", "management", "colleague", "colleagues", "company", "companies", "role", "roles",
    "position", "industry", "domain", "users", "user", "product", "products", "this", "that", "our", "us",
    "ambiguity", "change", "feedback", "remote", "travel", "shifts", "weekends", "it", "them",
}

_TRAILING_NOISE = re.compile(
    r"\b(?:and how|if so|please|in a professional setting|professionally|in production|at scale|"
    r"in your (?:current|previous|last) (?:role|job|position)|(?:for|over) (?:the )?(?:last|past) .*|"
    r"(?:to )?build\w* .*|to (?:develop|create|deploy|ship|implement|design|manage|run) .*)\b.*$"
)
_LEADING_NOISE = re.compile(r"^(?:any|some|the|a|an|modern|tools like|technologies like|frameworks like|such as)\s+")


@dataclass
class QuestionAnalysis:
    question: str
    category: str
    intent: str
    sections: List[str]
    target_skills: List[str] = field(default_factory=list)


def normalize_question(question: str) -> str:
    text = question.strip().lower().replace("’", "'")
    text = re.sub(r"\s+", " ", text)
    return text.rstrip(" *:")


def extract_target_skills(text: str) -> List[str]:
    """Technologies the question names, e.g. 'experience with React and Next.js?' -> ['react', 'next.js']."""
    skills: List[str] = []
    for pattern in _SKILL_PATTERNS:
        for match in re.finditer(pattern, text):
            # Keep dots inside names like "Next.js", but stop at a sentence break.
            phrase = re.split(r"\.(?:\s|$)", match.group("skill"))[0]
            phrase = _TRAILING_NOISE.sub("", phrase).strip()
            # Slash-joined acronyms are one skill ("CI/CD"); otherwise a slash separates skills.
            phrase = re.sub(r"\b([a-z]{1,3})/([a-z]{1,3})\b", r"\1-\2", phrase)
            for part in re.split(r",|/|\band\b|\bor\b|&|\bas well as\b", phrase):
                part = _LEADING_NOISE.sub("", part.strip(" -()'\"")).strip()
                part = re.sub(r"\s+(?:skills?|experience|framework|library|language|technologies)$", "", part)
                words = part.split()
                if not words or len(words) > 4:
                    continue
                if any(w in _NON_SKILL_WORDS for w in words):
                    continue
                if part not in skills:
                    skills.append(part)
    return skills


def classify_question(question: str) -> QuestionAnalysis:
    text = normalize_question(question)
    category, intent = "general", "general"
    for rule_category, rule_intent, patterns in RULES:
        if any(re.search(p, text) for p in patterns):
            category, intent = rule_category, rule_intent
            break

    target_skills = extract_target_skills(text) if category in ("skill_check", "experience", "general") else []
    # "Describe your experience with React" is really a skill question.
    if category in ("experience", "general") and target_skills:
        category, intent = "skill_check", "skill_experience"

    return QuestionAnalysis(
        question=question.strip(),
        category=category,
        intent=intent,
        sections=list(CATEGORY_SECTIONS[category]),
        target_skills=target_skills,
    )
