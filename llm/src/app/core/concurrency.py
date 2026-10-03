"""
Concurrency Helpers.
"""

import asyncio
from typing import Any, Awaitable, List


async def gather_all(*awaitables: Awaitable[Any]) -> List[Any]:
    """Like asyncio.gather, but when one fails the others are cancelled instead of left running."""
    tasks = [asyncio.ensure_future(a) for a in awaitables]
    try:
        return await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


async def capture(awaitable: Awaitable[Any]) -> Any:
    """Returns the exception instead of raising it, so the caller can decide later whether it matters."""
    try:
        return await awaitable
    except Exception as e:  # noqa: BLE001 - handed back to the caller, which re-raises it when it applies
        return e
