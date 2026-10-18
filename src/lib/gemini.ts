import { env, persona } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * The free brain: Google's Gemini API, called straight from the browser the
 * same way anthropic.ts calls Claude. Used in direct mode when the key gate was
 * given a Gemini key ("AQ.…", or the older "AIza…") — Google's free tier needs no
 * card, which the Anthropic API does. Google Search grounding stands in for
 * Anthropic's hosted web search, and Gemini's code execution lets her run
 * Python for real calculations, data work and charts.
 *
 * Free-tier limits are counted per model, so one model running out is not the
 * end of the day: answers walk down a ladder of free models (Flash, Flash-Lite,
 * then the open Gemma models, whose free allowance is far larger) and only give
 * up when every one of them is spent.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'

/** Used when the key is not allowed to list models. */
const FALLBACK_LADDER = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
]

/** A model that hit its limit is skipped for this long. Per-minute limits have
 *  recovered by then; a spent daily limit just costs one quick refusal. */
const SPENT_MS = 60_000

type Part = {
  text?: string
  thought?: boolean
  executableCode?: { language?: string; code?: string }
  codeExecutionResult?: { outcome?: string; output?: string }
  inlineData?: { mimeType?: string; data?: string }
}

/**
 * What to offer each model, most capable first: web search, reading web pages
 * (url_context — any link in the question), and Python code execution
 * together, then smaller sets, then nothing. Not every model takes every
 * combination, and search has its own free quota, so a refusal steps down a
 * rung rather than failing the answer; the rung that worked is remembered per
 * model.
 */
const TOOLSETS: Record<string, unknown>[][] = [
  [{ google_search: {} }, { url_context: {} }, { code_execution: {} }],
  [{ google_search: {} }, { url_context: {} }],
  [{ google_search: {} }, { code_execution: {} }],
  [{ code_execution: {} }],
  [],
]
const workingToolset = new Map<string, number>()
type Chunk = {
  candidates?: {
    content?: { parts?: Part[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
    urlContextMetadata?: { urlMetadata?: { retrievedUrl?: string; urlRetrievalStatus?: string }[] }
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

/** Fast models for conversation, and the deep thinkers (Pro) for hard work. */
type Ladder = { fast: string[]; deep: string[] }
let ladder: Promise<Ladder> | null = null
/** Model → when it may be tried again. */
const spentUntil = new Map<string, number>()

const isGemma = (model: string) => model.startsWith('gemma')

/**
 * Whether a question deserves the slower, smarter Pro model: solving,
 * explaining, coding, planning, analysis, markets, maths, anything long — or
 * the user asking her to "think hard". Small talk stays on Flash, where a
 * reply comes back fast enough to feel like conversation.
 */
export function needsDeepThinking(text: string): boolean {
  if (/\b(think (hard|deeply|carefully)|deep(ly)? think|take your time)\b/i.test(text)) return true
  if (text.trim().split(/\s+/).length > 18) return true
  return /\b(solve|calculate|calculation|explain|why does|why is|how (do|does|can|would|should) (i|you|we|it)|code|program|script|debug|bug|error|analy[sz]e|analysis|compare|plan|strategy|essay|letter|proof|prove|math|maths|equation|formula|percent|trading|trade|invest|stock|crypto|forex|business|marketing|step by step|summari[sz]e|review|design|homework|algorithm|translate|research)\b/i.test(
    text,
  )
}

/** The text of the newest user turn. */
function lastUserText(history: Msg[]): string {
  const last = [...history].reverse().find((m) => m.role === 'user')
  if (!last) return ''
  return typeof last.content === 'string'
    ? last.content
    : last.content.map((b) => (b as { text?: unknown }).text ?? '').join(' ')
}

/**
 * The free models this key can use, best first. Built once from the model list
 * so it keeps up with Google's renames; falls back to a fixed list if the key
 * may not list models.
 */
async function buildLadder(): Promise<Ladder> {
  const fast = await buildFastLadder()
  let deep = ['gemini-pro-latest']
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
      const pros = names.filter((n) => /^gemini-[\d.]+-pro$/.test(n)).sort((a, b) => version(b) - version(a))
      const found = [...(names.includes('gemini-pro-latest') ? ['gemini-pro-latest'] : []), ...pros]
      if (found.length) deep = found
    }
  } catch {
    /* keep the alias */
  }
  return { fast, deep }
}

async function buildFastLadder(): Promise<string[]> {
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
      // Flash first: it thinks before answering, which is most of what makes
      // her sound considered. Lite is the fallback once Flash's free allowance
      // is spent, then Gemma.
      const list = [
        ...['gemini-flash-latest', 'gemini-flash-lite-latest'].filter((n) => names.includes(n)),
        ...newest(/^gemini-[\d.]+-flash$/),
        ...newest(/^gemini-[\d.]+-flash-lite$/),
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
    // A photo arrives in the Anthropic block shape (see brain.ts); Gemini takes
    // the same bytes as inlineData.
    const images =
      typeof m.content === 'string'
        ? []
        : m.content.flatMap((b) => {
            const src = (b as { type?: string; source?: { media_type?: string; data?: string } })
            return src.type === 'image' && src.source?.data
              ? [{ inlineData: { mimeType: src.source.media_type ?? 'image/jpeg', data: src.source.data } }]
              : []
          })
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      // Gemma takes no system instruction, so the persona rides at the front of
      // the first user turn instead.
      parts: [...images, { text: i === 0 && persona ? `${persona}\n\n${text}` : text }],
    }
  })
}

function request(model: string, history: Msg[], tools: Record<string, unknown>[], signal: AbortSignal) {
  const gemma = isGemma(model)
  return fetch(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.geminiKey,
    },
    body: JSON.stringify({
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: persona() }] } }),
      contents: toContents(history, gemma ? persona() : null),
      ...(tools.length ? { tools } : {}),
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
  const { fast, deep } = await (ladder ??= buildLadder())
  // Hard questions try Pro first; when its (small) free allowance is spent,
  // Flash and the rest of the ladder carry on.
  const models = needsDeepThinking(lastUserText(history)) ? [...new Set([...deep, ...fast])] : fast
  const now = Date.now()
  let lastLimit: Response | null = null

  for (const model of models) {
    if ((spentUntil.get(model) ?? 0) > now) continue
    // Gemma takes no tools; everything else starts from the rung that last
    // worked for it (see TOOLSETS).
    const first = isGemma(model) ? TOOLSETS.length - 1 : (workingToolset.get(model) ?? 0)
    for (let rung = first; rung < TOOLSETS.length; rung++) {
      if (cancelled) throw new DOMException('cancelled', 'AbortError')
      const res = await request(model, history, TOOLSETS[rung], signal)
      if (res.ok) {
        workingToolset.set(model, rung)
        lastModel = model
        return res
      }
      // A model missing or not allowed for this key is not something fewer
      // tools will fix.
      const unavailable = res.status === 404 || res.status === 403
      if (!unavailable && rung < TOOLSETS.length - 1) continue
      if (res.status === 429 || unavailable) {
        // A limit clears; a model this key cannot use will not, so stop
        // spending a request on it for the rest of the day.
        spentUntil.set(model, Date.now() + (unavailable ? 6 * 3_600_000 : SPENT_MS))
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
    // The websites behind the answer — search results it used, pages it read —
    // so the user can see where it came from and open them.
    const sources = new Map<string, { title: string; uri: string }>()
    const addSource = (uri?: string, title?: string) => {
      if (!uri || sources.size >= 6) return false
      let name = title?.trim()
      try {
        if (!name) name = new URL(uri).hostname.replace(/^www\./, '')
      } catch {
        return false
      }
      if ([...sources.values()].some((s) => s.title === name)) return false
      sources.set(uri, { title: name, uri })
      return true
    }
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
        let more = false
        for (const c of candidate?.groundingMetadata?.groundingChunks ?? []) {
          more = addSource(c.web?.uri, c.web?.title) || more
        }
        for (const u of candidate?.urlContextMetadata?.urlMetadata ?? []) {
          if (!u.urlRetrievalStatus || /SUCCESS/.test(u.urlRetrievalStatus)) more = addSource(u.retrievedUrl) || more
        }
        if (more) handlers.onArtifact?.({ sources: [...sources.values()] })
        for (const part of candidate?.content?.parts ?? []) {
          // Code the model ran, what it printed, and any chart it drew go to
          // the screen, never into the voice.
          if (part.executableCode?.code) {
            if (!tools.includes('code_execution')) tools.push('code_execution')
            handlers.onArtifact?.({ code: part.executableCode.code })
            continue
          }
          if (part.codeExecutionResult) {
            handlers.onArtifact?.({ output: part.codeExecutionResult.output ?? '' })
            continue
          }
          if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('image/')) {
            handlers.onArtifact?.({
              image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            })
            continue
          }
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
