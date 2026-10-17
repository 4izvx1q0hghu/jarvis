"""The internet: search, read a page, open a website, check the weather."""

from __future__ import annotations

import html
import re
import webbrowser
from urllib.parse import quote_plus, urlparse

import httpx

from .registry import Context, N, S, tool

_TAGS = re.compile(r"<(script|style)[^>]*>.*?</\1>|<[^>]+>", re.S | re.I)


@tool(
    "web_search",
    "Search the internet for current information and get a summary with sources. "
    "Use for news, prices, facts that may have changed, or anything you are unsure of.",
    {"query": S("What to search for")},
    ["query"],
)
def web_search(ctx: Context, query: str) -> str:
    llm = ctx.llm
    if hasattr(llm, "search"):
        return llm.search(query)
    # No search-capable model configured: DuckDuckGo's instant answers (free,
    # no key) cover definitions and quick facts, not news.
    res = httpx.get(
        "https://api.duckduckgo.com/",
        params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1},
        timeout=15,
    )
    data = res.json()
    answer = data.get("AbstractText") or data.get("Answer") or ""
    related = [t.get("Text") for t in data.get("RelatedTopics", [])[:5] if isinstance(t, dict) and t.get("Text")]
    return answer or "\n".join(related) or "No instant answer. A Gemini key gives full web search."


@tool(
    "read_webpage",
    "Fetch a web page and return its readable text, to summarise or answer questions about it.",
    {"url": S("Full https:// address")},
    ["url"],
)
def read_webpage(ctx: Context, url: str) -> dict:
    if urlparse(url).scheme not in ("http", "https"):
        return {"error": "Only http(s) addresses can be read."}
    res = httpx.get(url, timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 JARVIS"})
    text = html.unescape(_TAGS.sub(" ", res.text))
    text = re.sub(r"\s+", " ", text).strip()
    return {"url": str(res.url), "status": res.status_code, "text": text[:15000]}


@tool(
    "open_website",
    "Open a website (or a web search) in the computer's browser.",
    {"url_or_query": S("An address like youtube.com, or words to search for")},
    ["url_or_query"],
)
def open_website(ctx: Context, url_or_query: str) -> str:
    target = url_or_query.strip()
    if " " in target or "." not in target:
        target = f"https://www.google.com/search?q={quote_plus(target)}"
    elif not target.startswith(("http://", "https://")):
        target = "https://" + target
    if urlparse(target).scheme not in ("http", "https"):
        return "Only web addresses can be opened."
    webbrowser.open(target)
    return f"Opened {target}"


@tool(
    "get_weather",
    "Current weather and today's forecast. Uses the home location from settings unless given coordinates.",
    {"latitude": N("Latitude (optional)"), "longitude": N("Longitude (optional)")},
)
def get_weather(ctx: Context, latitude: float | None = None, longitude: float | None = None) -> dict:
    lat = latitude if latitude is not None else ctx.settings.latitude
    lon = longitude if longitude is not None else ctx.settings.longitude
    if lat is None or lon is None:
        return {"error": "No location set. Add JARVIS_LAT and JARVIS_LON to .env, or ask with a city via web_search."}
    # Open-Meteo: free, no key.
    res = httpx.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto",
            "forecast_days": 1,
        },
        timeout=15,
    )
    data = res.json()
    return {"current": data.get("current"), "today": data.get("daily"), "units": data.get("current_units")}
