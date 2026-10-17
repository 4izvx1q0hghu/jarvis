"""Smart home through Home Assistant (free, open source, works with
thousands of devices: lights, plugs, thermostats, locks, cameras, TVs).

Lights, switches, media and climate run straight away. Locks, alarms, garage
doors and covers ask first — anything that affects the physical security of
the house is a confirm, not a convenience.
"""

from __future__ import annotations

import httpx

from .registry import Context, S, tool

SENSITIVE_DOMAINS = {"lock", "alarm_control_panel", "cover", "garage_door", "camera", "siren"}


def _ha(ctx: Context) -> tuple[str, dict]:
    s = ctx.settings
    if not (s.home_assistant_url and s.home_assistant_token):
        raise RuntimeError("Home Assistant isn't set up. Add HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN to .env.")
    return s.home_assistant_url.rstrip("/"), {"Authorization": f"Bearer {s.home_assistant_token}"}


@tool(
    "list_devices",
    "List smart-home devices and their current state, optionally one type (light, switch, lock, climate, media_player…).",
    {"domain": S("Device type to filter by (optional)")},
)
def list_devices(ctx: Context, domain: str = "") -> list[dict]:
    base, headers = _ha(ctx)
    states = httpx.get(f"{base}/api/states", headers=headers, timeout=15).json()
    out = []
    for st in states:
        entity = st["entity_id"]
        if domain and not entity.startswith(domain + "."):
            continue
        out.append({"entity_id": entity, "name": st["attributes"].get("friendly_name", entity), "state": st["state"]})
    return out[:150]


def _risk(args: dict) -> str:
    return "confirm" if args.get("domain", "") in SENSITIVE_DOMAINS else "safe"


@tool(
    "control_device",
    "Control a smart-home device through Home Assistant, e.g. domain=light service=turn_on entity_id=light.desk.",
    {
        "domain": S("light, switch, climate, media_player, lock, cover, scene, …"),
        "service": S("turn_on, turn_off, toggle, lock, unlock, open_cover, set_temperature, …"),
        "entity_id": S("The device id from list_devices"),
        "data": {"type": "object", "description": "Extra settings, e.g. {\"brightness_pct\": 40} (optional)"},
    },
    ["domain", "service", "entity_id"],
    risk=_risk,
    summary=lambda a: f"{a.get('service', '').replace('_', ' ')} {a.get('entity_id')}",
)
def control_device(ctx: Context, domain: str, service: str, entity_id: str, data: dict | None = None) -> str:
    base, headers = _ha(ctx)
    res = httpx.post(
        f"{base}/api/services/{domain}/{service}",
        headers=headers,
        json={"entity_id": entity_id, **(data or {})},
        timeout=15,
    )
    res.raise_for_status()
    return f"Done: {service} {entity_id}."
