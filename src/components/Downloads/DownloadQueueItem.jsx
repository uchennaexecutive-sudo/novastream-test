import { motion } from 'framer-motion'
import { Pause, Play, X, Clock, AlertCircle } from 'lucide-react'
import DownloadProgressRing from './DownloadProgressRing'

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatSpeed(bps) {
  if (!bps || bps <= 0) return null
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatEta(bytesDownloaded, totalBytes, speedBps) {
  if (!speedBps || speedBps <= 0 || !totalBytes || !bytesDownloaded) return null
  const remaining = totalBytes - bytesDownloaded
  if (remaining <= 0) return null
  const seconds = Math.round(remaining / speedBps)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

const QUALITY_LABELS = { standard: 'SD', high: 'HD', highest: '4K' }
const TYPE_ABBREV = { movie: 'Movie', tv: 'Series', anime: 'Anime', animation: 'Anim.' }

export default function DownloadQueueItem({
  download,
  onPause,
  onResume,
  onCancel,
}) {
  if (!download) return null

  const {
    id,
    title,
    poster,
    contentType,
    season,
    episode,
    episodeTitle,
    status,
    progress = 0,
    bytesDownloaded = 0,
    totalBytes = 0,
    speedBytesPerSec = 0,
    quality,
    resolvedQuality,
    errorMessage,
  } = download

  const isDownloading = status === 'downloading'
  const isPaused = status === 'paused'
  const isFailed = status === 'failed'

  const qualityLabel = resolvedQuality || QUALITY_LABELS[quality] || quality?.toUpperCase() || 'HD'
  const typeLabel = TYPE_ABBREV[contentType] || contentType || ''

  const subtitleParts = []
  if (contentType === 'tv' || contentType === 'anime') {
    if (season && episode) subtitleParts.push(`S${season}E${episode}`)
    if (episodeTitle) subtitleParts.push(episodeTitle)
  }

  const speed = formatSpeed(speedBytesPerSec)
  const eta = isDownloading ? formatEta(bytesDownloaded, totalBytes, speedBytesPerSec) : null
  const showProgress = isDownloading || isPaused

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: 'var(--bg-surface)',
        border: isFailed
          ? '1px solid rgba(248,113,113,0.22)'
          : '1px solid var(--border)',
      }}
    >
      <div
        className="w-12 h-[34px] rounded-md overflow-hidden flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {poster ? (
          <img src={poster} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] opacity-30">
            {typeLabel}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
          {subtitleParts.length > 0 && (
            <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              {subtitleParts.join(' / ')}
            </span>
          )}
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 font-mono"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {qualityLabel}
          </span>
        </div>

        {isFailed ? (
          <div className="flex items-center gap-1.5">
            <AlertCircle size={11} style={{ color: '#f87171', flexShrink: 0 }} />
            <span className="text-[11px] truncate" style={{ color: '#f87171' }}>
              {errorMessage || 'Download failed'}
            </span>
          </div>
        ) : showProgress ? (
          <div className="flex items-center gap-2.5">
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.07)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  background: isPaused ? 'rgba(255,255,255,0.25)' : 'var(--accent)',
                  boxShadow: isPaused ? 'none' : '0 0 6px var(--accent-glow)',
                }}
              />
            </div>
            <span className="font-mono text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              {isPaused
                ? 'Paused'
                : `${progress}%${totalBytes > 0 ? ` / ${formatBytes(bytesDownloaded)} of ${formatBytes(totalBytes)}` : ''}${speed ? ` / ${speed}` : ''}${eta ? ` / ${eta}` : ''}`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Clock size={10} style={{ color: 'var(--text-muted)' }} />
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Queued
            </span>
          </div>
        )}
      </div>

      {isDownloading && (
        <DownloadProgressRing progress={progress} size={34} strokeWidth={3} />
      )}

      <div className="flex items-center gap-1 flex-shrink-0">
        {isDownloading && (
          <motion.button
            onClick={() => onPause?.(id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            whileHover={{ color: 'var(--accent)' }}
            whileTap={{ scale: 0.92 }}
            title="Pause"
          >
            <Pause size={11} />
          </motion.button>
        )}
        {(isPaused || isFailed) && (
          <motion.button
            onClick={() => onResume?.(id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            whileHover={{ color: 'var(--accent)' }}
            whileTap={{ scale: 0.92 }}
            title={isFailed ? 'Retry' : 'Resume'}
          >
            <Play size={11} />
          </motion.button>
        )}
        <motion.button
          onClick={() => onCancel?.(id)}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          whileHover={{ color: '#f87171' }}
          whileTap={{ scale: 0.92 }}
          title="Cancel"
        >
          <X size={11} />
        </motion.button>
      </div>
    </motion.div>
  )
}
