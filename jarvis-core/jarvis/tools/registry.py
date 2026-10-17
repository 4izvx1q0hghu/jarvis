"""Tool registry. A tool is a Python function plus what the model needs to
know to call it (name, description, JSON-schema parameters) and what the
permission gate needs to know before it runs (its risk)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Context:
    """What every tool receives besides its own arguments."""

    settings: Any
    memory: Any = None
    store: Any = None
    llm: Any = None
    notify: Callable[[str], None] = lambda message: None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    func: Callable[..., Any]
    risk: str | Callable[[dict[str, Any]], str] = "safe"
    # One line describing the action, for the confirmation question.
    summary: Callable[[dict[str, Any]], str] | None = None

    def risk_for(self, args: dict[str, Any]) -> str:
        return self.risk(args) if callable(self.risk) else self.risk

    def describe(self, args: dict[str, Any]) -> str:
        if self.summary:
            try:
                return self.summary(args)
            except Exception:
                pass
        shown = ", ".join(f"{k}={v!r}" for k, v in args.items())
        return f"run {self.name}({shown})"

    def spec(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


REGISTRY: dict[str, Tool] = {}


def tool(
    name: str,
    description: str,
    params: dict[str, Any] | None = None,
    required: list[str] | None = None,
    risk: str | Callable[[dict[str, Any]], str] = "safe",
    summary: Callable[[dict[str, Any]], str] | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register a function as a tool. `params` maps argument name to a JSON
    schema fragment, e.g. {"query": {"type": "string", "description": "..."}}."""

    def register(func: Callable[..., Any]) -> Callable[..., Any]:
        schema: dict[str, Any] = {"type": "object", "properties": params or {}}
        if required:
            schema["required"] = required
        REGISTRY[name] = Tool(name, description, schema, func, risk, summary)
        return func

    return register


def S(description: str) -> dict[str, str]:
    """A string parameter."""
    return {"type": "string", "description": description}


def N(description: str) -> dict[str, str]:
    """A number parameter."""
    return {"type": "number", "description": description}
