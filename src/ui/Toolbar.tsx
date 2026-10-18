import { useEffect, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { setMuted, useMuted } from '../lib/mute'
import { pickPhoto, useLook } from '../lib/photo'
import { enableWeather, refreshWeather, useWeather, weatherIcon } from '../lib/weather'
import { forgetEverything, forgetFact, forgetName, KIND_LABEL, memorySnapshot, useLearned, type Kind } from '../lib/memory'
import { unlockSpeech } from '../lib/tts'
import { checkForScam, closeScan, openScan, useScan } from '../lib/scam'
import { pickAudio } from '../lib/voicenote'

/**
 * Danya's controls, under the wordmark: time and weather, the microphone mute
 * switch, the camera (photo or screenshot for her to look at), the scam
 * checker, and the memory manager. Only shown once she is powered up.
 */
export function Toolbar() {
  const phase = useStore((s) => s.phase)
  const muted = useMuted((s) => s.muted)
  const pending = useLook((s) => s.pending)
  const { weather, asking } = useWeather()
  const [now, setNow] = useState(() => new Date())
  const [memoryOpen, setMemoryOpen] = useState(false)
  const scanOpen = useScan((s) => s.open)

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
          {weather ? `${weatherIcon(weather.code)} ${weather.temp}°` : asking ? '…' : '🌤'}
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
          onClick={() => {
            // This tap also unlocks speech for the answer that follows (iOS).
            unlockSpeech()
            pickAudio()
          }}
          aria-label="Give Danya a voice note or recording to analyse"
          title="Give Danya a voice note or recording to analyse"
        >
          🎧
        </button>
        <button
          type="button"
          style={styles.round}
          onClick={openScan}
          aria-label="Check a message or link for scams"
          title="Check a message or link for scams"
        >
          🛡️
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
      {!muted && <LearnedNote onOpen={() => setMemoryOpen(true)} />}
      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
      {scanOpen && <ScanPanel />}
    </>
  )
}

/** Paste a message, email or link; Danya says whether it is a scam. */
function ScanPanel() {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip.trim()) setText(clip)
      else setNote('Nothing copied yet. Copy the message first, then tap Paste.')
    } catch {
      setNote('Press and hold in the box, then tap Paste.')
    }
  }
  const check = () => {
    if (!text.trim()) return
    // This tap also unlocks speech for the verdict that follows (iOS).
    unlockSpeech()
    closeScan()
    checkForScam(text)
  }

  return (
    <div className="dp-wrap" style={{ justifyContent: 'center' }}>
      <div className="dp-card" role="dialog" aria-label="Scam checker">
        <div className="dp-head">
          <span className="dp-dot" aria-hidden="true" />
          <span className="dp-title">🛡️ Is it a scam?</span>
          <button type="button" className="dp-close" onClick={closeScan} aria-label="Close">
            ✕
          </button>
        </div>
        <textarea
          style={styles.box}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setNote('')
          }}
          placeholder="Paste a message, email or link here…"
          rows={6}
        />
        {note && <p style={styles.hint}>{note}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" style={styles.secondaryBtn} onClick={() => void paste()}>
            📋 Paste
          </button>
          <button type="button" style={{ ...styles.primaryBtn, opacity: text.trim() ? 1 : 0.5 }} onClick={check}>
            Check it
          </button>
        </div>
        <p style={styles.hint}>
          Danya looks for warning signs on your phone, then checks the sender and links on the web. Don’t tap
          links in a message you’re not sure about.
        </p>
      </div>
    </div>
  )
}

/** "🧠 Learned: Sara is a customer…" for a few seconds after she notes something. */
function LearnedNote({ onOpen }: { onOpen: () => void }) {
  const notes = useLearned((s) => s.notes)
  useEffect(() => {
    if (!notes.length) return
    const t = setTimeout(() => useLearned.setState({ notes: [] }), 6000)
    return () => clearTimeout(t)
  }, [notes])
  if (!notes.length) return null
  const first = notes[0].replace(/^They\b/, 'You').replace(/^Their\b/, 'Your')
  return (
    <button type="button" style={styles.learned} onClick={onOpen}>
      🧠 Learned: {first.length > 60 ? `${first.slice(0, 58)}…` : first}
      {notes.length > 1 ? ` (+${notes.length - 1})` : ''}
    </button>
  )
}

const KIND_ICON: Record<Kind, string> = { store: '🏪', person: '👥', like: '❤️', other: '📌' }
const you = (text: string) => text.replace(/^They\b/, 'You').replace(/^Their\b/, 'Your').replace(/^Them\b/, 'You')

function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(memorySnapshot)
  const refresh = () => setSnapshot(memorySnapshot())
  const empty = !snapshot.name && snapshot.facts.length === 0
  const indexed = snapshot.facts.map((fact, i) => ({ fact, i }))

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
            Nothing yet. Just talk to me: I pick up your store, the people you mention and what you like as we go.
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
        {(Object.keys(KIND_LABEL) as Kind[]).map((kind) => {
          const group = indexed.filter(({ fact }) => fact.kind === kind)
          if (!group.length) return null
          return (
            <div key={kind} style={styles.memGroup}>
              <div style={styles.memHead}>
                {KIND_ICON[kind]} {KIND_LABEL[kind]}
              </div>
              {group.map(({ fact, i }) => (
                <div key={`${i}-${fact.text}`} style={styles.memRow}>
                  <span style={{ flex: 1 }}>{you(fact.text)}</span>
                  <button type="button" style={styles.del} onClick={() => (forgetFact(i), refresh())}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )
        })}
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
        <p style={styles.hint}>
          Stored only on this phone. I never keep passwords, codes or card numbers. Delete anything you don’t want me
          to know.
        </p>
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
    gap: 6,
    padding: '0 8px',
    zIndex: 50,
    pointerEvents: 'none',
  },
  chip: {
    ...glass,
    pointerEvents: 'auto',
    height: 38,
    padding: '0 11px',
    flex: 'none',
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
    width: 38,
    height: 38,
    flex: 'none',
    padding: 0,
    borderRadius: '50%',
    fontSize: 16,
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
  memGroup: { display: 'grid', gap: 8 },
  memHead: { fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: cyan, opacity: 0.85 },
  learned: {
    ...glass,
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 166px)',
    left: 16,
    right: 16,
    margin: '0 auto',
    width: 'fit-content',
    maxWidth: 'calc(100% - 32px)',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    zIndex: 50,
    animation: 'dp-in 300ms ease-out',
  },
  del: {
    border: '1px solid rgba(255,107,107,0.5)',
    background: 'transparent',
    color: '#ff9a9a',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 13,
  },
  hint: { margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.5 },
  box: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${cyan}44`,
    background: 'rgba(0, 8, 14, 0.7)',
    color: '#e6faff',
    // 16px or more stops iOS zooming the page when the box is tapped.
    fontSize: 16,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    resize: 'vertical',
  },
  primaryBtn: {
    flex: 1,
    padding: '13px 12px',
    borderRadius: 10,
    border: 'none',
    background: cyan,
    color: '#02060a',
    fontWeight: 700,
    fontSize: 16,
  },
  secondaryBtn: {
    flex: 1,
    padding: '13px 12px',
    borderRadius: 10,
    border: `1px solid ${cyan}66`,
    background: 'transparent',
    color: '#d8f6ff',
    fontSize: 16,
  },
}
