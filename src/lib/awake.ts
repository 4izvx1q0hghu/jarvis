/**
 * Keeps the screen on while Danya is open.
 *
 * When an iPhone auto-locks, Safari suspends the page: the microphone stops,
 * the wake word stops, and her voice needs a tap to come back. Holding a screen
 * wake lock stops the auto-lock for as long as she is on screen, so she can sit
 * on a charger and stay listening. Safari lets go of the lock whenever the page
 * is hidden, so it is asked for again each time she comes back, and on any tap,
 * since iOS may only grant it from one. Pressing the side button still locks the
 * phone as usual. Phones without the API simply follow their Auto-Lock setting.
 */

let lock: WakeLockSentinel | null = null
let wanted = false

async function hold(): Promise<void> {
  if (!wanted || document.visibilityState !== 'visible') return
  if (lock && !lock.released) return
  try {
    lock = await navigator.wakeLock.request('screen')
  } catch {
    // Refused (low battery, Low Power Mode, or no tap yet): try again later.
    lock = null
  }
}

/** Start keeping the screen on. Call it from a tap. */
export function keepAwake(): void {
  if (wanted || !('wakeLock' in navigator)) return
  wanted = true
  void hold()
  document.addEventListener('visibilitychange', () => void hold())
  window.addEventListener('pointerdown', () => void hold(), { capture: true, passive: true })
}

/** Whether the screen is being kept on right now. */
export const screenKeptOn = (): boolean => Boolean(lock && !lock.released)
