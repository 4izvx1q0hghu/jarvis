"""Reminders, tasks, calendar and email.

Reminders, tasks and the calendar live in JARVIS's own database, so they work
with no accounts at all; a background scheduler announces reminders when they
fall due. Email sends through any SMTP account you configure (an app password,
never your main one) and always asks first.
"""

from __future__ import annotations

import datetime as dt
import re
import smtplib
import time
from email.message import EmailMessage

from .registry import Context, S, tool

_REL = re.compile(r"in\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?", re.I)


def parse_when(when: str) -> float:
    """'in 10 minutes', 'in 2 hours', ISO '2026-10-18 09:00', or 'tomorrow 9am'-ish
    is left to the model, which is told to pass ISO times."""
    text = when.strip()
    m = _REL.search(text)
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        seconds = {"second": 1, "sec": 1, "minute": 60, "min": 60, "hour": 3600, "hr": 3600, "day": 86400}[unit]
        return time.time() + n * seconds
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise ValueError(f"Couldn't read the time '{when}'. Use ISO like 2026-10-18T09:00 or 'in 20 minutes'.") from exc


def _fmt(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts).strftime("%a %d %b %H:%M")


# -- reminders ---------------------------------------------------------------


@tool(
    "add_reminder",
    "Set a reminder. JARVIS announces it when it is due.",
    {"text": S("What to remind about"), "when": S("ISO date-time like 2026-10-18T09:00, or 'in 20 minutes'")},
    ["text", "when"],
)
def add_reminder(ctx: Context, text: str, when: str) -> str:
    due = parse_when(when)
    ctx.store.execute("INSERT INTO reminders (user_id, text, due) VALUES (?, ?, ?)", (ctx.settings.user_id, text, due))
    return f"Reminder set for {_fmt(due)}: {text}"


@tool("list_reminders", "List upcoming reminders.")
def list_reminders(ctx: Context) -> list[dict]:
    rows = ctx.store.query(
        "SELECT id, text, due FROM reminders WHERE user_id = ? AND done = 0 ORDER BY due", (ctx.settings.user_id,)
    )
    return [{"id": r["id"], "text": r["text"], "due": _fmt(r["due"])} for r in rows]


@tool("complete_reminder", "Mark a reminder done.", {"id": {"type": "integer", "description": "Reminder id"}}, ["id"])
def complete_reminder(ctx: Context, id: int) -> str:
    ctx.store.execute("UPDATE reminders SET done = 1 WHERE id = ? AND user_id = ?", (id, ctx.settings.user_id))
    return f"Reminder {id} done."


def due_reminders(store, user_id: str) -> list[dict]:
    """For the scheduler: reminders now due that haven't been announced."""
    rows = store.query(
        "SELECT id, text, due FROM reminders WHERE user_id = ? AND done = 0 AND notified = 0 AND due <= ?",
        (user_id, time.time()),
    )
    for r in rows:
        store.execute("UPDATE reminders SET notified = 1 WHERE id = ?", (r["id"],))
    return rows


# -- tasks -------------------------------------------------------------------


@tool(
    "add_task",
    "Add a task to the to-do list, optionally under a project.",
    {"text": S("The task"), "project": S("Project name (optional)")},
    ["text"],
)
def add_task(ctx: Context, text: str, project: str = "") -> str:
    ctx.store.execute(
        "INSERT INTO tasks (user_id, text, project, created) VALUES (?, ?, ?, ?)",
        (ctx.settings.user_id, text, project, time.time()),
    )
    return f"Added task: {text}" + (f" (project {project})" if project else "")


@tool("list_tasks", "List open tasks, optionally for one project.", {"project": S("Project (optional)")})
def list_tasks(ctx: Context, project: str = "") -> list[dict]:
    sql = "SELECT id, text, project FROM tasks WHERE user_id = ? AND done = 0"
    params: tuple = (ctx.settings.user_id,)
    if project:
        sql += " AND project = ?"
        params += (project,)
    return ctx.store.query(sql + " ORDER BY created", params)


@tool("complete_task", "Mark a task done.", {"id": {"type": "integer", "description": "Task id"}}, ["id"])
def complete_task(ctx: Context, id: int) -> str:
    ctx.store.execute("UPDATE tasks SET done = 1 WHERE id = ? AND user_id = ?", (id, ctx.settings.user_id))
    return f"Task {id} done."


# -- calendar ----------------------------------------------------------------


@tool(
    "add_event",
    "Add an event to the calendar.",
    {
        "title": S("Event title"),
        "start": S("ISO start, e.g. 2026-10-20T14:00"),
        "end": S("ISO end (optional)"),
        "location": S("Where (optional)"),
    },
    ["title", "start"],
)
def add_event(ctx: Context, title: str, start: str, end: str = "", location: str = "") -> str:
    s = parse_when(start)
    e = parse_when(end) if end else None
    ctx.store.execute(
        "INSERT INTO events (user_id, title, start, end, location) VALUES (?, ?, ?, ?, ?)",
        (ctx.settings.user_id, title, s, e, location),
    )
    return f"Added '{title}' on {_fmt(s)}" + (f" at {location}" if location else "")


@tool("list_events", "Calendar events in the next N days.", {"days": {"type": "integer", "description": "How many days ahead (default 7)"}})
def list_events(ctx: Context, days: int = 7) -> list[dict]:
    now = time.time()
    rows = ctx.store.query(
        "SELECT id, title, start, location FROM events WHERE user_id = ? AND start BETWEEN ? AND ? ORDER BY start",
        (ctx.settings.user_id, now - 3600, now + days * 86400),
    )
    return [{"id": r["id"], "title": r["title"], "when": _fmt(r["start"]), "location": r["location"]} for r in rows]


# -- email -------------------------------------------------------------------


@tool(
    "send_email",
    "Send an email from the configured account. Always confirm recipient and content with the user first.",
    {"to": S("Recipient address"), "subject": S("Subject line"), "body": S("Plain-text body")},
    ["to", "subject", "body"],
    risk="confirm",
    summary=lambda a: f"send an email to {a.get('to')} with the subject \"{a.get('subject')}\"",
)
def send_email(ctx: Context, to: str, subject: str, body: str) -> str:
    s = ctx.settings
    if not (s.smtp_host and s.smtp_user and s.smtp_password):
        return "Email isn't set up. Add SMTP_HOST, SMTP_USER and SMTP_PASSWORD (an app password) to .env."
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_user, to, subject
    msg.set_content(body)
    host, _, port = s.smtp_host.partition(":")
    with smtplib.SMTP(host, int(port or 587), timeout=30) as smtp:
        smtp.starttls()
        smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)
    return f"Sent to {to}."
