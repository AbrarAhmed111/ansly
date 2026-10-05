"""
Token Budgets per Pipeline Stage.

Every LLM call names its stage. The gateway logs one structured line per call
(stage, model, tokens, duration) and a warning when a call goes over its
stage's budget, so a prompt that quietly grows shows up in the logs. Budgets
are monitoring targets, never limits: an over-budget call still runs.

Batch calls answer several questions at once, so their budget scales with the
number of questions (`items`).
"""

import hashlib
import logging
from dataclasses import dataclass
from typing import Dict, Optional
from urllib.parse import urlsplit

logger = logging.getLogger("tokens")

RESUME_PARSE = "resume_parse"
JOB_ANALYSIS = "job_analysis"
MATCHING = "matching"
TAILORING = "tailoring_plan"
VALIDATION = "validation_review"
ANSWER = "answer"
ANSWER_BATCH = "answer_batch"
REGENERATION = "answer_regeneration"
ADAPTATION = "answer_adaptation"
# Rewrite controls (Shorter, Natural, Fit to limit...): the answer and an instruction, never the profile.
REWRITE = "answer_rewrite"
# Cover letters and "about me": longer answers drawing on more evidence.
ANSWER_COMPLEX = "answer_complex"
# One technology, one degree, one past role: the evidence settles it (answers/routing.py).
ANSWER_SIMPLE = "answer_simple"
# Embedding requests for semantic retrieval: a question, or profile records (first use / changed records).
EMBEDDING_QUERY = "embedding_query"
EMBEDDING_PROFILE = "embedding_profile"
EMBEDDING_STAGES = {EMBEDDING_QUERY, EMBEDDING_PROFILE}


@dataclass(frozen=True)
class Budget:
    input: int
    output: int
    # Extra input per question after the first (batches only).
    input_per_item: int = 0


BUDGETS: Dict[str, Budget] = {
    RESUME_PARSE: Budget(input=6000, output=5000),
    JOB_ANALYSIS: Budget(input=2500, output=1000),
    MATCHING: Budget(input=2500, output=800),
    TAILORING: Budget(input=2500, output=1500),
    VALIDATION: Budget(input=1500, output=400),
    ANSWER: Budget(input=1500, output=500),
    ANSWER_SIMPLE: Budget(input=1200, output=300),
    ANSWER_COMPLEX: Budget(input=2500, output=800),
    ANSWER_BATCH: Budget(input=1800, output=500, input_per_item=200),
    REGENERATION: Budget(input=2000, output=500),
    ADAPTATION: Budget(input=700, output=300),
    REWRITE: Budget(input=700, output=500),
}


# Model routing (Anthropic deployments). Work that needs no model never reaches the gateway: deterministic
# facts, skill matching, exact saved answers, the answer cache. For the rest, each stage has a tier:
#
#   fast    ANTHROPIC_FAST_MODEL when set (else the main model): extraction, short rewrites, review of changed
#           text, and, only with FAST_MODEL_SIMPLE_ANSWERS, simple answers the evidence settles.
#   strong  the deployment's main model: tailoring, matching, open-ended and behavioral answers, batches,
#           regenerations, cover letters.
#
# Effort is set per stage on top of that: mechanical stages need little reasoning, and thinking is billed as
# output. Stages not listed run at ANTHROPIC_EFFORT; a stage never runs above it. Models without effort support
# (Haiku 4.5) run without it.
FAST, STRONG = "fast", "strong"
STAGE_TIER: Dict[str, str] = {
    JOB_ANALYSIS: FAST, VALIDATION: FAST, ADAPTATION: FAST, ANSWER_SIMPLE: FAST, REWRITE: FAST,
    RESUME_PARSE: STRONG, MATCHING: STRONG, TAILORING: STRONG, ANSWER: STRONG, ANSWER_COMPLEX: STRONG,
    ANSWER_BATCH: STRONG, REGENERATION: STRONG,
}
FAST_MODEL_STAGES = {stage for stage, tier in STAGE_TIER.items() if tier == FAST}
EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"]
STAGE_EFFORT: Dict[str, str] = {JOB_ANALYSIS: "low", MATCHING: "low", VALIDATION: "low", ADAPTATION: "low",
                                REWRITE: "low"}


def effort_for(stage: str, configured: str) -> str:
    wanted = STAGE_EFFORT.get(stage, configured)
    if wanted not in EFFORT_LEVELS or configured not in EFFORT_LEVELS:
        return configured
    return min(wanted, configured, key=EFFORT_LEVELS.index)


def job_key(url: Optional[str], company: Optional[str] = None, role: Optional[str] = None) -> Optional[str]:
    """Groups usage by the posting it was for (no job text is stored): a hash of the URL without query or fragment,
    or of company + role when there's no URL. None when there's nothing to identify the job by."""
    if url and url.strip():
        parsed = urlsplit(url.strip().lower())
        basis = f"url:{parsed.netloc.removeprefix('www.')}{parsed.path.rstrip('/')}"
    elif (company or "").strip() or (role or "").strip():
        basis = f"job:{' '.join((company or '').lower().split())}|{' '.join((role or '').lower().split())}"
    else:
        return None
    return hashlib.sha256(basis.encode()).hexdigest()[:32]


def over_budget(stage: str, tokens_in: int, tokens_out: int, items: int = 1) -> str:
    """'' when within budget, else a short description of what went over."""
    budget = BUDGETS.get(stage)
    if budget is None:
        return ""
    limit_in = budget.input + budget.input_per_item * max(0, items - 1)
    limit_out = budget.output * max(1, items) if budget.input_per_item else budget.output
    over = []
    if tokens_in > limit_in:
        over.append(f"input_tokens={tokens_in} budget={limit_in}")
    if tokens_out > limit_out:
        over.append(f"output_tokens={tokens_out} budget={limit_out}")
    return " ".join(over)


def log_call(stage: str, model: str, provider: str, tokens_in: int, tokens_out: int, duration_ms: int,
             items: int = 1, cached: int = 0, cost: Optional[float] = None) -> None:
    """One structured line per LLM call (numbers and names only, never prompt content)."""
    logger.info(
        f"llm_call stage={stage} provider={provider} model={model} input_tokens={tokens_in} "
        f"output_tokens={tokens_out} total_tokens={tokens_in + tokens_out} cached_tokens={cached} "
        f"duration_ms={duration_ms} items={items}" + (f" cost_usd={cost:.6f}" if cost is not None else "")
    )
    over = over_budget(stage, tokens_in, tokens_out, items)
    if over:
        logger.warning(f"token_budget_exceeded stage={stage} {over}")
