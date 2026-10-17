/**
 * JARVIS configuration.
 *
 * Everything here is read from Vite env vars (.env.local) so no secrets are
 * committed. See .env.example for the full list.
 */

/**
 * Vite inlines a blank `.env` entry as an empty string, not as undefined, so
 * `??` never falls through to the default — and .env.example ships every
 * optional key blank, which is exactly the shape that used to bite. A blank
 * VITE_BACKEND silently selected the direct path and then complained about a
 * missing API key. Treat whitespace-only as unset everywhere in this file.
 */
function str(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? undefined : value
}

/**
 * Fixed-choice options. An unrecognised value is nearly always a typo, and
 * quietly falling back to the default hides it until it costs you a take.
 */
function choice<T extends string>(
  name: string,
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = str(raw)
  if (value === undefined) return fallback
  if ((allowed as readonly string[]).includes(value)) return value as T
  console.warn(
    `[jarvis] ${name}="${value}" is not one of ${allowed.join(' | ')} — using "${fallback}".`,
  )
  return fallback
}

/** Same, for the on/off options. Accepts true/false and 1/0. */
function flag(name: string, raw: unknown, fallback: boolean): boolean {
  const value = str(raw)?.toLowerCase()
  if (value === undefined) return fallback
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  console.warn(`[jarvis] ${name}="${value}" is not true or false — using ${fallback}.`)
  return fallback
}

/**
 * Keys typed into the page itself (direct mode on a phone).
 *
 * A public deploy must not carry an API key in its bundle — anyone could read
 * it out. So the key gate (src/ui/KeyGate.tsx) asks for them on the device and
 * keeps them in that browser's localStorage only. A key set in .env.local still
 * wins, so a local demo works exactly as before.
 */
export const KEY_STORE = {
  anthropic: 'jarvis.anthropicKey',
  gemini: 'jarvis.geminiKey',
  geminiModel: 'jarvis.geminiModel',
  eleven: 'jarvis.elevenKey',
} as const

function stored(name: string): string | undefined {
  try {
    return str(localStorage.getItem(name))
  } catch {
    return undefined
  }
}

/** One brain key is kept at a time; saving one clears the other. */
export function saveKeys(keys: {
  anthropic?: string
  gemini?: string
  geminiModel?: string
  eleven: string
}): void {
  forgetKeys()
  if (keys.anthropic) localStorage.setItem(KEY_STORE.anthropic, keys.anthropic)
  if (keys.gemini) localStorage.setItem(KEY_STORE.gemini, keys.gemini)
  if (keys.geminiModel) localStorage.setItem(KEY_STORE.geminiModel, keys.geminiModel)
  if (keys.eleven.trim()) localStorage.setItem(KEY_STORE.eleven, keys.eleven.trim())
}

export function forgetKeys(): void {
  try {
    for (const name of Object.values(KEY_STORE)) localStorage.removeItem(name)
  } catch {
    /* storage blocked — nothing was saved either */
  }
}

/**
 * Which brain to use.
 *
 *   'bridge' — run `npm run bridge` alongside the app. Authenticates off your
 *              existing Claude Code login (no API key), and every MCP server in
 *              your Claude Code config is available to JARVIS, including local
 *              ones like higgsfield, elevenlabs, android and playwright.
 *
 *   'direct' — the browser calls the Claude API itself. Nothing to run and it
 *              deploys as a static site, but it needs VITE_ANTHROPIC_API_KEY in
 *              the bundle and only reaches remote HTTP MCP servers.
 */
export const BACKEND: 'bridge' | 'direct' = choice(
  'VITE_BACKEND',
  import.meta.env.VITE_BACKEND,
  ['bridge', 'direct'] as const,
  'bridge',
)

/**
 * Where the bridge lives. Derived once here rather than in each of the three
 * places that talk to it, so moving off the default port is a single edit.
 * `wss://` maps to `https://` on its own, which is why this is a prefix swap
 * rather than a hardcoded scheme.
 */
export const BRIDGE_WS_URL = str(import.meta.env.VITE_BRIDGE_URL) ?? 'ws://localhost:8787'
export const BRIDGE_HTTP_URL = BRIDGE_WS_URL.replace(/^ws/, 'http')

/**
 * Speech output engine.
 *
 * false (default) — the browser's own speechSynthesis. Runs on-device, so
 *   speech starts on the next frame with no request and no download. This is
 *   the fastest option that exists and it's why it's the default.
 *
 * true — ElevenLabs. Noticeably better voice, but every sentence costs a
 *   round trip plus generation, which is the difference between a conversation
 *   and a walkie-talkie. Turn it on when you want the voice more than the pace.
 */
export const USE_ELEVENLABS =
  flag('VITE_USE_ELEVENLABS', import.meta.env.VITE_USE_ELEVENLABS, false) ||
  // An ElevenLabs key typed into the key gate is a request for that voice.
  (BACKEND === 'direct' && Boolean(stored(KEY_STORE.eleven)))

/**
 * Speech engine.
 *
 *   'system' — the browser's own speechSynthesis. Starts on the next frame,
 *     costs nothing, but is capped by whatever voices the OS ships; on macOS
 *     the British male option is compact Daniel.
 *
 *   'kokoro' — an 82M-parameter neural TTS running entirely in the browser via
 *     ONNX. Four proper British male voices and far better sound, nothing
 *     leaving the machine. MEASURED ON THIS MACHINE at q8/WebGPU it generates
 *     about 2.2x slower than realtime — "Yes, sir?" took 3.3 seconds and a
 *     thirteen-word sentence took nine. That is not a conversation, so it is
 *     not the default. Try `fp32` (see kokoro.ts) before enabling it; int8
 *     quantisation often silently falls back to CPU on WebGPU, which is the
 *     likely cause.
 */
export const TTS_ENGINE: 'kokoro' | 'system' = choice(
  'VITE_TTS_ENGINE',
  import.meta.env.VITE_TTS_ENGINE,
  ['kokoro', 'system'] as const,
  'system',
)

/**
 * Which Kokoro voice. All four are British male:
 *   bm_george — measured RP baritone, closest to the character
 *   bm_fable  — warmer
 *   bm_lewis  — lower
 *   bm_daniel — brighter
 */
export const KOKORO_VOICE = choice(
  'VITE_KOKORO_VOICE',
  import.meta.env.VITE_KOKORO_VOICE,
  ['bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel'] as const,
  'bm_george',
)

export const env = {
  anthropicKey:
    str(import.meta.env.VITE_ANTHROPIC_API_KEY) ?? stored(KEY_STORE.anthropic) ?? '',
  geminiKey: str(import.meta.env.VITE_GEMINI_API_KEY) ?? stored(KEY_STORE.gemini) ?? '',
  /** Chosen by the key gate from the models the key can use. */
  geminiModel:
    str(import.meta.env.VITE_GEMINI_MODEL) ??
    stored(KEY_STORE.geminiModel) ??
    'gemini-flash-latest',
  elevenKey:
    str(import.meta.env.VITE_ELEVENLABS_API_KEY) ?? stored(KEY_STORE.eleven) ?? '',
  elevenVoiceId:
    // Sarah — ElevenLabs' soft, young female premade voice.
    str(import.meta.env.VITE_ELEVENLABS_VOICE_ID) ?? 'EXAVITQu4vr4xnJGR5Gz',
  porcupineKey: str(import.meta.env.VITE_PICOVOICE_ACCESS_KEY) ?? '',
}

/** Which API answers in direct mode: Claude when there is an Anthropic key,
 *  otherwise Gemini's free tier when there is a Gemini key. */
export const DIRECT_BRAIN: 'anthropic' | 'gemini' =
  !env.anthropicKey && env.geminiKey ? 'gemini' : 'anthropic'

/** Direct mode cannot start without a key for one of the two. */
export const hasDirectKey = () => Boolean(env.anthropicKey || env.geminiKey)

/** `claude-opus-5` is the strongest model; `claude-sonnet-5` trades a little
 *  quality for lower latency if you find responses feel slow on camera. */
export const MODEL = 'claude-opus-5'

/**
 * Fast mode runs the same Opus 5 at up to 2.5x output speed. It is a research
 * preview on the Claude API and costs $10/$50 per Mtok instead of $5/$25.
 * For a recorded demo the snappiness is worth it. Off unless VITE_FAST_MODE is
 * set, because it doubles the bill and not every API account has the preview.
 */
export const FAST_MODE = flag('VITE_FAST_MODE', import.meta.env.VITE_FAST_MODE, false)

/**
 * Wake-word engine.
 *   'speech'    — zero setup, uses the browser's SpeechRecognition to listen for
 *                 "hey jarvis". Chrome/Edge only, audio goes to Google.
 *   'porcupine' — recommended. Runs offline in WASM, "Jarvis" is a built-in
 *                 keyword, far fewer false triggers. Needs a free AccessKey
 *                 from console.picovoice.ai.
 */
export const WAKE_ENGINE: 'speech' | 'porcupine' = env.porcupineKey
  ? 'porcupine'
  : 'speech'

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export type McpServer = {
  /** Stable id used as the tool namespace. Lowercase, no spaces. */
  name: string
  /** Human label for the HUD. */
  label: string
  /** Remote MCP endpoint. Must be reachable from Anthropic's servers, not yours. */
  url: string
  /** Bearer token, if the server wants one. Many put the secret in the URL instead. */
  token?: string
  enabled: boolean
}

/**
 * These are passed to the Messages API `mcp_servers` parameter. Anthropic dials
 * the servers itself, so there is no CORS to fight and no local bridge to run —
 * which is what makes a backend-free JARVIS possible.
 *
 * Only *remote HTTP* MCP servers work here. Local stdio servers (filesystem,
 * Blender, Playwright) need a machine to run on and are out of scope for a
 * browser-only build.
 *
 * READ THIS BEFORE FILLING ANY OF THESE IN. Every one of them ships to the
 * browser. In direct mode Vite inlines each token below into the JavaScript
 * bundle, and the Zapier and Pipedream URLs *are* secrets — the URL is the
 * credential. Anyone who opens devtools on a deployed build gets your Notion,
 * Linear, GitHub, Stripe, Sentry and Home Assistant access, not just the
 * Anthropic key. This is fine for a demo on your own machine or a recording;
 * it is not fine for anything public. The bridge backend (the default) reads
 * none of this — it uses your Claude Code MCP config, where the secrets stay on
 * your machine — so if you want these integrations without the exposure, run
 * `npm run bridge` instead of filling in this block.
 */
export const MCP_SERVERS: McpServer[] = [
  // The single highest-leverage integration: one URL, ~8,000 apps, managed
  // OAuth. Wire up Gmail, Google Calendar, Spotify, Slack, Notion and Sheets in
  // the Zapier dashboard and they all arrive through this one endpoint.
  // Get yours at https://mcp.zapier.com -> New MCP Server.
  {
    name: 'zapier',
    label: 'Zapier',
    url: str(import.meta.env.VITE_ZAPIER_MCP_URL) ?? '',
    enabled: Boolean(str(import.meta.env.VITE_ZAPIER_MCP_URL)),
  },

  // Alternative/complementary gateway: ~3,000 apps, free for personal use.
  {
    name: 'pipedream',
    label: 'Pipedream',
    url: str(import.meta.env.VITE_PIPEDREAM_MCP_URL) ?? '',
    enabled: Boolean(str(import.meta.env.VITE_PIPEDREAM_MCP_URL)),
  },

  // Official first-party servers. Each needs its own OAuth token pasted in.
  {
    name: 'notion',
    label: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    token: str(import.meta.env.VITE_NOTION_TOKEN),
    enabled: Boolean(str(import.meta.env.VITE_NOTION_TOKEN)),
  },
  {
    name: 'linear',
    label: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    token: str(import.meta.env.VITE_LINEAR_TOKEN),
    enabled: Boolean(str(import.meta.env.VITE_LINEAR_TOKEN)),
  },
  {
    name: 'github',
    label: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    token: str(import.meta.env.VITE_GITHUB_TOKEN),
    enabled: Boolean(str(import.meta.env.VITE_GITHUB_TOKEN)),
  },
  {
    name: 'stripe',
    label: 'Stripe',
    url: 'https://mcp.stripe.com',
    token: str(import.meta.env.VITE_STRIPE_TOKEN),
    enabled: Boolean(str(import.meta.env.VITE_STRIPE_TOKEN)),
  },
  {
    name: 'sentry',
    label: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    token: str(import.meta.env.VITE_SENTRY_TOKEN),
    enabled: Boolean(str(import.meta.env.VITE_SENTRY_TOKEN)),
  },
  // Home Assistant is self-hosted, so this needs a publicly reachable URL
  // (Nabu Casa Cloud, or a Cloudflare tunnel). Worth the setup — "Jarvis, dim
  // the lights" with the room actually dimming is the best shot in the video.
  // Both halves are required: an instance reachable from Anthropic's servers
  // with no bearer token attached is one that answers 401 to every tool call,
  // which reads on the HUD as connected and behaves as broken.
  {
    name: 'home',
    label: 'Home',
    url: str(import.meta.env.VITE_HOMEASSISTANT_MCP_URL) ?? '',
    token: str(import.meta.env.VITE_HOMEASSISTANT_TOKEN),
    enabled: Boolean(
      str(import.meta.env.VITE_HOMEASSISTANT_MCP_URL) &&
        str(import.meta.env.VITE_HOMEASSISTANT_TOKEN),
    ),
  },
]

export const activeServers = () => MCP_SERVERS.filter((s) => s.enabled && s.url)

/**
 * The persona for the browser-direct path only. The bridge carries its own,
 * fuller version in bridge/server.mjs — that's the one that gets used by
 * default, and the one worth editing.
 */
export const SYSTEM_PROMPT = `You are DANYA, a personal voice assistant. If asked your name, you are Danya. You are speaking out loud, and you also have a screen.

You are knowledgeable and genuinely useful. When someone gives you a problem —
maths, homework, code, a bug, a decision, something broken, a plan to make —
solve it. Think it through carefully step by step, check your working and your
final answer before you give it, and never stop at "it depends" when you can
work it out. For anything current (news, prices, scores, weather, recent
events), search the web rather than relying on memory.

Every reply has two parts:

1. SPOKEN (read aloud). Plain spoken prose: no markdown, bullets, headings,
   code, emoji or asterisks. Normally under 60 words — every word is read aloud
   and the user waits while it plays. When solving or explaining something, up
   to about 100 words: say the answer first, then the key idea in plain words.
   Write numbers, dates and times the way you'd say them ("eight fifteen", "the
   first of August"). If there is more on screen, end with "The details are on
   your screen."

2. SCREEN (optional, never read aloud). After the spoken part, you may add one
   panel between the exact markers [[PANEL]] and [[/PANEL]]. First line: a short
   title. Then short lines, one point per line: steps of a solution, key facts,
   a list, a comparison. Put any code in a fenced code block inside the panel.
   Use the panel whenever there are details, steps, numbers or code — always for
   code and for worked solutions. Keep it under about 25 lines.

Example:
The answer is forty-two. You multiply six by seven. The details are on your screen.
[[PANEL]]
Six times seven
Step 1: 6 × 7 = 42
Check: 42 ÷ 7 = 6 ✓
[[/PANEL]]

Voice:
- Warm, gentle and calm, with a light touch of humour. Kind, never fawning.
- Say "sir" at most once per exchange, and not in every exchange.

Using tools:
- You have live tools. Use them rather than guessing.
- Never narrate that you're about to use one. No "Let me search for that" or
  "I'll check that now" — go silent, use it, then answer. The user sees a
  spinner; they don't need commentary.
- Never speak a URL, ID or raw JSON aloud unless asked. Summarise.
- If a tool fails or isn't connected, one plain sentence saying so.
- For anything outward-facing or destructive (sending mail, posting, paying,
  deleting) say exactly what you're about to do and wait for confirmation.
- If you don't know, say you don't know.

Phone actions are handled by the app itself, not by you. If someone asks you to
call, text, WhatsApp, give directions, play something or open an app, tell them
to say it plainly, for example: "call Ali", "WhatsApp Ali saying I'm coming",
"directions to the airport", "play lo-fi music", "open Instagram". To call by
name they first say "save Ali as" and the number.`
