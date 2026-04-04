/**
 * LibraryGroup
 *
 * Collapsible group card for a series/anime show in the offline library.
 * Groups all downloaded episodes under a single expandable header.
 *
 * Props:
 *   contentId           string    — show's content id
 *   contentType         string    — "tv" | "anime"
 *   title               string    — show title
 *   poster              string    — poster URL
 *   episodes            array     — download items for this group (sorted by completedAt desc)
 *   onPlayOffline       fn        — (download) => void — Phase E: play via convertFileSrc
 *   onDelete            fn        — (download) => void — delete one episode
 *   onPlayOfflineEpisode fn|null  — (season, episode) => void — Phase E wiring point
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight, Tv2, Swords } from 'lucide-react'
import DownloadLibraryRow from './DownloadLibraryRow'

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function getEpisodeStoredBytes(episode) {
  return Math.max(
    Number(episode?.totalBytes || 0),
    Number(episode?.bytesDownloaded || 0),
  )
}

export default function LibraryGroup({
  contentId,
  contentType,
  title,
  poster,
  episodes = [],
  onPlayOffline,
  onDelete,
  onPlayOfflineEpisode = null,
}) {
  const [expanded, setExpanded] = useState(false)

  if (!episodes.length) return null

  const ContentIcon = contentType === 'anime' ? Swords : Tv2
  const episodeCount = episodes.length
  const totalBytes = episodes.reduce((sum, ep) => sum + getEpisodeStoredBytes(ep), 0)
  const sizeLabel = formatBytes(totalBytes)

  // Derive a representative season range label
  const seasons = [...new Set(episodes.map((ep) => ep.season).filter(Boolean))].sort((a, b) => a - b)
  let seasonLabel = ''
  if (seasons.length === 1) {
    seasonLabel = `Season ${seasons[0]}`
  } else if (seasons.length > 1) {
    seasonLabel = `Seasons ${seasons[0]}–${seasons[seasons.length - 1]}`
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Group header — click to expand/collapse */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left group"
        onClick={() => setExpanded((prev) => !prev)}
        style={{ background: 'transparent' }}
      >
        {/* Poster */}
        <div
          className="w-[56px] h-[36px] rounded-md overflow-hidden flex-shrink-0"
          style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {poster ? (
            <img src={poster} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ opacity: 0.3 }}>
              <ContentIcon size={14} style={{ color: 'var(--text-muted)' }} />
            </div>
          )}
        </div>

        {/* Title + metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {title}
            </span>
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 font-mono"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              <ContentIcon size={9} />
              {contentType === 'anime' ? 'Anime' : 'Series'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span>{episodeCount} episode{episodeCount !== 1 ? 's' : ''}</span>
            {seasonLabel && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>{seasonLabel}</span>
              </>
            )}
            {sizeLabel && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                <span className="font-mono">{sizeLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Chevron */}
        <div
          className="flex-shrink-0 transition-transform duration-200"
          style={{
            color: 'var(--text-muted)',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          <ChevronDown size={15} />
        </div>
      </button>

      {/* Expanded episode list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="episodes"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              className="px-2 pb-2 flex flex-col gap-1"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              {episodes.map((ep) => (
                <DownloadLibraryRow
                  key={ep.id}
                  download={ep}
                  onPlayOffline={onPlayOffline}
                  onDelete={() => onDelete?.(ep)}
                  canPlayOffline={Boolean(ep.filePath)}
                  hasOfflineSubtitles={Boolean(ep.subtitleFilePath)}
                  offlineSubtitleLabel={ep.subtitleFilePath ? 'English' : null}
                  onPlayOfflineEpisode={onPlayOfflineEpisode}
                  compact
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
