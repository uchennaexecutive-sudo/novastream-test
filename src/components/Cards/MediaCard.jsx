import { memo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { imgW500 } from '../../lib/tmdb'
import { buildDetailNavigationForTmdbItem, getTmdbMediaType } from '../../lib/animeClassification'

function MediaCard({ item, type, aspectRatio = 'portrait' }) {
  const navigate = useNavigate()
  const mediaType = getTmdbMediaType(item, type)
  const title = item.title || item.name || item.original_title || ''
  const poster = imgW500(item.poster_path || item.backdrop_path)
  const rating = item.vote_average

  const isSquare = aspectRatio === 'square'

  const handleOpen = async () => {
    const target = await buildDetailNavigationForTmdbItem(item, type)
    navigate(target.path, target.state ? { state: target.state } : undefined)
  }

  return (
    <motion.div
      className={`rounded-2xl overflow-hidden relative cursor-pointer group ${isSquare ? 'w-full' : 'w-44 flex-shrink-0'}`}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
        height: 264,
      }}
      whileHover={{
        y: -8,
        boxShadow: '0 0 30px var(--accent-glow), 0 20px 60px rgba(0,0,0,0.4)',
        borderColor: 'var(--border-hover)',
        transition: { duration: 0.3, ease: 'easeOut' },
      }}
      onClick={handleOpen}
    >
      {poster ? (
        <img
          src={poster}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ background: 'var(--bg-elevated)' }}
        >
          <span className="text-4xl opacity-40">🎬</span>
        </div>
      )}

      {/* Hover overlay */}
      <div
        className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out p-3 pt-10"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)',
        }}
      >
        <p className="font-display font-semibold text-sm text-white truncate">{title}</p>

        <div className="flex items-center gap-2 mt-1.5">
          {rating > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 glow-dot" />
              {rating.toFixed(1)}
            </span>
          )}
        </div>

        <div
          className="mt-2.5 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 group-hover:shadow-lg"
          style={{
            background: 'var(--accent)',
            boxShadow: '0 0 16px var(--accent-glow)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        </div>
      </div>

      {/* Rating badge */}
      {rating > 0 && (
        <div
          className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold"
          style={{
            background: 'rgba(0,0,0,0.7)',
            color: rating >= 7 ? '#4ade80' : rating >= 5 ? '#fbbf24' : '#f87171',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {rating.toFixed(1)}
        </div>
      )}
    </motion.div>
  )
}

export default memo(MediaCard)
