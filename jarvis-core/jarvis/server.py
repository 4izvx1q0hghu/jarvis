"""The server: dashboard, API, reminder scheduler, and Danya's socket.

WebSocket  /ws (also /)  — speaks the same protocol as Danya's Node bridge, so
                            Danya's Iron Man interface can use this brain:
    in:   {"type":"ask","text","id"}  {"type":"interrupt"}
    out:  {"type":"ready","servers":[…]}  {"type":"tool","name","ask"}
          {"type":"text","delta","ask"}   {"type":"done","text","ask"}
          {"type":"error","message","ask"}
          plus {"type":"event",…} and {"type":"notify",…} for the dashboard
          (Danya ignores frame types it doesn't know).
HTTP       /            Danya's holographic interface (after `npm run build:core`),
                        otherwise the dashboard
           /dashboard   the admin dashboard: memory, tasks, audit, approvals
           /health      Danya's capability probe
           /api/…       state, memory (view / edit / delete), audit, mute

Security: every API call and socket needs the access token (printed at
startup), except from this machine's own browser at a local origin — the same
trust rule Danya's bridge used. The server listens on 127.0.0.1 unless
JARVIS_HOST says otherwise.
"""

from __future__ import annotations

import asyncio
import hmac
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .agent import Session
from .runtime import Runtime
from .tools.web import get_weather

WEB = Path(__file__).parent / "web"
# Danya's holographic interface, built from the repository root with
# `npm run build:core` (it lands here and is git-ignored).
UI = Path(__file__).parent / "ui"


def _local_origin(origin: str | None) -> bool:
    if not origin:
        return False
    for host in ("http://localhost", "http://127.0.0.1"):
        if origin.startswith(host):
            return True
    return False


def create_app(runtime: Runtime | None = None) -> FastAPI:
    rt = runtime or Runtime()
    clients: set[WebSocket] = set()
    weather_cache: dict[str, Any] = {"at": 0.0, "data": None}

    def authorised(token: str | None, origin: str | None, client_host: str | None) -> bool:
        if token and hmac.compare_digest(token, rt.settings.auth_token):
            return True
        if origin in rt.settings.allowed_origins:
            return True
        # This machine's own browser, at a local origin.
        return _local_origin(origin) and client_host in ("127.0.0.1", "::1", "localhost")

    def require(request: Request) -> None:
        bearer = request.headers.get("authorization", "")
        token = bearer[7:] if bearer.lower().startswith("bearer ") else request.query_params.get("token")
        client = request.client.host if request.client else None
        if not authorised(token, request.headers.get("origin") or f"http://{request.url.hostname}", client):
            raise HTTPException(status_code=401, detail="Missing or wrong JARVIS token.")

    async def broadcast(frame: dict[str, Any]) -> None:
        for ws in list(clients):
            try:
                await ws.send_json(frame)
            except Exception:
                clients.discard(ws)

    # -- scheduler: announce reminders when due ---------------------------

    async def scheduler() -> None:
        while True:
            try:
                for r in rt.due_reminders():
                    rt.audit.record("reminder_due", id=r["id"], text=r["text"])
                    await broadcast({"type": "notify", "kind": "reminder", "text": f"Reminder: {r['text']}"})
            except Exception as exc:  # the scheduler must never die
                rt.audit.record("error", where="scheduler", error=str(exc))
            await asyncio.sleep(15)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        task = asyncio.create_task(scheduler())
        yield
        task.cancel()

    app = FastAPI(title="JARVIS", docs_url=None, redoc_url=None, lifespan=lifespan)

    # -- HTTP ---------------------------------------------------------------

    @app.get("/dashboard")
    async def dashboard() -> FileResponse:
        return FileResponse(WEB / "index.html")

    if not (UI / "index.html").is_file():
        # Danya's holographic interface isn't built yet (npm run build:core):
        # the dashboard stands in at the root.
        @app.get("/")
        async def root() -> FileResponse:
            return FileResponse(WEB / "index.html")

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "tts": False, "stt": False}

    @app.get("/api/state")
    async def state(request: Request) -> dict:
        require(request)
        uid = rt.settings.user_id
        if time.time() - weather_cache["at"] > 600 and rt.settings.latitude is not None:
            try:
                ctx = rt.agent().ctx
                weather_cache["data"] = await asyncio.to_thread(get_weather, ctx)
                weather_cache["at"] = time.time()
            except Exception:
                pass
        now = time.time()
        return {
            "status": rt.status(),
            "weather": weather_cache["data"],
            "tasks": rt.store.query("SELECT id, text, project FROM tasks WHERE user_id=? AND done=0 ORDER BY created", (uid,)),
            "reminders": rt.store.query(
                "SELECT id, text, due FROM reminders WHERE user_id=? AND done=0 ORDER BY due LIMIT 20", (uid,)
            ),
            "events": rt.store.query(
                "SELECT id, title, start, location FROM events WHERE user_id=? AND start BETWEEN ? AND ? ORDER BY start",
                (uid, now - 3600, now + 7 * 86400),
            ),
            "memories": rt.memory.all(),
            "audit": rt.audit.tail(30),
        }

    @app.patch("/api/memories/{memory_id}")
    async def edit_memory(memory_id: int, request: Request) -> dict:
        require(request)
        body = await request.json()
        ok = rt.memory.update(memory_id, str(body.get("text", "")))
        rt.audit.record("memory_edit", id=memory_id, ok=ok, via="dashboard")
        return {"ok": ok}

    @app.delete("/api/memories/{memory_id}")
    async def delete_memory(memory_id: int, request: Request) -> dict:
        require(request)
        ok = rt.memory.delete(memory_id)
        rt.audit.record("memory_delete", id=memory_id, ok=ok, via="dashboard")
        return {"ok": ok}

    @app.delete("/api/memories")
    async def clear_memories(request: Request) -> dict:
        require(request)
        count = rt.memory.clear()
        rt.audit.record("memory_clear", count=count, via="dashboard")
        return {"deleted": count}

    @app.get("/api/audit")
    async def audit(request: Request, limit: int = 100) -> list:
        require(request)
        return rt.audit.tail(min(limit, 1000))

    @app.post("/api/mute")
    async def mute(request: Request) -> dict:
        require(request)
        body = await request.json()
        rt.set_muted(bool(body.get("muted")))
        await broadcast({"type": "event", "kind": "mute", "muted": rt.muted})
        return {"muted": rt.muted}

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    # -- WebSocket ------------------------------------------------------------

    async def socket(ws: WebSocket) -> None:
        origin = ws.headers.get("origin")
        client = ws.client.host if ws.client else None
        if not authorised(ws.query_params.get("token"), origin, client):
            await ws.close(code=4401)
            return
        await ws.accept()
        clients.add(ws)
        loop = asyncio.get_running_loop()
        session = Session()
        current: dict[str, Any] = {"ask": None}

        def send_soon(frame: dict[str, Any]) -> None:
            asyncio.run_coroutine_threadsafe(ws.send_json(frame), loop)

        def on_event(event: dict[str, Any]) -> None:
            ask = current["ask"]
            send_soon({"type": "event", "ask": ask, **event})
            if event.get("kind") == "tool_start":
                send_soon({"type": "tool", "name": event["name"], "ask": ask})

        agent = rt.agent(on_event=on_event)
        await ws.send_json({"type": "ready", "servers": ["danya-core", rt.status()["brain"]]})

        try:
            while True:
                msg = await ws.receive_json()
                kind = msg.get("type")
                if kind == "interrupt":
                    current["ask"] = None  # the running turn's reply is dropped
                    continue
                if kind != "ask" or not isinstance(msg.get("text"), str):
                    continue
                ask_id = msg.get("id") or str(time.time())
                current["ask"] = ask_id
                try:
                    reply = await asyncio.to_thread(agent.run, session, msg["text"])
                except Exception as exc:
                    await ws.send_json({"type": "error", "message": str(exc), "ask": ask_id})
                    continue
                if current["ask"] != ask_id:
                    continue  # superseded by an interrupt
                await ws.send_json({"type": "text", "delta": reply, "ask": ask_id})
                await ws.send_json({"type": "done", "text": reply, "ask": ask_id})
        except WebSocketDisconnect:
            pass
        finally:
            clients.discard(ws)

    app.add_api_websocket_route("/ws", socket)
    app.add_api_websocket_route("/", socket)

    # Danya's holographic interface, when built. Mounted last so the API, the
    # dashboard and the socket above all match first.
    if (UI / "index.html").is_file():
        app.mount("/", StaticFiles(directory=UI, html=True), name="danya")
    return app
