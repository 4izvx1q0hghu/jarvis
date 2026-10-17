import { create } from 'zustand'

/**
 * The on-screen half of an answer, for the direct (phone) path.
 *
 * On the bridge the model pushes HUD panels with a tool; the direct path has no
 * such channel, so the model writes its panel inline between [[PANEL]] and
 * [[/PANEL]] after the spoken answer, and the splitter below keeps it out of
 * the voice. Details, lists and code go on screen; the voice stays short.
 * Questions about a person, place or thing also get a picture and summary from
 * Wikipedia, fetched directly — no model call, no quota.
 */

export type InfoPanel = {
  title: string
  lines: string[]
  code?: string
  image?: string
  source?: string
}

export const useInfoPanel = create<{ panel: InfoPanel | null }>(() => ({ panel: null }))
export const showInfo = (panel: InfoPanel) => useInfoPanel.setState({ panel })
export const closeInfo = () => useInfoPanel.setState({ panel: null })

const OPEN = '[[PANEL]]'
const CLOSE = '[[/PANEL]]'

/**
 * Splits a streamed answer into what is spoken and what goes on screen. Markers
 * can arrive split across chunks, so a tail that could be the start of one is
 * held back until the next chunk settles it.
 */
export function makePanelSplitter() {
  let inPanel = false
  let carry = ''
  let panel = ''

  const push = (chunk: string): string => {
    let s = carry + chunk
    carry = ''
    let spoken = ''
    while (s) {
      const marker = inPanel ? CLOSE : OPEN
      const at = s.indexOf(marker)
      if (at >= 0) {
        if (inPanel) panel += s.slice(0, at)
        else spoken += s.slice(0, at)
        s = s.slice(at + marker.length)
        inPanel = !inPanel
        continue
      }
      let keep = 0
      for (let k = Math.min(marker.length - 1, s.length); k > 0; k--) {
        if (marker.startsWith(s.slice(-k))) {
          keep = k
          break
        }
      }
      const body = s.slice(0, s.length - keep)
      carry = s.slice(s.length - keep)
      if (inPanel) panel += body
      else spoken += body
      s = ''
    }
    return spoken
  }

  /** Flushes whatever was being held back. */
  const end = (): string => {
    const rest = carry
    carry = ''
    if (inPanel) {
      panel += rest
      return ''
    }
    return rest
  }

  return { push, end, panel: () => panel.trim() }
}

/** "Title\n- point\n```js\ncode\n```" → a panel. */
export function parsePanel(raw: string): InfoPanel | null {
  if (!raw.trim()) return null
  let code: string | undefined
  const fence = /```[^\n]*\n([\s\S]*?)```/.exec(raw)
  let rest = raw
  if (fence) {
    code = fence[1].replace(/\s+$/, '')
    rest = raw.replace(fence[0], '\n')
  }
  const lines = rest
    .split('\n')
    .map((l) => l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1'))
    .filter(Boolean)
  const title = (lines.shift() ?? 'Details').replace(/^#+\s*/, '')
  return { title, lines, code }
}

/** The subject of a "who is / what is / tell me about / show me" question. */
export function pictureSubject(said: string): string | null {
  const m =
    /\b(?:show me (?:a |an )?(?:picture|photo|image|pic) of|(?:picture|photo|image) of|who (?:is|was|are|were)|what (?:is|was|are|were)(?: an?| the)?|tell me about|show me)\s+(.+)$/i.exec(
      said.trim().replace(/[.!?]+$/, ''),
    )
  if (!m) return null
  const subject = m[1].replace(/^(?:a|an|the)\s+/i, '').trim()
  // "what is the time", "who are you" and the like are not encyclopedia topics.
  // Sums ("what is 6 times 7") are problems to solve, not topics to look up.
  if (!subject || subject.split(/\s+/).length > 6 || /\d/.test(subject)) return null
  if (/^(?:you|your|me|my|it|this|that|the time|time|today|the weather|weather|up|happening)\b/i.test(subject)) {
    return null
  }
  return subject
}

/** A Wikipedia picture and two-sentence summary, or null. Never throws. */
export async function wikiCard(subject: string): Promise<InfoPanel | null> {
  try {
    const search = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=${encodeURIComponent(subject)}`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!search.ok) return null
    const hit = ((await search.json()) as { query?: { search?: { title: string }[] } }).query
      ?.search?.[0]?.title
    if (!hit) return null
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.replace(/ /g, '_'))}`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!res.ok) return null
    const page = (await res.json()) as {
      title?: string
      extract?: string
      type?: string
      thumbnail?: { source?: string }
      content_urls?: { mobile?: { page?: string } }
    }
    if (page.type === 'disambiguation' || !page.extract) return null
    const sentences = page.extract.match(/[^.!?]+[.!?]+/g) ?? [page.extract]
    return {
      title: page.title ?? hit,
      lines: [sentences.slice(0, 2).join(' ').trim()],
      image: page.thumbnail?.source,
      source: page.content_urls?.mobile?.page,
    }
  } catch {
    return null
  }
}
