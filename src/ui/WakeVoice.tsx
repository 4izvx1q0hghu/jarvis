import { useEffect, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { IOS, unlockSpeech } from '../lib/tts'

/**
 * iOS only. When the phone locks or the user switches apps, Safari suspends the
 * page, and when it comes back its speech is locked again until a tap — the
 * wake word still works and answers still arrive as text, but in silence. So on
 * return, ask for one tap anywhere, and use that tap to clear the engine and
 * unlock speech exactly the way the diagnostics test button does.
 */
export function WakeVoice() {
  const [needed, setNeeded] = useState(false)
  const phase = useStore((s) => s.phase)

  useEffect(() => {
    if (!IOS) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNeeded(true)
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setNeeded(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onShow)
    }
  }, [])

  useEffect(() => {
    if (!needed) return
    const onTap = () => {
      try {
        speechSynthesis.cancel()
      } catch {
        /* no engine */
      }
      unlockSpeech()
      setNeeded(false)
    }
    window.addEventListener('pointerdown', onTap, { capture: true })
    return () => window.removeEventListener('pointerdown', onTap, { capture: true })
  }, [needed])

  // Before INITIALISE there is nothing to wake; that tap unlocks speech itself.
  if (!needed || phase === 'offline' || phase === 'boot') return null

  return (
    <div style={styles.wrap} role="status">
      <div style={styles.banner}>Tap anywhere to wake Danya’s voice</div>
    </div>
  )
}

const cyan = '#5fe3ff'

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    padding: '0 16px',
    zIndex: 70,
    pointerEvents: 'none',
  },
  banner: {
    padding: '10px 16px',
    borderRadius: 999,
    border: `1px solid ${cyan}`,
    background: 'rgba(4, 16, 26, 0.92)',
    color: cyan,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 15,
    fontWeight: 600,
  },
}
