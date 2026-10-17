"""Wires the parts together: settings → storage, memory, audit, brain → agents.

The server, the voice loop and the text chat all build on one Runtime, so they
share the same memory, reminders and audit log.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from .agent import Agent
from .audit import AuditLog
from .config import Settings, load_settings
from .llm import LLM, make_llm
from .memory import Memory
from .storage import Store
from .tools import REGISTRY
from .tools.productivity import due_reminders


class Runtime:
    def __init__(self, settings: Settings | None = None, llm: LLM | None = None):
        self.settings = settings or load_settings()
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.store = Store(self.settings.db_path)
        self.memory = Memory(self.store, self.settings.user_id)
        self.audit = AuditLog(self.settings.audit_path)
        self.llm = llm or make_llm(self.settings)
        self.started = time.time()

    def agent(self, on_event: Callable[[dict[str, Any]], None] | None = None, notify=None) -> Agent:
        return Agent(self.llm, self.settings, self.memory, self.store, self.audit, on_event=on_event, notify=notify)

    # The mute switch is a file, so the server, the dashboard and a separate
    # voice process all see the same state.
    @property
    def _mute_file(self):
        return self.settings.data_dir / "MUTED"

    @property
    def muted(self) -> bool:
        return self._mute_file.exists()

    def set_muted(self, muted: bool) -> None:
        if muted:
            self._mute_file.write_text("muted", encoding="utf-8")
        elif self._mute_file.exists():
            self._mute_file.unlink()
        self.audit.record("mute", muted=muted)

    def due_reminders(self) -> list[dict]:
        return due_reminders(self.store, self.settings.user_id)

    def status(self) -> dict[str, Any]:
        s = self.settings
        return {
            "brain": getattr(self.llm, "name", "unknown"),
            "provider": s.provider,
            "tools": sorted(REGISTRY),
            "uptime_s": int(time.time() - self.started),
            "muted": self.muted,
            "camera": s.camera_enabled,
            "screen": s.screen_enabled,
            "smart_home": bool(s.home_assistant_url and s.home_assistant_token),
            "email": bool(s.smtp_host),
            "folders": [str(p) for p in s.allowed_dirs],
        }
