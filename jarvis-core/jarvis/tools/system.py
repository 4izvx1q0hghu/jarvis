"""The computer itself: open allow-listed apps, report status and time.

Deliberately absent: a tool that runs arbitrary shell commands. JARVIS opens
apps from a list you control (JARVIS_APPS in .env adds more), so a model
mistake or a malicious web page cannot turn into a command.
"""

from __future__ import annotations

import datetime as dt
import os
import platform
import shutil
import subprocess

from .registry import Context, S, tool

SYSTEM = platform.system()  # Windows | Darwin | Linux

APPS: dict[str, dict[str, list[str]]] = {
    "calculator": {"Windows": ["calc"], "Darwin": ["open", "-a", "Calculator"], "Linux": ["gnome-calculator"]},
    "notepad": {"Windows": ["notepad"], "Darwin": ["open", "-a", "TextEdit"], "Linux": ["gedit"]},
    "browser": {"Windows": ["cmd", "/c", "start", "", "https://"], "Darwin": ["open", "https://"], "Linux": ["xdg-open", "https://"]},
    "file explorer": {"Windows": ["explorer"], "Darwin": ["open", "."], "Linux": ["xdg-open", "."]},
    "spotify": {"Windows": ["cmd", "/c", "start", "", "spotify:"], "Darwin": ["open", "-a", "Spotify"], "Linux": ["spotify"]},
    "vs code": {"Windows": ["code"], "Darwin": ["open", "-a", "Visual Studio Code"], "Linux": ["code"]},
    "terminal": {"Windows": ["wt"], "Darwin": ["open", "-a", "Terminal"], "Linux": ["x-terminal-emulator"]},
}


def _custom_apps() -> dict[str, list[str]]:
    """JARVIS_APPS="obs=C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe;discord=..." """
    out = {}
    for item in (os.environ.get("JARVIS_APPS") or "").split(";"):
        if "=" in item:
            name, _, path = item.partition("=")
            out[name.strip().lower()] = [path.strip()]
    return out


@tool(
    "open_app",
    "Open an application on the computer from the approved list.",
    {"name": S("App name, e.g. calculator, notepad, spotify, vs code, browser, file explorer")},
    ["name"],
)
def open_app(ctx: Context, name: str) -> str:
    key = name.lower().strip()
    custom = _custom_apps()
    if key in custom:
        command = custom[key]
    elif key in APPS and SYSTEM in APPS[key]:
        command = APPS[key][SYSTEM]
    else:
        known = ", ".join(sorted(set(APPS) | set(custom)))
        return f"'{name}' isn't on the approved app list. Known apps: {known}. Add more with JARVIS_APPS in .env."
    if not shutil.which(command[0]) and not os.path.exists(command[0]) and command[0] not in ("cmd", "open"):
        return f"{name} doesn't seem to be installed ({command[0]} not found)."
    subprocess.Popen(command, shell=False)  # never shell=True
    return f"Opened {name}."


@tool("get_time", "The current date and time on this computer.")
def get_time(ctx: Context) -> str:
    return dt.datetime.now().strftime("%A %d %B %Y, %H:%M")


@tool("system_status", "CPU, memory, disk and battery status of this computer.")
def system_status(ctx: Context) -> dict:
    status: dict = {"os": f"{SYSTEM} {platform.release()}", "python": platform.python_version()}
    try:
        import psutil  # optional

        status["cpu_percent"] = psutil.cpu_percent(interval=0.3)
        status["memory_percent"] = psutil.virtual_memory().percent
        battery = psutil.sensors_battery()
        if battery:
            status["battery_percent"] = battery.percent
            status["charging"] = battery.power_plugged
    except ImportError:
        status["note"] = "Install psutil for CPU, memory and battery figures."
    total, used, free = shutil.disk_usage(os.path.expanduser("~"))
    status["disk_free_gb"] = round(free / 1e9, 1)
    return status
