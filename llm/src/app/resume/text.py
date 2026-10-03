"""
Text Helpers shared by matching and validation: technology terms and metrics.

Term matching reuses V1's skill precheck (canonicalize + n-gram corpus terms),
so "Postgres" matches "PostgreSQL" and "Next.js" matches "NextJS".
"""

import re
from typing import Iterable, List, Set

from src.app.answers.profile_context import GENERIC_SUFFIXES, _term_ngrams, canonicalize

# Common technologies, so a rewrite can't slip in one the job didn't name either.
# Names that are also everyday words (Go, Rust, Swift, Spring, REST...) are left out to avoid false alarms;
# they are still checked when the job itself names them.
KNOWN_TECH = {
    canonicalize(t) for t in [
        "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Ruby", "PHP", "Kotlin",
        "Scala", "Elixir", "Haskell", "SQL", "Bash", "React", "Next.js", "Vue", "Angular", "Svelte",
        "Node.js", "NestJS", "Django", "Flask", "FastAPI", "Laravel", ".NET",
        "React Native", "Flutter", "Redux", "GraphQL", "gRPC", "PostgreSQL", "MySQL", "SQLite", "MongoDB",
        "Redis", "Elasticsearch", "DynamoDB", "Cassandra", "Kafka", "RabbitMQ", "Supabase", "Firebase", "Prisma",
        "AWS", "GCP", "Azure", "Vercel", "Netlify", "Heroku", "Docker", "Kubernetes", "Terraform", "Ansible",
        "Jenkins", "GitHub Actions", "GitLab CI", "CircleCI", "CI/CD", "Linux", "Nginx", "Tailwind", "Sass",
        "Webpack", "Vite", "Jest", "Cypress", "Playwright", "Selenium", "Pytest", "Storybook", "Figma", "Jira",
        "Snowflake", "Airflow", "dbt", "Hadoop", "Pandas", "NumPy", "TensorFlow", "PyTorch", "scikit-learn",
        "LangChain", "OpenAI", "LLM", "Tableau", "Power BI", "Salesforce", "SAP", "Shopify", "WordPress", "Stripe",
        "EKS", "ECS", "S3", "EC2", "CloudFormation", "BigQuery", "Datadog", "Grafana", "Prometheus",
        "Kubeflow", "OpenShift", "Istio", "Microservices", "Serverless", "WebSockets", "OAuth", "Three.js", "D3",
    ]
}

_NUMBER = re.compile(r"(?<![\w.])[$€£]?\d[\d,]*(?:\.\d+)?\s*(?:%|x\b|k\b|m\b|\+)?", re.IGNORECASE)


def terms(text: str) -> Set[str]:
    """Canonical 1–3-gram terms in `text`."""
    return _term_ngrams(text)


def has_term(corpus_terms: Set[str], term: str) -> bool:
    """V1's has_skill: canonical match, also ignoring generic trailing words ("CI/CD pipelines")."""
    if canonicalize(term) in corpus_terms:
        return True
    words = term.lower().split()
    while words and words[-1] in GENERIC_SUFFIXES:
        words = words[:-1]
        if words and canonicalize(" ".join(words)) in corpus_terms:
            return True
    return False


def tech_terms(text: str, vocabulary: Iterable[str]) -> Set[str]:
    """Technology terms in `text`: known technologies plus `vocabulary` (e.g. the job's skill requirements)."""
    vocab = KNOWN_TECH | {canonicalize(v) for v in vocabulary if v and len(v) <= 40}
    return terms(text) & vocab


def numbers(text: str) -> List[str]:
    """Normalized numbers and metrics in `text`: "35%" -> "35", "$1.2M" -> "1.2", "10,000" -> "10000"."""
    found = []
    for match in _NUMBER.finditer(text):
        digits = re.sub(r"[^\d.]", "", match.group(0)).rstrip(".")
        if digits:
            found.append(digits)
    return found


def number_set(texts: Iterable[str]) -> Set[str]:
    out: Set[str] = set()
    for text in texts:
        out.update(numbers(text or ""))
    return out
