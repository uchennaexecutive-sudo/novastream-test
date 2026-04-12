import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { getHistory, removeFromHistory } from '../lib/supabase'
import { imgW500 } from '../lib/tmdb'
import { getAllProgressRows, getEpisodeProgressKey } from '../lib/progress'
import useAuthStore from '../store/useAuthStore'
import { hasUserDataScope, subscribeUserDataChanged } from '../lib/userDataEvents'

export default function History() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const userId = useAuthStore((state) => state.user?.id || null)

  const loadHistory = useCallback(async ({ withLoading = false } = {}) => {
    if (withLoading) {
      setLoading(true)
    }

    try {
      const [historyItems, progressRows] = await Promise.all([
        getHistory(),
        getAllProgressRows(),
      ])

      const progressByEpisodeKey = new Map(
        progressRows.map((row) => [
          `${row.content_id}::${getEpisodeProgressKey(row.season, row.episode)}`,
          row,
        ])
      )

      const latestProgressByContentId = new Map()
      for (const row of progressRows) {
        const contentId = String(row.content_id)
        const existing = latestProgressByContentId.get(contentId)
        const existingTime = new Date(existing?.updated_at || 0).getTime()
        const nextTime = new Date(row?.updated_at || 0).getTime()

        if (!existing || nextTime >= existingTime) {
          latestProgressByContentId.set(contentId, row)
        }
      }

      const nextItems = historyItems
        .map((item) => {
          const exactProgress = progressByEpisodeKey.get(
            `${item.tmdb_id}::${getEpisodeProgressKey(item.season, item.episode)}`
          )
          const fallbackProgress = latestProgressByContentId.get(String(item.tmdb_id))
          const progress = exactProgress || fallbackProgress || null

          return {
            ...item,
            ...(progress || {}),
            id: String(item.tmdb_id),
            content_id: String(item.tmdb_id),
            content_type: item.media_type,
            title: item.title || progress?.title || 'Untitled',
            poster_path: item.poster_path || null,
            season: item.season ?? progress?.season ?? null,
            episode: item.episode ?? progress?.episode ?? null,
            watched_at: item.watched_at || progress?.updated_at,
          }
        })
        .sort((left, right) => (
          new Date(right?.watched_at || right?.updated_at || 0).getTime()
          - new Date(left?.watched_at || left?.updated_at || 0).getTime()
        ))

      setItems(nextItems)
    } finally {
      if (withLoading) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadHistory({ withLoading: true })
  }, [loadHistory, userId])

  useEffect(() => (
    subscribeUserDataChanged((detail) => {
      // Skip remove events — the optimistic setItems already handles the UI update.
      // Re-fetching from cloud here risks the deleted item being restored before
      // the Supabase delete propagates.
      if (detail?.reason === 'history-remove') return
      if (!hasUserDataScope(detail, ['history'])) return
      void loadHistory()
    })
  ), [loadHistory])

  const handleRemove = async (e, tmdbId) => {
    e.stopPropagation()
    setItems(prev => prev.filter(i => String(i.tmdb_id) !== String(tmdbId) && String(i.id) !== String(tmdbId)))
    await removeFromHistory(tmdbId)
  }

  const handleOpen = (item) => {
    const detailType = item.content_type === 'movie' ? 'movie' : 'tv'
    navigate(`/detail/${detailType}/${item.content_id}`, {
      state: {
        resumeSeason: item.season,
        resumeEpisode: item.episode,
      },
    })
  }

  return (
    <div className="p-6">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        ⏱ History
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Recently watched</p>

      {loading ? (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-full h-[264px] rounded-2xl shimmer" style={{ border: '1px solid var(--border)' }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <motion.div
          className="flex flex-col items-center justify-center py-24 rounded-2xl"
          style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(20px)',
            boxShadow: 'var(--card-shadow), var(--inner-glow)',
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
            style={{
              background: 'var(--bg-elevated)',
              boxShadow: '0 0 40px var(--accent-glow)',
            }}
          >
            <span className="text-4xl">⏱</span>
          </div>
          <h3 className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
            No watch history
          </h3>
          <p className="text-sm max-w-sm text-center" style={{ color: 'var(--text-muted)' }}>
            Start watching to see your history here. We'll keep track of where you left off.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-6 px-6 py-2.5 rounded-xl font-medium text-sm"
            style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}
          >
            Start Watching
          </button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5">
          {items.map(item => (
            <motion.div
              key={item.id}
              className="rounded-2xl overflow-hidden relative cursor-pointer group"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                height: 264,
                boxShadow: 'var(--card-shadow)',
              }}
              whileHover={{
                y: -8,
                boxShadow: '0 0 30px var(--accent-glow), 0 20px 60px rgba(0,0,0,0.4)',
                borderColor: 'var(--border-hover)',
              }}
              onClick={() => handleOpen(item)}
            >
              {(item.poster_path || item.poster || item.backdrop) ? (
                <img
                  src={item.poster_path ? imgW500(item.poster_path) : (item.poster || item.backdrop)}
                  alt={item.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                  <span className="text-4xl opacity-40">⏱</span>
                </div>
              )}

              <div
                className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out p-3 pt-10"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)' }}
              >
                <p className="font-display font-semibold text-sm text-white truncate">{item.title}</p>
                {Number(item.season) > 0 && Number(item.episode) > 0 && (
                  <p className="text-[11px] text-white/60 mt-0.5">
                    S{item.season} E{item.episode}
                  </p>
                )}
                <button
                  onClick={(e) => handleRemove(e, item.tmdb_id)}
                  className="mt-2 text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:scale-105"
                  style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                >
                  Remove
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
