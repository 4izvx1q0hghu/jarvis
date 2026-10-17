"""Memory, as tools the model can use — only for things the user wants kept.

Remembering and recalling are safe. Correcting or forgetting a memory asks
first. The user can also see, edit and delete everything from the dashboard.
"""

from __future__ import annotations

from .registry import Context, S, tool


@tool(
    "remember",
    "Save something the user asked you to remember (a preference, a fact about them, a project, a routine). "
    "Only use when they ask or clearly agree.",
    {"text": S("The fact, in a short sentence"), "category": S("profile, preference, project, routine or general")},
    ["text"],
)
def remember(ctx: Context, text: str, category: str = "general") -> str:
    memory_id = ctx.memory.add(text, category or "general")
    return f"Remembered (#{memory_id}): {text}"


@tool("recall", "Search what you remember about the user.", {"query": S("What to look for")}, ["query"])
def recall(ctx: Context, query: str) -> list[dict]:
    return [{"id": m["id"], "text": m["text"], "category": m["category"]} for m in ctx.memory.search(query, 10)]


@tool("list_memories", "List everything you remember about the user.")
def list_memories(ctx: Context) -> list[dict]:
    return [{"id": m["id"], "text": m["text"], "category": m["category"]} for m in ctx.memory.all()]


@tool(
    "correct_memory",
    "Correct a stored memory.",
    {"id": {"type": "integer", "description": "Memory id"}, "text": S("The corrected fact")},
    ["id", "text"],
    risk="confirm",
    summary=lambda a: f"change memory #{a.get('id')} to \"{a.get('text')}\"",
)
def correct_memory(ctx: Context, id: int, text: str) -> str:
    return "Updated." if ctx.memory.update(int(id), text) else f"No memory #{id}."


@tool(
    "forget",
    "Delete a stored memory.",
    {"id": {"type": "integer", "description": "Memory id"}},
    ["id"],
    risk="confirm",
    summary=lambda a: f"permanently forget memory #{a.get('id')}",
)
def forget(ctx: Context, id: int) -> str:
    return "Forgotten." if ctx.memory.delete(int(id)) else f"No memory #{id}."
