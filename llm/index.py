"""
Vercel entrypoint. Vercel serves the FastAPI `app` it finds in this file; it
lives at the project root so `src.app...` imports resolve.
"""

from src.app.main import app

__all__ = ["app"]
