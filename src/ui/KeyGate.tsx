import { useState, type CSSProperties, type FormEvent } from 'react'
import { saveKeys } from '../config'

/**
 * Asks for the API key on the device, before JARVIS boots.
 *
 * Only shown in direct mode with no key yet — i.e. the public GitHub Pages
 * build on a phone. Takes either a Google Gemini key (free tier, "AIza…") or an
 * Anthropic key ("sk-ant-…"), told apart by their prefix. The key goes into
 * this browser's localStorage and nowhere else; the deploy itself carries none.
 * It is checked against its API once before it is saved, so a typo shows up
 * here rather than as JARVIS failing on the first question.
 */
export default function KeyGate() {
  const [brainKey, setBrainKey] = useState('')
  const [eleven, setEleven] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const key = brainKey.trim()
    if (!key) return
    setBusy(true)
    setError('')
    try {
      if (key.startsWith('AIza')) {
        const model = await checkGemini(key)
        saveKeys({ gemini: key, geminiModel: model, eleven })
      } else if (key.startsWith('sk-ant-')) {
        await checkAnthropic(key)
        saveKeys({ anthropic: key, eleven })
      } else {
        throw new Error(
          'That does not look like a Gemini key (AIza…) or an Anthropic key (sk-ant-…).',
        )
      }
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
      return
    }
    location.reload()
  }

  return (
    <form onSubmit={submit} style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>D.A.N.Y.A.</h1>
        <p style={styles.text}>
          Enter your key once. It is saved on this device only, never in the
          website.
        </p>

        <label style={styles.label}>
          Gemini API key (free) or Anthropic API key
          <input
            style={styles.input}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="AIza... or sk-ant-..."
            value={brainKey}
            onChange={(e) => setBrainKey(e.target.value)}
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

        <button style={styles.button} type="submit" disabled={busy || !brainKey.trim()}>
          {busy ? 'CHECKING…' : 'SAVE AND START'}
        </button>

        <p style={styles.small}>
          Get a free Gemini key at aistudio.google.com. To remove the keys from
          this device later, open this page with ?forget-keys at the end of the
          address.
        </p>
      </div>
    </form>
  )
}

/**
 * Checks a Gemini key and picks the model to talk to: the "latest flash" alias
 * when the key can use it, otherwise the newest plain flash model on offer.
 * Google renames models often enough that hardcoding one would rot.
 */
async function checkGemini(key: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      { headers: { 'x-goog-api-key': key } },
    )
  } catch {
    throw new Error('Could not reach Google. Check your connection and try again.')
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Error('Google rejected that key. Check it and try again.')
  }
  if (!res.ok) {
    throw new Error(`Could not check the key (Google answered ${res.status}). Try again.`)
  }

  const { models = [] } = (await res.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[]
  }
  const names = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
  if (names.includes('gemini-flash-latest')) return 'gemini-flash-latest'
  const version = (n: string) => Number(/gemini-([\d.]+)-flash/.exec(n)?.[1] ?? 0)
  const flash = names
    .filter((n) => /^gemini-[\d.]+-flash$/.test(n))
    .sort((a, b) => version(b) - version(a))
  return flash[0] ?? names.find((n) => n.includes('flash')) ?? 'gemini-flash-latest'
}

async function checkAnthropic(key: string): Promise<void> {
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
  } catch {
    throw new Error('Could not reach Anthropic. Check your connection and try again.')
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Anthropic rejected that key. Check it and try again.')
  }
  if (!res.ok) {
    throw new Error(`Could not check the key (Anthropic answered ${res.status}). Try again.`)
  }
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
