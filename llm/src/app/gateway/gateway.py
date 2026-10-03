"""
LLM Gateway Layer.
Provides automatic fallback across multiple providers and multiple API keys.

Handles:
- Deployments built from settings (any number of keys per provider, in GATEWAY_PROVIDER_ORDER)
- Error classification (rate limit / server / network -> cooldown; bad key / missing model -> disable)
- Output validation (a provider whose output fails the caller's validator is skipped)
- User-facing provider status events ("fallback", "switched")
- Normalized token usage metrics
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generic, List, Optional, TypeVar

from src.app.core import llm_usage, metrics, token_budget
from src.app.core.config import get_settings

from .adapters import Completion, complete_anthropic, complete_openai_compatible
from .deployment import ProviderDeployment
from .error_classifier import ErrorClassifier, InvalidOutputError
from .providers import build_deployments
from .status import ProviderStatusEvent

logger = logging.getLogger("LLMGateway")

T = TypeVar("T")


class GatewayUnavailableError(RuntimeError):
    """No deployment could produce a valid completion."""


@dataclass
class GatewayResult(Generic[T]):
    text: str
    value: T
    provider: str
    model: str
    usage: Dict[str, int]
    status_events: List[ProviderStatusEvent] = field(default_factory=list)


class LLMGateway:
    """
    Manages provider deployments, ordered fallback, and status events.
    Decouples the application layer from specific LLM providers.
    """

    def __init__(
        self,
        max_attempts: int = 10,
        cooldown_seconds: int = 60,
        deployments: Optional[List[ProviderDeployment]] = None,
    ):
        settings = get_settings()
        self.max_attempts = max_attempts
        self.cooldown_seconds = cooldown_seconds
        self.timeout = settings.GATEWAY_TIMEOUT_SECONDS
        self.max_retries = settings.GATEWAY_RETRIES
        self.deployments: List[ProviderDeployment] = (
            deployments if deployments is not None else build_deployments(settings, cooldown_seconds)
        )

    def get_available_deployments(self) -> List[ProviderDeployment]:
        """Returns deployments that are configured and not in cooldown."""
        return [d for d in self.deployments if d.is_available]

    @staticmethod
    def model_for(deployment: ProviderDeployment, stage: str) -> str:
        """The deployment's model, or ANTHROPIC_FAST_MODEL for fast-tier stages on Anthropic when it is set (see
        token_budget.STAGE_TIER). Simple answers go to it only with FAST_MODEL_SIMPLE_ANSWERS."""
        settings = get_settings()
        fast = settings.ANTHROPIC_FAST_MODEL.strip()
        if deployment.kind != "anthropic" or not fast or stage not in token_budget.FAST_MODEL_STAGES:
            return deployment.default_model
        if stage == token_budget.ANSWER_SIMPLE and not settings.FAST_MODEL_SIMPLE_ANSWERS:
            return deployment.default_model
        return fast

    async def _complete(
        self,
        deployment: ProviderDeployment,
        system: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float],
        max_tokens: Optional[int],
        stage: str = "unknown",
    ) -> Completion:
        if deployment.kind == "anthropic":
            settings = get_settings()
            return await complete_anthropic(
                deployment,
                system,
                messages,
                max_tokens=max(max_tokens or 0, settings.ANTHROPIC_MAX_TOKENS),
                effort=token_budget.effort_for(stage, settings.ANTHROPIC_EFFORT),
                timeout=self.timeout,
                max_retries=self.max_retries,
                model=self.model_for(deployment, stage),
            )
        return await complete_openai_compatible(
            deployment,
            system,
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    async def generate(
        self,
        system: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = 0.7,
        max_tokens: Optional[int] = None,
        validate: Optional[Callable[[str], Any]] = None,
        stage: str = "unknown",
        items: int = 1,
    ) -> GatewayResult:
        """
        Executes a chat completion with automatic fallback across deployments.

        `validate` receives the raw text and returns the parsed value; raising
        InvalidOutputError (or ValueError) moves on to the next deployment.
        `stage` (a name from core/token_budget.py) and `items` (questions in a
        batch) label the call's token log line and budget check.
        """
        available = self.get_available_deployments()

        # If all active deployments are cooling down, attempt the one cooling down the soonest
        if not available:
            active = [d for d in self.deployments if not d.is_permanently_disabled]
            if not active:
                raise GatewayUnavailableError("No LLM provider deployments configured or available.")
            active.sort(key=lambda d: d.cooldown_until)
            available = [active[0]]

        status_events: List[ProviderStatusEvent] = []
        attempts = 0
        last_error: Optional[Exception] = None

        for deployment in available:
            if attempts >= self.max_attempts:
                break
            attempts += 1

            try:
                logger.info(
                    f"🌐 Calling {deployment.name} ({deployment.default_model}) "
                    f"[Attempt {attempts}/{self.max_attempts}]..."
                )
                start_time = time.time()
                metrics.llm_started()
                completion = await self._complete(deployment, system, messages, temperature, max_tokens, stage)
                duration_ms = int((time.time() - start_time) * 1000)
                model = self.model_for(deployment, stage)
                try:
                    value = validate(completion.text) if validate else completion.text
                except ValueError as e:
                    # The provider billed this call even though its output can't be used.
                    llm_usage.record(llm_usage.from_usage(stage, deployment.provider, model, completion.usage,
                                                          duration_ms, items, ok=False))
                    raise InvalidOutputError(str(e)) from e

                if status_events:
                    status_events.append(
                        ProviderStatusEvent(
                            type="provider_status",
                            status="switched",
                            message=f"Switched to {deployment.name} successfully.",
                            provider=deployment.name,
                        )
                    )

                usage = completion.usage
                call = llm_usage.from_usage(stage, deployment.provider, model, usage, duration_ms, items)
                llm_usage.record(call)
                token_budget.log_call(stage, model, deployment.provider, call.prompt_tokens, call.output_tokens,
                                      duration_ms, items, cached=call.cache_read_tokens, cost=call.cost_usd)
                return GatewayResult(
                    text=completion.text,
                    value=value,
                    provider=deployment.name,
                    model=model,
                    usage=usage,
                    status_events=status_events,
                )

            except Exception as e:
                last_error = e
                reason = ErrorClassifier.classify(e)
                action = ErrorClassifier.action(reason)

                if action == "disable":
                    deployment.mark_disabled()
                elif action == "cooldown":
                    deployment.mark_cooldown(self.cooldown_seconds)

                status_events.append(
                    ProviderStatusEvent(
                        type="provider_status",
                        status="fallback",
                        message=f"{deployment.name} failed ({reason}). Switching to another provider...",
                        provider=deployment.name,
                    )
                )
                logger.warning(f"⚠️ Fallback from {deployment.name}: {reason} -> {action} ({type(e).__name__}: {e})")
                continue

        logger.error(f"❌ All LLM provider attempts failed after {attempts} attempts. Last error: {last_error}")
        raise GatewayUnavailableError(
            f"All LLM providers are currently unavailable or in cooldown. Last error: {last_error}"
        )
