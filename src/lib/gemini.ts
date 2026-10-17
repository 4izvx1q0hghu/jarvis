import { env, SYSTEM_PROMPT } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * The free brain: Google's Gemini API, called straight from the browser the
 * same way anthropic.ts calls Claude. Used in direct mode when the key gate was
 * given a Gemini key ("AQ.…", or the older "AIza…") — Google's free tier needs no
 * card, which the Anthropic API does. Google Search grounding stands in for
 * Anthropic's hosted web search.
 *
 * Free-tier limits are counted per model, so one model running out is not the
 * end of the day: answers walk down a ladder of free models (Flash-Lite, Flash,
 * then the open Gemma models, whose free allowance is far larger) and only give
 * up when every one of them is spent.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'

/** Used when the key is not allowed to list models. */
const FALLBACK_LADDER = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
]

/** A model that hit its limit is skipped for this long. Per-minute limits have
 *  recovered by then; a spent daily limit just costs one quick refusal. */
const SPENT_MS = 60_000

type Part = { text?: string; thought?: boolean }
type Chunk = {
  candidates?: {
    content?: { parts?: Part[] }
    groundingMetadata?: unknown
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
}

/** The turn in flight, so a barge-in can abort it — same contract as the
 *  Anthropic path: cutting her off stops the generation, not just the voice. */
let controller: AbortController | null = null
let cancelled = false
let searched = false
let lastModel = ''

let ladder: Promise<string[]> | null = null
/** Model → when it may be tried again. */
const spentUntil = new Map<string, number>()
/** Models whose search quota is gone (or that cannot search) — asked without it. */
const noSearch = new Set<string>()

const isGemma = (model: string) => model.startsWith('gemma')

/**
 * The free models this key can use, best first. Built once from the model list
 * so it keeps up with Google's renames; falls back to a fixed list if the key
 * may not list models.
 */
async function buildLadder(): Promise<string[]> {
  const first = env.geminiModel ? [env.geminiModel] : []
  try {
    const res = await fetch(`${API}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': env.geminiKey },
    })
    if (res.ok) {
      const { models = [] } = (await res.json()) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[]
      }
      const names = models
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
      const version = (n: string) => Number(/(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0)
      const size = (n: string) => Number(/-(\d+)b-/.exec(n)?.[1] ?? 0)
      const newest = (re: RegExp) =>
        names.filter((n) => re.test(n)).sort((a, b) => version(b) - version(a))
      const list = [
        ...['gemini-flash-lite-latest', 'gemini-flash-latest'].filter((n) => names.includes(n)),
        ...newest(/^gemini-[\d.]+-flash-lite$/),
        ...newest(/^gemini-[\d.]+-flash$/),
        ...names
          .filter((n) => /^gemma-[\d.]+-\d+b-it$/.test(n))
          .sort((a, b) => version(b) - version(a) || size(b) - size(a)),
      ]
      if (list.length) return [...new Set([...list, ...first])]
    }
  } catch {
    /* fall through to the fixed list */
  }
  return [...new Set([...FALLBACK_LADDER, ...first])]
}

/** Gemini calls the assistant "model" and takes parts rather than strings. */
function toContents(history: Msg[], persona: string | null) {
  return history.map((m, i) => {
    const text =
      (typeof m.content === 'string'
        ? m.content
        : m.content
            .map((b) => (b as { text?: unknown }).text)
            .filter((t): t is string => typeof t === 'string')
            .join('')) || '…'
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      // Gemma takes no system instruction, so the persona rides at the front of
      // the first user turn instead.
      parts: [{ text: i === 0 && persona ? `${persona}\n\n${text}` : text }],
    }
  })
}

function request(model: string, history: Msg[], search: boolean, signal: AbortSignal) {
  const gemma = isGemma(model)
  return fetch(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.geminiKey,
    },
    body: JSON.stringify({
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } }),
      contents: toContents(history, gemma ? SYSTEM_PROMPT : null),
      ...(search ? { tools: [{ google_search: {} }] } : {}),
      // Room for the model's own thinking as well as the short spoken answer;
      // on Gemini both count against this limit.
      generationConfig: { maxOutputTokens: 4096 },
    }),
  })
}

async function failure(res: Response): Promise<Error> {
  let detail = ''
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    /* not JSON */
  }
  return new Error(`Gemini error ${res.status}${detail ? `: ${detail}` : ''}`)
}

/**
 * The first model on the ladder that answers. A limit (429) or a model this key
 * does not have (404) moves on to the next; anything else — a bad key, a bad
 * request — is a real error and stops here.
 */
async function firstAnswer(history: Msg[], signal: AbortSignal): Promise<Response> {
  const models = await (ladder ??= buildLadder())
  const now = Date.now()
  let lastLimit: Response | null = null

  for (const model of models) {
    if ((spentUntil.get(model) ?? 0) > now) continue
    // Search first where it is offered. Grounding has its own free quota, so a
    // refusal is retried without it before the model counts as spent.
    const tries = isGemma(model) || noSearch.has(model) ? [false] : [true, false]
    for (const search of tries) {
      if (cancelled) throw new DOMException('cancelled', 'AbortError')
      const res = await request(model, history, search, signal)
      if (res.ok) {
        if (!search && tries.length > 1) noSearch.add(model)
        lastModel = model
        return res
      }
      if (search) continue
      if (res.status === 429 || res.status === 404) {
        spentUntil.set(model, Date.now() + SPENT_MS)
        if (res.status === 429) lastLimit = res
        break
      }
      throw await failure(res)
    }
  }

  if (lastLimit) {
    throw new Error(
      "Gemini's free limit is used up on every model for now. Per-minute limits " +
        'clear in a minute; daily limits reset at midnight US Pacific time.',
    )
  }
  throw new Error('No Gemini model answered. Try again in a minute.')
}

export async function ask(
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  cancelled = false
  const tools: string[] = []
  let text = ''

  controller = new AbortController()
  try {
    const res = await firstAnswer(history, controller.signal)

    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let blocked = false
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue

        const chunk = JSON.parse(line.slice(5)) as Chunk
        if (chunk.promptFeedback?.blockReason) blocked = true
        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason === 'SAFETY') blocked = true
        if (candidate?.groundingMetadata && !tools.includes('web_search')) {
          tools.push('web_search')
          searched = true
        }
        for (const part of candidate?.content?.parts ?? []) {
          if (part.thought || !part.text) continue
          text += part.text
          handlers.onText(part.text)
        }
      }
    }

    if (!text && blocked) {
      const line = "I can't help with that one."
      handlers.onText(line)
      return { text: line, tools }
    }
    return { text: text.trim(), tools }
  } catch (err) {
    // A barge-in aborts the request on purpose; hand back what was said.
    if (cancelled) return { text: text.trim(), tools }
    throw err
  } finally {
    controller = null
  }
}

export function cancel(): void {
  cancelled = true
  controller?.abort()
}

/** Labels for the HUD's SYSTEMS rail. */
export function connectedLabels(): string[] {
  const brain = lastModel ? `Gemini (${lastModel})` : 'Gemini'
  return searched ? [brain, 'Google Search'] : [brain]
}
