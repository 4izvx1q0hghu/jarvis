"""Command line:

  python -m jarvis chat     talk by typing (works with nothing but an LLM key)
  python -m jarvis serve    dashboard + API + Danya's socket on http://127.0.0.1:8787
  python -m jarvis voice    hands-free: "Hey Jarvis" (needs requirements-voice.txt)
  python -m jarvis doctor   check settings and optional features
"""

from __future__ import annotations

import importlib.util
import sys

from .agent import Session
from .runtime import Runtime


def chat(rt: Runtime) -> None:
    agent = rt.agent(on_event=_print_event)
    session = Session()
    print(f"JARVIS ({getattr(rt.llm, 'name', '?')}). Type 'quit' to leave.\n")
    while True:
        try:
            text = input("you › ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if text.lower() in ("quit", "exit", "q"):
            return
        if text:
            print(f"jarvis › {agent.run(session, text)}\n")


def _print_event(event: dict) -> None:
    kind = event.get("kind")
    if kind == "plan":
        print(f"  ↳ plan: {event['text']}")
    elif kind == "tool_start":
        print(f"  ↳ {event['name']} …")
    elif kind == "tool_done":
        print(f"  ↳ {event['name']} {'✓' if event['ok'] else '✗ ' + event['result'][:80]}")


def serve(rt: Runtime) -> None:
    import uvicorn

    from .server import create_app

    s = rt.settings
    print(f"\nJARVIS dashboard:  http://{s.host}:{s.port}/?token={s.auth_token}")
    print("Keep that link private — the token is the key to your assistant.\n")
    uvicorn.run(create_app(rt), host=s.host, port=s.port, log_level="warning")


def doctor(rt: Runtime) -> None:
    s = rt.settings
    def has(mod: str) -> str:
        return "yes" if importlib.util.find_spec(mod) else "no"
    print(f"brain:          {getattr(rt.llm, 'name', '?')}" + ("  (no key: offline echo mode)" if s.provider == "fake" else ""))
    print(f"data folder:    {s.data_dir}")
    print(f"file access:    {', '.join(map(str, s.allowed_dirs))}")
    print(f"camera / screen:{' on' if s.camera_enabled else ' off'} / {'on' if s.screen_enabled else 'off'}")
    print(f"smart home:     {'set up' if s.home_assistant_url else 'not set up'}")
    print(f"email:          {'set up' if s.smtp_host else 'not set up'}")
    print(f"server deps:    fastapi {has('fastapi')}, uvicorn {has('uvicorn')}")
    print(f"voice deps:     sounddevice {has('sounddevice')}, openwakeword {has('openwakeword')}, "
          f"faster_whisper {has('faster_whisper')}, edge_tts {has('edge_tts')}, pyttsx3 {has('pyttsx3')}")
    print(f"vision deps:    opencv {has('cv2')}, mss {has('mss')}, pillow {has('PIL')}")


def main(argv: list[str] | None = None) -> None:
    args = argv if argv is not None else sys.argv[1:]
    command = args[0] if args else "chat"
    rt = Runtime()
    if command == "chat":
        chat(rt)
    elif command == "serve":
        serve(rt)
    elif command == "voice":
        from .voice import run_voice

        run_voice(rt)
    elif command == "doctor":
        doctor(rt)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
