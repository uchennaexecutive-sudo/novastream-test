/**
 * OfflineBadge
 *
 * Reusable offline-ready indicator for downloaded content.
 *
 * variant="pill"    → labeled pill with OFFLINE text (default, for rows/headers)
 * variant="corner"  → small icon-only circle for thumbnail corners
 * variant="dot"     → tiny presence dot for tight episode cards
 */
import { WifiOff } from 'lucide-react'

export default function OfflineBadge({
  variant = 'pill',
  hasSubtitles = false,
  style: styleProp = {},
}) {
  if (variant === 'corner') {
    return (
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.72)', ...styleProp }}
        title={hasSubtitles ? 'Downloaded · Subtitles included' : 'Downloaded for offline viewing'}
      >
        <WifiOff size={9} style={{ color: '#4ade80' }} />
      </div>
    )
  }

  if (variant === 'dot') {
    return (
      <div
        className="flex items-center gap-1 flex-shrink-0"
        title={hasSubtitles ? 'Downloaded · Subtitles included' : 'Downloaded'}
      >
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: '#4ade80', boxShadow: '0 0 4px rgba(74,222,128,0.6)', ...styleProp }}
        />
        <span style={{ fontSize: 9, fontWeight: 700, color: '#4ade80', letterSpacing: '0.04em' }}>
          OFFLINE{hasSubtitles ? ' · SUB' : ''}
        </span>
      </div>
    )
  }

  // pill (default)
  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-full flex-shrink-0"
      style={{
        background: 'rgba(74,222,128,0.10)',
        border: '1px solid rgba(74,222,128,0.26)',
        color: '#4ade80',
        ...styleProp,
      }}
      title={hasSubtitles ? 'Downloaded · Subtitles included' : 'Downloaded for offline viewing'}
    >
      <WifiOff size={9} strokeWidth={2} />
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>
        OFFLINE
      </span>
      {hasSubtitles && (
        <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.75 }}>· SUB</span>
      )}
    </div>
  )
}
