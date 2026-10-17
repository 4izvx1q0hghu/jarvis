"""The brain: one small interface over the LLM providers.

Every provider takes the same inputs — a system prompt, the conversation, and
the tools on offer — and returns the same thing: some text and/or tool calls.
The agent never knows which model is answering.

Conversation messages are plain dicts:
  {"role": "user", "content": str}
  {"role": "assistant", "content": str, "tool_calls": [ToolCall], "raw": ...}
  {"role": "tool", "call_id": str, "name": str, "content": str}

`raw` keeps the provider's own form of an assistant turn so it can be replayed
exactly — Gemini's newer models refuse a function call sent back without the
signature they attached to it.
"""

from __future__ import annotations

import itertools
import json
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

Message = dict[str, Any]


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass
class Reply:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw: Any = None


class LLMError(RuntimeError):
    pass


class LLM(Protocol):
    name: str

    def complete(self, system: str, messages: list[Message], tools: list[dict[str, Any]]) -> Reply: ...


_ids = itertools.count(1)


def _new_id() -> str:
    return f"call_{next(_ids)}_{int(time.time() * 1000) % 100000}"


# ---------------------------------------------------------------------------
# Gemini (free tier available; key from aistudio.google.com)
# ---------------------------------------------------------------------------


class GeminiLLM:
    """Google Gemini over REST. Free-tier limits are per model, so a limit on
    one model falls through to the next in `models`."""

    API = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, api_key: str, model: str | None = None, timeout: float = 60.0):
        self.api_key = api_key
        self.models = [model] if model else ["gemini-flash-latest", "gemini-flash-lite-latest"]
        self.name = f"gemini:{self.models[0]}"
        self.http = httpx.Client(timeout=timeout)

    # -- conversion --------------------------------------------------------

    @staticmethod
    def to_contents(messages: list[Message]) -> list[dict[str, Any]]:
        contents: list[dict[str, Any]] = []
        for m in messages:
            role = m["role"]
            if role == "user":
                contents.append({"role": "user", "parts": [{"text": m["content"] or "…"}]})
            elif role == "assistant":
                if m.get("raw"):
                    contents.append({"role": "model", "parts": m["raw"]})
                    continue
                parts: list[dict[str, Any]] = []
                if m.get("content"):
                    parts.append({"text": m["content"]})
                for call in m.get("tool_calls", []):
                    parts.append({"functionCall": {"name": call.name, "args": call.args}})
                contents.append({"role": "model", "parts": parts or [{"text": "…"}]})
            elif role == "tool":
                part = {"functionResponse": {"name": m["name"], "response": {"result": m["content"]}}}
                # Consecutive results belong in one turn.
                if contents and contents[-1]["role"] == "user" and "functionResponse" in contents[-1]["parts"][0]:
                    contents[-1]["parts"].append(part)
                else:
                    contents.append({"role": "user", "parts": [part]})
        return contents

    @staticmethod
    def to_declarations(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{"name": t["name"], "description": t["description"], "parameters": t["parameters"]} for t in tools]

    @staticmethod
    def parse(data: dict[str, Any]) -> Reply:
        candidates = data.get("candidates") or []
        if not candidates:
            reason = (data.get("promptFeedback") or {}).get("blockReason")
            return Reply(text="I can't help with that one." if reason else "")
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text, calls = [], []
        for part in parts:
            if part.get("thought"):
                continue
            if "functionCall" in part:
                fc = part["functionCall"]
                calls.append(ToolCall(id=fc.get("id") or _new_id(), name=fc["name"], args=fc.get("args") or {}))
            elif part.get("text"):
                text.append(part["text"])
        return Reply(text="".join(text).strip(), tool_calls=calls, raw=parts)

    # -- call --------------------------------------------------------------

    def complete(self, system: str, messages: list[Message], tools: list[dict[str, Any]]) -> Reply:
        body: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": self.to_contents(messages),
            "generationConfig": {"maxOutputTokens": 2048},
        }
        if tools:
            body["tools"] = [{"functionDeclarations": self.to_declarations(tools)}]
        last_error = "no model answered"
        for model in self.models:
            res = self.http.post(
                f"{self.API}/models/{model}:generateContent",
                headers={"x-goog-api-key": self.api_key},
                json=body,
            )
            if res.status_code in (429, 404):
                last_error = f"{model}: HTTP {res.status_code}"
                continue  # this model's free limit is spent (or it is gone): try the next
            if res.status_code >= 400:
                raise LLMError(f"Gemini error {res.status_code}: {res.text[:300]}")
            self.name = f"gemini:{model}"
            return self.parse(res.json())
        raise LLMError(f"Gemini free limit reached on every model ({last_error}). Try again later.")

    def search(self, query: str) -> str:
        """A web search answered by Gemini with Google Search grounding."""
        body = {
            "contents": [{"role": "user", "parts": [{"text": f"Search the web and summarise, with sources: {query}"}]}],
            "tools": [{"google_search": {}}],
        }
        for model in self.models:
            res = self.http.post(
                f"{self.API}/models/{model}:generateContent",
                headers={"x-goog-api-key": self.api_key},
                json=body,
            )
            if res.status_code in (429, 404):
                continue
            res.raise_for_status()
            data = res.json()
            reply = self.parse(data)
            sources = []
            meta = (data.get("candidates") or [{}])[0].get("groundingMetadata") or {}
            for chunk in meta.get("groundingChunks", [])[:5]:
                web = chunk.get("web") or {}
                if web.get("uri"):
                    sources.append(f"- {web.get('title', 'source')}: {web['uri']}")
            return reply.text + ("\n\nSources:\n" + "\n".join(sources) if sources else "")
        raise LLMError("Search unavailable: Gemini free limit reached.")

    def vision(self, image_bytes: bytes, mime: str, question: str) -> str:
        import base64

        body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"inlineData": {"mimeType": mime, "data": base64.b64encode(image_bytes).decode()}},
                        {"text": question},
                    ],
                }
            ]
        }
        for model in self.models:
            res = self.http.post(
                f"{self.API}/models/{model}:generateContent",
                headers={"x-goog-api-key": self.api_key},
                json=body,
            )
            if res.status_code in (429, 404):
                continue
            res.raise_for_status()
            return self.parse(res.json()).text
        raise LLMError("Vision unavailable: Gemini free limit reached.")


# ---------------------------------------------------------------------------
# Anthropic Claude (paid API credits; key from console.anthropic.com)
# ---------------------------------------------------------------------------


class AnthropicLLM:
    API = "https://api.anthropic.com/v1/messages"

    def __init__(self, api_key: str, model: str | None = None, timeout: float = 90.0):
        self.api_key = api_key
        self.model = model or "claude-sonnet-5-5"
        self.name = f"anthropic:{self.model}"
        self.http = httpx.Client(timeout=timeout)

    @staticmethod
    def to_messages(messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            role = m["role"]
            if role == "user":
                out.append({"role": "user", "content": m["content"] or "…"})
            elif role == "assistant":
                if m.get("raw"):
                    out.append({"role": "assistant", "content": m["raw"]})
                    continue
                blocks: list[dict[str, Any]] = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": m["content"]})
                for call in m.get("tool_calls", []):
                    blocks.append({"type": "tool_use", "id": call.id, "name": call.name, "input": call.args})
                out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": "…"}]})
            elif role == "tool":
                block = {"type": "tool_result", "tool_use_id": m["call_id"], "content": m["content"]}
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                    out[-1]["content"].append(block)
                else:
                    out.append({"role": "user", "content": [block]})
        return out

    @staticmethod
    def parse(data: dict[str, Any]) -> Reply:
        text, calls = [], []
        for block in data.get("content", []):
            if block.get("type") == "text":
                text.append(block["text"])
            elif block.get("type") == "tool_use":
                calls.append(ToolCall(id=block["id"], name=block["name"], args=block.get("input") or {}))
        return Reply(text="".join(text).strip(), tool_calls=calls, raw=data.get("content"))

    def complete(self, system: str, messages: list[Message], tools: list[dict[str, Any]]) -> Reply:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 2048,
            "system": system,
            "messages": self.to_messages(messages),
        }
        if tools:
            body["tools"] = [
                {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools
            ]
        res = self.http.post(
            self.API,
            headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
            json=body,
        )
        if res.status_code >= 400:
            raise LLMError(f"Claude error {res.status_code}: {res.text[:300]}")
        return self.parse(res.json())


# ---------------------------------------------------------------------------
# Fake (tests and offline demos)
# ---------------------------------------------------------------------------


class FakeLLM:
    """Replays scripted replies, and records what it was asked. With no
    script it echoes, so the whole system can be exercised offline."""

    name = "fake"

    def __init__(self, script: list[Reply] | None = None):
        self.script = list(script or [])
        self.calls: list[dict[str, Any]] = []

    def complete(self, system: str, messages: list[Message], tools: list[dict[str, Any]]) -> Reply:
        self.calls.append({"system": system, "messages": [dict(m) for m in messages], "tools": tools})
        if self.script:
            return self.script.pop(0)
        last = next((m for m in reversed(messages) if m["role"] == "user"), {"content": ""})
        return Reply(text=f"(offline mode) You said: {last['content']}")


def make_llm(settings: Any) -> LLM:
    if settings.provider == "gemini" and settings.gemini_api_key:
        return GeminiLLM(settings.gemini_api_key, settings.model)
    if settings.provider == "anthropic" and settings.anthropic_api_key:
        return AnthropicLLM(settings.anthropic_api_key, settings.model)
    return FakeLLM()


def as_json(value: Any, limit: int = 6000) -> str:
    """Tool results go back to the model as text, capped so one huge file
    cannot crowd out the conversation."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + f"\n…[truncated {len(text) - limit} chars]"
