import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { imgOriginal } from '../../lib/tmdb'
import GlassButton from '../UI/GlassButton'
import RatingBadge from '../UI/RatingBadge'
import GlassBadge from '../UI/GlassBadge'
import { GENRE_MAP } from '../../lib/tmdb'

export default function HeroSlide({ item }) {
  const navigate = useNavigate()
  const title = item.title || item.name
  const type = item.media_type || (item.title ? 'movie' : 'tv')
  const backdrop = imgOriginal(item.backdrop_path)
  const overview = item.overview?.slice(0, 200) + (item.overview?.length > 200 ? '...' : '')
  const genres = (item.genre_ids || []).slice(0, 3).map(id => GENRE_MAP[id]).filter(Boolean)
  const year = (item.release_date || item.first_air_date || '').slice(0, 4)

  return (
    <div className="relative w-full h-[75vh] overflow-hidden">
      {/* Full-bleed backdrop */}
      {backdrop ? (
        <motion.img
          src={backdrop}
          alt={title}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          transition={{ duration: 8, ease: 'easeOut' }}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, var(--bg-base) 0%, var(--orb-1) 50%, var(--bg-base) 100%)',
          }}
        >
          <span className="font-display font-bold text-6xl" style={{ color: 'var(--accent)', opacity: 0.2 }}>
            NOVA STREAM
          </span>
        </div>
      )}

      {/* Strong gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'var(--hero-overlay)',
        }}
      />
      {/* Extra side gradient for the info card area */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to right, var(--bg-base) 0%, rgba(0,0,0,0.2) 30%, transparent 50%)',
          opacity: 0.5,
        }}
      />

      {/* Floating glass info card */}
      <motion.div
        className="absolute bottom-16 left-8 max-w-2xl z-10 p-7 rounded-2xl"
        style={{
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--card-shadow), var(--inner-glow)',
        }}
        initial={{ opacity: 0, y: 50, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* Title */}
        <h1
          className="font-display font-bold mb-3 leading-tight"
          style={{
            color: 'var(--text-primary)',
            fontSize: 'clamp(2rem, 4vw, 3.5rem)',
            textShadow: '0 2px 20px rgba(0,0,0,0.5)',
          }}
        >
          {title}
        </h1>

        {/* Meta row */}
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          <RatingBadge rating={item.vote_average} />
          {year && (
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {year}
            </span>
          )}
          {genres.map(g => <GlassBadge key={g}>{g}</GlassBadge>)}
        </div>

        {/* Overview */}
        <p
          className="text-sm mb-5 leading-relaxed max-w-lg"
          style={{ color: 'var(--text-secondary)' }}
        >
          {overview}
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <GlassButton
            variant="filled"
            onClick={() =>
              navigate(`/detail/${type}/${item.id}`, {
                state:
                  type === 'anime'
                    ? {
                      isAnime: true,
                      animeTitle: item.title || item.name || item.original_title || '',
                      animeAltTitle: item.original_name || item.original_title || '',
                      animeYear: item.releaseDate || item.start_date || item.year || null,
                    }
                    : undefined,
              })
            }
            className="accent-pulse"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Play Now
          </GlassButton>
          <GlassButton>+ Watchlist</GlassButton>
        </div>
      </motion.div>
    </div>
  )
}
