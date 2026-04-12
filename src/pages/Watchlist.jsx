import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { getWatchlist, removeFromWatchlist } from '../lib/supabase'
import { imgW500 } from '../lib/tmdb'
import useAuthStore from '../store/useAuthStore'
import { hasUserDataScope, subscribeUserDataChanged } from '../lib/userDataEvents'

export default function Watchlist() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const userId = useAuthStore((state) => state.user?.id || null)

  const loadWatchlist = useCallback(async ({ withLoading = false } = {}) => {
    if (withLoading) {
      setLoading(true)
    }

    try {
      const nextItems = await getWatchlist()
      setItems(nextItems)
    } finally {
      if (withLoading) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadWatchlist({ withLoading: true })
  }, [loadWatchlist, userId])

  useEffect(() => (
    subscribeUserDataChanged((detail) => {
      if (!hasUserDataScope(detail, ['watchlist'])) return
      void loadWatchlist()
    })
  ), [loadWatchlist])

  const handleRemove = async (e, tmdbId) => {
    e.stopPropagation()
    await removeFromWatchlist(tmdbId)
    setItems(prev => prev.filter(i => i.tmdb_id !== tmdbId))
  }

  return (
    <div className="p-6">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        ★ Watchlist
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Your saved titles</p>

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
            <span className="text-4xl">★</span>
          </div>
          <h3 className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
            Your watchlist is empty
          </h3>
          <p className="text-sm max-w-sm text-center" style={{ color: 'var(--text-muted)' }}>
            Browse movies and series to save your favorites here. They'll be waiting for you.
          </p>
          <button
            onClick={() => navigate('/movies')}
            className="mt-6 px-6 py-2.5 rounded-xl font-medium text-sm"
            style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}
          >
            Browse Movies
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
              onClick={() => navigate(`/detail/${item.media_type}/${item.tmdb_id}`)}
            >
              {item.poster_path ? (
                <img
                  src={imgW500(item.poster_path)}
                  alt={item.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                  <span className="text-4xl opacity-40">🎬</span>
                </div>
              )}
              <div
                className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out p-3 pt-10"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)' }}
              >
                <p className="font-display font-semibold text-sm text-white truncate">{item.title}</p>
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
