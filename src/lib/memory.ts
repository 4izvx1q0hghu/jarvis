/**
 * What Danya remembers about you between visits: your name, and things you ask
 * her to remember. Kept in this browser's localStorage only, like the keys and
 * contacts, and handed to the model with every question so she can use it.
 *
 * "My name is Ahamed" / "call me Ahamed", "remember that I love cricket",
 * "what do you remember about me", "forget everything" are handled here on the
 * device, instantly; everything else she learns only lasts the conversation.
 */

type Memory = { name?: string; facts: string[] }

const KEY = 'danya.memory'
const MAX_FACTS = 30

function load(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Memory>
    return { name: m.name, facts: Array.isArray(m.facts) ? m.facts : [] }
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

/** Appended to the persona so the model knows who it is talking to. */
export function memoryBlock(): string {
  const m = load()
  if (!m.name && !m.facts.length) return ''
  const lines = ['', 'What you remember about the person you are talking to:']
  if (m.name) lines.push(`- Their name is ${m.name}. Use it now and then, like a friend would — not every reply.`)
  for (const f of m.facts) lines.push(`- ${f}`)
  return lines.join('\n')
}

const OPENER = /^(?:(?:hey|hi|ok(?:ay)?|so|danya|dania|dhanya|please)[\s,]+)*/i
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

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
    const mem = load()
    mem.facts = [...mem.facts.filter((f) => f !== fact), fact].slice(-MAX_FACTS)
    save(mem)
    return 'Okay, I’ll remember that.'
  }

  if (/^(?:what do you (?:remember|know) about me|what have you remembered|what do you remember)$/i.test(text)) {
    const mem = load()
    if (!mem.name && !mem.facts.length) return "Honestly, nothing yet! Tell me your name, or say 'remember that' and something about you."
    const bits = [
      mem.name ? `your name is ${mem.name}` : '',
      ...mem.facts.map((f) => f.replace(/^They\b/, 'you').replace(/^Their\b/, 'your')),
    ].filter(Boolean)
    return `I remember that ${bits.join(', and ')}.`
  }

  if (/^forget (?:everything|all of it|what you know about me|everything about me|my name)$/i.test(text)) {
    save({ facts: [] })
    return 'Done — I’ve forgotten all of it. Fresh start!'
  }

  return null
}
