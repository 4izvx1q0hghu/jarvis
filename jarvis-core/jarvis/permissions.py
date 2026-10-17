"""The permission gate between the brain and the hands.

The model only ever *asks* for a tool. This module decides, in code, whether
that request runs, needs the user's explicit yes first, or is refused — the
model's own judgement is never the safeguard.

Every tool declares a risk level:
  safe     — read-only or trivially reversible: runs straight away
  confirm  — sends, spends, deletes, unlocks, changes things: asks first
  blocked  — never runs
A tool may compute its risk from the arguments (a light is safe, a door lock
is not). Settings can force tools to auto-approve or deny.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .tools.registry import Tool

YES = re.compile(r"^\s*(yes|yeah|yep|yup|sure|ok(ay)?|confirm(ed)?|go ahead|do it|approved?|please do|affirmative)\b", re.I)
NO = re.compile(r"^\s*(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|abort|deny|wait)\b", re.I)


class Decision(Enum):
    ALLOW = "allow"
    CONFIRM = "confirm"
    DENY = "deny"


@dataclass
class Policy:
    auto_approve: tuple[str, ...] = ()
    deny: tuple[str, ...] = ()

    def decide(self, tool: Tool, args: dict[str, Any]) -> Decision:
        if tool.name in self.deny:
            return Decision.DENY
        risk = tool.risk_for(args)
        if risk == "blocked":
            return Decision.DENY
        if risk == "confirm" and tool.name not in self.auto_approve:
            return Decision.CONFIRM
        return Decision.ALLOW


def is_yes(text: str) -> bool:
    return bool(YES.match(text)) and not NO.match(text)


def is_no(text: str) -> bool:
    return bool(NO.match(text))
