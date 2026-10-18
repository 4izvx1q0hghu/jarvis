import { closeInfo, googleImages, useInfoPanel } from '../lib/infoPanel'

/**
 * The screen half of an answer: a live market chart, a picture, key points,
 * code Danya ran and what it printed, charts her code drew. Plain React text
 * throughout — nothing is parsed as HTML, so a model's panel cannot inject
 * markup. Styles live in index.css under `.dp-`.
 */
export function InfoPanel() {
  const panel = useInfoPanel((s) => s.panel)
  if (!panel) return null

  const wide = Boolean(panel.chart || panel.images?.length || panel.gallery?.length)

  return (
    <div className="dp-wrap" role="region" aria-label={panel.title}>
      <div className={`dp-card${wide ? ' dp-wide' : ''}`} key={panel.title}>
        <div className="dp-head">
          <span className="dp-dot" aria-hidden="true" />
          <span className="dp-title">{panel.title}</span>
          <button type="button" className="dp-close" onClick={closeInfo} aria-label="Close">
            ✕
          </button>
        </div>

        {panel.chart && (
          <div className="dp-chart">
            <iframe
              src={panel.chart.url}
              title={`${panel.chart.label} chart`}
              loading="lazy"
              allow="fullscreen"
            />
          </div>
        )}

        {panel.image && (
          <img
            className="dp-image"
            src={panel.image}
            alt={panel.title}
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}

        {panel.gallery && panel.gallery.length > 0 && (
          <div className="dp-gallery">
            {panel.gallery.map((img) => (
              // No lazy loading: iOS Safari can leave lazy images inside a
              // scrolling panel blank. There are only a handful of them.
              <a key={img.thumb} href={img.full} target="_blank" rel="noreferrer" title={img.title}>
                <img src={img.thumb} alt={img.title} onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')} />
              </a>
            ))}
          </div>
        )}

        {panel.lines.length > 0 && (
          <ul className="dp-points">
            {panel.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}

        {panel.code && (
          <div className="dp-block">
            <div className="dp-block-head">
              <span>CODE</span>
              {panel.ran && <span className="dp-ran">▶ RAN</span>}
            </div>
            <pre className="dp-code">{panel.code}</pre>
          </div>
        )}

        {panel.output && (
          <div className="dp-block">
            <div className="dp-block-head">
              <span>OUTPUT</span>
            </div>
            <pre className="dp-output">{panel.output}</pre>
          </div>
        )}

        {panel.images?.map((src, i) => (
          <img key={i} className="dp-image dp-plot" src={src} alt={`${panel.title} chart ${i + 1}`} />
        ))}

        {panel.sources && panel.sources.length > 0 && (
          <div className="dp-sources">
            <span>From the web:</span>
            {panel.sources.map((s) => (
              <a key={s.uri} href={s.uri} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ))}
          </div>
        )}
        {panel.source && (
          <a className="dp-source" href={panel.source} target="_blank" rel="noreferrer">
            Wikipedia page ↗
          </a>
        )}
        {panel.gallery && panel.gallery.length > 0 && (
          <span className="dp-credit">
            Tap a picture to open it ·{' '}
            <a href={googleImages(panel.galleryQuery ?? panel.title)} target="_blank" rel="noreferrer">
              More on Google Images ↗
            </a>
          </span>
        )}
      </div>
    </div>
  )
}
