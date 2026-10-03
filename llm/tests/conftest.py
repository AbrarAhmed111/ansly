"""
Pytest configuration and shared test fixtures.
Ensures application directory is in sys.path and mock environments are clean.
"""

import os
import sys

import pytest

# Ensure app and starter root are discoverable in test runs
STARTER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if STARTER_ROOT not in sys.path:
    sys.path.insert(0, STARTER_ROOT)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def clear_caches():
    """In-process caches are keyed by user id, and every test uses the same fake user."""
    from src.app.answers import engine, profile_context, saved

    profile_context._profile_cache.clear()
    saved._cache.clear()
    engine._answer_cache.clear()
    yield
