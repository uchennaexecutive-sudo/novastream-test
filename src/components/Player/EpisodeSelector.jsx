import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { getSeasonDetails, imgW500 } from '../../lib/tmdb'
import { getEpisodeProgressKey } from '../../lib/progress'
import DownloadButton from '../Downloads/DownloadButton'
import OfflineBadge from '../Downloads/OfflineBadge'

export default function EpisodeSelector({
  seriesId,
  numSeasons,
  currentSeason = 1,
  currentEpisode = null,
  progressMap = {},
  onPlay,
  // ── Download props (Phase B: fed from useDownloadStore) ──────────────────
  // downloadStatusMap: { [episodeKey]: { status, progress } }
  //   episodeKey = getEpisodeProgressKey(season, episode)
  //   Phase B: useDownloadStore.getDownloadStatus(seriesId, season, episode)
  downloadStatusMap = {},
  // onDownloadEpisode: (season, episode) => void
  //   Phase C: enqueue single episode via useDownloadStore
  onDownloadEpisode = null,
  // onPauseEpisode: (season, episode) => void
  //   Phase C: pause an in-flight episode download via useDownloadStore / Rust
  onPauseEpisode = null,
  // onDownloadSeason: (season) => void
  //   Phase C: open SeasonDownloadSheet (handled by Detail.jsx via setSeasonDownloadSheetOpen)
  onDownloadSeason = null,
  // onPlayOfflineEpisode: (season, episode) => void
  //   Phase E: open player with convertFileSrc(filePath) for the downloaded episode
  onPlayOfflineEpisode = null,
}) {
  const [season, setSeason] = useState(currentSeason || 1)
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSeason(currentSeason || 1)
  }, [currentSeason])

  useEffect(() => {
    setLoading(true)
    getSeasonDetails(seriesId, season)
      .then(data => setEpisodes(data.episodes || []))
      .catch(() => setEpisodes([]))
      .finally(() => setLoading(false))
  }, [seriesId, season])

  const downloadedEpisodeCount = Object.values(downloadStatusMap).filter(
    (entry) => entry?.status === 'completed'
  ).length

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: numSeasons }, (_, index) => index + 1).map(nextSeason => (
              <button
                key={nextSeason}
                onClick={() => setSeason(nextSeason)}
                className="px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
                style={{
                  background: nextSeason === season ? 'var(--accent)' : 'var(--bg-surface)',
                  color: nextSeason === season ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${nextSeason === season ? 'var(--accent)' : 'var(--border)'}`,
                  boxShadow: nextSeason === season ? '0 0 16px var(--accent-glow)' : 'none',
                }}
              >
                Season {nextSeason}
              </button>
            ))}
          </div>
          {downloadedEpisodeCount > 0 && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(74,222,128,0.10)',
                border: '1px solid rgba(74,222,128,0.26)',
                color: '#4ade80',
              }}
            >
              {downloadedEpisodeCount} downloaded
            </span>
          )}
        </div>

        {/* Download Season button — Phase C: wire onDownloadSeason */}
        {onDownloadSeason && (
          <motion.button
            onClick={() => onDownloadSeason(season)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
            whileHover={{
              color: 'var(--accent)',
              borderColor: 'var(--accent)',
              boxShadow: '0 0 12px var(--accent-glow)',
            }}
            whileTap={{ scale: 0.97 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download Season
          </motion.button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-36 rounded-xl shimmer" style={{ border: '1px solid var(--border)' }} />
          ))
        ) : (
          episodes.map((ep) => {
            const episodeProgress = progressMap[getEpisodeProgressKey(season, ep.episode_number)]
            const progressPercent = Math.round((episodeProgress?.percent || 0) * 100)
            const isCurrentEpisode = Number(currentSeason) === Number(season)
              && Number(currentEpisode) === Number(ep.episode_number)
            const epDownloadState = downloadStatusMap[getEpisodeProgressKey(season, ep.episode_number)]
            const isEpisodeDownloaded = epDownloadState?.status === 'completed'

            return (
              <motion.div
                key={ep.id}
                className="rounded-xl overflow-hidden cursor-pointer group"
                style={{
                  background: 'var(--bg-surface)',
                  border: isCurrentEpisode
                    ? '1px solid var(--accent)'
                    : isEpisodeDownloaded
                      ? '1px solid rgba(74,222,128,0.22)'
                      : '1px solid var(--border)',
                  boxShadow: isCurrentEpisode
                    ? '0 0 24px var(--accent-glow), var(--card-shadow)'
                    : 'var(--card-shadow)',
                }}
                whileHover={{
                  y: -3,
                  borderColor: isEpisodeDownloaded ? 'rgba(74,222,128,0.45)' : 'var(--border-hover)',
                  boxShadow: '0 0 20px var(--accent-glow), 0 12px 40px rgba(0,0,0,0.3)',
                }}
                onClick={() => {
                  if (isEpisodeDownloaded && onPlayOfflineEpisode) {
                    onPlayOfflineEpisode(season, ep.episode_number)
                  } else {
                    onPlay(season, ep.episode_number, ep.runtime || null)
                  }
                }}
              >
                <div className="relative h-28">
                  {ep.still_path ? (
                    <img
                      src={imgW500(ep.still_path)}
                      alt={ep.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                      <span className="text-2xl opacity-40">TV</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center"
                      style={{
                        background: isEpisodeDownloaded ? 'rgba(74,222,128,0.85)' : 'var(--accent)',
                        boxShadow: '0 0 20px var(--accent-glow-strong)',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                        <polygon points="6 3 20 12 6 21 6 3" />
                      </svg>
                    </div>
                  </div>

                  {/* Offline badge — always visible when downloaded (not hover-gated) */}
                  {isEpisodeDownloaded && (
                    <div className="absolute top-2 left-2 z-10">
                      <OfflineBadge variant="pill" />
                    </div>
                  )}

                  {/* Episode download button — top-right overlay
                    Phase B: status from downloadStatusMap[getEpisodeProgressKey(season, ep.episode_number)]
                    Phase C: onDownloadEpisode enqueues via useDownloadStore
                    Hidden for completed episodes — offline badge + play-offline click takes over
                  */}
                  {onDownloadEpisode && !isEpisodeDownloaded && (
                    <div
                      className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                      onClick={e => e.stopPropagation()}
                    >
                      <DownloadButton
                        size="sm"
                        contentId={String(seriesId)}
                        contentType="tv"
                        season={season}
                        episode={ep.episode_number}
                        status={epDownloadState?.status || 'default'}
                        progress={epDownloadState?.progress || 0}
                        onDownload={() => onDownloadEpisode(season, ep.episode_number)}
                        onPause={() => onPauseEpisode?.(season, ep.episode_number)}
                      />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>E{ep.episode_number}</span>
                    <span className="text-xs truncate font-medium" style={{ color: 'var(--text-primary)' }}>{ep.name}</span>
                  </div>
                  {ep.air_date && (
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{ep.air_date}</span>
                  )}
                  {(isCurrentEpisode || progressPercent > 0) && (
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-mono" style={{ color: isCurrentEpisode ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {progressPercent}% watched
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${progressPercent}%`,
                            background: 'var(--accent)',
                            boxShadow: '0 0 10px var(--accent-glow)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })
        )}
      </div>
    </div>
  )
}
