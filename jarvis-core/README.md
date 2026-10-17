# JARVIS core — a real, buildable JARVIS

A practical personal AI assistant that feels like JARVIS: it understands you,
talks, plans multi-step tasks, uses tools on your computer and the internet,
remembers what you approve, and always asks before anything consequential.

This folder is the **brain and hands** (Python). The **face** is Danya, the
holographic interface in the rest of this repository (also usable on an
iPhone at https://4izvx1q0hghu.github.io/jarvis/), and a built-in cinematic
dashboard.

---

## 1. Movie JARVIS vs. what's real today

| In the films | Real today? | How this project does it |
|---|---|---|
| Understands anything you say, banters, reasons | **Yes** | A large language model (Gemini free, or Claude) |
| Talks back in a natural voice, instantly | **Mostly** | Neural TTS (edge-tts); ~1–3 s round trip, not instant |
| Always listening for its name | **Yes** | openWakeWord "hey jarvis", offline |
| Remembers you and your preferences | **Yes** | SQLite memory you can view, edit and delete |
| Runs your computer: apps, files, web, email | **Yes, with limits** | Tool calling behind a permission gate |
| Controls the house | **Yes** | Home Assistant (thousands of devices) |
| Sees through cameras, reads screens | **Yes** | Vision models, only when you switch the sense on |
| Plans and carries out complex jobs on its own | **Partly** | Agent loop with a step limit and approvals |
| Hacks any system, controls satellites | **No** | Fiction (and illegal) |
| Flies the suit, real-time 3D holograms | **No** | Holograms are a styled 2D screen; no robotics core here |
| Runs entirely on its own with no servers | **No** | The model runs in the cloud; your PC runs the rest |
| Reads every phone notification (iPhone) | **No** | Apple forbids it; Android allows it with a native app |

The honest summary: the *conversation* and *assistant* parts of JARVIS are
real now. Instant everything, true autonomy, holograms and suits are not.

---

## 2. Architecture and data flow

```
   You ─ voice ─▶ ┌──────────────┐  text  ┌───────────────────────────────┐
                  │  voice.py    │ ─────▶ │  agent.py  (the loop)         │
   wake word ───▶ │ openWakeWord │        │  1. persona + memories + tools │
                  │ faster-whisper│ ◀───── │  2. LLM decides / plans       │
   speaker ◀───── │ edge-tts     │  reply │  3. tool request ─▶ GATE      │
                  └──────────────┘        │  4. run / ask you / refuse    │
                                          │  5. results back to the LLM   │
   Danya (phone/  ┌──────────────┐        │  6. answer + events           │
   browser) ─ws─▶ │  server.py   │ ─────▶ └───────┬───────────────┬───────┘
   dashboard ───▶ │  FastAPI     │                │               │
                  │  /ws /api    │         ┌──────▼─────┐  ┌──────▼──────┐
                  └──────────────┘         │ llm.py     │  │ tools/      │
                                           │ Gemini /   │  │ web, files, │
   ┌─────────────────────────────┐        │ Claude     │  │ apps, tasks,│
   │ permissions.py  safe/confirm│◀── GATE └────────────┘  │ calendar,   │
   │ audit.py   every action log │                         │ email, home,│
   │ memory.py  approved memory  │                         │ vision,     │
   │ storage.py SQLite           │                         │ memory      │
   └─────────────────────────────┘                         └─────────────┘
```

**One request, step by step:** "Hey Jarvis → tidy my Downloads and remind me
at 6 to call the supplier."
1. The wake word fires; Whisper turns your speech into text.
2. The agent sends the persona, relevant memories and the tool list to the LLM.
3. The LLM plans: `organize_folder(Downloads)`, then `add_reminder(...)`.
4. `organize_folder` is a *confirm* tool, so the system pauses and JARVIS says
   *"I'm about to organise the files in Downloads — shall I go ahead?"*
5. You say "yes". It runs, the result goes back to the LLM, the reminder
   (a *safe* tool) is added, and JARVIS reports what it did.
6. Every step lands in the audit log and on the dashboard's activity feed.
   At 6 pm the scheduler announces the reminder.

---

## 3. Hardware and software

**Minimum (free, use what you have):** any Windows/Mac/Linux computer from
the last ~8 years, 8 GB RAM, a microphone and speakers (a USB headset works
well). It must stay on for JARVIS to be "always there".

**Recommended:** a quiet always-on machine — an old laptop with the lid
open, or a used mini PC (Intel N100 class, ~US$100–150, 16 GB RAM). Add a
USB conference speakerphone (~US$25–40) for room-wide listening.

**Budget always-on:** Raspberry Pi 5 (8 GB) + USB mic + speaker (~US$100).
Use `JARVIS_WHISPER=tiny.en` for faster speech recognition on it.

**Software:** Python 3.10+, Git, a modern browser. Everything else installs
with pip.

---

## 4. Tools and APIs

| Need | Free option (default) | Paid / upgrade |
|---|---|---|
| Brain (LLM) | Google Gemini free tier (aistudio.google.com) | Claude API (console.anthropic.com) |
| Web search | Gemini + Google Search grounding | — |
| Speech → text | faster-whisper (offline) | Cloud STT (Deepgram, ElevenLabs Scribe) |
| Text → speech | edge-tts neural voices (online, free) | ElevenLabs |
| Wake word | openWakeWord (offline, custom words trainable) | Picovoice Porcupine |
| Smart home | Home Assistant (free, self-hosted) | — |
| Weather | Open-Meteo (no key) | — |
| Email | Any SMTP account with an app password | — |
| Memory / data | SQLite (built in) | Postgres + vector search |

---

## 5. Affordable prototype plan

| Phase | You get | Cost |
|---|---|---|
| **1. Text brain** (30 min) | `python -m jarvis chat` with tools, memory, approvals | Free |
| **2. Dashboard + Danya** (15 min) | `python -m jarvis serve`, cinematic UI, phone face | Free |
| **3. Voice** (30 min) | "Hey Jarvis", hands-free conversation, interruptions | Free (+ headset) |
| **4. Home & senses** (1–2 h) | Home Assistant, camera, screen explaining | Free (+ devices) |
| **5. Always on** | Mini PC / Pi running it 24/7, auto-start | ~US$100 one-off |

---

## 6. Install and run

### Windows
```bash
git clone https://github.com/4izvx1q0hghu/jarvis.git
cd jarvis/jarvis-core
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
notepad .env
```
Put your Gemini key in `GEMINI_API_KEY=`, save, then:
```bash
python -m jarvis doctor
python -m jarvis chat
```

### macOS / Linux / Raspberry Pi
```bash
git clone https://github.com/4izvx1q0hghu/jarvis.git
cd jarvis/jarvis-core
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && nano .env
python -m jarvis chat
```

### The dashboard (and Danya's brain)
```bash
python -m jarvis serve
```
It prints `http://127.0.0.1:8787/?token=…` — open that link. To use Danya's
holographic interface as the face, run Danya locally in bridge mode (from the
repository root: `npm install`, then `npm run dev` with `VITE_BRIDGE_URL`
left at its default `ws://localhost:8787`). To reach it from your phone over
HTTPS, use Tailscale (`tailscale serve 8787`) — never expose the port to the
open internet.

### Voice ("Hey Jarvis")
```bash
pip install -r requirements-voice.txt
python -m jarvis voice
```
The first run downloads the wake-word and speech models. Say "Hey Jarvis",
wait for `[voice] yes?`, then speak. Type `m` + Enter (or press Mute on the
dashboard) to mute; nothing is listened to while muted.

### Optional senses and encryption
```bash
pip install -r requirements-extras.txt
```
Then set `JARVIS_CAMERA=1` and/or `JARVIS_SCREEN=1`, and optionally
`JARVIS_MEMORY_KEY` for encrypted memory (see `.env.example`).

### Things to try
- "What's happening in the news today?" (web search)
- "Remember that I trade gold and run a store called NapNest."
- "Remind me in 20 minutes to check the oven."
- "Add a task to the store project: reply to supplier."
- "Organise my JARVIS folder." → it asks first.
- "Turn on the desk light." / "Unlock the front door." → the second asks first.
- "What's on my screen?" (with `JARVIS_SCREEN=1`)

---

## 7. Security model

- **Permission gate in code.** Tools are `safe`, `confirm` or `blocked`;
  sending, deleting, writing, unlocking and similar always pause for your
  explicit "yes" (any other reply cancels). Override per tool in `.env`.
- **No arbitrary commands.** There is no shell tool; apps open from an
  allow-list you control (`JARVIS_APPS`).
- **File sandbox.** File tools only touch `JARVIS_ALLOWED_DIRS`; `..` and
  symlink escapes are refused. "Delete" moves to a restorable trash.
- **Senses off by default.** Camera and screen need explicit switches, and
  JARVIS is told never to claim it sees what no tool returned.
- **Authentication.** The server binds to 127.0.0.1 and needs a token
  (random each start unless you set one); only this machine's own browser at a
  local origin is trusted without it.
- **Audit log.** Every request, decision, approval and result is appended to
  `~/.jarvis/audit.jsonl`, with secrets redacted.
- **Your data stays local.** Memory, reminders and logs live in
  `~/.jarvis/`; only the conversation text goes to the LLM provider. Optional
  encryption at rest for memory.
- **Prompt injection.** Web pages and emails can contain instructions aimed
  at the AI. The gate means none of them can send, delete or unlock anything
  without you saying yes.

---

## 8. Testing and troubleshooting

```bash
pip install pytest
python -m pytest -q
```
25 tests cover the permission gate, file sandbox, memory privacy, the agent's
approve/decline flow, audit redaction, both providers' message formats, and the
server (including the Danya socket and token checks).

| Problem | Fix |
|---|---|
| "offline mode — You said: …" | No LLM key. Add `GEMINI_API_KEY` to `.env`. |
| "free limit reached on every model" | Gemini free quota spent; wait, or add an Anthropic key. |
| Dashboard asks for a token | Use the full link printed by `serve`, or set `JARVIS_TOKEN`. |
| Danya says it can't reach the bridge | Run `serve` first; check port 8787 isn't in use. |
| Wake word never fires | Check the mic in OS settings; speak closer; run `doctor`. |
| It hears itself / cuts out | Use a headset, or raise `SILENCE_RMS` in `voice.py`. |
| No voice output | `pip install edge-tts miniaudio` (or pyttsx3 for offline). |
| Camera/screen "switched off" | That's the safety default: set `JARVIS_CAMERA=1` / `JARVIS_SCREEN=1`. |
| Smart home errors | Check `HOME_ASSISTANT_URL` and the long-lived token. |

---

## 9. Roadmap

1. **Streaming replies** — speak the first sentence while the rest is written.
2. **Semantic memory** — embeddings for recall by meaning, not keywords.
3. **Google Calendar / Gmail** via OAuth (the cloud "Danya – morning briefing"
   and "alerts" routines already cover Gmail + Shopify summaries).
4. **Computer use** — let the model operate apps visually, with a
   per-session approval and a kill switch.
5. **Speaker recognition** — only respond to your voice.
6. **Android companion app** — notification reading, which iPhone forbids.
7. **Multi-room** — Raspberry Pi satellites with mics in each room.
8. **Robotics** — ROS 2 bridge for a robot arm or rover, behind the same gate.
