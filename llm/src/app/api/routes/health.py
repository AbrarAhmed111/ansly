"""
Health Check Endpoint.
Reports operational health, Supabase connectivity, and LLM gateway deployments.
"""

from fastapi import APIRouter

from src.app.api.deps import gateway
from src.app.core.config import get_settings
from src.app.core.supabase import check_supabase

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Health check")
async def health_check():
    """
    Returns system status, Supabase connectivity, and gateway deployment counts.
    Deployment details are only listed outside production.
    """
    settings = get_settings()
    available = gateway.get_available_deployments()
    gateway_info = {
        "total_deployments": len(gateway.deployments),
        "available_deployments": len(available),
    }
    if settings.ENVIRONMENT != "production":
        gateway_info["deployments"] = [
            {
                "name": d.name,
                "provider": d.provider,
                "model": d.default_model,
                "is_available": d.is_available,
                "is_disabled": d.is_permanently_disabled,
            }
            for d in gateway.deployments
        ]

    return {
        "status": "healthy",
        "app_name": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
        "supabase": await check_supabase(),
        "gateway": gateway_info,
    }
