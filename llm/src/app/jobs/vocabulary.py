"""
Skill Vocabulary.

The technologies Ansly recognizes in job postings and search queries, each
with the spellings that count as it. Names are the display form stored on
`jobs.skills`; matching against a profile goes through
`answers.profile_context.canonicalize`, so "Node", "node.js" and "NodeJS" are
the same skill.

Terms that are also ordinary English words ("React", "Go", "Swift", "Rust")
only match with their usual capitalization.
"""

import re
from typing import Dict, List, Pattern, Tuple

# (display name, extra regex alternatives, case-sensitive)
_SKILLS: List[Tuple[str, List[str], bool]] = [
    # Languages
    ("JavaScript", [r"javascript", r"ecmascript", r"es6"], False),
    ("TypeScript", [r"typescript"], False),
    ("Python", [r"python"], False),
    ("Java", [r"java(?!\s*script)"], False),
    ("Kotlin", [r"kotlin"], False),
    ("Swift", [r"Swift(?!UI)"], True),
    ("Objective-C", [r"objective-c"], False),
    ("Go", [r"Go(?=[\s,/).;]|$)(?!\s+(?:to|through|beyond|above|live|out|back|deep|further|ahead)\b)", r"golang"], True),
    ("Rust", [r"Rust"], True),
    ("C++", [r"c\+\+"], False),
    ("C#", [r"c#"], False),
    ("Ruby", [r"ruby(?!\s+on\s+rails)"], False),
    ("PHP", [r"php"], False),
    ("Scala", [r"scala"], False),
    ("Elixir", [r"elixir"], False),
    ("Erlang", [r"erlang"], False),
    ("Haskell", [r"haskell"], False),
    ("Clojure", [r"clojure"], False),
    ("Dart", [r"Dart"], True),
    ("Lua", [r"lua"], False),
    ("Julia", [r"Julia"], True),
    ("SQL", [r"sql"], False),
    ("Bash", [r"bash", r"shell scripting"], False),
    ("Solidity", [r"solidity"], False),
    ("HTML", [r"html5?"], False),
    ("CSS", [r"css3?"], False),
    ("Sass", [r"sass", r"scss"], False),
    ("GraphQL", [r"graphql"], False),
    # Frontend and mobile
    ("React", [r"React(?:\.?js)?(?!\s*Native)"], True),
    ("React Native", [r"react\s+native"], False),
    ("Next.js", [r"next\.?js"], False),
    ("Vue.js", [r"vue(?:\.?js)?"], False),
    ("Nuxt", [r"nuxt(?:\.?js)?"], False),
    ("Angular", [r"angular(?:js)?"], False),
    ("Svelte", [r"svelte(?:kit)?"], False),
    ("Remix", [r"Remix"], True),
    ("Astro", [r"Astro"], True),
    ("Redux", [r"redux"], False),
    ("Tailwind CSS", [r"tailwind(?:\s*css)?"], False),
    ("Vite", [r"Vite"], True),
    ("Webpack", [r"webpack"], False),
    ("Flutter", [r"flutter"], False),
    ("Electron", [r"Electron"], True),
    ("jQuery", [r"jquery"], False),
    ("Storybook", [r"storybook"], False),
    ("Three.js", [r"three\.?js"], False),
    ("D3.js", [r"d3(?:\.js)?"], False),
    ("iOS", [r"iOS"], True),
    ("Android", [r"android"], False),
    ("SwiftUI", [r"swiftui"], False),
    ("Jetpack Compose", [r"jetpack compose"], False),
    # Backend
    ("Node.js", [r"node(?:\.?js)"], False),
    ("Express.js", [r"express(?:\.?js)", r"Express(?=\s*(?:,|/|\)|and|or))"], False),
    ("NestJS", [r"nest\.?js"], False),
    ("Deno", [r"Deno"], True),
    ("Django", [r"django"], False),
    ("Flask", [r"Flask"], True),
    ("FastAPI", [r"fastapi"], False),
    ("Ruby on Rails", [r"ruby\s+on\s+rails", r"Rails"], False),
    ("Laravel", [r"laravel"], False),
    ("Spring Boot", [r"spring\s*boot", r"Spring(?=\s+(?:framework|cloud|mvc))"], False),
    (".NET", [r"\.net(?:\s+core)?", r"asp\.net(?:\s+core)?", r"dotnet"], False),
    ("gRPC", [r"grpc"], False),
    ("REST APIs", [r"rest(?:ful)?\s+apis?", r"rest(?:ful)?\s+services?"], False),
    ("Microservices", [r"micro-?services?"], False),
    ("tRPC", [r"trpc"], False),
    # Data stores and data engineering
    ("PostgreSQL", [r"postgres(?:ql)?"], False),
    ("MySQL", [r"mysql"], False),
    ("SQLite", [r"sqlite"], False),
    ("MongoDB", [r"mongo(?:db)?"], False),
    ("Redis", [r"redis"], False),
    ("Elasticsearch", [r"elastic\s*search"], False),
    ("Cassandra", [r"cassandra"], False),
    ("DynamoDB", [r"dynamo\s*db"], False),
    ("Supabase", [r"supabase"], False),
    ("Firebase", [r"firebase"], False),
    ("Snowflake", [r"Snowflake"], True),
    ("BigQuery", [r"big\s*query"], False),
    ("Redshift", [r"redshift"], False),
    ("ClickHouse", [r"clickhouse"], False),
    ("Kafka", [r"kafka"], False),
    ("RabbitMQ", [r"rabbitmq"], False),
    ("Spark", [r"(?:apache\s+)?Spark|pyspark"], True),
    ("Airflow", [r"airflow"], False),
    ("dbt", [r"dbt"], False),
    ("Databricks", [r"databricks"], False),
    ("Pandas", [r"pandas"], False),
    ("NumPy", [r"numpy"], False),
    ("Prisma", [r"Prisma"], True),
    ("pgvector", [r"pgvector"], False),
    ("Neo4j", [r"neo4j"], False),
    # Cloud and DevOps
    ("AWS", [r"aws", r"amazon web services"], False),
    ("GCP", [r"gcp", r"google cloud(?:\s+platform)?"], False),
    ("Azure", [r"azure"], False),
    ("Docker", [r"docker"], False),
    ("Kubernetes", [r"kubernetes", r"k8s"], False),
    ("Terraform", [r"terraform"], False),
    ("Pulumi", [r"pulumi"], False),
    ("Ansible", [r"ansible"], False),
    ("Helm", [r"Helm"], True),
    ("CI/CD", [r"ci\s*/\s*cd", r"continuous (?:integration|delivery|deployment)"], False),
    ("GitHub Actions", [r"github actions"], False),
    ("Jenkins", [r"jenkins"], False),
    ("Linux", [r"linux"], False),
    ("Nginx", [r"nginx"], False),
    ("Serverless", [r"serverless"], False),
    ("Cloudflare", [r"cloudflare"], False),
    ("Vercel", [r"Vercel"], True),
    ("Prometheus", [r"prometheus"], False),
    ("Grafana", [r"grafana"], False),
    ("Datadog", [r"datadog"], False),
    ("OpenTelemetry", [r"opentelemetry"], False),
    # AI and ML
    ("Machine Learning", [r"machine learning", r"\bML\b"], False),
    ("Deep Learning", [r"deep learning"], False),
    ("LLM", [r"llms?", r"large language models?"], False),
    ("Generative AI", [r"generative ai", r"gen\s?ai"], False),
    ("AI", [r"AI(?![-\s]*(?:ML|/ML))", r"artificial intelligence"], True),
    ("NLP", [r"nlp", r"natural language processing"], False),
    ("Computer Vision", [r"computer vision"], False),
    ("PyTorch", [r"pytorch"], False),
    ("TensorFlow", [r"tensorflow"], False),
    ("JAX", [r"JAX"], True),
    ("scikit-learn", [r"scikit-learn", r"sklearn"], False),
    ("Hugging Face", [r"hugging\s*face"], False),
    ("LangChain", [r"langchain"], False),
    ("LlamaIndex", [r"llama\s*index"], False),
    ("RAG", [r"RAG", r"retrieval[- ]augmented generation"], True),
    ("MLOps", [r"mlops"], False),
    # Testing and tools
    ("Jest", [r"Jest"], True),
    ("Cypress", [r"cypress"], False),
    ("Playwright", [r"playwright"], False),
    ("Selenium", [r"selenium"], False),
    ("Vitest", [r"vitest"], False),
    ("pytest", [r"pytest"], False),
    ("Git", [r"Git(?!Hub|Lab)"], True),
    ("Figma", [r"figma"], False),
    # Practices
    ("Distributed Systems", [r"distributed systems?"], False),
    ("System Design", [r"system design"], False),
    ("Agile", [r"agile", r"scrum"], False),
    ("Blockchain", [r"blockchain", r"web3"], False),
]


def _compile(alternatives: List[str], case_sensitive: bool) -> Pattern[str]:
    body = "|".join(f"(?:{a})" for a in alternatives)
    # Boundaries that also work around symbols ("C++", "C#", ".NET").
    return re.compile(rf"(?<![\w.+#-])(?:{body})(?![\w+#]|\.\w)", 0 if case_sensitive else re.IGNORECASE)


SKILL_PATTERNS: List[Tuple[str, Pattern[str]]] = [
    (name, _compile(alts or [re.escape(name)], cs)) for name, alts, cs in _SKILLS
]
SKILL_NAMES: Dict[str, str] = {name.lower(): name for name, _, _ in _SKILLS}

# A posting rarely lists more than this many real requirements.
MAX_SKILLS = 25


def find_skills(text: str, limit: int = MAX_SKILLS) -> List[str]:
    """Known skills mentioned in `text`, most mentioned first (ties by first appearance)."""
    if not text:
        return []
    found = []
    for name, pattern in SKILL_PATTERNS:
        matches = list(pattern.finditer(text))
        if matches:
            found.append((-len(matches), matches[0].start(), name))
    found.sort()
    return [name for _, _, name in found[:limit]]
