"""
Vercel entrypoint. vercel.json builds this file with @vercel/python, which
installs requirements.txt, and routes every request here.
"""

import sys
from pathlib import Path

# Make `src.app...` importable however the function is loaded.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.app.main import app  # noqa: E402


@app.middleware("http")
async def strip_vercel_function_prefix(request, call_next):
    """Accept requests even if Vercel forwards the function path to FastAPI."""
    prefix = "/api/index.py"
    path = request.scope.get("path", "")
    if path == prefix:
        request.scope["path"] = "/"
    elif path.startswith(f"{prefix}/"):
        request.scope["path"] = path[len(prefix):]
    return await call_next(request)
