import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { getHistory } from '../lib/supabase'
import { getAllProgressRows, getEpisodeProgressKey } from '../lib/progress'
import ContinueCard from '../components/Cards/ContinueCard'

export default function History() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([getHistory(), getAllProgressRows()])
      .then(([historyItems, progressRows]) => {
        const progressMap = new Map(
          progressRows.map(row => [
            `${row.content_id}::${getEpisodeProgressKey(row.season, row.episode)}`,
            row,
          ])
        )

        setItems(historyItems.map((item) => {
          const progress = progressMap.get(`${item.tmdb_id}::${getEpisodeProgressKey(item.season, item.episode)}`)

          if (!progress) {
            return {
              ...item,
              content_id: String(item.tmdb_id),
              content_type: item.media_type,
              duration_seconds: 0,
            }
          }

          return {
            ...item,
            ...progress,
            title: item.title || progress.title,
          }
        }))
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        ⏱ History
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Recently watched</p>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-full h-36 rounded-2xl shimmer" style={{ border: '1px solid var(--border)' }} />
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {items.map(item => <ContinueCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  )
}
