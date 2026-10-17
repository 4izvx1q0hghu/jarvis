import json

import pytest

from jarvis.agent import Session
from jarvis.audit import redact
from jarvis.llm import AnthropicLLM, FakeLLM, GeminiLLM, Reply, ToolCall
from jarvis.memory import Memory
from jarvis.permissions import Decision, Policy, is_no, is_yes
from jarvis.tools import REGISTRY, Context
from jarvis.tools.files import PathNotAllowed, safe_path


# -- permissions --------------------------------------------------------------


def test_risk_levels():
    policy = Policy()
    assert policy.decide(REGISTRY["web_search"], {"query": "x"}) is Decision.ALLOW
    assert policy.decide(REGISTRY["send_email"], {}) is Decision.CONFIRM
    assert policy.decide(REGISTRY["delete_file"], {"path": "a"}) is Decision.CONFIRM


def test_smart_home_risk_depends_on_device():
    policy = Policy()
    light = {"domain": "light", "service": "turn_on", "entity_id": "light.desk"}
    lock = {"domain": "lock", "service": "unlock", "entity_id": "lock.front"}
    assert policy.decide(REGISTRY["control_device"], light) is Decision.ALLOW
    assert policy.decide(REGISTRY["control_device"], lock) is Decision.CONFIRM


def test_overrides():
    assert Policy(deny=("web_search",)).decide(REGISTRY["web_search"], {}) is Decision.DENY
    assert Policy(auto_approve=("write_file",)).decide(REGISTRY["write_file"], {}) is Decision.ALLOW


def test_yes_no():
    assert is_yes("Yes please") and is_yes("go ahead") and is_yes("ok")
    assert not is_yes("no") and is_no("no thanks") and is_no("cancel that")
    assert not is_yes("what's the weather")


# -- file sandbox ---------------------------------------------------------------


def test_sandbox_blocks_escape(settings):
    ctx = Context(settings=settings)
    assert safe_path(ctx, "notes.txt").parent == settings.allowed_dirs[0]
    with pytest.raises(PathNotAllowed):
        safe_path(ctx, "../outside.txt")
    with pytest.raises(PathNotAllowed):
        safe_path(ctx, "C:/Windows/System32/drivers/etc/hosts")


def test_delete_goes_to_trash(settings):
    ctx = Context(settings=settings)
    target = settings.allowed_dirs[0] / "old.txt"
    target.write_text("bye")
    result = REGISTRY["delete_file"].func(ctx, path="old.txt")
    assert not target.exists()
    assert (settings.trash_dir).exists() and "restore_from" in result


def test_organize_folder(settings):
    ctx = Context(settings=settings)
    work = settings.allowed_dirs[0]
    for name in ("a.jpg", "b.pdf", "c.xyz"):
        (work / name).write_text("x")
    moved = REGISTRY["organize_folder"].func(ctx, path=str(work))["moved"]
    assert moved == {"Images": 1, "Documents": 1, "Other": 1}


# -- memory -----------------------------------------------------------------------


def test_memory_crud_and_privacy(runtime):
    mem = runtime.memory
    mid = mem.add("I trade gold on weekdays", "routine")
    assert mem.search("gold trading")[0]["id"] == mid
    assert mem.update(mid, "I trade gold and bitcoin")
    other = Memory(runtime.store, user_id="someone-else")
    assert other.all() == [] and not other.delete(mid)  # users are separate
    assert mem.delete(mid) and mem.all() == []


def test_memory_context_includes_profile(runtime):
    runtime.memory.add("Name is Ahamed", "profile")
    assert "Ahamed" in runtime.memory.context("anything")


# -- agent loop -------------------------------------------------------------------


def make_agent(runtime, script):
    runtime.llm = FakeLLM(script)
    events = []
    agent = runtime.agent(on_event=events.append)
    return agent, events


def test_agent_uses_safe_tool_then_answers(runtime):
    agent, events = make_agent(
        runtime,
        [
            Reply(tool_calls=[ToolCall("1", "add_task", {"text": "Call supplier", "project": "store"})]),
            Reply(text="Added it to your store tasks."),
        ],
    )
    session = Session()
    assert agent.run(session, "remind me to call the supplier") == "Added it to your store tasks."
    assert runtime.store.query("SELECT text FROM tasks")[0]["text"] == "Call supplier"
    assert [e["kind"] for e in events if e["kind"].startswith("tool")] == ["tool_start", "tool_done"]


def test_agent_pauses_for_approval_then_runs_on_yes(runtime, settings):
    (settings.allowed_dirs[0] / "draft.txt").write_text("x")
    agent, events = make_agent(
        runtime,
        [
            Reply(tool_calls=[ToolCall("1", "delete_file", {"path": "draft.txt"})]),
            Reply(text="Deleted — it's in the trash if you need it."),
        ],
    )
    session = Session()
    question = agent.run(session, "delete draft.txt")
    assert "Shall I go ahead" in question and (settings.allowed_dirs[0] / "draft.txt").exists()
    assert any(e["kind"] == "confirm" for e in events)
    assert agent.run(session, "yes") == "Deleted — it's in the trash if you need it."
    assert not (settings.allowed_dirs[0] / "draft.txt").exists()


def test_agent_does_nothing_on_no(runtime, settings):
    (settings.allowed_dirs[0] / "keep.txt").write_text("x")
    agent, _ = make_agent(runtime, [Reply(tool_calls=[ToolCall("1", "delete_file", {"path": "keep.txt"})])])
    session = Session()
    agent.run(session, "delete keep.txt")
    assert agent.run(session, "no") == "Okay, I won't do that."
    assert (settings.allowed_dirs[0] / "keep.txt").exists()


def test_agent_reports_tool_errors_to_model(runtime):
    agent, _ = make_agent(
        runtime,
        [Reply(tool_calls=[ToolCall("1", "read_file", {"path": "../../etc/passwd"})]), Reply(text="I can't read that.")],
    )
    assert agent.run(Session(), "read passwd") == "I can't read that."
    tool_msg = runtime.llm.calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and "outside the folders" in tool_msg["content"]


def test_agent_step_limit(runtime, settings):
    settings.max_steps = 2
    loop = [Reply(tool_calls=[ToolCall(str(i), "get_time", {})]) for i in range(5)]
    agent, _ = make_agent(runtime, loop)
    assert "more steps" in agent.run(Session(), "loop forever")


def test_every_action_is_audited(runtime):
    agent, _ = make_agent(runtime, [Reply(tool_calls=[ToolCall("1", "get_time", {})]), Reply(text="It's late.")])
    agent.run(Session(), "time?")
    kinds = [e["event"] for e in runtime.audit.tail()]
    assert {"user", "decision", "tool", "assistant"} <= set(kinds)


def test_audit_redacts_secrets():
    clean = redact({"to": "a@b.com", "password": "hunter2", "nested": {"api_key": "k"}})
    assert clean["password"] == "[redacted]" and clean["nested"]["api_key"] == "[redacted]" and clean["to"] == "a@b.com"


# -- providers ------------------------------------------------------------------


def test_gemini_conversion_round_trip():
    history = [
        {"role": "user", "content": "weather?"},
        {"role": "assistant", "content": "", "tool_calls": [ToolCall("1", "get_weather", {})], "raw": None},
        {"role": "tool", "call_id": "1", "name": "get_weather", "content": '{"t": 30}'},
    ]
    contents = GeminiLLM.to_contents(history)
    assert [c["role"] for c in contents] == ["user", "model", "user"]
    assert contents[2]["parts"][0]["functionResponse"]["name"] == "get_weather"
    reply = GeminiLLM.parse(
        {"candidates": [{"content": {"parts": [{"text": "Hot. "}, {"functionCall": {"name": "get_time", "args": {}}}]}}]}
    )
    assert reply.text == "Hot." and reply.tool_calls[0].name == "get_time" and reply.raw


def test_anthropic_conversion_groups_tool_results():
    history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "", "tool_calls": [ToolCall("a", "get_time", {}), ToolCall("b", "system_status", {})]},
        {"role": "tool", "call_id": "a", "name": "get_time", "content": "noon"},
        {"role": "tool", "call_id": "b", "name": "system_status", "content": "ok"},
    ]
    msgs = AnthropicLLM.to_messages(history)
    assert len(msgs) == 3 and len(msgs[2]["content"]) == 2 and msgs[2]["content"][0]["type"] == "tool_result"


def test_tool_specs_are_valid_json_schema():
    for tool in REGISTRY.values():
        spec = tool.spec()
        assert spec["parameters"]["type"] == "object"
        json.dumps(spec)  # serialisable
