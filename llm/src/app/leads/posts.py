"""Qualify LinkedIn posts the user loaded and sent from the extension against a targeting profile.

Only the post fields the extension read from the user's own search page are used. Nothing is fetched,
no contact detail is guessed, and a match is a relevance signal, not a verification of the author or offer.
"""

import hashlib
import re
import unicodedata
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])")
HIRING_SIGNALS = (
    "hiring",
    "we are looking for",
    "we're looking for",
    "looking for",
    "seeking",
    "join our team",
    "open position",
    "open role",
    "job opening",
    "apply now",
    "career opportunity",
)


def _terms(values: Any, limit: int = 8) -> List[str]:
    """User-authored profile terms: printable, single-spaced, at most 80 characters, no case-insensitive repeats."""
    if not isinstance(values, list):
        return []
    terms: List[str] = []
    for value in values:
        if isinstance(value, str):
            term = " ".join("".join(character for character in value if character.isprintable()).strip().split())
            if term and len(term) <= 80 and term.casefold() not in {v.casefold() for v in terms}:
                terms.append(term)
        if len(terms) >= limit:
            break
    return terms


def _opportunity_type(text: str) -> str:
    for term, value in (
        ("freelance", "freelance"),
        ("consultant", "consulting"),
        ("consulting", "consulting"),
        ("part-time", "part_time"),
        ("part time", "part_time"),
        ("contract", "contract"),
        ("startup", "startup"),
    ):
        if term in text:
            return value
    return "job"

ACTIVITY_URN_RE = re.compile(r"^urn:li:activity:\d{1,30}$")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.IGNORECASE)
# A bare "company.com/jobs" link. A path is required, and code-ish suffixes are excluded, so "Node.js" never counts.
BARE_LINK_RE = re.compile(
    r"(?<![\w@./-])(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?!(?:js|ts|py|net)/)[a-z]{2,12}/[^\s<>\"')\]]*",
    re.IGNORECASE,
)
POST_SIGNALS = HIRING_SIGNALS + (
    "developer needed",
    "need a developer",
    "need an engineer",
    "looking to hire",
    "freelancer",
    "freelance",
    "contract role",
    "build an mvp",
    "build my",
    "build our",
    "send your cv",
    "send your resume",
    "apply here",
    "apply via",
)
TITLE_LENGTH = 140


def _is_linkedin(host: Optional[str]) -> bool:
    host = (host or "").lower()
    return host == "linkedin.com" or host.endswith(".linkedin.com")


def canonical_post_url(source_post_id: Optional[str], original_post_url: Optional[str]) -> Optional[str]:
    """A stable post URL: built from the activity URN when present, else the LinkedIn URL without query/fragment."""
    if source_post_id and ACTIVITY_URN_RE.match(source_post_id):
        return f"https://www.linkedin.com/feed/update/{source_post_id}/"
    if not original_post_url:
        return None
    parsed = urlparse(original_post_url)
    if parsed.scheme != "https" or not _is_linkedin(parsed.hostname):
        return None
    urn = re.search(r"urn:li:activity:\d{1,30}", parsed.path)
    if urn:
        return f"https://www.linkedin.com/feed/update/{urn.group(0)}/"
    path = parsed.path.rstrip("/")
    return f"https://www.linkedin.com{path}/" if path else None


def canonical_profile_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme != "https" or not _is_linkedin(parsed.hostname) or not parsed.path.startswith("/in/"):
        return None
    return f"https://www.linkedin.com{parsed.path.rstrip('/')}/"


def post_identity(candidate: Dict[str, Any]) -> str:
    """Use LinkedIn's activity URN when present, otherwise hash the loaded post content."""
    source_post_id = candidate.get("source_post_id")
    if isinstance(source_post_id, str) and ACTIVITY_URN_RE.fullmatch(source_post_id):
        return source_post_id

    author = canonical_profile_url(candidate.get("author_profile_url")) or (candidate.get("author_name") or "").strip().casefold()
    text = " ".join(unicodedata.normalize("NFKC", candidate["post_text"]).split()).casefold()
    digest = hashlib.sha256(f"{author}\n{text}".encode("utf-8")).hexdigest()
    return f"ansly:sha256:{digest}"


def _title(text: str) -> str:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), text.strip())
    return first_line if len(first_line) <= TITLE_LENGTH else first_line[: TITLE_LENGTH - 1].rstrip() + "…"


def normalize(text: str) -> str:
    """Fold styled Unicode (for example 𝗛𝗶𝗿𝗶𝗻𝗴) to plain text and treat hyphens as spaces, for matching only."""
    return re.sub(r"[-‐-―]", " ", unicodedata.normalize("NFKC", text)).casefold()


def _matches(text: str, term: str) -> bool:
    """Whole-word match that also accepts a plural and a JS suffix: "angular" matches "Angular", "AngularJS",
    "Angular.js"; "dm" matches "DM" and "DMs". "java" never matches "JavaScript"."""
    return re.search(rf"(?<!\w){re.escape(normalize(term))}(?:s|js|\.js)?(?!\w)", text) is not None


def _contact(text: str) -> Optional[tuple[str, Dict[str, str]]]:
    """Return an email, contact form, or apply link found in the loaded post text."""
    plain = unicodedata.normalize("NFKC", text)
    email = EMAIL_RE.search(plain)
    if email:
        return "email_available", {"email": email.group(0)}
    for link in URL_RE.findall(plain):
        normalized_link = link.rstrip(".,;:!?")
        if re.search(r"/(?:contact|contact-us|contact-form|forms?)(?:[/#?]|$)", normalized_link, re.IGNORECASE):
            return "contact_form_available", {"contact_form_url": normalized_link}
    link = URL_RE.search(plain)
    if link:
        return "application_link_available", {"application_url": link.group(0).rstrip(".,;:!?")}
    bare = BARE_LINK_RE.search(plain)
    if bare:
        return "application_link_available", {"application_url": "https://" + bare.group(0).rstrip(".,;:!?")}
    return None


def qualify_post(candidate: Dict[str, Any], profile: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a lead row for a relevant opportunity post, or None when it should be filtered out."""
    text: str = candidate["post_text"]
    lowered = normalize(text)

    # Posts with no email and no apply link ("comment X", "DM me") are reach farming; they are never saved.
    contact = _contact(text)
    if contact is None:
        return None
    contactability, contact_info = contact

    excluded = _terms(profile.get("excluded_keywords"), 100)
    if any(_matches(lowered, term) for term in excluded):
        return None

    roles = _terms(profile.get("target_roles"), 100)
    keywords = _terms(profile.get("keywords"), 100)
    matched_roles = [term for term in roles if _matches(lowered, term)]
    matched_keywords = [term for term in keywords if _matches(lowered, term)]
    if not matched_roles and not matched_keywords:
        return None
    if not any(signal in lowered for signal in POST_SIGNALS):
        return None

    profile_url = canonical_profile_url(candidate.get("author_profile_url"))
    if profile_url:
        contact_info["profile_url"] = profile_url
    match_terms = matched_roles[:4] + matched_keywords[:6]

    return {
        "source_platform": "linkedin",
        "source_name": "LinkedIn",
        "author_name": (candidate.get("author_name") or "").strip()[:200] or "Unknown author",
        "author_profile_url": profile_url,
        "company_name": "Unverified employer",
        "title": _title(text),
        "opportunity_type": _opportunity_type(lowered),
        "status": "new",
        "contactability": contactability,
        "description": text,
        "publication_date": candidate.get("published_at"),
        "original_post_url": candidate["canonical_url"],
        "tags": match_terms,
        "contact_info": contact_info,
        # Email posts rank above link-only posts; more matched terms rank higher within each tier.
        "confidence": round(
            (0.7 if contactability == "email_available" else 0.5)
            + min(0.25, 0.08 * len(matched_roles) + 0.03 * len(matched_keywords)),
            2,
        ),
        "qualification_reason": "Matched profile terms: " + ", ".join(match_terms),
        "profile_snapshot": {
            "id": str(profile["id"]),
            "name": str(profile["name"]),
            "description": profile.get("description"),
            "target_roles": roles[:30],
            "keywords": keywords[:30],
        },
    }
