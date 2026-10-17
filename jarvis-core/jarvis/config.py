"""Settings, read from environment variables and an optional `.env` file.

Nothing secret lives in code. Every setting has a safe default, so JARVIS
starts with only an LLM key configured; integrations switch on as their
settings appear.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=value lines, # comments. Real environment
    variables always win over the file."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _flag(name: str, default: bool = False) -> bool:
    value = _env(name)
    return default if value is None else value.lower() in ("1", "true", "yes", "on")


def _list(name: str) -> list[str]:
    value = _env(name, "") or ""
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass
class Settings:
    # The brain
    provider: str = "gemini"  # gemini | anthropic | fake
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None
    model: str | None = None  # None = the provider's default

    # Where JARVIS keeps its database, audit log and trash
    data_dir: Path = field(default_factory=lambda: Path.home() / ".jarvis")
    # The only folders the file tools may touch
    allowed_dirs: list[Path] = field(default_factory=list)

    # Server
    host: str = "127.0.0.1"
    port: int = 8787
    auth_token: str = ""
    allowed_origins: list[str] = field(default_factory=list)

    # Voice
    wake_word: str = "hey_jarvis"
    # edge-tts voice; any from `edge-tts --list-voices`. Ava: warm, calm,
    # friendly American — the "helpful suit AI" sound.
    voice_name: str = "en-US-AvaNeural"

    # Senses — off unless explicitly enabled
    camera_enabled: bool = False
    screen_enabled: bool = False

    # Integrations
    home_assistant_url: str | None = None
    home_assistant_token: str | None = None
    smtp_host: str | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    latitude: float | None = None
    longitude: float | None = None

    # Agent limits and permission overrides
    max_steps: int = 8
    auto_approve: list[str] = field(default_factory=list)  # tools never to confirm
    deny_tools: list[str] = field(default_factory=list)  # tools never to run

    user_id: str = "owner"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jarvis.db"

    @property
    def audit_path(self) -> Path:
        return self.data_dir / "audit.jsonl"

    @property
    def trash_dir(self) -> Path:
        return self.data_dir / "trash"


def load_settings(env_file: str | os.PathLike[str] | None = ".env") -> Settings:
    if env_file:
        _load_dotenv(Path(env_file))

    data_dir = Path(_env("JARVIS_DATA_DIR", str(Path.home() / ".jarvis"))).expanduser()
    allowed = [Path(p).expanduser().resolve() for p in _list("JARVIS_ALLOWED_DIRS")]
    if not allowed:
        # A sensible, contained default: a JARVIS folder in Documents.
        allowed = [(Path.home() / "Documents" / "JARVIS").resolve()]

    gemini = _env("GEMINI_API_KEY")
    anthropic = _env("ANTHROPIC_API_KEY")
    provider = _env("JARVIS_PROVIDER") or ("gemini" if gemini else "anthropic" if anthropic else "fake")

    def _float(name: str) -> float | None:
        value = _env(name)
        try:
            return float(value) if value is not None else None
        except ValueError:
            return None

    token = _env("JARVIS_TOKEN")
    if not token:
        # Generated per run and printed at startup, so the server is never
        # open to the network without one.
        token = secrets.token_urlsafe(18)

    return Settings(
        provider=provider,
        gemini_api_key=gemini,
        anthropic_api_key=anthropic,
        model=_env("JARVIS_MODEL"),
        data_dir=data_dir,
        allowed_dirs=allowed,
        host=_env("JARVIS_HOST", "127.0.0.1") or "127.0.0.1",
        port=int(_env("JARVIS_PORT", "8787") or 8787),
        auth_token=token,
        allowed_origins=_list("JARVIS_ALLOWED_ORIGINS"),
        wake_word=_env("JARVIS_WAKE_WORD", "hey_jarvis") or "hey_jarvis",
        voice_name=_env("JARVIS_VOICE", "en-US-AvaNeural") or "en-US-AvaNeural",
        camera_enabled=_flag("JARVIS_CAMERA"),
        screen_enabled=_flag("JARVIS_SCREEN"),
        home_assistant_url=_env("HOME_ASSISTANT_URL"),
        home_assistant_token=_env("HOME_ASSISTANT_TOKEN"),
        smtp_host=_env("SMTP_HOST"),
        smtp_user=_env("SMTP_USER"),
        smtp_password=_env("SMTP_PASSWORD"),
        latitude=_float("JARVIS_LAT"),
        longitude=_float("JARVIS_LON"),
        max_steps=int(_env("JARVIS_MAX_STEPS", "8") or 8),
        auto_approve=_list("JARVIS_AUTO_APPROVE"),
        deny_tools=_list("JARVIS_DENY"),
        user_id=_env("JARVIS_USER", "owner") or "owner",
    )
