import { create } from 'zustand'

/**
 * What Danya remembers about you between visits. Kept in this browser's
 * localStorage only, like the keys and contacts, and handed to the model with
 * every question so she can use it.
 *
 * She learns by herself: after an answer she may add a hidden [[MEMORY]] block
 * with anything worth keeping that you told her — your store, the people you
 * mention, what you like — and `learnFrom` files it here, sorted by kind. She
 * can also correct or drop an old note by its number. Secrets (passwords,
 * codes, card or ID numbers, keys) are never kept, whatever she writes.
 *
 * "My name is Ahamed", "remember that …", "what do you remember about me" and
 * "forget everything" are still handled here on the device, instantly.
 */

export type Kind = 'store' | 'person' | 'like' | 'other'
export type Fact = { text: string; kind: Kind; at: number }
type Memory = { name?: string; facts: Fact[] }

const KEY = 'danya.memory'
const MAX_FACTS = 80

export const KIND_LABEL: Record<Kind, string> = {
  store: 'Your store and work',
  person: 'People you mentioned',
  like: 'What you like',
  other: 'Other things',
}

function load(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { name?: string; facts?: unknown[] }
    const facts = (Array.isArray(m.facts) ? m.facts : [])
      .map((f): Fact | null =>
        // Older versions kept plain strings.
        typeof f === 'string'
          ? { text: f, kind: guessKind(f), at: 0 }
          : f && typeof (f as Fact).text === 'string'
            ? { text: (f as Fact).text, kind: (f as Fact).kind ?? 'other', at: (f as Fact).at ?? 0 }
            : null,
      )
      .filter((f): f is Fact => f !== null)
    return { name: m.name, facts }
  } catch {
    return { facts: [] }
  }
}

function save(m: Memory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage blocked — memory just will not persist */
  }
}

export const userName = (): string | undefined => load().name

/** For the memory manager: everything stored, to show and delete. */
export const memorySnapshot = (): Memory => load()

export function forgetFact(index: number): void {
  const m = load()
  m.facts = m.facts.filter((_, i) => i !== index)
  save(m)
}

export function forgetName(): void {
  const m = load()
  delete m.name
  save(m)
}

export const forgetEverything = (): void => save({ facts: [] })

/** What she just learned, for the little "Learned" note on screen. */
export const useLearned = create<{ notes: string[] }>(() => ({ notes: [] }))

/** A best guess at the kind of a note written without one. */
function guessKind(text: string): Kind {
  if (/\b(store|shop|shopify|business|customers?|orders?|products?|sells?|brand|website|napnest|supplier|work|job)\b/i.test(text)) return 'store'
  if (/\b(like|love|prefer|enjoy|hate|dislike|favou?rite|into)\b/i.test(text)) return 'like'
  if (/\b(brother|sister|mother|mum|mom|father|dad|wife|husband|friend|cousin|uncle|aunt|son|daughter|boss|partner|girlfriend|boyfriend)\b/i.test(text) || /^[A-Z][a-z]+ (is|was)\b/.test(text)) return 'person'
  return 'other'
}

/** Never kept, whatever the model writes: secrets, codes, card and ID numbers. */
function secret(text: string): boolean {
  return (
    /\b(password|passcode|pin|otp|tac|cvv|verification code|one[- ]time code|seed phrase|recovery phrase|api key|private key|card number|bank account|ic number|nric|passport number)\b/i.test(text) ||
    // Nine or more digits in a row (card, phone, ID numbers), not dates.
    /(?:\d[ -]?){9,}/.test(text) ||
    /\b(AIza[\w-]{10,}|AQ\.[\w-]{10,}|sk-[\w-]{10,})/.test(text)
  )
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Adds a note unless it is already known; a fuller version replaces a shorter one. */
function remember(m: Memory, text: string, kind: Kind): boolean {
  const n = norm(text)
  if (!n || secret(text)) return false
  const same = m.facts.findIndex((f) => {
    const o = norm(f.text)
    return o === n || o.includes(n) || n.includes(o)
  })
  if (same >= 0) {
    if (n.length <= norm(m.facts[same].text).length) return false
    m.facts.splice(same, 1)
  }
  m.facts.push({ text, kind, at: Date.now() })
  if (m.facts.length > MAX_FACTS) m.facts = m.facts.slice(-MAX_FACTS)
  return true
}

const KINDS: Record<string, Kind | 'name'> = {
  store: 'store', business: 'store', work: 'store', shop: 'store',
  person: 'person', people: 'person', contact: 'person',
  like: 'like', likes: 'like', preference: 'like', prefers: 'like', dislike: 'like',
  other: 'other', fact: 'other', goal: 'other', life: 'other',
  name: 'name',
}

/**
 * Files what the model put in its [[MEMORY]] block, one note per line:
 *   store: Sells pillows and eye masks on Shopify, mostly to the US
 *   person: Sara is a customer waiting for a late order
 *   replace 3: like: Prefers short answers in English and Tamil
 *   forget 5
 * Returns the notes that were new, to show.
 */
export function learnFrom(raw: string): string[] {
  if (!raw.trim()) return []
  const before = load()
  const drop = new Set<number>()
  const adds: { text: string; kind: Kind }[] = []
  let name: string | undefined

  // Numbers refer to the list as it was sent, so read every line first.
  for (const line of raw.split('\n').map((l) => l.trim().replace(/^[-*•]\s+/, '')).filter(Boolean).slice(0, 8)) {
    const op = /^(replace|update|forget|remove|delete)\s+#?(\d+)\s*:?\s*(.*)$/i.exec(line)
    let body = line
    if (op) {
      const i = Number(op[2]) - 1
      if (i >= 0 && i < before.facts.length) drop.add(i)
      if (/^(forget|remove|delete)$/i.test(op[1])) continue
      body = op[3]
    }
    const tagged = /^([a-z]+)\s*:\s*(.+)$/i.exec(body)
    const kind = tagged ? KINDS[tagged[1].toLowerCase()] : undefined
    const text = (kind ? tagged![2] : body).trim().replace(/\.$/, '').slice(0, 200)
    if (text.length < 4) continue
    if (kind === 'name') {
      if (/^[a-z][a-z .'-]{0,30}$/i.test(text)) name = titleCase(text)
    } else {
      adds.push({ text, kind: kind ?? guessKind(text) })
    }
  }

  const m: Memory = { name: name ?? before.name, facts: before.facts.filter((_, i) => !drop.has(i)) }
  const learned = adds.filter((a) => remember(m, a.text, a.kind)).map((a) => a.text)
  if (learned.length || drop.size || name) save(m)
  if (learned.length) useLearned.setState({ notes: learned })
  return learned
}

/** Appended to the persona so the model knows who it is talking to. */
export function memoryBlock(): string {
  const m = load()
  if (!m.name && !m.facts.length) return ''
  const lines = ['', 'What you remember about the person you are talking to (numbered, so you can correct a note):']
  if (m.name) lines.push(`- Their name is ${m.name}. Use it now and then, like a friend would — not every reply.`)
  for (const kind of Object.keys(PROMPT_LABEL) as Kind[]) {
    const group = m.facts.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === kind)
    if (!group.length) continue
    lines.push(`${PROMPT_LABEL[kind]}:`)
    for (const { f, i } of group) lines.push(`  ${i + 1}. ${f.text}`)
  }
  return lines.join('\n')
}

const PROMPT_LABEL: Record<Kind, string> = {
  store: 'Their store and work',
  person: 'People in their life',
  like: 'What they like',
  other: 'Other things about them',
}

const OPENER = /^(?:(?:hey|hi|ok(?:ay)?|so|danya|dania|dhanya|please)[\s,]+)*/i

/** A memory command and the reply to speak, or null to let the model answer. */
export function memoryAction(said: string): string | null {
  const text = said.trim().replace(/[.!?]+$/, '').replace(OPENER, '').trim()
  let m: RegExpExecArray | null

  if ((m = /^(?:my name is|my name's|call me|i'm called|i am called|you can call me)\s+([a-z][a-z .'-]{0,30})$/i.exec(text))) {
    const name = titleCase(m[1].trim())
    const mem = load()
    mem.name = name
    save(mem)
    return `Nice to meet you, ${name}! I'll remember that.`
  }

  if ((m = /^(?:please )?remember(?: that)?\s+(.{3,200})$/i.exec(text))) {
    // "remember that I love cricket" is about the user — keep it in their words,
    // turned into something the model reads as a fact about them.
    const fact = m[1].trim().replace(/^i\b/i, 'They').replace(/^my\b/i, 'Their')
    if (secret(fact)) return "I'd rather not keep that one: it looks like a password or a number to keep private. Better in a password manager."
    const mem = load()
    remember(mem, fact, guessKind(fact))
    save(mem)
    return 'Okay, I’ll remember that.'
  }

  if (/^(?:what do you (?:remember|know) about me|what have you remembered|what do you remember)$/i.test(text)) {
    const mem = load()
    if (!mem.name && !mem.facts.length) return "Honestly, nothing yet! Just talk to me — I'll pick things up as we go."
    const latest = mem.facts
      .slice(-3)
      .reverse()
      .map((f) => f.text.replace(/^They\b/, 'You').replace(/^Their\b/, 'Your').replace(/\.$/, ''))
    if (!latest.length) return `You're ${mem.name}, and that's all I know so far.`
    const count = `${mem.facts.length} ${mem.facts.length === 1 ? 'thing' : 'things'} about you`
    return `${mem.name ? `You're ${mem.name}, and I know ${count}` : `I know ${count}`}. The latest: ${latest.join('. ')}. Tap the brain button to see them all.`
  }

  if (/^forget (?:everything|all of it|what you know about me|everything about me|my name)$/i.test(text)) {
    save({ facts: [] })
    return 'Done — I’ve forgotten all of it. Fresh start!'
  }

  return null
}
