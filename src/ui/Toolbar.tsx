import { useEffect, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { setMuted, useMuted } from '../lib/mute'
import { pickPhoto, useLook } from '../lib/photo'
import { enableWeather, refreshWeather, useWeather, weatherIcon } from '../lib/weather'
import { forgetEverything, forgetFact, forgetName, memorySnapshot } from '../lib/memory'
import { unlockSpeech } from '../lib/tts'

/**
 * Danya's controls, under the wordmark: time and weather, the microphone mute
 * switch, the camera (photo or screenshot for her to look at), and the memory
 * manager. Only shown once she is powered up.
 */
export function Toolbar() {
  const phase = useStore((s) => s.phase)
  const muted = useMuted((s) => s.muted)
  const pending = useLook((s) => s.pending)
  const { weather, asking } = useWeather()
  const [now, setNow] = useState(() => new Date())
  const [memoryOpen, setMemoryOpen] = useState(false)

  useEffect(() => {
    refreshWeather()
    const clock = setInterval(() => setNow(new Date()), 30_000)
    const weatherTimer = setInterval(refreshWeather, 30 * 60_000)
    return () => {
      clearInterval(clock)
      clearInterval(weatherTimer)
    }
  }, [])

  if (phase === 'offline' || phase === 'boot') return null

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <>
      <div style={styles.bar}>
        <button
          type="button"
          style={styles.chip}
          onClick={() => (weather ? refreshWeather() : enableWeather())}
          title={weather ? weather.place : 'Tap to show the weather for where you are'}
        >
          {weather ? `${weatherIcon(weather.code)} ${weather.temp}°` : asking ? '…' : '🌤 Weather'}
          <span style={styles.time}>{time}</span>
        </button>
        <button
          type="button"
          style={{ ...styles.round, ...(muted ? styles.alert : {}) }}
          onClick={() => setMuted(!muted)}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          title={muted ? 'Microphone off — tap to turn on' : 'Microphone on — tap to mute'}
        >
          {muted ? '🔇' : '🎙️'}
        </button>
        <button
          type="button"
          style={{ ...styles.round, ...(pending ? styles.pulse : {}) }}
          onClick={() => {
            // This tap also unlocks speech for the answer that follows (iOS).
            unlockSpeech()
            pickPhoto()
          }}
          aria-label="Show Danya a photo or screenshot"
          title="Show Danya a photo or screenshot"
        >
          📷
        </button>
        <button
          type="button"
          style={styles.round}
          onClick={() => setMemoryOpen(true)}
          aria-label="What Danya remembers"
          title="What Danya remembers"
        >
          🧠
        </button>
      </div>
      {muted && <div style={styles.mutedNote}>Microphone muted</div>}
      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
    </>
  )
}

function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(memorySnapshot)
  const refresh = () => setSnapshot(memorySnapshot())
  const empty = !snapshot.name && snapshot.facts.length === 0

  return (
    <div className="dp-wrap" style={{ justifyContent: 'center' }}>
      <div className="dp-card" role="dialog" aria-label="What Danya remembers">
        <div className="dp-head">
          <span className="dp-dot" aria-hidden="true" />
          <span className="dp-title">What I remember about you</span>
          <button type="button" className="dp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {empty && (
          <p style={styles.hint}>
            Nothing yet. Say “my name is …” or “remember that …” and it will show up here.
          </p>
        )}
        {snapshot.name && (
          <div style={styles.memRow}>
            <span style={{ flex: 1 }}>Your name is {snapshot.name}</span>
            <button type="button" style={styles.del} onClick={() => (forgetName(), refresh())}>
              Delete
            </button>
          </div>
        )}
        {snapshot.facts.map((fact, i) => (
          <div key={`${i}-${fact}`} style={styles.memRow}>
            <span style={{ flex: 1 }}>{fact.replace(/^They\b/, 'You').replace(/^Their\b/, 'Your')}</span>
            <button type="button" style={styles.del} onClick={() => (forgetFact(i), refresh())}>
              Delete
            </button>
          </div>
        ))}
        {!empty && (
          <button
            type="button"
            style={{ ...styles.del, justifySelf: 'start' }}
            onClick={() => {
              if (confirm('Forget everything Danya remembers about you?')) {
                forgetEverything()
                refresh()
              }
            }}
          >
            Forget everything
          </button>
        )}
        <p style={styles.hint}>Stored only on this phone. Say “remember that …” to add more.</p>
      </div>
    </div>
  )
}

const cyan = '#5fe3ff'
const glass: CSSProperties = {
  border: `1px solid ${cyan}55`,
  background: 'rgba(4, 16, 26, 0.78)',
  WebkitBackdropFilter: 'blur(10px)',
  backdropFilter: 'blur(10px)',
  color: '#d8f6ff',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}

const styles: Record<string, CSSProperties> = {
  bar: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 118px)',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    gap: 10,
    zIndex: 50,
    pointerEvents: 'none',
  },
  chip: {
    ...glass,
    pointerEvents: 'auto',
    height: 42,
    padding: '0 14px',
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
  },
  time: { opacity: 0.7, fontSize: 13 },
  round: {
    ...glass,
    pointerEvents: 'auto',
    width: 42,
    height: 42,
    borderRadius: '50%',
    fontSize: 18,
    lineHeight: 1,
  },
  alert: { borderColor: '#ff6b6b', boxShadow: '0 0 12px rgba(255,107,107,0.5)' },
  pulse: { borderColor: cyan, boxShadow: `0 0 18px ${cyan}`, transform: 'scale(1.08)' },
  mutedNote: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 168px)',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#ff8a8a',
    fontSize: 13,
    letterSpacing: '0.12em',
    zIndex: 50,
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  memRow: { display: 'flex', gap: 10, alignItems: 'center', fontSize: 15 },
  del: {
    border: '1px solid rgba(255,107,107,0.5)',
    background: 'transparent',
    color: '#ff9a9a',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 13,
  },
  hint: { margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.5 },
}
