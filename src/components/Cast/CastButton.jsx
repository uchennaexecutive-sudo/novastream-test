import { memo } from 'react'
import useCastStore from '../../store/useCastStore'

// Cast icon SVG — matches the Google Cast / W3C presentation API icon shape.
function CastIcon({ size = 16, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      <path d="M2 15a7 7 0 0 1 7 7" />
      <path d="M2 19a3 3 0 0 1 3 3" />
      <circle cx="2" cy="22" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * CastButton — compact control-bar button that opens the CastDeviceSheet.
 *
 * Visual states:
 *   idle        — cast icon, standard white button
 *   discovering — spinner (scanning for devices)
 *   connecting  — spinner + "Connecting…" label
 *   casting     — accent color + truncated device name
 *   error       — red-tinted, cast icon (clicking opens sheet to show the error)
 *
 * Props:
 *   onClick — opens the CastDeviceSheet
 *   size    — icon size in px (default 16)
 */
function CastButton({ onClick, size = 16 }) {
  const castStatus = useCastStore((s) => s.castStatus)
  const activeCastDevice = useCastStore((s) => s.activeCastDevice)

  const isCasting = castStatus === 'casting'
  const isDiscovering = castStatus === 'discovering'
  const isConnecting = castStatus === 'connecting'
  const isError = castStatus === 'error'
  const isBusy = isDiscovering || isConnecting

  // Derive appearance
  let bg, border, color, title
  if (isCasting) {
    bg = 'rgba(139,92,246,0.22)'
    border = '1px solid rgba(139,92,246,0.55)'
    color = '#c4b5fd'
    title = `Casting to ${activeCastDevice?.name || 'device'}`
  } else if (isError) {
    bg = 'rgba(239,68,68,0.15)'
    border = '1px solid rgba(239,68,68,0.4)'
    color = '#fca5a5'
    title = 'Cast error — click to see details'
  } else {
    bg = 'rgba(255,255,255,0.08)'
    border = '1px solid rgba(255,255,255,0.08)'
    color = '#fff'
    title = 'Cast to device'
  }

  return (
    <button
      onClick={onClick}
      title={title}
      className="h-10 rounded-xl flex items-center gap-2 text-xs font-semibold transition-all duration-200"
      style={{
        padding: (isCasting || isConnecting) ? '0 12px' : '0 10px',
        background: bg,
        border,
        color,
        minWidth: 40,
      }}
    >
      {isBusy ? (
        <span
          className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
          style={{
            borderColor: isConnecting ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.35)',
            borderTopColor: isConnecting ? '#8b5cf6' : 'rgba(255,255,255,0.8)',
            display: 'inline-block',
          }}
        />
      ) : (
        <CastIcon size={size} style={{ color, flexShrink: 0 }} />
      )}

      {/* Label: shown while connecting or actively casting */}
      {isConnecting && (
        <span className="truncate max-w-[80px]">Connecting…</span>
      )}
      {isCasting && (
        <span className="truncate max-w-[96px]">
          {activeCastDevice?.name || 'Casting'}
        </span>
      )}
    </button>
  )
}

export default memo(CastButton)
