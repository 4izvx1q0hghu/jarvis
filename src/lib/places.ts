/**
 * "Cafes near me", "nearest petrol station", "where can I buy a phone charger",
 * "any good nasi kandar around here" — real places nearby, for any kind of
 * place, not a fixed list.
 *
 * Two halves. A Maps button (Google Maps and Apple Maps both search around the
 * phone's own location, with photos, reviews, opening hours and directions),
 * and a note for the model with where the user is, so it searches the web for
 * real places there instead of guessing — and the app does not go looking for
 * an encyclopedia picture of the words "cafes near me".
 */

const NEAR =
  /\b(?:near me|nearby|near here|near (?:my|our) (?:place|house|home|office|location)|around (?:me|here|this area)|close (?:to me|by)|closest|nearest|in (?:my|this) area|walking distance|within \d+ ?(?:km|kilometres?|kilometers?|min(?:ute)?s?))\b/gi
const WHERE =
  /^(?:where (?:can|could|do|should) (?:i|we) (?:find|get|buy|eat|go for|go to|grab|have|park|pray|fix|repair)|where(?:'s| is| are) (?:the |a |an )?(?:nearest|closest))\b/i
const FILLER =
  /\b(?:hey|ok(?:ay)?|danya|can you|could you|please|show me|show|find(?: me)?|search(?: for)?|look(?:ing)? for|where (?:is|are)|what(?:'s| is| are)|which|are there|is there|any|some|a few|good|best|nice|great|cheap(?:est)?|top|the|a|an|pictures? of|photos? of|images? of|list(?: of)?|recommend(?: me)?|i want|i need|i'm looking for|me|open now|right now|now)\b/gi

export type Nearby = { what: string; label: string; maps: string; apple: string }

export function nearbyRequest(said: string): Nearby | null {
  const text = said.trim().replace(/[.!?]+$/, '')
  NEAR.lastIndex = 0
  if (!NEAR.test(text) && !WHERE.test(text)) return null
  const what =
    text
      .replace(NEAR, ' ')
      .replace(WHERE, ' ')
      .replace(FILLER, ' ')
      .replace(/[,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'places'
  return {
    what,
    label: what.replace(/^\w/, (c) => c.toUpperCase()),
    maps: `https://www.google.com/maps/search/${encodeURIComponent(`${what} near me`)}`,
    apple: `https://maps.apple.com/?q=${encodeURIComponent(what)}`,
  }
}

/** What the model is told, with the place the phone last reported. */
export function nearbyNote(n: Nearby, place: string | undefined): string {
  return `[The user wants real ${n.what} near them${place ? `; they are around ${place}` : ''}. Search the web for real ones${place ? ' there' : ''} and name three to five: what each is, the area, and why it's worth going (rating, price or speciality if you find them). Don't make up places. A button that opens them in Maps, with photos and directions, is already on the screen.]`
}
