import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Trash2, Subtitles } from 'lucide-react'
import OfflineBadge from './OfflineBadge'

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '--'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

const QUALITY_LABELS = { standard: 'SD', high: 'HD', highest: '4K' }
const TYPE_LABELS = { movie: 'Movie', tv: 'Series', anime: 'Anime', animation: 'Anim.' }

export default function DownloadLibraryRow({
  download,
  onPlayOffline,
  onDelete,
  canPlayOffline,
  hasOfflineSubtitles,
  offlineSubtitleLabel,
  onPlayOfflineEpisode = null,
  compact = false,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!download) return null

  const {
    id,
    title,
    poster,
    contentType,
    season,
    episode,
    episodeTitle,
    quality,
    resolvedQuality,
    totalBytes,
    bytesDownloaded,
    completedAt,
  } = download

  const qualityLabel = resolvedQuality || QUALITY_LABELS[quality] || quality?.toUpperCase() || 'HD'
  const typeLabel = TYPE_LABELS[contentType] || contentType || ''
  const isPlayable = canPlayOffline !== undefined ? canPlayOffline : true
  const storedBytes = Math.max(Number(totalBytes || 0), Number(bytesDownloaded || 0))

  const subtitleParts = []
  if (contentType === 'tv' || contentType === 'anime') {
    if (season && episode) subtitleParts.push(`Season ${season} / Episode ${episode}`)
    if (episodeTitle) subtitleParts.push(episodeTitle)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      className="flex items-center gap-4 rounded-xl px-4 group"
      style={{
        paddingTop: compact ? '10px' : '14px',
        paddingBottom: compact ? '10px' : '14px',
        background: compact ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        border: compact ? '1px solid rgba(255,255,255,0.04)' : '1px solid var(--border)',
        position: 'relative',
      }}
      whileHover={{ borderColor: compact ? 'rgba(255,255,255,0.09)' : 'var(--border-hover)' }}
    >
      <div
        className="w-[72px] h-[48px] rounded-lg overflow-hidden flex-shrink-0 relative"
        style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {poster ? (
          <img src={poster} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs opacity-30">
            {typeLabel}
          </div>
        )}
        <div className="absolute bottom-1 right-1">
          <OfflineBadge variant="corner" hasSubtitles={hasOfflineSubtitles} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              fontFamily: 'monospace',
            }}
          >
            {qualityLabel}
          </span>
          <OfflineBadge variant="pill" hasSubtitles={hasOfflineSubtitles} />
        </div>

        {subtitleParts.length > 0 && (
          <p className="text-xs truncate mb-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtitleParts.join(' / ')}
          </p>
        )}

        <div className="flex items-center gap-3">
          {storedBytes > 0 && (
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {formatBytes(storedBytes)}
            </span>
          )}
          {completedAt && (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {formatDate(completedAt)}
            </span>
          )}
          {hasOfflineSubtitles && offlineSubtitleLabel && (
            <span
              className="flex items-center gap-1 text-[10px] font-medium"
              style={{ color: 'rgba(74,222,128,0.7)' }}
              title="Subtitle track downloaded"
            >
              <Subtitles size={9} />
              {offlineSubtitleLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <motion.button
          onClick={() => onPlayOffline?.(download)}
          disabled={!isPlayable}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{
            background: isPlayable ? 'rgba(74,222,128,0.15)' : 'var(--bg-elevated)',
            color: isPlayable ? '#4ade80' : 'var(--text-muted)',
            border: isPlayable ? '1px solid rgba(74,222,128,0.32)' : '1px solid var(--border)',
            boxShadow: isPlayable ? '0 0 10px rgba(74,222,128,0.12)' : 'none',
            cursor: isPlayable ? 'pointer' : 'not-allowed',
          }}
          whileHover={isPlayable ? { boxShadow: '0 0 18px rgba(74,222,128,0.22)', borderColor: 'rgba(74,222,128,0.55)' } : {}}
          whileTap={isPlayable ? { scale: 0.96 } : {}}
          title={isPlayable ? 'Play offline' : 'File not available'}
        >
          <Play size={11} fill={isPlayable ? '#4ade80' : 'var(--text-muted)'} strokeWidth={0} />
          Play Offline
        </motion.button>

        <motion.button
          onClick={() => setConfirmDelete(true)}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          whileHover={{ color: '#f87171', background: 'rgba(248,113,113,0.08)' }}
          whileTap={{ scale: 0.92 }}
          title="Delete download"
        >
          <Trash2 size={13} />
        </motion.button>
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            className="absolute inset-0 rounded-xl flex items-center justify-center gap-3"
            style={{
              background: 'rgba(8,8,14,0.88)',
              backdropFilter: 'blur(8px)',
              zIndex: 10,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Delete this download?
            </span>
            <motion.button
              onClick={() => { onDelete?.(id); setConfirmDelete(false) }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: '#f87171', color: '#fff' }}
              whileTap={{ scale: 0.96 }}
            >
              Delete
            </motion.button>
            <motion.button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              whileTap={{ scale: 0.96 }}
            >
              Keep
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
