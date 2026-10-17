import type { CSSProperties } from 'react'
import { closeInfo, useInfoPanel } from '../lib/infoPanel'

/**
 * Details, pictures and code shown while Danya speaks the short version.
 * Plain React text throughout — nothing here is parsed as HTML, so a model's
 * panel cannot inject markup.
 */
export function InfoPanel() {
  const panel = useInfoPanel((s) => s.panel)
  if (!panel) return null

  return (
    <div style={styles.wrap} role="region" aria-label={panel.title}>
      <div style={styles.card}>
        <div style={styles.head}>
          <span style={styles.title}>{panel.title}</span>
          <button type="button" style={styles.close} onClick={closeInfo} aria-label="Close">
            ✕
          </button>
        </div>
        {panel.image && <img src={panel.image} alt={panel.title} style={styles.image} />}
        {panel.lines.length > 0 && (
          <ul style={styles.list}>
            {panel.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        {panel.code && <pre style={styles.code}>{panel.code}</pre>}
        {panel.source && (
          <a href={panel.source} target="_blank" rel="noreferrer" style={styles.source}>
            Source: Wikipedia
          </a>
        )}
      </div>
    </div>
  )
}

const cyan = '#5fe3ff'

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
    right: 12,
    left: 12,
    display: 'flex',
    justifyContent: 'flex-end',
    zIndex: 55,
    pointerEvents: 'none',
  },
  card: {
    pointerEvents: 'auto',
    width: '100%',
    maxWidth: 400,
    maxHeight: '48vh',
    overflowY: 'auto',
    display: 'grid',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${cyan}66`,
    background: 'rgba(4, 16, 26, 0.92)',
    color: '#d8f6ff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 15,
    lineHeight: 1.5,
  },
  head: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: 600, color: cyan },
  close: {
    border: 'none',
    background: 'transparent',
    color: '#d8f6ff',
    fontSize: 18,
    lineHeight: 1,
    padding: 4,
  },
  image: { width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8 },
  list: { margin: 0, paddingLeft: 18, display: 'grid', gap: 4 },
  code: {
    margin: 0,
    padding: 10,
    borderRadius: 8,
    background: '#01080d',
    border: `1px solid ${cyan}33`,
    color: '#e6faff',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.45,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  source: { color: cyan, fontSize: 13 },
}
