"""
Small In-Process TTL Cache.

Opportunistic only: each server instance has its own copy, entries vanish on
restart, and a miss always falls back to the database. Keys start with the
user's id, so entries are never shared between users and one user's entries
can be dropped together after a write.
"""

import time
from collections import OrderedDict
from typing import Any, Generic, Hashable, Optional, Tuple, TypeVar

V = TypeVar("V")


class TTLCache(Generic[V]):
    def __init__(self, ttl_seconds: float, max_entries: int):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._entries: "OrderedDict[Tuple[Hashable, ...], Tuple[float, V]]" = OrderedDict()

    def get(self, key: Tuple[Hashable, ...]) -> Optional[V]:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires, value = entry
        if expires <= time.monotonic():
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return value

    def set(self, key: Tuple[Hashable, ...], value: V) -> None:
        self._entries[key] = (time.monotonic() + self.ttl, value)
        self._entries.move_to_end(key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)

    def invalidate_user(self, user_id: Any) -> None:
        for key in [k for k in self._entries if k and k[0] == user_id]:
            del self._entries[key]

    def clear(self) -> None:
        self._entries.clear()
