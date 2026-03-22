import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import ReactPlayer from 'react-player'
import { getDetails, imgOriginal, imgW500 } from '../lib/tmdb'
import { preloadAnimePlayback } from '../lib/consumet'
import { isMovieLikeMediaType } from '../lib/embeds'
import {
  getContentProgressMap,
  getLatestProgress,
  getProgress,
  isResumableProgress,
} from '../lib/progress'
import { getAnimeById } from '../lib/anilist'
import RatingBadge from '../components/UI/RatingBadge'
import GlassBadge from '../components/UI/GlassBadge'
import MediaCard from '../components/Cards/MediaCard'
import EpisodeSelector from '../components/Player/EpisodeSelector'
import AnimePlayer from '../components/Player/AnimePlayer'
import MoviePlayer from '../components/Player/MoviePlayer'
import { addToWatchlist, isInWatchlist } from '../lib/supabase'
import {
  buildAnimeCanonicalFromAniList,
  buildAnimeEpisodesFromAniListEntry,
} from '../lib/animeMapper'

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

export default function Detail() {
  const { type, id } = useParams()
  const isMovieLike = isMovieLikeMediaType(type)
  const location = useLocation()
  const navigate = useNavigate()

  const requestedResumeAt = Math.max(0, Math.floor(Number(location.state?.resumeAt) || 0))
  const requestedResumeSeason = Number(location.state?.resumeSeason) || null
  const requestedResumeEpisode = Number(location.state?.resumeEpisode) || null

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [animePlayerOpen, setAnimePlayerOpen] = useState(false)
  const [playSeason, setPlaySeason] = useState(requestedResumeSeason || 1)
  const [playEpisode, setPlayEpisode] = useState(requestedResumeEpisode || 1)
  const [playerResumeAt, setPlayerResumeAt] = useState(requestedResumeAt)
  const [playerDurationHint, setPlayerDurationHint] = useState(0)
  const [resumeProgress, setResumeProgress] = useState(location.state?.resumeProgress || null)
  const [progressMap, setProgressMap] = useState({})
  const [inWatchlist, setInWatchlist] = useState(false)

  const [canonicalAnime, setCanonicalAnime] = useState(null)
  const [canonicalLoading, setCanonicalLoading] = useState(false)
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0)
  const [animePlayTitle, setAnimePlayTitle] = useState('')
  const [animePlayAltTitle, setAnimePlayAltTitle] = useState('')
  const [prefetchedAnimeData, setPrefetchedAnimeData] = useState(null)

  const animePrefetchRef = useRef(new Map())
  const prefetchedAnimeIdRef = useRef(null)
  const autoOpenHandledRef = useRef(false)

  const isAnime = Boolean(location.state?.isAnime)
  const animeTitle =
    location.state?.animeTitle || location.state?.animeAltTitle || data?.title || data?.name || ''
  const animeAltTitle =
    location.state?.animeAltTitle || data?.original_name || data?.original_title || ''
  const anilistId = Number(location.state?.anilistId) || null

  useEffect(() => {
    setLoading(true)
    setResumeProgress(location.state?.resumeProgress || null)
    setProgressMap({})
    setPlaySeason(requestedResumeSeason || 1)
    setPlayEpisode(requestedResumeEpisode || 1)
    setPlayerResumeAt(requestedResumeAt)
    setPlayerDurationHint(0)
    setCanonicalAnime(null)
    setCanonicalLoading(false)
    setSelectedEntryIndex(0)
    setAnimePlayTitle('')
    setAnimePlayAltTitle('')
    setPrefetchedAnimeData(null)
    autoOpenHandledRef.current = false

    getDetails(type, id)
      .then(setData)
      .finally(() => setLoading(false))

    isInWatchlist(Number(id)).then(setInWatchlist).catch(() => { })
  }, [
    id,
    location.state?.resumeAt,
    location.state?.resumeEpisode,
    location.state?.resumeProgress,
    location.state?.resumeSeason,
    requestedResumeAt,
    requestedResumeEpisode,
    requestedResumeSeason,
    type,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadProgress() {
      try {
        const [directProgress, latestProgress, nextProgressMap] = await Promise.all([
          getProgress(
            id,
            isMovieLike ? null : requestedResumeSeason,
            isMovieLike ? null : requestedResumeEpisode
          ),
          getLatestProgress(id),
          isMovieLike ? Promise.resolve({}) : getContentProgressMap(id),
        ])

        if (cancelled) return

        const preferredProgress =
          [directProgress, latestProgress, location.state?.resumeProgress].find((item) =>
            isResumableProgress(item)
          ) || null

        setProgressMap(nextProgressMap || {})
        setResumeProgress(preferredProgress)

        if (preferredProgress?.season) setPlaySeason(preferredProgress.season)
        if (preferredProgress?.episode) setPlayEpisode(preferredProgress.episode)

        if (preferredProgress?.progress_seconds) {
          setPlayerResumeAt(preferredProgress.progress_seconds)
        }
      } catch {
        if (!cancelled) {
          setProgressMap({})
          setResumeProgress(location.state?.resumeProgress || null)
        }
      }
    }

    loadProgress()

    return () => {
      cancelled = true
    }
  }, [id, isMovieLike, location.state?.resumeProgress, requestedResumeEpisode, requestedResumeSeason, type])

  useEffect(() => {
    if (!isAnime || !anilistId) return undefined

    let cancelled = false
    setCanonicalLoading(true)

    getAnimeById(anilistId)
      .then((media) => {
        if (cancelled) return

        const result = buildAnimeCanonicalFromAniList(media)
        setCanonicalAnime(result || null)

        if (result?.entries?.length) {
          const requestedSeason = Number(location.state?.resumeSeason || resumeProgress?.season || 1)

          const matchedSeasonIndex = result.entries.findIndex(
            (entry) => entry.kind === 'season' && Number(entry.seasonNumber || 0) === requestedSeason
          )

          setSelectedEntryIndex(matchedSeasonIndex >= 0 ? matchedSeasonIndex : 0)
        } else {
          setSelectedEntryIndex(0)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanonicalAnime(null)
          setSelectedEntryIndex(0)
        }
      })
      .finally(() => {
        if (!cancelled) setCanonicalLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [anilistId, isAnime, location.state?.resumeSeason, resumeProgress?.season])

  const selectedCanonicalEntry = canonicalAnime?.entries?.[selectedEntryIndex] || null

  const selectedEpisodes = useMemo(() => {
    if (selectedCanonicalEntry?.isLongRunner) {
      const providerEpisodes = Array.isArray(prefetchedAnimeData?.episodes)
        ? prefetchedAnimeData.episodes
        : []

      if (providerEpisodes.length > 0) {
        return providerEpisodes.map((episode, index) => ({
          number: Number(episode?.number || episode?.episodeNumber || index + 1),
          title: episode?.title || `Episode ${index + 1}`,
          image: selectedCanonicalEntry?.bannerImage || selectedCanonicalEntry?.image || '',
          isMainSeriesLauncher: false,
        }))
      }
    }

    return buildAnimeEpisodesFromAniListEntry(selectedCanonicalEntry)
  }, [prefetchedAnimeData, selectedCanonicalEntry])

  const playbackAnimeTitle = useMemo(() => {
    if (!isAnime) return animeTitle
    return selectedCanonicalEntry?.title || animeTitle
  }, [animeTitle, isAnime, selectedCanonicalEntry])

  useEffect(() => {
    if (!isAnime || !playbackAnimeTitle) return undefined

    let cancelled = false

    preloadAnimePlayback(playbackAnimeTitle, animeAltTitle)
      .then((payload) => {
        if (cancelled || !payload?.animeId) return
        animePrefetchRef.current.set(payload.animeId, payload)
        prefetchedAnimeIdRef.current = payload.animeId
        setPrefetchedAnimeData(payload)
      })
      .catch(() => { })

    return () => {
      cancelled = true
    }
  }, [animeAltTitle, isAnime, playbackAnimeTitle])

  const handlePlay = async (
    seasonNumber = 1,
    episodeNumber = 1,
    resumeSeconds = 0,
    durationHintSeconds = 0,
    animePlaybackTitle = '',
    animePlaybackAltTitle = ''
  ) => {
    const nextSeason = seasonNumber || 1
    const nextEpisode = episodeNumber || 1

    setPlaySeason(nextSeason)
    setPlayEpisode(nextEpisode)
    setPlayerResumeAt(Math.max(0, Math.floor(Number(resumeSeconds) || 0)))
    setPlayerDurationHint(Math.max(0, Math.floor(Number(durationHintSeconds) || 0)))

    if (isAnime) {
      setAnimePlayTitle(animePlaybackTitle || playbackAnimeTitle || animeTitle)
      setAnimePlayAltTitle(animePlaybackAltTitle || animeAltTitle || animeTitle)
      setPlayerOpen(false)
      setAnimePlayerOpen(true)
      return
    }

    setAnimePlayerOpen(false)
    setPlayerOpen(true)
  }

  useEffect(() => {
    if (!data || autoOpenHandledRef.current || !location.state?.autoOpenPlayer) return

    const fallbackProgress = location.state?.resumeProgress || resumeProgress
    const targetSeason = Number(location.state?.resumeSeason || fallbackProgress?.season || playSeason || 1)
    const targetEpisode = Number(location.state?.resumeEpisode || fallbackProgress?.episode || playEpisode || 1)
    const targetResumeAt = Math.max(
      0,
      Math.floor(Number(location.state?.resumeAt || fallbackProgress?.progress_seconds || playerResumeAt || 0))
    )
    const targetDurationHint = Math.max(
      0,
      Math.floor(Number(data.runtime || data.episode_run_time?.[0] || 0) * 60)
    )

    autoOpenHandledRef.current = true
    handlePlay(targetSeason, targetEpisode, targetResumeAt, targetDurationHint)
  }, [
    data,
    location.state?.autoOpenPlayer,
    location.state?.resumeAt,
    location.state?.resumeEpisode,
    location.state?.resumeProgress,
    location.state?.resumeSeason,
    playEpisode,
    playSeason,
    playerResumeAt,
    resumeProgress,
  ])

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

  const title = data.title || data.name || ''
  const backdrop = imgOriginal(data.backdrop_path)
  const poster = imgW500(data.poster_path)
  const trailer = data.videos?.results?.find(
    (video) => video.type === 'Trailer' && video.site === 'YouTube'
  )
  const cast = data.credits?.cast?.slice(0, 16) || []
  const similar = data.similar?.results?.slice(0, 12) || []
  const genres = data.genres || []
  const numSeasons = data.number_of_seasons || 0
  const year = (data.release_date || data.first_air_date || '').slice(0, 4)
  const showResumeButton = isResumableProgress(resumeProgress)
  const defaultDurationHint = Math.max(
    0,
    Math.floor(Number(data.runtime || data.episode_run_time?.[0] || 0) * 60)
  )
  const resumeLabel = isMovieLike
    ? `Resume ${formatTime(resumeProgress?.progress_seconds || 0)}`
    : `Resume S${resumeProgress?.season || playSeason || 1} E${resumeProgress?.episode || playEpisode || 1}`
  const primaryLabel = showResumeButton ? resumeLabel : 'Stream Now'

  const getAnimeCardImage = (entry, episode = null) => {
    return (
      episode?.image ||
      entry?.bannerImage ||
      entry?.image ||
      backdrop ||
      poster ||
      ''
    )
  }
  const isMainSeriesLauncher = () => false

  const handleWatchlist = async () => {
    await addToWatchlist({
      tmdb_id: data.id,
      media_type: type,
      title,
      poster_path: data.poster_path,
    })
    setInWatchlist(true)
  }

  return (
    <div>
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
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 70%)' }}
        />

        {/* Back button */}
        <motion.button
          onClick={() => navigate(-1)}
          className="absolute flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium cursor-pointer"
          style={{
            top: 76,
            left: 20,
            zIndex: 20,
            background: 'rgba(10,10,16,0.65)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.85)',
          }}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          whileHover={{
            background: 'rgba(10,10,16,0.88)',
            borderColor: 'var(--border-hover)',
            boxShadow: '0 0 16px var(--accent-glow)',
            color: '#fff',
          }}
          whileTap={{ scale: 0.96 }}
        >
          <ChevronLeft size={15} strokeWidth={2} />
          Back
        </motion.button>
      </div>

      <div className="relative z-10 w-full" style={{ marginTop: -120, padding: '0 64px 64px 64px' }}>
        <div className="grid grid-cols-[280px_1fr] items-start" style={{ gap: 48 }}>
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
                <span className="text-5xl opacity-40">M</span>
              </div>
            )}
          </motion.div>

          <motion.div
            className="pt-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
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

            {genres.length > 0 && (
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                {genres.map((genre) => (
                  <GlassBadge key={genre.id}>{genre.name}</GlassBadge>
                ))}
              </div>
            )}

            <p
              style={{ color: 'var(--text-secondary)', maxWidth: 680, fontSize: 16, lineHeight: 1.7 }}
              className="mb-8"
            >
              {data.overview}
            </p>

            <div className="flex gap-4 flex-wrap" style={{ marginTop: 32 }}>
              <motion.button
                onClick={() =>
                  handlePlay(
                    isMovieLike ? 1 : showResumeButton ? resumeProgress?.season || playSeason || 1 : playSeason,
                    isMovieLike ? 1 : showResumeButton ? resumeProgress?.episode || playEpisode || 1 : playEpisode,
                    showResumeButton ? resumeProgress?.progress_seconds || playerResumeAt || 0 : 0,
                    defaultDurationHint
                  )
                }
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
                {primaryLabel}
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
                whileHover={{
                  scale: 1.02,
                  borderColor: 'var(--accent)',
                  boxShadow: '0 0 20px var(--accent-glow)',
                }}
                whileTap={{ scale: 0.98 }}
              >
                {inWatchlist ? 'In Watchlist' : '+ Watchlist'}
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="space-y-14" style={{ padding: '48px 64px' }}>
        {cast.length > 0 && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              Cast
            </h3>
            <div className="flex gap-5 overflow-x-auto hide-scrollbar pb-3">
              {cast.map((person) => (
                <div key={person.id} className="flex flex-col items-center flex-shrink-0 w-24 group">
                  <div
                    className="w-20 h-20 rounded-full overflow-hidden mb-2 transition-all duration-200 group-hover:ring-2 group-hover:ring-[var(--accent)] group-hover:scale-105"
                    style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--card-shadow)' }}
                  >
                    {person.profile_path ? (
                      <img src={imgW500(person.profile_path)} alt={person.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl opacity-40">P</div>
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

        {trailer && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              Trailer
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

        {isAnime && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              Episodes
            </h3>

            {canonicalLoading ? (
              <div className="flex justify-center py-8">
                <div
                  className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
                />
              </div>
            ) : canonicalAnime?.entries?.length ? (
              <div>
                <div className="flex gap-2 mb-5 flex-wrap">
                  {canonicalAnime.entries.map((entry, index) => {
                    const active = index === selectedEntryIndex
                    return (
                      <button
                        key={`${entry.kind}-${entry.id}-${index}`}
                        onClick={() => {
                          setSelectedEntryIndex(index)
                          setPlaySeason(Number(entry.seasonNumber || 1))
                          setPlayEpisode(1)
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
                        style={{
                          background: active ? 'var(--accent)' : 'var(--bg-surface)',
                          color: active ? '#fff' : 'var(--text-secondary)',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          boxShadow: active ? '0 0 16px var(--accent-glow)' : 'none',
                        }}
                      >
                        {entry.label}
                      </button>
                    )
                  })}
                </div>

                {selectedEpisodes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {selectedEpisodes.map((episode, index) => {
                      const entrySeason = Number(selectedCanonicalEntry?.seasonNumber || 1)
                      const episodeNumber = Number(episode.number || index + 1)
                      const isCurrentEpisode =
                        Number(playSeason) === entrySeason && Number(playEpisode) === episodeNumber

                      return (
                        <motion.div
                          key={`${selectedCanonicalEntry?.id}-${episodeNumber}`}
                          className="rounded-xl overflow-hidden cursor-pointer group"
                          style={{
                            background: 'var(--bg-surface)',
                            border: isCurrentEpisode ? '1px solid var(--accent)' : '1px solid var(--border)',
                            boxShadow: isCurrentEpisode
                              ? '0 0 24px var(--accent-glow), var(--card-shadow)'
                              : 'var(--card-shadow)',
                          }}
                          whileHover={{
                            y: -3,
                            borderColor: 'var(--border-hover)',
                            boxShadow: '0 0 20px var(--accent-glow), 0 12px 40px rgba(0,0,0,0.3)',
                          }}
                          onClick={() =>
                            handlePlay(
                              entrySeason,
                              isMainSeriesLauncher(episode) ? 1 : episodeNumber,
                              0,
                              defaultDurationHint,
                              selectedCanonicalEntry?.title || playbackAnimeTitle || animeTitle,
                              animeAltTitle || animeTitle
                            )
                          }
                        >
                          <div className="relative h-28 overflow-hidden">
                            {getAnimeCardImage(selectedCanonicalEntry, episode) ? (
                              <img
                                src={getAnimeCardImage(selectedCanonicalEntry, episode)}
                                alt={episode.title || `Episode ${episodeNumber}`}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                            ) : (
                              <div
                                className="w-full h-full flex items-center justify-center"
                                style={{ background: 'var(--bg-elevated)' }}
                              >
                                <span className="text-2xl opacity-40">TV</span>
                              </div>
                            )}

                            <div
                              className="absolute inset-0"
                              style={{
                                background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.15), transparent)',
                              }}
                            />

                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                              <div
                                className="w-11 h-11 rounded-full flex items-center justify-center"
                                style={{ background: 'var(--accent)', boxShadow: '0 0 20px var(--accent-glow-strong)' }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                  <polygon points="6 3 20 12 6 21 6 3" />
                                </svg>
                              </div>
                            </div>
                          </div>

                          <div className="p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>
                                E{episodeNumber}
                              </span>
                              <span
                                className="text-xs truncate font-medium"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {isMainSeriesLauncher(episode) ? 'Open Main Series' : (episode.title || `Episode ${episodeNumber}`)}
                              </span>
                            </div>

                            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                              {isMainSeriesLauncher(episode)
                                ? 'Long-running series'
                                : selectedCanonicalEntry?.kind === 'season'
                                  ? `Season ${entrySeason}`
                                  : selectedCanonicalEntry?.label || 'Anime'}
                            </span>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                ) : (
                  <div
                    className="rounded-2xl p-5"
                    style={{
                      border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Anime season data could not be loaded.
                  </div>
                )}
              </div>
            ) : (
              <div
                className="rounded-2xl p-5"
                style={{
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-secondary)',
                }}
              >
                Anime season data could not be loaded.
              </div>
            )}
          </section>
        )}

        {!isAnime && type === 'tv' && numSeasons > 0 && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              Episodes
            </h3>
            <EpisodeSelector
              seriesId={data.id}
              numSeasons={numSeasons}
              currentSeason={playSeason}
              currentEpisode={playEpisode}
              progressMap={progressMap}
              onPlay={(seasonNumber, episodeNumber, runtime) =>
                handlePlay(
                  seasonNumber,
                  episodeNumber,
                  0,
                  Math.max(0, Math.floor(Number(runtime || data.episode_run_time?.[0] || 0) * 60))
                )
              }
            />
          </section>
        )}

        {similar.length > 0 && (
          <section>
            <h3 className="font-display font-semibold text-xl mb-5" style={{ color: 'var(--text-primary)' }}>
              More Like This
            </h3>
            <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-3">
              {similar.map((item) => (
                <MediaCard key={item.id} item={item} type={type} />
              ))}
            </div>
          </section>
        )}
      </div>

      {!isAnime &&
        (playerOpen ? (
          <MoviePlayer
            tmdbId={data.id}
            imdbId={data.imdb_id || null}
            title={title}
            poster={poster}
            backdrop={backdrop}
            contentType={type === 'tv' ? 'series' : type}
            season={playSeason}
            episode={playEpisode}
            resumeAt={playerResumeAt}
            onClose={() => setPlayerOpen(false)}
          />
        ) : null)}

      {isAnime && animePlayerOpen && (
        <AnimePlayer
          animeTitle={animePlayTitle || playbackAnimeTitle || animeTitle}
          animeAltTitle={animePlayAltTitle || animeAltTitle}
          contentId={data.id}
          season={playSeason}
          episode={playEpisode}
          poster={poster}
          backdrop={backdrop}
          resumeAt={playerResumeAt}
          prefetchedAnime={animePrefetchRef.current.get(prefetchedAnimeIdRef.current) || null}
          onClose={() => setAnimePlayerOpen(false)}
        />
      )}
    </div>
  )
}