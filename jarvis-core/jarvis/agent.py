"""The agent loop: understand, plan, act through tools, report.

One turn:
  1. The user's words go to the model with the persona, relevant memories and
     the list of tools.
  2. If the model asks for tools, each request passes the permission gate:
       allowed  → it runs, and the result goes back to the model;
       confirm  → the turn pauses and JARVIS asks "shall I go ahead?";
       denied   → the model is told it was refused.
  3. Repeat until the model answers in words, or the step limit is reached.

A paused action resumes only on a clear yes in the user's next message; any
other reply cancels it. Every step is audited and reported as an event, so a
dashboard can show progress live.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Callable

from .audit import AuditLog
from .llm import LLM, LLMError, Message, ToolCall, as_json
from .memory import Memory
from .permissions import Decision, Policy, is_no, is_yes
from .tools import REGISTRY, Context

PERSONA = """You are JARVIS, a personal AI assistant: calm, warm, quick-witted and
genuinely useful — the real-world version of Tony Stark's assistant. You speak
naturally, like a capable person, not a robot. Replies are usually spoken aloud,
so keep them short and conversational: one to three sentences unless the user
asks for detail. No markdown in spoken replies.

How you work:
- Understand what the user means, not just their exact words.
- For anything that takes several steps, make a short plan first, then carry it
  out step by step with your tools, and report what you did.
- Use tools instead of guessing. Search the web for anything current.
- If a request is ambiguous or you are unsure, ask one short clarifying
  question instead of guessing — especially before anything consequential.
- Say plainly when you don't know or a tool failed.
- You can only see or hear through your tools. Never claim to see the camera,
  the screen or a room unless a tool just returned it.
- Sensitive actions (sending messages, spending, deleting, unlocking, changing
  files) are paused by the system for the user's approval; that's expected.
- Only save memories the user asks you to keep, or clearly agrees to.
"""


@dataclass
class Pending:
    call: ToolCall
    question: str


@dataclass
class Session:
    """One conversation. History is trimmed at user turns, never between a
    tool call and its result."""

    history: list[Message] = field(default_factory=list)
    pending: Pending | None = None
    max_messages: int = 40

    def trim(self) -> None:
        if len(self.history) <= self.max_messages:
            return
        cut = len(self.history) - self.max_messages
        while cut < len(self.history) and self.history[cut]["role"] != "user":
            cut += 1
        self.history = self.history[cut:]


EventSink = Callable[[dict[str, Any]], None]


class Agent:
    def __init__(
        self,
        llm: LLM,
        settings: Any,
        memory: Memory,
        store: Any,
        audit: AuditLog,
        policy: Policy | None = None,
        on_event: EventSink | None = None,
        notify: Callable[[str], None] | None = None,
    ):
        self.llm = llm
        self.settings = settings
        self.memory = memory
        self.audit = audit
        self.policy = policy or Policy(tuple(settings.auto_approve), tuple(settings.deny_tools))
        self.on_event = on_event or (lambda e: None)
        self.ctx = Context(settings=settings, memory=memory, store=store, llm=llm, notify=notify or (lambda m: None))
        for folder in settings.allowed_dirs[:1]:
            folder.mkdir(parents=True, exist_ok=True)

    # -- helpers -----------------------------------------------------------

    def emit(self, kind: str, **data: Any) -> None:
        try:
            self.on_event({"kind": kind, **data})
        except Exception:
            pass

    def system_prompt(self, user_text: str) -> str:
        now = dt.datetime.now().strftime("%A %d %B %Y, %H:%M")
        folders = ", ".join(str(p) for p in self.settings.allowed_dirs)
        senses = []
        if not self.settings.camera_enabled:
            senses.append("camera: off")
        if not self.settings.screen_enabled:
            senses.append("screen: off")
        return (
            PERSONA
            + f"\nNow: {now}. Folders you may use: {folders}. Senses: {', '.join(senses) or 'camera and screen on'}."
            + self.memory.context(user_text)
        )

    def tool_specs(self) -> list[dict[str, Any]]:
        return [t.spec() for t in REGISTRY.values() if t.name not in self.policy.deny]

    def execute(self, call: ToolCall, approved: bool = False) -> str:
        tool = REGISTRY[call.name]
        self.emit("tool_start", name=call.name, args=call.args)
        try:
            result = tool.func(self.ctx, **call.args)
            text = as_json(result)
            self.audit.record("tool", name=call.name, args=call.args, approved=approved, ok=True, result=text[:500])
            self.emit("tool_done", name=call.name, ok=True, result=text[:300])
            return text
        except Exception as exc:  # a failed tool is information for the model, not a crash
            message = f"{type(exc).__name__}: {exc}"
            self.audit.record("tool", name=call.name, args=call.args, approved=approved, ok=False, error=message)
            self.emit("tool_done", name=call.name, ok=False, result=message)
            return as_json({"error": message})

    # -- the turn ----------------------------------------------------------

    def run(self, session: Session, user_text: str) -> str:
        self.audit.record("user", text=user_text)
        self.emit("thinking")

        # A paused action waits on this reply.
        if session.pending:
            pending, session.pending = session.pending, None
            if is_yes(user_text):
                self.audit.record("approval", name=pending.call.name, args=pending.call.args, approved=True)
                result = self.execute(pending.call, approved=True)
                session.history.append(
                    {"role": "user", "content": f"[The user approved {pending.call.name}. Result: {result}]\n{user_text}"}
                )
                return self._loop(session, user_text)
            self.audit.record("approval", name=pending.call.name, args=pending.call.args, approved=False)
            if is_no(user_text) or len(user_text.split()) <= 3:
                session.history.append({"role": "user", "content": f"[The user declined {pending.call.name}.] {user_text}"})
                reply = "Okay, I won't do that."
                session.history.append({"role": "assistant", "content": reply})
                self.emit("final", text=reply)
                return reply
            # They said something else entirely: drop the action, answer that.
            session.history.append({"role": "user", "content": f"[{pending.call.name} was cancelled.] {user_text}"})
            return self._loop(session, user_text)

        session.history.append({"role": "user", "content": user_text})
        return self._loop(session, user_text)

    def _loop(self, session: Session, user_text: str) -> str:
        session.trim()
        system = self.system_prompt(user_text)
        tools = self.tool_specs()

        for step in range(self.settings.max_steps):
            try:
                reply = self.llm.complete(system, session.history, tools)
            except LLMError as exc:
                text = str(exc)
                self.audit.record("error", error=text)
                self.emit("error", text=text)
                return text

            session.history.append(
                {"role": "assistant", "content": reply.text, "tool_calls": reply.tool_calls, "raw": reply.raw}
            )
            if not reply.tool_calls:
                text = reply.text or "Done."
                self.audit.record("assistant", text=text, steps=step + 1)
                self.emit("final", text=text)
                return text

            if reply.text:
                self.emit("plan", text=reply.text)

            for i, call in enumerate(reply.tool_calls):
                tool = REGISTRY.get(call.name)
                if tool is None:
                    session.history.append({"role": "tool", "call_id": call.id, "name": call.name, "content": "Unknown tool."})
                    continue
                decision = self.policy.decide(tool, call.args)
                self.audit.record("decision", name=call.name, args=call.args, decision=decision.value)

                if decision is Decision.DENY:
                    session.history.append(
                        {"role": "tool", "call_id": call.id, "name": call.name, "content": "Refused by the permission policy."}
                    )
                    continue

                if decision is Decision.CONFIRM:
                    question = f"Before I do it: I'm about to {tool.describe(call.args)}. Shall I go ahead?"
                    session.pending = Pending(call, question)
                    session.history.append(
                        {"role": "tool", "call_id": call.id, "name": call.name, "content": "Waiting for the user's approval."}
                    )
                    # Any other calls in this batch are dropped; the model can
                    # ask for them again once this one is settled.
                    for later in reply.tool_calls[i + 1 :]:
                        session.history.append(
                            {"role": "tool", "call_id": later.id, "name": later.name, "content": "Not run: waiting on approval."}
                        )
                    session.history.append({"role": "assistant", "content": question})
                    self.emit("confirm", name=call.name, question=question)
                    return question

                result = self.execute(call)
                session.history.append({"role": "tool", "call_id": call.id, "name": call.name, "content": result})

        text = "That took more steps than I'm allowed in one go. Shall I keep going?"
        self.emit("final", text=text)
        return text
