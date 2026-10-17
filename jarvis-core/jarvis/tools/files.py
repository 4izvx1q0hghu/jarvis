"""Files, sandboxed to JARVIS_ALLOWED_DIRS.

Reading and listing are safe. Writing, moving, organising and deleting ask
first — and "delete" moves to JARVIS's own trash folder (restorable), never a
permanent delete. Any path that resolves outside the allowed folders,
including through `..` or a symlink, is refused.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from .registry import Context, S, tool

TEXT_LIMIT = 20_000


class PathNotAllowed(PermissionError):
    pass


def safe_path(ctx: Context, raw: str) -> Path:
    roots = [Path(r).resolve() for r in ctx.settings.allowed_dirs]
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = roots[0] / candidate
    resolved = candidate.resolve()
    for root in roots:
        if resolved == root or root in resolved.parents:
            return resolved
    allowed = ", ".join(str(r) for r in roots)
    raise PathNotAllowed(f"'{raw}' is outside the folders JARVIS may use ({allowed}).")


@tool(
    "list_files",
    "List files and folders in an allowed folder.",
    {"path": S("Folder path; relative paths start in the main JARVIS folder. Default: that folder.")},
)
def list_files(ctx: Context, path: str = "") -> dict:
    folder = safe_path(ctx, path or str(ctx.settings.allowed_dirs[0]))
    if not folder.is_dir():
        return {"error": f"{folder} is not a folder"}
    items = []
    for p in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))[:200]:
        items.append({"name": p.name, "type": "folder" if p.is_dir() else "file", "bytes": p.stat().st_size if p.is_file() else None})
    return {"folder": str(folder), "items": items}


@tool("read_file", "Read a text file from an allowed folder.", {"path": S("File path")}, ["path"])
def read_file(ctx: Context, path: str) -> dict:
    file = safe_path(ctx, path)
    if not file.is_file():
        return {"error": f"{file} does not exist"}
    text = file.read_text(encoding="utf-8", errors="replace")
    return {"path": str(file), "text": text[:TEXT_LIMIT], "truncated": len(text) > TEXT_LIMIT}


@tool(
    "search_files",
    "Find files whose name contains some text, inside the allowed folders.",
    {"query": S("Part of the file name")},
    ["query"],
)
def search_files(ctx: Context, query: str) -> dict:
    hits = []
    for root in ctx.settings.allowed_dirs:
        root = Path(root)
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if query.lower() in p.name.lower():
                hits.append(str(p))
                if len(hits) >= 50:
                    return {"matches": hits, "more": True}
    return {"matches": hits}


@tool(
    "write_file",
    "Create or overwrite a text file in an allowed folder.",
    {"path": S("File path"), "text": S("Full file contents")},
    ["path", "text"],
    risk="confirm",
    summary=lambda a: f"write {len(a.get('text', ''))} characters to {a.get('path')}",
)
def write_file(ctx: Context, path: str, text: str) -> dict:
    file = safe_path(ctx, path)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text, encoding="utf-8")
    return {"written": str(file), "bytes": file.stat().st_size}


@tool(
    "move_file",
    "Move or rename a file or folder within the allowed folders.",
    {"source": S("Current path"), "destination": S("New path")},
    ["source", "destination"],
    risk="confirm",
    summary=lambda a: f"move {a.get('source')} to {a.get('destination')}",
)
def move_file(ctx: Context, source: str, destination: str) -> dict:
    src, dst = safe_path(ctx, source), safe_path(ctx, destination)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    return {"moved": str(src), "to": str(dst)}


@tool(
    "delete_file",
    "Delete a file or folder (it goes to JARVIS's trash and can be restored).",
    {"path": S("Path to delete")},
    ["path"],
    risk="confirm",
    summary=lambda a: f"delete {a.get('path')} (moved to the JARVIS trash, restorable)",
)
def delete_file(ctx: Context, path: str) -> dict:
    target = safe_path(ctx, path)
    trash = Path(ctx.settings.trash_dir) / time.strftime("%Y%m%d-%H%M%S")
    trash.mkdir(parents=True, exist_ok=True)
    shutil.move(str(target), str(trash / target.name))
    return {"trashed": str(target), "restore_from": str(trash / target.name)}


EXT_GROUPS = {
    "Images": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"},
    "Documents": {".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".odt"},
    "Spreadsheets": {".xls", ".xlsx", ".csv", ".ods"},
    "Videos": {".mp4", ".mov", ".avi", ".mkv", ".webm"},
    "Audio": {".mp3", ".wav", ".m4a", ".flac", ".aac"},
    "Archives": {".zip", ".rar", ".7z", ".tar", ".gz"},
    "Code": {".py", ".js", ".ts", ".html", ".css", ".json", ".java", ".c", ".cpp"},
}


@tool(
    "organize_folder",
    "Tidy a folder by moving its files into sub-folders by type (Images, Documents, …).",
    {"path": S("Folder to organise")},
    ["path"],
    risk="confirm",
    summary=lambda a: f"organise the files in {a.get('path')} into sub-folders by type",
)
def organize_folder(ctx: Context, path: str) -> dict:
    folder = safe_path(ctx, path)
    moved: dict[str, int] = {}
    for p in folder.iterdir():
        if not p.is_file():
            continue
        group = next((g for g, exts in EXT_GROUPS.items() if p.suffix.lower() in exts), "Other")
        (folder / group).mkdir(exist_ok=True)
        shutil.move(str(p), str(folder / group / p.name))
        moved[group] = moved.get(group, 0) + 1
    return {"folder": str(folder), "moved": moved}
