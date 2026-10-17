from fastapi.testclient import TestClient

from jarvis.llm import FakeLLM, Reply
from jarvis.server import create_app


def client_for(runtime):
    return TestClient(create_app(runtime))


def test_health_is_open(runtime):
    assert client_for(runtime).get("/health").json()["ok"] is True


def test_api_needs_token(runtime):
    c = client_for(runtime)
    assert c.get("/api/state", headers={"origin": "https://evil.example"}).status_code == 401
    ok = c.get("/api/state", headers={"authorization": "Bearer test-token"})
    assert ok.status_code == 200 and "status" in ok.json()


def test_memory_api(runtime):
    mid = runtime.memory.add("likes cricket")
    c = client_for(runtime)
    h = {"authorization": "Bearer test-token"}
    assert c.patch(f"/api/memories/{mid}", json={"text": "loves cricket"}, headers=h).json()["ok"]
    assert runtime.memory.all()[0]["text"] == "loves cricket"
    assert c.delete(f"/api/memories/{mid}", headers=h).json()["ok"]
    assert runtime.memory.all() == []


def test_mute_switch(runtime):
    c = client_for(runtime)
    h = {"authorization": "Bearer test-token"}
    assert c.post("/api/mute", json={"muted": True}, headers=h).json()["muted"] is True
    assert runtime.muted
    c.post("/api/mute", json={"muted": False}, headers=h)
    assert not runtime.muted


def test_danya_protocol_over_websocket(runtime):
    runtime.llm = FakeLLM([Reply(text="Hello, Ahamed.")])
    c = client_for(runtime)
    with c.websocket_connect("/ws?token=test-token") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "ask", "text": "hi", "id": "42"})
        frames = []
        while True:
            frame = ws.receive_json()
            frames.append(frame)
            if frame["type"] == "done":
                break
        text = [f for f in frames if f["type"] == "text"][0]
        assert text["delta"] == "Hello, Ahamed." and text["ask"] == "42"
        assert frames[-1]["text"] == "Hello, Ahamed."


def test_websocket_rejects_foreign_origin(runtime):
    c = client_for(runtime)
    try:
        with c.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()
        assert False, "should have been rejected"
    except Exception:
        pass
