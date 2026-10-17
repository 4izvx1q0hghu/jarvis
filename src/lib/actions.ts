import { create } from 'zustand'

/**
 * Phone actions: "call Ali", "WhatsApp Ali saying I'm coming", "directions to
 * the airport", "play …", "open Instagram", and a small contact book.
 *
 * Recognised here on the device, before anything is sent to a model: they are
 * instant, cost no API quota, and work the same whichever brain is answering.
 * None of them acts on its own. Each puts a button on screen and the user taps
 * it — iOS only opens tel:, sms: and app links from a real tap, and a voice
 * misheard as "call" should never place a call by itself.
 */

export type ActionCard = {
  title: string
  detail?: string
  /** What the button opens. No href means an information card only. */
  href?: string
  button?: string
  items?: string[]
}

export const useActionCard = create<{ card: ActionCard | null }>(() => ({ card: null }))
export const showCard = (card: ActionCard) => useActionCard.setState({ card })
export const closeCard = () => useActionCard.setState({ card: null })

/** What to say back, and the card to show with it. */
export type PhoneAction = { say: string; card?: ActionCard }

// ---------------------------------------------------------------------------
// Contacts — kept in this browser only, like the API keys.
// ---------------------------------------------------------------------------

type Contact = { name: string; number: string }
const CONTACTS_KEY = 'danya.contacts'

function loadContacts(): Record<string, Contact> {
  try {
    return JSON.parse(localStorage.getItem(CONTACTS_KEY) ?? '{}') as Record<string, Contact>
  } catch {
    return {}
  }
}

function storeContacts(contacts: Record<string, Contact>): void {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts))
  } catch {
    /* storage blocked — the save simply does not persist */
  }
}

const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/^(?:my|the)\s+/, '')
    .replace(/'s$/, '')
    .trim()

const titleCase = (name: string) => name.replace(/\b\w/g, (c) => c.toUpperCase())

/** "+94 77-123 4567" → "+94771234567". Keeps a leading + only. */
const tidyNumber = (raw: string) => `${raw.trim().startsWith('+') ? '+' : ''}${raw.replace(/\D/g, '')}`

const looksLikeNumber = (s: string) => (s.match(/\d/g) ?? []).length >= 6

/** A saved contact, or a number said out loud. */
function resolve(target: string): Contact | null {
  if (looksLikeNumber(target)) return { name: target.trim(), number: tidyNumber(target) }
  const hit = loadContacts()[keyOf(target)]
  return hit ?? null
}

/** wa.me wants the full international number with no + or leading zeros. A
 *  number saved without its country code cannot be used there. */
function waNumber(number: string): string | null {
  if (number.startsWith('+')) return number.slice(1)
  if (number.startsWith('00')) return number.slice(2)
  return null
}

// ---------------------------------------------------------------------------
// Recognising the request
// ---------------------------------------------------------------------------

/** Polite openers recognisers keep: "please", "can you", "hey Danya", … */
const OPENER =
  /^(?:(?:please|ok(?:ay)?|hey|hi|so|now|can you|could you|would you|will you|i want you to|i need you to|danya|dania|dhanya)[\s,]+)*/i

const SEP = String.raw`\s*(?:,|:|saying|that says|to say|and say|and tell (?:him|her|them)|telling (?:him|her|them)|that)\s+`

const APPS: Record<string, { label: string; href: string }> = {
  whatsapp: { label: 'WhatsApp', href: 'https://wa.me/' },
  instagram: { label: 'Instagram', href: 'https://www.instagram.com/' },
  youtube: { label: 'YouTube', href: 'https://www.youtube.com/' },
  maps: { label: 'Maps', href: 'https://maps.apple.com/' },
  'google maps': { label: 'Google Maps', href: 'https://www.google.com/maps' },
  spotify: { label: 'Spotify', href: 'https://open.spotify.com/' },
  facebook: { label: 'Facebook', href: 'https://www.facebook.com/' },
  tiktok: { label: 'TikTok', href: 'https://www.tiktok.com/' },
  'tik tok': { label: 'TikTok', href: 'https://www.tiktok.com/' },
  snapchat: { label: 'Snapchat', href: 'https://www.snapchat.com/' },
  telegram: { label: 'Telegram', href: 'https://t.me/' },
  gmail: { label: 'Gmail', href: 'googlegmail://' },
  messages: { label: 'Messages', href: 'sms:' },
}

const enc = encodeURIComponent

export function phoneAction(said: string): PhoneAction | null {
  const text = said
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(OPENER, '')
    .replace(/^what'?s ?app\b/i, 'whatsapp')
    .trim()
  let m: RegExpExecArray | null

  // -- contacts -------------------------------------------------------------
  if ((m = /^(?:save|add|store)(?: (?:a )?(?:new )?contact)?\s+(.+?)\s+(?:as|with number|with the number|number|is|on|at)\s+(\+?\d[\d\s().-]{5,})$/i.exec(text))
    || (m = /^(?:save|add|store)(?: the)?(?: number)?\s+(\+?\d[\d\s().-]{5,})\s+(?:as|for)\s+(.+)$/i.exec(text))) {
    const [name, raw] = looksLikeNumber(m[1]) ? [m[2], m[1]] : [m[1], m[2]]
    const number = tidyNumber(raw)
    const contacts = loadContacts()
    contacts[keyOf(name)] = { name: titleCase(keyOf(name)), number }
    storeContacts(contacts)
    const hint = waNumber(number)
      ? ''
      : ' For WhatsApp, save it with your country code too, like plus nine four.'
    return {
      say: `Saved ${titleCase(keyOf(name))}.${hint}`,
      card: { title: `Saved ${titleCase(keyOf(name))}`, detail: number },
    }
  }

  if ((m = /^(?:delete|remove|forget) (?:the )?contact\s+(.+)$/i.exec(text))) {
    const contacts = loadContacts()
    const key = keyOf(m[1])
    if (!contacts[key]) return { say: `I don't have a contact called ${m[1]}.` }
    const { name } = contacts[key]
    delete contacts[key]
    storeContacts(contacts)
    return { say: `Deleted ${name}.` }
  }

  if (/^(?:list|show|read|open|what are)(?: me)?(?: all)?(?: of)?(?: my)? contacts$/i.test(text)) {
    const list = Object.values(loadContacts())
    if (!list.length) {
      return { say: 'You have no contacts saved yet. Say: save Ali as, then the number.' }
    }
    return {
      say: `You have ${list.length} contact${list.length === 1 ? '' : 's'}: ${list.map((c) => c.name).join(', ')}.`,
      card: { title: 'Your contacts', items: list.map((c) => `${c.name} — ${c.number}`) },
    }
  }

  // -- WhatsApp -------------------------------------------------------------
  // WhatsApp has no link for starting a call, so a WhatsApp call opens the chat.
  if ((m = /^whatsapp (?:video )?call\s+(.+)$/i.exec(text))) {
    const who = resolve(m[1])
    const wa = who && waNumber(who.number)
    return {
      say: wa
        ? `Opening your chat with ${who.name}. Tap the call button there.`
        : `Opening WhatsApp. Find ${m[1]} and tap call.`,
      card: {
        title: `WhatsApp ${who?.name ?? titleCase(m[1])}`,
        href: wa ? `https://wa.me/${wa}` : 'https://wa.me/',
        button: 'Open WhatsApp',
      },
    }
  }

  if ((m = new RegExp(String.raw`^(?:send (?:a |an )?)?whatsapp(?: message)?(?: to)?\s+(.+?)(?:${SEP}(.+))?$`, 'i').exec(text))) {
    const [, target, message = ''] = m
    const who = resolve(target)
    const wa = who && waNumber(who.number)
    const query = message ? `?text=${enc(message)}` : ''
    return {
      say: wa
        ? `Tap the button to WhatsApp ${who.name}.`
        : `Tap the button, then pick ${titleCase(keyOf(target))} in WhatsApp.`,
      card: {
        title: `WhatsApp ${who?.name ?? titleCase(keyOf(target))}`,
        detail: message || undefined,
        href: wa ? `https://wa.me/${wa}${query}` : `https://wa.me/${query}`,
        button: message ? 'Open message' : 'Open chat',
      },
    }
  }

  // -- text message ---------------------------------------------------------
  if ((m = new RegExp(String.raw`^(?:send (?:a |an )?)?(?:text|sms|message)(?: message)?(?: to)?\s+(.+?)${SEP}(.+)$`, 'i').exec(text))) {
    const [, target, message] = m
    const who = resolve(target)
    return {
      say: who
        ? `Tap the button to text ${who.name}.`
        : `Tap the button, then pick ${titleCase(keyOf(target))} in Messages.`,
      card: {
        title: `Text ${who?.name ?? titleCase(keyOf(target))}`,
        detail: message,
        href: `sms:${who?.number ?? ''}&body=${enc(message)}`,
        button: 'Open message',
      },
    }
  }

  // -- phone call -----------------------------------------------------------
  if (!/^call me\b/i.test(text) && (m = /^(?:call|phone|ring|dial)\s+(.+)$/i.exec(text))) {
    const who = resolve(m[1])
    if (!who) {
      return {
        say: `I don't have a number for ${titleCase(keyOf(m[1]))}. Say: save ${titleCase(keyOf(m[1]))} as, then the number.`,
      }
    }
    return {
      say: `Tap the button to call ${who.name}.`,
      card: { title: `Call ${who.name}`, detail: who.number, href: `tel:${who.number}`, button: 'Call' },
    }
  }

  // -- directions -----------------------------------------------------------
  if ((m = /^(?:navigate|directions|get directions|give me directions|take me|drive me|guide me|how do i get|show me the way)\s+(?:to\s+)?(.+)$/i.exec(text))) {
    const place = m[1]
    return {
      say: `Tap the button for directions to ${place}.`,
      card: {
        title: `Directions to ${place}`,
        href: `https://maps.apple.com/?daddr=${enc(place)}`,
        button: 'Open Maps',
      },
    }
  }

  // -- open an app ----------------------------------------------------------
  if ((m = /^(?:open|launch|start|go to)(?: up)?(?: the)?\s+(.+?)(?: app)?$/i.exec(text))) {
    const app = APPS[m[1].toLowerCase()]
    if (app) {
      return {
        say: `Tap the button to open ${app.label}.`,
        card: { title: app.label, href: app.href, button: `Open ${app.label}` },
      }
    }
  }

  // -- YouTube --------------------------------------------------------------
  if ((m = /^(?:play|put on)\s+(.+?)(?:\s+on youtube)?$/i.exec(text))
    || (m = /^(?:search )?youtube(?: for)?\s+(.+)$/i.exec(text))
    || (m = /^search (?:for )?(.+?) on youtube$/i.exec(text))) {
    const what = m[1]
    return {
      say: `Tap the button to play ${what} on YouTube.`,
      card: {
        title: `YouTube: ${what}`,
        href: `https://www.youtube.com/results?search_query=${enc(what)}`,
        button: 'Open YouTube',
      },
    }
  }

  return null
}
