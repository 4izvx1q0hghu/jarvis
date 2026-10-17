"""The hands: everything JARVIS can do, each behind the permission gate.

Importing this package registers every tool with the registry.
"""

from . import (  # noqa: F401  (imported for their registration side effect)
    files,
    memory_tools,
    productivity,
    smarthome,
    system,
    vision,
    web,
)
from .registry import REGISTRY, Context, Tool, tool

__all__ = ["REGISTRY", "Context", "Tool", "tool"]
