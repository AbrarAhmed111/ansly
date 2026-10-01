"""
Error Classifier for LLM Gateway Fallback.
Maps provider exceptions into actionable recovery decisions.
"""

from .adapters import RefusalError


class InvalidOutputError(Exception):
    """The provider answered, but the output failed the caller's validation."""


class ErrorClassifier:
    """Classifies provider exceptions into reason codes and recovery actions."""

    # What the gateway does with the deployment that failed, by reason code.
    # Every reason moves on to the next deployment.
    DISABLE = {"model_or_endpoint_not_found", "invalid_api_key", "payment_required"}
    SKIP = {"invalid_output", "refusal"}  # no cooldown: the deployment itself is healthy

    @staticmethod
    def classify(error: Exception) -> str:
        """Returns a reason code for the error."""
        if isinstance(error, InvalidOutputError):
            return "invalid_output"
        if isinstance(error, RefusalError):
            return "refusal"

        # Both the openai and anthropic SDKs expose the HTTP status on their errors.
        status = getattr(error, "status_code", None)
        if isinstance(status, int):
            if status == 404:
                return "model_or_endpoint_not_found"
            if status in (401, 403):
                return "invalid_api_key"
            if status == 402:
                return "payment_required"
            if status == 429:
                return "rate_limit_or_quota"
            if status in (408, 409) or status >= 500:
                return "provider_server_error"
            if 400 <= status < 500:
                return "bad_request"

        err_msg = f"{type(error).__name__}: {error}".lower()
        if "404" in err_msg or "model_not_found" in err_msg:
            return "model_or_endpoint_not_found"
        if "429" in err_msg or "rate limit" in err_msg or "quota" in err_msg or "resource exhausted" in err_msg:
            return "rate_limit_or_quota"
        if any(code in err_msg for code in ["500", "502", "503", "504", "529", "internal server error",
                                            "service unavailable", "overloaded"]):
            return "provider_server_error"
        if any(term in err_msg for term in ["timeout", "timed out", "connection", "network error"]):
            return "network_or_timeout"
        if "401" in err_msg or "unauthorized" in err_msg or "invalid api key" in err_msg or "authentication" in err_msg:
            return "invalid_api_key"
        return "unknown_error"

    @classmethod
    def action(cls, reason: str) -> str:
        """Returns "disable", "skip", or "cooldown" for a reason code."""
        if reason in cls.DISABLE:
            return "disable"
        if reason in cls.SKIP:
            return "skip"
        return "cooldown"
