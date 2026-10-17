import { create } from 'zustand'

/**
 * The microphone mute switch. Muted means the speech recogniser is stopped —
 * not listening and ignoring, but off — and it stays muted across visits.
 * voice.ts listens for MUTE_EVENT; the toolbar button flips it.
 */

const KEY = 'danya.muted'
export const MUTE_EVENT = 'danya-mute'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const useMuted = create<{ muted: boolean }>(() => ({ muted: load() }))
export const isMuted = (): boolean => useMuted.getState().muted

export function setMuted(muted: boolean): void {
  useMuted.setState({ muted })
  try {
    localStorage.setItem(KEY, muted ? '1' : '0')
  } catch {
    /* storage blocked: muted for this visit only */
  }
  window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: muted }))
}
