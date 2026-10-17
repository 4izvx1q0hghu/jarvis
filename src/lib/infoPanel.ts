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
  /** True when the code was actually run (Gemini code execution). */
  ran?: boolean
  output?: string
  /** A Wikipedia picture. */
  image?: string
  /** Charts or images the model's code produced. */
  images?: string[]
  /** A live market chart (TradingView embed URL). */
  chart?: { url: string; label: string }
  /** Pictures from the web, shown as a gallery. */
  gallery?: GalleryImage[]
  source?: string
}

export type GalleryImage = { thumb: string; full: string; title: string }

/** Adds to the panel on screen, or starts one titled `title`. */
export function mergeInfo(patch: Partial<InfoPanel>, title = 'Details'): void {
  const current = useInfoPanel.getState().panel
  const base: InfoPanel = current ?? { title, lines: [] }
  showInfo({
    ...base,
    ...patch,
    lines: patch.lines ?? base.lines,
    images: patch.images ? [...(base.images ?? []), ...patch.images] : base.images,
  })
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

/** "Title\n- point\nIMAGES: query\n```js\ncode\n```" → a panel, plus the
 *  picture search the model asked for, if any. */
export function parsePanel(raw: string): (InfoPanel & { imageQuery?: string }) | null {
  if (!raw.trim()) return null
  let code: string | undefined
  const fence = /```[^\n]*\n([\s\S]*?)```/.exec(raw)
  let rest = raw
  if (fence) {
    code = fence[1].replace(/\s+$/, '')
    rest = raw.replace(fence[0], '\n')
  }
  let imageQuery: string | undefined
  const lines = rest
    .split('\n')
    .map((l) => l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1'))
    .filter((l) => {
      const m = /^images?:\s*(.+)$/i.exec(l)
      if (m) imageQuery = m[1].trim()
      return Boolean(l) && !m
    })
  const title = (lines.shift() ?? 'Details').replace(/^#+\s*/, '')
  return { title, lines, code, imageQuery }
}

/** "Show me pictures of X", "what does X look like", "images of X". */
export function imageRequest(said: string): string | null {
  const text = said.trim().replace(/[.!?]+$/, '')
  const m =
    /\b(?:show me |find |get |give me )?(?:some |a few )?(?:pictures?|photos?|images?|pics?)\s+of\s+(.+)$/i.exec(text) ??
    /\bwhat (?:does|do|did) (.+?) look like\b/i.exec(text) ??
    /\bshow me (?:what )?(.+?) looks? like\b/i.exec(text)
  return m ? m[1].replace(/^(?:a|an|the)\s+/i, '').trim() || null : null
}

/**
 * Pictures from Wikimedia Commons: free, no key, CORS-enabled, and served from
 * upload.wikimedia.org (already allowed by the page's CSP). Never throws.
 */
export async function wikiImages(query: string, count = 6): Promise<GalleryImage[]> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${query}`,
      gsrnamespace: '6',
      gsrlimit: String(count * 2),
      prop: 'imageinfo',
      iiprop: 'url|mime',
      iiurlwidth: '480',
    })
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const pages = Object.values(
      ((await res.json()) as {
        query?: { pages?: Record<string, { title: string; index?: number; imageinfo?: { thumburl?: string; url?: string; mime?: string }[] }> }
      }).query?.pages ?? {},
    )
    return pages
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => ({ info: p.imageinfo?.[0], title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '') }))
      .filter((p) => p.info?.thumburl && /^image\/(jpeg|png|webp)/.test(p.info.mime ?? ''))
      .slice(0, count)
      .map((p) => ({ thumb: p.info!.thumburl!, full: p.info!.url ?? p.info!.thumburl!, title: p.title }))
  } catch {
    return []
  }
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
