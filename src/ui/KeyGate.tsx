import { useState, type CSSProperties, type FormEvent } from 'react'
import { saveKeys } from '../config'

/**
 * Asks for the API keys on the device, before JARVIS boots.
 *
 * Only shown in direct mode with no key yet — i.e. the public GitHub Pages
 * build on a phone. The keys go into this browser's localStorage and nowhere
 * else; the deploy itself carries none. The Anthropic key is checked against
 * the API once before it is saved, so a typo shows up here rather than as
 * JARVIS failing on the first question.
 */
export default function KeyGate() {
  const [anthropic, setAnthropic] = useState('')
  const [eleven, setEleven] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const key = anthropic.trim()
    if (!key) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      })
      if (res.status === 401 || res.status === 403) {
        setError('Anthropic rejected that key. Check it and try again.')
        return
      }
      if (!res.ok) {
        setError(`Could not check the key (Anthropic answered ${res.status}). Try again.`)
        return
      }
    } catch {
      setError('Could not reach Anthropic. Check your connection and try again.')
      return
    } finally {
      setBusy(false)
    }
    saveKeys(key, eleven)
    location.reload()
  }

  return (
    <form onSubmit={submit} style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>J.A.R.V.I.S.</h1>
        <p style={styles.text}>
          Enter your keys once. They are saved on this device only, never in the
          website.
        </p>

        <label style={styles.label}>
          Anthropic API key
          <input
            style={styles.input}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            value={anthropic}
            onChange={(e) => setAnthropic(e.target.value)}
          />
        </label>

        <label style={styles.label}>
          ElevenLabs API key (optional, for the better voice)
          <input
            style={styles.input}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={eleven}
            onChange={(e) => setEleven(e.target.value)}
          />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <button style={styles.button} type="submit" disabled={busy || !anthropic.trim()}>
          {busy ? 'CHECKING…' : 'SAVE AND START'}
        </button>

        <p style={styles.small}>
          To remove the keys from this device later, open this page with ?forget-keys
          at the end of the address.
        </p>
      </div>
    </form>
  )
}

const cyan = '#5fe3ff'

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    padding: 16,
    background: '#02060a',
    color: '#d8f6ff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    display: 'grid',
    gap: 16,
    padding: 24,
    border: `1px solid ${cyan}55`,
    borderRadius: 12,
    background: '#061420',
  },
  title: { margin: 0, color: cyan, letterSpacing: '0.2em', fontSize: 22 },
  text: { margin: 0, lineHeight: 1.5, fontSize: 15 },
  label: { display: 'grid', gap: 6, fontSize: 14 },
  input: {
    padding: '12px 14px',
    fontSize: 16, // 16px stops iOS Safari zooming into the field
    borderRadius: 8,
    border: `1px solid ${cyan}66`,
    background: '#02060a',
    color: '#ffffff',
  },
  button: {
    padding: '14px',
    fontSize: 16,
    letterSpacing: '0.15em',
    borderRadius: 8,
    border: 'none',
    background: cyan,
    color: '#02060a',
    fontWeight: 700,
  },
  error: { margin: 0, color: '#ff8a8a', fontSize: 14 },
  small: { margin: 0, fontSize: 12, opacity: 0.7, lineHeight: 1.5 },
}
