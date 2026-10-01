"""
Sends one tiny request to every configured deployment (no fallback) and
reports which keys/models work. Usage: uv run python -m scripts.check_providers
"""

import asyncio
import sys
import time

from src.app.api.deps import gateway
from src.app.gateway import ErrorClassifier


async def check(deployment):
    start = time.time()
    try:
        completion = await gateway._complete(
            deployment, "Reply with the single word: ok", [{"role": "user", "content": "ping"}],
            temperature=0, max_tokens=16,
        )
        return deployment, "ok", completion.text.strip()[:40], time.time() - start
    except Exception as e:  # noqa: BLE001 - report every failure
        return deployment, ErrorClassifier.classify(e), f"{type(e).__name__}: {str(e)[:120]}", time.time() - start


async def main() -> int:
    results = await asyncio.gather(*(check(d) for d in gateway.deployments))
    for d, status, detail, seconds in results:
        print(f"{'OK  ' if status == 'ok' else 'FAIL'} {d.name:26} {d.default_model:24} {seconds:5.1f}s  {status:28} {detail}")
    working = sum(1 for r in results if r[1] == "ok")
    print(f"\n{working}/{len(results)} deployments working")
    return 0 if working else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
