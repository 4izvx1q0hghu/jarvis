import { useEffect, type CSSProperties } from 'react'
import { closeCard, useActionCard } from '../lib/actions'

/**
 * The button a phone action puts on screen ("Call Ali", "Open WhatsApp", …).
 *
 * The button is a real link the user taps: iOS only opens tel:, sms: and app
 * links from a genuine tap, and nothing that dials or sends should happen on a
 * misheard word alone. It clears itself after a while so a stale "Call" button
 * is not left lying around.
 */
export function ActionCard() {
  const card = useActionCard((s) => s.card)

  useEffect(() => {
    if (!card) return
    const t = setTimeout(closeCard, 45_000)
    return () => clearTimeout(t)
  }, [card])

  if (!card) return null

  return (
    <div style={styles.wrap} role="dialog" aria-label={card.title}>
      <div style={styles.card}>
        <div style={styles.title}>{card.title}</div>
        {card.detail && <div style={styles.detail}>{card.detail}</div>}
        {card.items && (
          <ul style={styles.list}>
            {card.items.map((item) => (
              <li key={item} style={styles.item}>
                {item}
              </li>
            ))}
          </ul>
        )}
        <div style={styles.row}>
          {card.href && (
            <a
              href={card.href}
              style={styles.primary}
              target={card.href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              onClick={() => setTimeout(closeCard, 500)}
            >
              {card.button ?? 'Open'}
            </a>
          )}
          <button type="button" style={styles.secondary} onClick={closeCard}>
            {card.href ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

const cyan = '#5fe3ff'

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
    display: 'flex',
    justifyContent: 'center',
    padding: '0 16px',
    zIndex: 60,
    pointerEvents: 'none',
  },
  card: {
    pointerEvents: 'auto',
    width: '100%',
    maxWidth: 420,
    display: 'grid',
    gap: 10,
    padding: 16,
    borderRadius: 14,
    border: `1px solid ${cyan}66`,
    background: 'rgba(4, 16, 26, 0.92)',
    color: '#d8f6ff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  title: { fontSize: 18, fontWeight: 600, color: cyan },
  detail: { fontSize: 15, opacity: 0.85, wordBreak: 'break-word' },
  list: { margin: 0, padding: '0 0 0 18px', display: 'grid', gap: 4, fontSize: 15 },
  item: { wordBreak: 'break-word' },
  row: { display: 'flex', gap: 10, marginTop: 4 },
  primary: {
    flex: 1,
    textAlign: 'center',
    padding: '14px 12px',
    borderRadius: 10,
    background: cyan,
    color: '#02060a',
    fontWeight: 700,
    fontSize: 16,
    textDecoration: 'none',
  },
  secondary: {
    flex: 1,
    padding: '14px 12px',
    borderRadius: 10,
    border: `1px solid ${cyan}66`,
    background: 'transparent',
    color: '#d8f6ff',
    fontSize: 16,
  },
}
