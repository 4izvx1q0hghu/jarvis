"""Long-term memory the user can see, correct and delete.

Only things the user asked JARVIS to remember (or approved) are stored. Each
turn, the few memories most relevant to what was just said are handed to the
model, so it knows your preferences without being sent everything.

Optional encryption at rest: set JARVIS_MEMORY_KEY to a Fernet key (and
`pip install cryptography`) and memory text is stored encrypted.
"""

from __future__ import annotations

import os
import re
import time

from .storage import Store

_WORD = re.compile(r"[a-z0-9']+")
_STOP = set("a an the and or but of to in on at for with is are was were be i you my me it this that what do".split())


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


class _Cipher:
    def __init__(self) -> None:
        key = os.environ.get("JARVIS_MEMORY_KEY")
        self.fernet = None
        if key:
            from cryptography.fernet import Fernet  # optional dependency

            self.fernet = Fernet(key.encode())

    def seal(self, text: str) -> str:
        return self.fernet.encrypt(text.encode()).decode() if self.fernet else text

    def open(self, text: str) -> str:
        if not self.fernet:
            return text
        try:
            return self.fernet.decrypt(text.encode()).decode()
        except Exception:  # stored before encryption was switched on
            return text


class Memory:
    def __init__(self, store: Store, user_id: str = "owner"):
        self.store = store
        self.user_id = user_id
        self.cipher = _Cipher()

    def add(self, text: str, category: str = "general") -> int:
        now = time.time()
        cur = self.store.execute(
            "INSERT INTO memories (user_id, text, category, created, updated) VALUES (?, ?, ?, ?, ?)",
            (self.user_id, self.cipher.seal(text.strip()), category, now, now),
        )
        return int(cur.lastrowid)

    def all(self) -> list[dict]:
        rows = self.store.query(
            "SELECT id, text, category, created, updated FROM memories WHERE user_id = ? ORDER BY updated DESC",
            (self.user_id,),
        )
        for row in rows:
            row["text"] = self.cipher.open(row["text"])
        return rows

    def update(self, memory_id: int, text: str) -> bool:
        cur = self.store.execute(
            "UPDATE memories SET text = ?, updated = ? WHERE id = ? AND user_id = ?",
            (self.cipher.seal(text.strip()), time.time(), memory_id, self.user_id),
        )
        return cur.rowcount > 0

    def delete(self, memory_id: int) -> bool:
        cur = self.store.execute("DELETE FROM memories WHERE id = ? AND user_id = ?", (memory_id, self.user_id))
        return cur.rowcount > 0

    def clear(self) -> int:
        return self.store.execute("DELETE FROM memories WHERE user_id = ?", (self.user_id,)).rowcount

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """Keyword overlap, nudged by recency. Simple, private and offline;
        swap in embeddings later (see README roadmap) without changing callers."""
        wanted = _words(query)
        now = time.time()
        scored = []
        for row in self.all():
            overlap = len(wanted & _words(row["text"] + " " + row["category"]))
            if overlap == 0 and wanted:
                continue
            age_days = (now - row["updated"]) / 86400
            scored.append((overlap + 1 / (1 + age_days), row))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [row for _, row in scored[:limit]]

    def context(self, query: str) -> str:
        """The memory note added to the system prompt for this turn."""
        relevant = self.search(query) if query else []
        profile = [m for m in self.all() if m["category"] == "profile"][:5]
        picked = {m["id"]: m for m in profile + relevant}.values()
        if not picked:
            return ""
        lines = "\n".join(f"- [{m['id']}] {m['text']}" for m in picked)
        return f"\n\nThings the user has asked you to remember (ids in brackets):\n{lines}"
