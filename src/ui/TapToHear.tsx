import { useEffect, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { SPEECH_BLOCKED_EVENT, unlockSpeech } from '../lib/tts'

/**
 * The guaranteed way to hear an answer on iPhone.
 *
 * When iOS refuses to speak (tts.ts gives up on a sentence and fires
 * SPEECH_BLOCKED_EVENT), the unspoken sentences collect here behind one big
 * button. Tapping it speaks them from inside the tap — the same path as the
 * diagnostics "Test voice" button, which iOS always allows — and the same tap
 * unlocks speech again, so the next answers usually play by themselves.
 */
export function TapToHear() {
  const [pending, setPending] = useState<string[]>([])
  const phase = useStore((s) => s.phase)

  useEffect(() => {
    const onBlocked = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail ?? '').trim()
      if (text) setPending((p) => [...p, text])
    }
    window.addEventListener(SPEECH_BLOCKED_EVENT, onBlocked)
    return () => window.removeEventListener(SPEECH_BLOCKED_EVENT, onBlocked)
  }, [])

  // A new question makes the old answer's button stale.
  useEffect(() => {
    if (phase === 'thinking') setPending([])
  }, [phase])

  if (!pending.length) return null

  const play = () => {
    const text = pending.join(' ')
    setPending([])
    try {
      speechSynthesis.cancel()
    } catch {
      /* no engine */
    }
    unlockSpeech()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    speechSynthesis.speak(u)
  }

  return (
    <div style={styles.wrap}>
      <button type="button" style={styles.button} onClick={play}>
        🔊 Tap to hear Danya
      </button>
    </div>
  )
}

const cyan = '#5fe3ff'

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 150px)',
    display: 'flex',
    justifyContent: 'center',
    padding: '0 16px',
    zIndex: 65,
    pointerEvents: 'none',
  },
  button: {
    pointerEvents: 'auto',
    padding: '16px 28px',
    borderRadius: 999,
    border: 'none',
    background: cyan,
    color: '#02060a',
    fontSize: 18,
    fontWeight: 700,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
}
