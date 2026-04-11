import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Download, WifiOff,
  Film, Tv2, Swords, Palette,
  CheckCircle2, AlertCircle, ArrowDownToLine, BookOpen,
} from 'lucide-react'
import DownloadQueueItem from '../components/Downloads/DownloadQueueItem'
import DownloadLibraryRow from '../components/Downloads/DownloadLibraryRow'
import LibraryGroup from '../components/Downloads/LibraryGroup'
import StorageIndicator from '../components/Downloads/StorageIndicator'
import useDownloadStore from '../store/useDownloadStore'
import { prepareAnimeDownloadRuntimeData, clearAnimeDownloadCache } from '../lib/animeDownloads'
import {
  cancelVideoDownload,
  deleteVideoDownload as deleteVideoDownloadFile,
  getDownloadsStorageInfo,
  pauseVideoDownload,
  startVideoDownload,
} from '../lib/videoDownloads'

// ── Filter config (Library tab only) ─────────────────────────────────────────

const LIBRARY_FILTERS = [
  { id: 'all',       label: 'All',       Icon: Download },
  { id: 'movie',     label: 'Movies',    Icon: Film },
  { id: 'tv',        label: 'Series',    Icon: Tv2 },
  { id: 'anime',     label: 'Anime',     Icon: Swords },
  { id: 'animation', label: 'Animation', Icon: Palette },
]

// ── Group episodic completed items, keep movies/animation flat ────────────────

function buildLibraryStructure(completedItems, filter) {
  const filtered = filter === 'all'
    ? completedItems
    : completedItems.filter((d) => d.contentType === filter)

  const EPISODIC = new Set(['tv', 'anime'])
  const groups = {}
  const flat = []

  for (const item of filtered) {
    if (EPISODIC.has(item.contentType)) {
      const key = `${item.contentType}::${item.contentId}`
      if (!groups[key]) {
        groups[key] = {
          key,
          contentId: item.contentId,
          contentType: item.contentType,
          title: item.title,
          poster: item.poster,
          episodes: [],
          latestCompletedAt: null,
        }
      }
      groups[key].episodes.push(item)
      const ts = item.completedAt || item.queuedAt || ''
      if (!groups[key].latestCompletedAt || ts > groups[key].latestCompletedAt) {
        groups[key].latestCompletedAt = ts
      }
    } else {
      flat.push(item)
    }
  }

  const groupList = Object.values(groups)
    .map((g) => ({
      ...g,
      episodes: [...g.episodes].sort((a, b) => {
        const sa = (a.season || 0) * 10000 + (a.episode || 0)
        const sb = (b.season || 0) * 10000 + (b.episode || 0)
        return sa - sb
      }),
    }))
    .sort((a, b) => (b.latestCompletedAt || '').localeCompare(a.latestCompletedAt || ''))

  return { groupList, flat }
}

// ── Empty states ──────────────────────────────────────────────────────────────

function EmptyQueue() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-16 text-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <ArrowDownToLine size={22} style={{ color: 'var(--text-muted)' }} />
      </div>
      <h3 className="font-display font-bold text-base mb-1.5" style={{ color: 'var(--text-primary)' }}>
        No active downloads
      </h3>
      <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Open any movie, series, or anime detail page and tap the Download button to queue it here.
      </p>
    </motion.div>
  )
}

function EmptyLibrary({ filter, hasCompleted }) {
  const isFiltered = filter !== 'all'
  const filterLabel = LIBRARY_FILTERS.find((f) => f.id === filter)?.label || filter

  return (
    <motion.div
      className="flex flex-col items-center justify-center py-16 text-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <WifiOff size={22} style={{ color: 'var(--text-muted)' }} />
      </div>
      <h3 className="font-display font-bold text-base mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {isFiltered ? `No ${filterLabel} saved` : 'Your library is empty'}
      </h3>
      <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {isFiltered && hasCompleted
          ? 'You have other titles saved. Switch to All to see them.'
          : 'Downloaded titles will appear here once complete.'}
      </p>
    </motion.div>
  )
}

// ── Filter bar (Library tab) ──────────────────────────────────────────────────

function LibraryFilterBar({ filter, setFilter, completedItems }) {
  const counts = useMemo(() => {
    const map = {}
    for (const f of LIBRARY_FILTERS) {
      map[f.id] = f.id === 'all'
        ? completedItems.length
        : completedItems.filter((d) => d.contentType === f.id).length
    }
    return map
  }, [completedItems])

  return (
    <div className="flex gap-1.5 flex-wrap">
      {LIBRARY_FILTERS.map(({ id, label, Icon }) => {
        const isActive = filter === id
        const count = counts[id] || 0
        if (count === 0 && id !== 'all' && !isActive) return null

        return (
          <motion.button
            key={id}
            onClick={() => setFilter(id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{
              background: isActive ? 'var(--accent)' : 'var(--bg-surface)',
              color: isActive ? '#fff' : 'var(--text-secondary)',
              border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
              boxShadow: isActive ? '0 0 12px var(--accent-glow)' : 'none',
            }}
            whileTap={{ scale: 0.96 }}
          >
            <Icon size={11} />
            {label}
            {count > 0 && (
              <span className="font-mono" style={{ opacity: isActive ? 0.75 : 0.55, fontSize: 10 }}>
                {count}
              </span>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'downloads', label: 'Downloads', Icon: ArrowDownToLine },
  { id: 'library',   label: 'Library',   Icon: BookOpen },
]

const getStoredDownloadBytes = (item) => (
  Math.max(
    Number(item?.totalBytes || 0),
    Number(item?.bytesDownloaded || 0),
  )
)

export default function Downloads() {
  const [activeTab, setActiveTab] = useState('downloads')
  const [libraryFilter, setLibraryFilter] = useState('all')
  const navigate = useNavigate()

  const downloadItems  = useDownloadStore((s) => s.items)
  const storage        = useDownloadStore((s) => s.storage)
  const setStorageInfo = useDownloadStore((s) => s.setStorageInfo)
  const pauseDownload  = useDownloadStore((s) => s.pauseDownload)
  const resumeDownload = useDownloadStore((s) => s.resumeDownload)
  const cancelDownload = useDownloadStore((s) => s.cancelDownload)
  const deleteDownload = useDownloadStore((s) => s.deleteDownload)

  const activeItems = useMemo(() => (
    [...downloadItems]
      .filter((d) => ['queued', 'downloading', 'paused', 'failed'].includes(d.status))
      .sort((a, b) => new Date(b.queuedAt || 0) - new Date(a.queuedAt || 0))
  ), [downloadItems])

  const completedItems = useMemo(() => (
    [...downloadItems]
      .filter((d) => d.status === 'completed')
      .sort((a, b) => (
        new Date(b.completedAt || b.queuedAt || 0) - new Date(a.completedAt || a.queuedAt || 0)
      ))
  ), [downloadItems])

  const storageSummary = useMemo(() => {
    const derivedBreakdown = { movies: 0, series: 0, anime: 0, animation: 0 }
    for (const item of completedItems) {
      const bytes = getStoredDownloadBytes(item)
      if (item.contentType === 'movie')     derivedBreakdown.movies    += bytes
      if (item.contentType === 'tv')        derivedBreakdown.series    += bytes
      if (item.contentType === 'anime')     derivedBreakdown.anime     += bytes
      if (item.contentType === 'animation') derivedBreakdown.animation += bytes
    }
    const breakdown = storage?.breakdown || derivedBreakdown
    const usedBytes = storage?.usedBytes != null
      ? storage.usedBytes
      : Object.values(breakdown).reduce((t, v) => t + Number(v || 0), 0)

    return {
      usedBytes,
      totalBytes: storage?.totalBytes || 0,
      freeBytes: storage?.freeBytes ?? null,
      breakdown,
    }
  }, [storage, completedItems])

  const { groupList, flat } = useMemo(
    () => buildLibraryStructure(completedItems, libraryFilter),
    [completedItems, libraryFilter]
  )

  const activeCount    = activeItems.length
  const completedCount = completedItems.length
  const failedCount    = activeItems.filter((d) => d.status === 'failed').length
  const hasFiltered    = groupList.length > 0 || flat.length > 0

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handlePlayOffline(download) {
    if (!download?.contentId) return
    const routeMediaType = download.contentType === 'anime'
      ? (download.detailMediaType || (download.episode ? 'tv' : 'movie'))
      : (download.contentType === 'tv' ? 'tv' : download.contentType)

    navigate(`/detail/${routeMediaType}/${download.contentId}`, {
      state: {
        autoOpenPlayer: true,
        isAnime: download.contentType === 'anime',
        animeTitle: download.contentType === 'anime' ? download.title : undefined,
        animeAltTitle: download.contentType === 'anime' ? download.animeAltTitle || undefined : undefined,
        animeSearchTitles: download.contentType === 'anime' ? download.animeSearchTitles || [] : [],
        anilistId: download.contentType === 'anime' ? download.anilistId || null : null,
        canonicalAnilistId: download.contentType === 'anime' ? download.canonicalAnilistId || null : null,
        resumeSeason: download.season ?? null,
        resumeEpisode: download.episode ?? null,
        offlinePlayback: {
          filePath: download.filePath || null,
          subtitleFilePath: download.subtitleFilePath || null,
        },
      },
    })
  }

  async function handlePause(id) {
    pauseDownload(id)
    try { await pauseVideoDownload(id) } catch (e) { console.warn('[downloads] pause failed', e) }
  }

  async function handleResume(id) {
    const download = downloadItems.find((d) => d.id === id)
    if (!download) return
    resumeDownload(id)
    try {
      let preparedDownload = download

      if (download.contentType === 'anime') {
        clearAnimeDownloadCache()
        preparedDownload = await prepareAnimeDownloadRuntimeData(download)

        useDownloadStore.getState().updateDownload(id, {
          animeAltTitle: preparedDownload.animeAltTitle || download.animeAltTitle || '',
          animeSearchTitles: preparedDownload.animeSearchTitles || download.animeSearchTitles || [],
          providerId: preparedDownload.providerId || download.providerId || null,
          providerAnimeId: preparedDownload.providerAnimeId || download.providerAnimeId || null,
          providerMatchedTitle: preparedDownload.providerMatchedTitle || download.providerMatchedTitle || null,
          streamUrl: preparedDownload.streamUrl,
          streamType: preparedDownload.streamType,
          headers: preparedDownload.headers || {},
          subtitleUrl: preparedDownload.subtitleUrl || download.subtitleUrl || null,
          resolvedQuality: preparedDownload.qualityLabel || download.resolvedQuality || null,
        })
      }

      await startVideoDownload({
        id: preparedDownload.id,
        contentId: String(preparedDownload.contentId),
        contentType: preparedDownload.contentType,
        title: preparedDownload.title,
        poster: preparedDownload.poster || null,
        season: preparedDownload.season ?? null,
        episode: preparedDownload.episode ?? null,
        episodeTitle: preparedDownload.episodeTitle || null,
        quality: preparedDownload.quality || 'high',
        streamUrl: preparedDownload.streamUrl || null,
        streamType: preparedDownload.streamType || null,
        headers: preparedDownload.headers || {},
        subtitleUrl: preparedDownload.subtitleUrl || null,
        totalBytes: preparedDownload.totalBytes || null,
      })
    } catch (e) {
      console.warn('[downloads] resume failed', e)
      useDownloadStore.getState().updateDownload(id, {
        status: 'failed',
        speedBytesPerSec: 0,
        errorMessage: e?.message || 'Download failed to resume',
      })
    }
  }

  async function handleCancel(id) {
    try {
      await cancelVideoDownload(id)
      cancelDownload(id)
    } catch (e) {
      console.warn('[downloads] cancel failed', e)
    }
  }

  async function handleDelete(download) {
    if (!download?.id) return
    try {
      await deleteVideoDownloadFile({ id: download.id, filePath: download.filePath || null })
      deleteDownload(download.id)
    } catch (e) { console.warn('[downloads] delete failed', e) }
  }

  async function handleRefreshStorage() {
    try {
      const info = await getDownloadsStorageInfo()
      if (info) setStorageInfo(info)
    } catch (e) { console.warn('[downloads] refresh storage failed', e) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Back */}
      <motion.button
        onClick={() => navigate(-1)}
        className="mb-5 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium"
        style={{
          background: 'rgba(10,10,16,0.55)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.82)',
        }}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        whileHover={{ background: 'rgba(10,10,16,0.88)', borderColor: 'var(--border-hover)', color: '#fff' }}
        whileTap={{ scale: 0.96 }}
      >
        <ChevronLeft size={15} strokeWidth={2} />
        Back
      </motion.button>

      {/* Page header */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {/* Title row */}
        <div className="flex items-center gap-3 mb-5">
          <Download size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--text-primary)' }}>
            Downloads
          </h1>
          {/* Stat chips */}
          <div className="flex items-center gap-2 ml-auto">
            {completedCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold"
                style={{
                  background: 'rgba(74,222,128,0.08)',
                  border: '1px solid rgba(74,222,128,0.2)',
                  color: '#4ade80',
                }}
              >
                <CheckCircle2 size={11} />
                {completedCount} saved
              </div>
            )}
            {failedCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold"
                style={{
                  background: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.2)',
                  color: '#f87171',
                }}
              >
                <AlertCircle size={11} />
                {failedCount} failed
              </div>
            )}
          </div>
        </div>

        {/* Centered tab switcher */}
        <div className="flex justify-center">
          <div
            className="flex p-1 rounded-2xl gap-1"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id
              const badge = id === 'downloads' ? activeCount : completedCount

              return (
                <motion.button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className="relative flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-colors duration-150"
                  style={{
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                    boxShadow: isActive ? '0 0 16px var(--accent-glow)' : 'none',
                    minWidth: 120,
                    justifyContent: 'center',
                  }}
                  whileTap={{ scale: 0.97 }}
                  layout
                >
                  <Icon size={14} />
                  {label}
                  {badge > 0 && (
                    <span
                      className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full"
                      style={{
                        background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--bg-elevated)',
                        color: isActive ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>
        </div>
      </motion.div>

      {/* Storage card — always visible, above tab content */}
      <motion.div
        className="mb-7"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
      >
        <StorageIndicator
          usedBytes={storageSummary.usedBytes}
          totalBytes={storageSummary.totalBytes}
          freeBytes={storageSummary.freeBytes}
          breakdown={storageSummary.breakdown}
          onManage={() => navigate('/settings')}
          onRefreshStorage={handleRefreshStorage}
        />
      </motion.div>

      {/* Tab content */}
      <AnimatePresence mode="wait">

        {/* ── Downloads tab ── */}
        {activeTab === 'downloads' && (
          <motion.div
            key="downloads"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {activeItems.length > 0 ? (
              <div
                className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}
              >
                <AnimatePresence>
                  {activeItems.map((item, idx) => (
                    <div
                      key={item.id}
                      style={idx > 0 ? { borderTop: '1px solid var(--border)' } : {}}
                    >
                      <DownloadQueueItem
                        download={item}
                        onPause={handlePause}
                        onResume={handleResume}
                        onCancel={handleCancel}
                      />
                    </div>
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <EmptyQueue />
            )}
          </motion.div>
        )}

        {/* ── Library tab ── */}
        {activeTab === 'library' && (
          <motion.div
            key="library"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {completedItems.length > 0 && (
              <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <span
                  className="text-sm font-semibold tracking-wide uppercase"
                  style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em' }}
                >
                  Saved titles
                </span>
                <LibraryFilterBar
                  filter={libraryFilter}
                  setFilter={setLibraryFilter}
                  completedItems={completedItems}
                />
              </div>
            )}

            {hasFiltered ? (
              <div className="flex flex-col gap-2">
                <AnimatePresence>
                  {groupList.map((group) => (
                    <LibraryGroup
                      key={group.key}
                      contentId={group.contentId}
                      contentType={group.contentType}
                      title={group.title}
                      poster={group.poster}
                      episodes={group.episodes}
                      onPlayOffline={handlePlayOffline}
                      onDelete={handleDelete}
                      // Phase E: wire per-episode offline playback routing
                      onPlayOfflineEpisode={null}
                    />
                  ))}
                  {flat.map((item) => (
                    <DownloadLibraryRow
                      key={item.id}
                      download={item}
                      onPlayOffline={handlePlayOffline}
                      onDelete={() => handleDelete(item)}
                      canPlayOffline={Boolean(item.filePath)}
                      hasOfflineSubtitles={Boolean(item.subtitleFilePath)}
                      offlineSubtitleLabel={item.subtitleFilePath ? 'English' : null}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <EmptyLibrary filter={libraryFilter} hasCompleted={completedCount > 0} />
            )}
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
