import { env, SYSTEM_PROMPT } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * The free brain: Google's Gemini API, called straight from the browser the
 * same way anthropic.ts calls Claude. Used in direct mode when the key gate was
 * given a Gemini key (they start with "AIza") — Google's free tier needs no
 * card, which the Anthropic API does. Google Search grounding stands in for
 * Anthropic's hosted web search.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'

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
 *  Anthropic path: cutting JARVIS off stops the generation, not just the voice. */
let controller: AbortController | null = null
let cancelled = false
let searched = false

/** Gemini calls the assistant "model" and takes parts rather than strings. */
function toContents(history: Msg[]) {
  return history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      {
        text:
          (typeof m.content === 'string'
            ? m.content
            : m.content
                .map((b) => (b as { text?: unknown }).text)
                .filter((t): t is string => typeof t === 'string')
                .join('')) || '…',
      },
    ],
  }))
}

function request(history: Msg[], search: boolean, signal: AbortSignal) {
  return fetch(`${API}/models/${env.geminiModel}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.geminiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: toContents(history),
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
  if (res.status === 429) {
    return new Error('Gemini free-tier limit reached. Wait a minute and ask again.')
  }
  return new Error(`Gemini error ${res.status}${detail ? `: ${detail}` : ''}`)
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
    // Search first. Grounding has its own free-tier quota and not every model
    // offers it, so a refusal falls back to answering without search rather
    // than not answering at all.
    let res = await request(history, true, controller.signal)
    if (!res.ok && !cancelled) {
      res = await request(history, false, controller.signal)
    }
    if (!res.ok) throw await failure(res)

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
      const line = "I can't help with that one, sir."
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
  return searched ? ['Gemini', 'Google Search'] : ['Gemini']
}
