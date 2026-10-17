"""Audit log: an append-only record of everything JARVIS did and why.

One JSON object per line in ~/.jarvis/audit.jsonl — every tool call, its
permission decision, whether the user approved it, and the outcome. Values
under keys that look like secrets are redacted before they are written.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

_SECRET = re.compile(r"pass(word)?|secret|token|api[_-]?key|authorization|cookie", re.I)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[redacted]" if _SECRET.search(str(k)) else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str) and len(value) > 2000:
        return value[:2000] + "…"
    return value


class AuditLog:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def record(self, event: str, **fields: Any) -> dict:
        entry = {"ts": time.time(), "event": event, **redact(fields)}
        with self.lock, self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
        return entry

    def tail(self, limit: int = 50) -> list[dict]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()[-limit:]
        out = []
        for line in lines:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out
