import { useState, useEffect } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import ReactPlayer from 'react-player'
import { getDetails, imgOriginal, imgW500 } from '../lib/tmdb'
import GlassButton from '../components/UI/GlassButton'
import RatingBadge from '../components/UI/RatingBadge'
import GlassBadge from '../components/UI/GlassBadge'
import MediaCard from '../components/Cards/MediaCard'
import EpisodeSelector from '../components/Player/EpisodeSelector'
import AnimePlayer from '../components/Player/AnimePlayer'
import PlayerModal from '../components/Player/PlayerModal'
import { addToWatchlist, isInWatchlist } from '../lib/supabase'

export default function Detail() {
  const { type, id } = useParams()
  const location = useLocation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [animePlayerOpen, setAnimePlayerOpen] = useState(false)
  const [playSeason, setPlaySeason] = useState(1)
  const [playEpisode, setPlayEpisode] = useState(1)
  const [inWatchlist, setInWatchlist] = useState(false)

  useEffect(() => {
    setLoading(true)
    getDetails(type, id)
      .then(setData)
      .finally(() => setLoading(false))
    isInWatchlist(Number(id)).then(setInWatchlist).catch(() => {})
  }, [type, id])

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  const title = data.title || data.name
  const backdrop = imgOriginal(data.backdrop_path)
  const poster = imgW500(data.poster_path)
  const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube')
  const cast = data.credits?.cast?.slice(0, 16) || []
  const similar = data.similar?.results?.slice(0, 12) || []
  const genres = data.genres || []
  const numSeasons = data.number_of_seasons || 0
  const year = (data.release_date || data.first_air_date || '').slice(0, 4)
  const isAnime = Boolean(location.state?.isAnime)
  const animeTitle = location.state?.animeTitle || location.state?.animeAltTitle || title

  const handleWatchlist = async () => {
    await addToWatchlist({
      tmdb_id: data.id,
      media_type: type,
      title,
      poster_path: data.poster_path,
    })
    setInWatchlist(true)
  }

  const handlePlay = (s, e) => {
    const nextSeason = s || 1
    const nextEpisode = e || 1

    setPlaySeason(nextSeason)
    setPlayEpisode(nextEpisode)

    if (isAnime) {
      setAnimePlayerOpen(true)
      return
    }

    setPlayerOpen(true)
  }

  return (
    <div>
      {/* ─── Hero Backdrop — full bleed ─── */}
      <div className="relative w-full h-[55vh] -mt-14 overflow-hidden" style={{ objectPosition: 'center top' }}>
        {backdrop ? (
          <motion.img
            src={backdrop}
            alt={title}
            className="w-full h-full object-cover"
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            transition={{ duration: 8, ease: 'easeOut' }}
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ background: 'linear-gradient(135deg, var(--bg-base), var(--orb-1), var(--bg-base))' }}
          />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 70%)' }} />
      </div>

      {/* ─── Info Panel — 2 column grid ─── */}
      <div className="relative z-10 w-full" style={{ marginTop: -120, padding: '0 64px 64px 64px' }}>
        <div className="grid grid-cols-[280px_1fr] items-start" style={{ gap: 48 }}>

          {/* Left: Poster */}
          <motion.div
            className="rounded-2xl overflow-hidden flex-shrink-0 sticky top-20"
            style={{
              border: '1px solid var(--border)',
              boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
              aspectRatio: '2/3',
            }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
          >
            {poster ? (
              <img src={poster} alt={title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                <span className="text-5xl opacity-40">🎬</span>
              </div>
            )}
          </motion.div>

          {/* Right: Info */}
          <motion.div
            className="pt-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            {/* Title */}
            <h1
              className="font-display font-bold mb-3 leading-[1.1]"
              style={{
                color: 'var(--text-primary)',
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.1,
                textShadow: '0 4px 30px rgba(0,0,0,0.5)',
              }}
            >
              {title}
            </h1>

            {data.tagline && (
              <p className="italic mb-4" style={{ color: 'var(--text-secondary)', fontSize: 18 }}>
                "{data.tagline}"
              </p>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <RatingBadge rating={data.vote_average} />
              <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                {data.vote_count?.toLocaleString()} votes
              </span>
              {year && (
                <GlassBadge>
                  <span className="font-mono">{year}</span>
                </GlassBadge>
              )}
              {data.runtime && (
                <GlassBadge>
                  <span className="font-mono">{data.runtime}</span> min
                </GlassBadge>
              )}
              {numSeasons > 0 && (
                <GlassBadge>
                  <span className="font-mono">{numSeasons}</span> season{numSeasons > 1 ? 's' : ''}
                </GlassBadge>
              )}
            </div>

            {/* Genres */}
            {genres.length > 0 && (
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                {genres.map(g => <GlassBadge key={g.id}>{g.name}</GlassBadge>)}
              </div>
            )}

            {/* Overview */}
            <p
              style={{ color: 'var(--text-secondary)', maxWidth: 680, fontSize: 16, lineHeight: 1.7 }}
              className="mb-8"
            >
              {data.overview}
            </p>

            {/* Action Buttons */}
            <div className="flex gap-4" style={{ marginTop: 32 }}>
              <motion.button
                onClick={() => handlePlay(1, 1)}
                className="flex items-center gap-3 font-semibold rounded-xl"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  padding: '16px 40px',
                  fontSize: 18,
                  boxShadow: '0 0 30px var(--accent-glow)',
                }}
                whileHover={{ scale: 1.02, boxShadow: '0 0 40px var(--accent-glow)' }}
                whileTap={{ scale: 0.98 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Stream Now
              </motion.button>
              <motion.button
                onClick={handleWatchlist}
                className="font-semibold rounded-xl"
                style={{
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  padding: '16px 40px',
                  fontSize: 18,
                  border: '1px solid var(--border)',
                  backdropFilter: 'blur(12px)',
                }}
                whileHover={{ scale: 1.02, borderColor: 'var(--accent)', boxShadow: '0 0 20px var(--accent-glow)' }}
                whileTap={{ scale: 0.98 }}
              >
                {inWatchlist ? '✓ In Watchlist' : '+ Watchlist'}
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ─── Full-width content sections ─── */}
      <div className="space-y-14" style={{ padding: '48px 64px' }}>

        {/* Cast */}
        {cast.length > 0 && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              🎭 Cast
            </h3>
            <div className="flex gap-5 overflow-x-auto hide-scrollbar pb-3">
              {cast.map(person => (
                <div key={person.id} className="flex flex-col items-center flex-shrink-0 w-24 group">
                  <div
                    className="w-20 h-20 rounded-full overflow-hidden mb-2 transition-all duration-200 group-hover:ring-2 group-hover:ring-[var(--accent)] group-hover:scale-105"
                    style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--card-shadow)' }}
                  >
                    {person.profile_path ? (
                      <img src={imgW500(person.profile_path)} alt={person.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl opacity-40">👤</div>
                    )}
                  </div>
                  <span className="text-xs text-center truncate w-full font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {person.name}
                  </span>
                  <span className="text-[10px] text-center truncate w-full" style={{ color: 'var(--text-muted)' }}>
                    {person.character}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Trailer */}
        {trailer && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              🎥 Trailer
            </h3>
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                border: '1px solid var(--border)',
                boxShadow: 'var(--card-shadow)',
                aspectRatio: '16/9',
                maxWidth: 900,
              }}
            >
              <ReactPlayer
                url={`https://www.youtube.com/watch?v=${trailer.key}`}
                width="100%"
                height="100%"
                controls
              />
            </div>
          </section>
        )}

        {/* Episodes */}
        {type === 'tv' && numSeasons > 0 && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              📺 Episodes
            </h3>
            <EpisodeSelector
              seriesId={data.id}
              numSeasons={numSeasons}
              onPlay={(s, e) => handlePlay(s, e)}
            />
          </section>
        )}

        {/* Similar */}
        {similar.length > 0 && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              🎬 More Like This
            </h3>
            <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-3">
              {similar.map(item => <MediaCard key={item.id} item={item} type={type} />)}
            </div>
          </section>
        )}
      </div>

      {!isAnime && (
        <PlayerModal
          isOpen={playerOpen}
          onClose={() => setPlayerOpen(false)}
          tmdbId={data.id}
          mediaType={type}
          title={title}
          posterPath={data.poster_path}
          season={playSeason}
          episode={playEpisode}
          isAnime={false}
        />
      )}

      {isAnime && animePlayerOpen && (
        <AnimePlayer
          animeTitle={animeTitle}
          season={playSeason}
          episode={playEpisode}
          backdrop={backdrop}
          onClose={() => setAnimePlayerOpen(false)}
        />
      )}
    </div>
  )
}
