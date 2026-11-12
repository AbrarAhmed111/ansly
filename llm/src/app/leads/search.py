"""Search indexed public web results and qualify them against a targeting profile."""

import re
from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse

import httpx

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
MAX_QUERIES = 3
MAX_RESULTS_PER_QUERY = 10
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
JOB_PATH_SIGNALS = ("/jobs/", "/job/", "/careers/", "/career/", "/openings/")
EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])")


class PublicSearchError(Exception):
    """The configured external search provider failed or rejected a request."""


def _terms(values: Any, limit: int = 8) -> List[str]:
    if not isinstance(values, list):
        return []
    terms = []
    for value in values:
        if isinstance(value, str):
            term = " ".join("".join(character for character in value if character.isprintable()).strip().split())
            if term and len(term) <= 80 and term.casefold() not in {v.casefold() for v in terms}:
                terms.append(term)
        if len(terms) >= limit:
            break
    return terms


def _quoted(term: str) -> str:
    return '"' + term.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_queries(profile: Dict[str, Any]) -> List[str]:
    """Build a bounded set of public-web searches from user-authored profile terms."""
    roles = _terms(profile.get("target_roles"), 6)
    keywords = _terms(profile.get("keywords"), 6)
    locations = _terms(profile.get("locations"), 2)
    excluded = _terms(profile.get("excluded_keywords"), 3)
    if not roles and not keywords:
        raise ValueError("Add target roles or keywords to this targeting profile before searching.")

    queries: List[str] = []
    role_groups = [roles[index:index + 2] for index in range(0, len(roles), 2)] or [[]]
    for group in role_groups[:MAX_QUERIES]:
        phrases = group or keywords[:2]
        terms = [_quoted(term) for term in phrases]
        query = f'("hiring" OR "looking for" OR "seeking" OR "job opening") ({" OR ".join(terms)})'
        if keywords and group:
            query += f' ({" OR ".join(_quoted(term) for term in keywords[:3])})'
        if locations:
            query += f' ({" OR ".join(_quoted(term) for term in locations)})'
        query += "".join(f" -{_quoted(term)}" for term in excluded)
        queries.append(query)
    return queries


async def search_public_web(query: str, api_key: str) -> List[Dict[str, str]]:
    """Return bounded Brave Search results; never fetch or parse source pages."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                BRAVE_SEARCH_URL,
                params={"q": query, "count": MAX_RESULTS_PER_QUERY, "safesearch": "moderate"},
                headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            )
        if response.status_code in (401, 403):
            raise PublicSearchError("Brave Search rejected the API key. Verify BRAVE_SEARCH_API_KEY.")
        if response.status_code == 429:
            raise PublicSearchError("Brave Search quota or rate limit was reached. Try again later.")
        response.raise_for_status()
        payload = response.json()
    except PublicSearchError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise PublicSearchError("The public search provider could not complete the request.") from exc

    web = payload.get("web", {}) if isinstance(payload, dict) else {}
    items = web.get("results", []) if isinstance(web, dict) else []
    results: List[Dict[str, str]] = []
    for item in items[:MAX_RESULTS_PER_QUERY] if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title, url, description = item.get("title"), item.get("url"), item.get("description")
        if not all(isinstance(value, str) and value.strip() for value in (title, url, description)):
            continue
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            continue
        results.append({
            "title": title.strip()[:300],
            "url": url.strip()[:2000],
            "description": description.strip()[:4000],
        })
    return results


def _contains_term(text: str, term: str) -> bool:
    pattern = rf"(?<!\w){re.escape(term.casefold())}(?!\w)"
    return re.search(pattern, text.casefold()) is not None


def qualify_result(result: Dict[str, str], profile: Dict[str, Any]) -> Dict[str, Any] | None:
    """Use only the search result title/snippet and profile terms; no facts are inferred from absent data."""
    title = result["title"]
    description = result["description"]
    url = result["url"]
    text = f"{title}\n{description}"
    lowered = text.casefold()

    excluded = _terms(profile.get("excluded_keywords"), 100)
    if any(_contains_term(lowered, term) for term in excluded):
        return None

    roles = _terms(profile.get("target_roles"), 100)
    keywords = _terms(profile.get("keywords"), 100)
    matched_roles = [term for term in roles if _contains_term(lowered, term)]
    matched_keywords = [term for term in keywords if _contains_term(lowered, term)]
    if not matched_roles and not matched_keywords:
        return None

    has_hiring_signal = any(signal in lowered for signal in HIRING_SIGNALS)
    path = urlparse(url).path.casefold()
    has_job_path = any(signal in path for signal in JOB_PATH_SIGNALS)
    if not (has_hiring_signal or has_job_path):
        return None

    host = (urlparse(url).hostname or "").lower()
    source_platform = (
        "linkedin" if host == "linkedin.com" or host.endswith(".linkedin.com")
        else "twitter" if host in ("x.com", "twitter.com") or host.endswith(".x.com") or host.endswith(".twitter.com")
        else "reddit" if host == "reddit.com" or host.endswith(".reddit.com")
        else "other"
    )
    opportunity_type = _opportunity_type(lowered)
    match_terms = matched_roles[:4] + matched_keywords[:6]
    reason = "Matched profile terms: " + ", ".join(match_terms)
    if not has_hiring_signal:
        reason += "; job-listing URL detected."

    email_match = EMAIL_RE.search(description)
    contact_info: Dict[str, str] = {}
    contactability = "unknown"
    if email_match:
        contact_info["email"] = email_match.group(0)
        contactability = "email_available"
    elif has_job_path:
        contact_info["application_url"] = url
        contactability = "application_link_available"

    return {
        "source_platform": source_platform,
        "source_name": host,
        "author_name": "Public web listing",
        "company_name": _company_from_title(title),
        "title": title,
        "opportunity_type": opportunity_type,
        "status": "new",
        "contactability": contactability,
        "description": description,
        "original_post_url": url,
        "tags": match_terms,
        "contact_info": contact_info,
        "confidence": min(0.95, 0.55 + 0.1 * len(matched_roles) + 0.04 * len(matched_keywords)),
        "qualification_reason": reason,
        "profile_snapshot": {
            "id": str(profile["id"]),
            "name": str(profile["name"]),
            "description": profile.get("description"),
            "target_roles": roles[:30],
            "keywords": keywords[:30],
        },
    }


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


def _company_from_title(title: str) -> str:
    match = re.search(r"\bat\s+([^|—-]+)$", title, re.IGNORECASE)
    if match:
        candidate = match.group(1).strip()
        if candidate and len(candidate) <= 200:
            return candidate
    return "Unverified employer"


def unique_results(results: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    """Deduplicate provider results by normalized URL."""
    unique: List[Dict[str, str]] = []
    seen = set()
    for result in results:
        parsed = urlparse(result["url"])
        key = f"{parsed.hostname or ''}{parsed.path}".rstrip("/").casefold()
        if key and key not in seen:
            seen.add(key)
            unique.append(result)
    return unique
