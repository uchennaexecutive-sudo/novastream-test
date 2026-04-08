import { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, WifiOff } from 'lucide-react'
import ReactPlayer from 'react-player'
import { getDetails, imgOriginal, imgW500 } from '../lib/tmdb'
import { preloadAnimePlayback } from '../lib/consumet'
import { isMovieLikeMediaType } from '../lib/embeds'
import {
  getContentProgressMap,
  getEpisodeProgressKey,
  getLatestProgress,
  getProgress,
  isResumableProgress,
} from '../lib/progress'
import { getAnimeById } from '../lib/anilist'
import DownloadButton from '../components/Downloads/DownloadButton'
import OfflineBadge from '../components/Downloads/OfflineBadge'
import QualityPickerSheet from '../components/Downloads/QualityPickerSheet'
import SeasonDownloadSheet from '../components/Downloads/SeasonDownloadSheet'
import RatingBadge from '../components/UI/RatingBadge'
import GlassBadge from '../components/UI/GlassBadge'
import MediaCard from '../components/Cards/MediaCard'
import EpisodeSelector from '../components/Player/EpisodeSelector'
import useAppStore, { getReducedEffectsMode } from '../store/useAppStore'
import { addToWatchlist, isInWatchlist } from '../lib/supabase'
import {
  buildAnimeCanonicalFromAniList,
  buildAnimeEpisodesFromAniListEntry,
  resolveAnimeCanonicalRoot,
} from '../lib/animeMapper'
import { searchAnime as searchAniListAnime } from '../lib/anilist'
import { prepareAnimeDownloadRuntimeData, clearAnimeDownloadCache } from '../lib/animeDownloads'
import useDownloadStore, { getDownloadItemByIdentity } from '../store/useDownloadStore'
import { pauseVideoDownload, startVideoDownload } from '../lib/videoDownloads'

const AnimePlayer = lazy(() => import('../components/Player/AnimePlayer'))
const MoviePlayer = lazy(() => import('../components/Player/MoviePlayer'))

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

const DETAIL_REQUEST_TIMEOUT_MS = 15000
const EPISODE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function withTimeout(promise, timeoutMs, message) {
  let timer = null

  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timer)
  })
}

function parseEpisodeDate(dateValue) {
  if (!dateValue) return null

  const parsed = new Date(`${String(dateValue).trim()}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isFutureEpisodeDate(dateValue) {
  const parsed = parseEpisodeDate(dateValue)
  if (!parsed) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return parsed.getTime() > today.getTime()
}

function formatEpisodeDate(dateValue) {
  const parsed = parseEpisodeDate(dateValue)
  if (!parsed) return ''
  return EPISODE_DATE_FORMATTER.format(parsed)
}

function getAnimeEpisodeAvailabilityLabel(episode) {
  if (episode?.isReleased !== false) return ''
  if (episode?.airingAt) {
    const parsed = new Date(Number(episode.airingAt) * 1000)
    if (!Number.isNaN(parsed.getTime())) {
      return `Airs ${EPISODE_DATE_FORMATTER.format(parsed)}`
    }
  }
  return 'Not released yet'
}

const normalizeAnimeFranchiseKey = (value) =>
  String(value || '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b.*$/i, '')
    .replace(/\bseason\s+\d+\b.*$/i, '')
    .replace(/\bfinal\s+season\b.*$/i, '')
    .replace(/\bpart\s+\d+\b.*$/i, '')
    .replace(/\bcour\s+\d+\b.*$/i, '')
    .replace(/\s*[:\-–]\s*$/, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const hasExplicitSeasonTitleMarker = (item) => {
  const titles = [
    item?.title?.english,
    item?.title?.romaji,
    item?.title?.native,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())

  return titles.some((title) => (
    /\bseason\s+[2-9]\d*\b/.test(title)
    || /\b[2-9]\d*(st|nd|rd|th)\s+season\b/.test(title)
    || /\bfinal\s+season\b/.test(title)
  ))
}

function mergeSupplementalAnimeSeasons(canonical, candidates = []) {
  if (!canonical) return canonical

  const existingEntries = Array.isArray(canonical.entries) ? canonical.entries : []
  const existingSeasonIds = new Set(
    existingEntries
      .filter((entry) => entry?.kind === 'season')
      .map((entry) => Number(entry.id || 0))
      .filter(Boolean)
  )

  const supplementalSeasons = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => !existingSeasonIds.has(Number(candidate?.id || 0)))
    .map((candidate) => ({
      id: candidate.id,
      kind: 'season',
      title: candidate?.title?.english || candidate?.title?.romaji || candidate?.title?.native || 'Untitled',
      label: '',
      seasonNumber: 0,
      episodesCount: Math.max(
        1,
        Number(candidate?.episodes || 0),
        Number(candidate?.nextAiringEpisode?.episode || 1) - 1,
      ),
      totalEpisodes: Math.max(
        1,
        Number(candidate?.episodes || 0),
        Number(candidate?.nextAiringEpisode?.episode || 1) - 1,
      ),
      releasedEpisodes: Math.max(
        0,
        Number(candidate?.nextAiringEpisode?.episode || 0) > 0
          ? Number(candidate?.nextAiringEpisode?.episode || 0) - 1
          : String(candidate?.status || '').toUpperCase() === 'FINISHED'
            ? Number(candidate?.episodes || 0)
            : 0,
      ),
      releaseStatus: String(candidate?.status || '').toUpperCase(),
      nextAiringEpisodeNumber: Number(candidate?.nextAiringEpisode?.episode || 0),
      nextAiringAt: Number(candidate?.nextAiringEpisode?.airingAt || 0),
      image: candidate?.coverImage?.extraLarge || candidate?.coverImage?.large || '',
      bannerImage: candidate?.bannerImage || '',
      year: candidate?.seasonYear || candidate?.startDate?.year || 0,
      isLongRunner: false,
    }))

  if (!supplementalSeasons.length) {
    return canonical
  }

  const combinedSeasons = [
    ...existingEntries.filter((entry) => entry?.kind === 'season'),
    ...supplementalSeasons,
  ]
    .sort((a, b) => {
      const yearDiff = Number(a?.year || 0) - Number(b?.year || 0)
      if (yearDiff !== 0) return yearDiff
      return Number(a?.id || 0) - Number(b?.id || 0)
    })
    .map((entry, index) => ({
      ...entry,
      seasonNumber: index + 1,
      label: `Season ${index + 1}`,
    }))

  return {
    ...canonical,
    entries: [
      ...combinedSeasons,
      ...existingEntries.filter((entry) => entry?.kind !== 'season'),
    ],
  }
}

export default function Detail() {
  const { type, id } = useParams()
  const isMovieLike = isMovieLikeMediaType(type)
  const location = useLocation()
  const navigate = useNavigate()
  const reducedEffectsMode = useAppStore(getReducedEffectsMode)

  const requestedResumeAt = Math.max(0, Math.floor(Number(location.state?.resumeAt) || 0))
  const requestedResumeSeason = Number(location.state?.resumeSeason) || null
  const requestedResumeEpisode = Number(location.state?.resumeEpisode) || null

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailError, setDetailError] = useState('')
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [animePlayerOpen, setAnimePlayerOpen] = useState(false)
  const [playSeason, setPlaySeason] = useState(requestedResumeSeason || 1)
  const [playEpisode, setPlayEpisode] = useState(requestedResumeEpisode || 1)
  const [playerResumeAt, setPlayerResumeAt] = useState(requestedResumeAt)
  const [playerDurationHint, setPlayerDurationHint] = useState(0)
  const [offlinePlaybackRequest, setOfflinePlaybackRequest] = useState(null)
  const [resumeProgress, setResumeProgress] = useState(location.state?.resumeProgress || null)
  const [progressMap, setProgressMap] = useState({})
  const [inWatchlist, setInWatchlist] = useState(false)
  const downloadItems = useDownloadStore((state) => state.items)
  const preferredDownloadQuality = useDownloadStore((state) => state.preferredQuality)
  const setPreferredDownloadQuality = useDownloadStore((state) => state.setPreferredQuality)
  const enqueueDownload = useDownloadStore((state) => state.enqueueDownload)
  const enqueueSeasonDownloads = useDownloadStore((state) => state.enqueueSeasonDownloads)
  const pauseDownload = useDownloadStore((state) => state.pauseDownload)
  const resumeDownload = useDownloadStore((state) => state.resumeDownload)

  // ── Download UI state (Phase A shell — wired to backend in Phase B/C) ──────
  // Phase B: replace with useDownloadStore selectors
  const [qualitySheetOpen, setQualitySheetOpen] = useState(false)
  const [seasonDownloadSheetOpen, setSeasonDownloadSheetOpen] = useState(false)
  const [pendingDownloadTarget, setPendingDownloadTarget] = useState(null)
  const [seasonDownloadContext, setSeasonDownloadContext] = useState(null)

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
  const canonicalAnilistId = Number(location.state?.canonicalAnilistId) || null

  useEffect(() => {
    setLoading(true)
    setDetailError('')
    setResumeProgress(location.state?.resumeProgress || null)
    setProgressMap({})
    setPlaySeason(requestedResumeSeason || 1)
    setPlayEpisode(requestedResumeEpisode || 1)
    setPlayerResumeAt(requestedResumeAt)
    setPlayerDurationHint(0)
    setOfflinePlaybackRequest(null)
    setCanonicalAnime(null)
    setCanonicalLoading(false)
    setSelectedEntryIndex(0)
    setAnimePlayTitle('')
    setAnimePlayAltTitle('')
    setPrefetchedAnimeData(null)
    autoOpenHandledRef.current = false

    withTimeout(
      getDetails(type, id),
      DETAIL_REQUEST_TIMEOUT_MS,
      'This title took too long to load. Please try again.'
    )
      .then(setData)
      .catch((error) => {
        console.warn('[detail] failed to load details', error)
        setData(null)
        setDetailError(error?.message || 'Could not load this title.')
      })
      .finally(() => setLoading(false))

    isInWatchlist(Number(id)).then(setInWatchlist).catch(() => { })
  }, [
    detailReloadKey,
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

  const applyProgressState = useCallback((progress, nextProgressMap = null) => {
    const nextResumeProgress = isResumableProgress(progress) ? progress : null

    if (nextProgressMap !== null) {
      setProgressMap(nextProgressMap || {})
    }

    setResumeProgress(nextResumeProgress)

    if (!isMovieLike) {
      const nextSeason = Number(progress?.season) || null
      const nextEpisode = Number(progress?.episode) || null

      if (nextSeason) setPlaySeason(nextSeason)
      if (nextEpisode) setPlayEpisode(nextEpisode)
    }

    setPlayerResumeAt(
      Math.max(0, Math.floor(Number(nextResumeProgress?.progress_seconds || 0)))
    )
  }, [isMovieLike])

  const loadProgressState = useCallback(async (overrideProgress = null) => {
    const hasExplicitRequestedEpisode = (
      !isMovieLike
      && Number.isInteger(requestedResumeSeason)
      && requestedResumeSeason > 0
      && Number.isInteger(requestedResumeEpisode)
      && requestedResumeEpisode > 0
    )

    const [directProgress, latestProgress, nextProgressMap] = await Promise.all([
      hasExplicitRequestedEpisode
        ? getProgress(id, requestedResumeSeason, requestedResumeEpisode)
        : Promise.resolve(null),
      getLatestProgress(id),
      isMovieLike ? Promise.resolve({}) : getContentProgressMap(id),
    ])

    const preferredProgress = overrideProgress !== null
      ? overrideProgress
      : [
        location.state?.resumeProgress,
        directProgress,
        latestProgress,
      ].find(isResumableProgress) || [
        location.state?.resumeProgress,
        directProgress,
        latestProgress,
      ].find(Boolean) || null

    applyProgressState(preferredProgress, nextProgressMap || {})
    return preferredProgress
  }, [
    applyProgressState,
    id,
    isMovieLike,
    location.state?.resumeProgress,
    requestedResumeEpisode,
    requestedResumeSeason,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadProgress() {
      try {
        await loadProgressState()
        if (cancelled) return
      } catch {
        if (!cancelled) {
          applyProgressState(location.state?.resumeProgress || null, {})
        }
      }
    }

    loadProgress()

    return () => {
      cancelled = true
    }
  }, [applyProgressState, id, loadProgressState, location.state?.resumeProgress, requestedResumeEpisode, requestedResumeSeason, type])

  const normalizePlayerCloseProgress = useCallback((payload) => {
    if (!payload) return null

    const progressSeconds = Math.max(
      0,
      Math.floor(Number(payload.progressSeconds ?? payload.progress_seconds) || 0)
    )
    const durationSeconds = Math.max(
      0,
      Math.floor(Number(payload.durationSeconds ?? payload.duration_seconds) || 0)
    )

    return {
      content_id: String(id),
      content_type: isAnime ? 'anime' : isMovieLike ? type : 'tv',
      season: isMovieLike ? null : (Number(payload.season) || null),
      episode: isMovieLike ? null : (Number(payload.episode) || null),
      progress_seconds: progressSeconds,
      duration_seconds: durationSeconds,
      updated_at: new Date().toISOString(),
    }
  }, [id, isAnime, isMovieLike, type])

  const handleMoviePlayerClose = useCallback((payload = null) => {
    setPlayerOpen(false)
    setOfflinePlaybackRequest(null)

    const normalizedProgress = normalizePlayerCloseProgress(payload)
    if (normalizedProgress) {
      applyProgressState(normalizedProgress)
    }

    void loadProgressState(normalizedProgress)
  }, [applyProgressState, loadProgressState, normalizePlayerCloseProgress])

  const handleAnimePlayerClose = useCallback((payload = null) => {
    setAnimePlayerOpen(false)
    setOfflinePlaybackRequest(null)

    const normalizedProgress = normalizePlayerCloseProgress(payload)
    if (normalizedProgress) {
      applyProgressState(normalizedProgress)
    }

    void loadProgressState(normalizedProgress)
  }, [applyProgressState, loadProgressState, normalizePlayerCloseProgress])

  useEffect(() => {
    const animeIdentityId = canonicalAnilistId || anilistId
    if (!isAnime || !animeIdentityId) return undefined

    let cancelled = false
    setCanonicalLoading(true)

    getAnimeById(animeIdentityId)
      .then(async (media) => {
        if (cancelled) return

        const canonicalRoot = resolveAnimeCanonicalRoot(media) || media
        let rootMedia = media

        if (canonicalRoot?.id && canonicalRoot.id !== media.id) {
          rootMedia = await getAnimeById(canonicalRoot.id) || canonicalRoot
          if (cancelled) return
        }

        const result = buildAnimeCanonicalFromAniList(rootMedia)
        const rootTitle =
          rootMedia?.title?.english || rootMedia?.title?.romaji || rootMedia?.title?.native || ''
        const rootKey = normalizeAnimeFranchiseKey(rootTitle)
        const supplementalCandidates = rootKey
          ? await searchAniListAnime(rootTitle)
              .then((items) => (Array.isArray(items) ? items : []))
              .catch(() => [])
          : []

        const supplementalSeasonCandidates = supplementalCandidates.filter((candidate) => {
          const candidateKey = normalizeAnimeFranchiseKey(
            candidate?.title?.english || candidate?.title?.romaji || candidate?.title?.native || ''
          )
          const format = String(candidate?.format || '').toUpperCase()
          const status = String(candidate?.status || '').toUpperCase()

          if (!candidateKey || candidateKey !== rootKey) return false
          if (status === 'NOT_YET_RELEASED') return false

          if (format === 'TV' || format === 'TV_SHORT') {
            return true
          }

          return format === 'ONA' && hasExplicitSeasonTitleMarker(candidate)
        })

        const mergedResult = mergeSupplementalAnimeSeasons(result, supplementalSeasonCandidates)
        setCanonicalAnime(mergedResult || null)

        if (mergedResult?.entries?.length) {
          const requestedSeason = Number(location.state?.resumeSeason || resumeProgress?.season || 1)

          const matchedSeasonIndex = mergedResult.entries.findIndex(
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
  }, [anilistId, canonicalAnilistId, isAnime, location.state?.resumeSeason, resumeProgress?.season])

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

  const releasedSelectedEpisodes = useMemo(
    () => selectedEpisodes.filter((episode) => episode?.isReleased !== false),
    [selectedEpisodes]
  )

  const playbackAnimeTitle = useMemo(() => {
    if (!isAnime) return animeTitle
    return selectedCanonicalEntry?.title || animeTitle
  }, [animeTitle, isAnime, selectedCanonicalEntry])

  const detailTitle = data?.title || data?.name || ''

  const animeDownloadSearchTitles = useMemo(() => {
    if (!isAnime) return []

    return [...new Set([
      selectedCanonicalEntry?.title,
      playbackAnimeTitle,
      animeTitle,
      animeAltTitle,
      detailTitle,
    ].map((value) => String(value || '').trim()).filter(Boolean))]
  }, [
    animeAltTitle,
    animeTitle,
    detailTitle,
    isAnime,
    playbackAnimeTitle,
    selectedCanonicalEntry,
  ])

  useEffect(() => {
    if (!isAnime || !playbackAnimeTitle) return undefined
    if (prefetchedAnimeData?.animeId) return undefined

    let cancelled = false
    const timer = window.setTimeout(() => {
      preloadAnimePlayback(...animeDownloadSearchTitles)
        .then((payload) => {
          if (cancelled || !payload?.animeId) return
          animePrefetchRef.current.set(payload.animeId, payload)
          prefetchedAnimeIdRef.current = payload.animeId
          setPrefetchedAnimeData(payload)
        })
        .catch(() => { })
    }, 500)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [animeDownloadSearchTitles, isAnime, playbackAnimeTitle, prefetchedAnimeData?.animeId])

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

    setOfflinePlaybackRequest(null)
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

  const openOfflinePlayback = useCallback((downloadItem, options = {}) => {
    if (!downloadItem?.filePath) return

    const nextSeason = Number(options.season ?? downloadItem.season ?? playSeason ?? 1) || 1
    const nextEpisode = Number(options.episode ?? downloadItem.episode ?? playEpisode ?? 1) || 1
    const targetResumeProgress = (
      isMovieLike
        ? resumeProgress
        : (
          Number(resumeProgress?.season) === nextSeason
          && Number(resumeProgress?.episode) === nextEpisode
        )
          ? resumeProgress
          : null
    )

    setPlaySeason(nextSeason)
    setPlayEpisode(nextEpisode)
    setPlayerResumeAt(Math.max(0, Math.floor(Number(targetResumeProgress?.progress_seconds || 0))))
    setOfflinePlaybackRequest({
      filePath: downloadItem.filePath,
      subtitleFilePath: downloadItem.subtitleFilePath || null,
      subtitleLabel: downloadItem.subtitleFilePath ? 'English' : null,
    })

    if (isAnime) {
      setAnimePlayTitle(options.animePlaybackTitle || playbackAnimeTitle || animeTitle)
      setAnimePlayAltTitle(options.animePlaybackAltTitle || animeAltTitle || animeTitle)
      setPlayerOpen(false)
      setAnimePlayerOpen(true)
      return
    }

    setAnimePlayerOpen(false)
    setPlayerOpen(true)
  }, [
    animeAltTitle,
    animeTitle,
    isAnime,
    isMovieLike,
    playEpisode,
    playSeason,
    playbackAnimeTitle,
    resumeProgress,
  ])

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
    if (location.state?.offlinePlayback?.filePath) {
      openOfflinePlayback({
        filePath: location.state.offlinePlayback.filePath,
        subtitleFilePath: location.state.offlinePlayback.subtitleFilePath || null,
      }, {
        season: targetSeason,
        episode: targetEpisode,
        animePlaybackTitle: playbackAnimeTitle || animeTitle,
        animePlaybackAltTitle: animeAltTitle || animeTitle,
      })
      return
    }
    handlePlay(targetSeason, targetEpisode, targetResumeAt, targetDurationHint)
  }, [
    data,
    animeAltTitle,
    animeTitle,
    openOfflinePlayback,
    location.state?.autoOpenPlayer,
    location.state?.offlinePlayback?.filePath,
    location.state?.offlinePlayback?.subtitleFilePath,
    location.state?.resumeAt,
    location.state?.resumeEpisode,
    location.state?.resumeProgress,
    location.state?.resumeSeason,
    playEpisode,
    playSeason,
    playbackAnimeTitle,
    playerResumeAt,
    resumeProgress,
  ])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div
          className="max-w-md w-full rounded-2xl p-6 text-center"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <h2
            className="font-display font-semibold text-xl mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Could not load this title
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            {detailError || 'Something went wrong while loading this page.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Go Back
            </button>
            <button
              onClick={() => setDetailReloadKey((value) => value + 1)}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                boxShadow: '0 0 18px var(--accent-glow)',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title = detailTitle
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
  const detailDownloadContentType = isAnime ? 'anime' : type
  const currentDownloadItem = getDownloadItemByIdentity(downloadItems, {
    contentId: data.id,
    contentType: detailDownloadContentType,
    season: isMovieLike ? null : playSeason,
    episode: isMovieLike ? null : playEpisode,
  })
  const currentDownloadStatus = currentDownloadItem?.status === 'failed'
    ? 'default'
    : (currentDownloadItem?.status || 'default')
  const currentDownloadProgress = currentDownloadStatus === 'default'
    ? 0
    : Number(currentDownloadItem?.progress || 0)
  const canPlayOffline = Boolean(
    currentDownloadItem?.status === 'completed' && currentDownloadItem?.filePath
  )

  const seriesDownloadStatusMap = (() => {
    const nextMap = {}

    for (const item of downloadItems) {
      if (String(item?.contentId || '') !== String(data.id)) continue
      if (item?.contentType !== 'tv') continue
      if (!item?.season || !item?.episode) continue

      nextMap[getEpisodeProgressKey(item.season, item.episode)] = {
        id: item.id,
        status: item.status === 'failed' ? 'default' : (item.status || 'default'),
        progress: item.status === 'failed' ? 0 : Number(item.progress || 0),
      }
    }

    return nextMap
  })()

  const animeDownloadStatusMap = (() => {
    const nextMap = {}

    for (const item of downloadItems) {
      if (String(item?.contentId || '') !== String(data.id)) continue
      if (item?.contentType !== 'anime') continue
      if (!item?.season || !item?.episode) continue

      nextMap[getEpisodeProgressKey(item.season, item.episode)] = {
        id: item.id,
        status: item.status === 'failed' ? 'default' : (item.status || 'default'),
        progress: item.status === 'failed' ? 0 : Number(item.progress || 0),
      }
    }

    return nextMap
  })()

  const buildDownloadTarget = ({
    contentType = detailDownloadContentType,
    season = null,
    episode = null,
    episodeTitle = null,
  } = {}) => ({
    contentId: String(data.id),
    contentType,
    title: contentType === 'anime'
      ? (selectedCanonicalEntry?.title || playbackAnimeTitle || animeTitle || title)
      : title,
    animeAltTitle: contentType === 'anime' ? (animeAltTitle || animeTitle || playbackAnimeTitle || title) : null,
    animeSearchTitles: contentType === 'anime' ? animeDownloadSearchTitles : [],
    anilistId: contentType === 'anime' ? anilistId : null,
    canonicalAnilistId: contentType === 'anime' ? canonicalAnilistId : null,
    detailMediaType: contentType === 'anime' ? type : null,
    providerAnimeId: contentType === 'anime' ? prefetchedAnimeData?.animeId || null : null,
    providerMatchedTitle: contentType === 'anime' ? prefetchedAnimeData?.matchedTitle || null : null,
    providerId: contentType === 'anime' ? prefetchedAnimeData?.providerId || null : null,
    poster,
    season,
    episode,
    episodeTitle,
  })

  const startBackendDownloadForItem = async (item) => {
    if (!item?.id) return

    try {
      let preparedItem = item

      if (item.contentType === 'anime') {
        clearAnimeDownloadCache()
        preparedItem = await prepareAnimeDownloadRuntimeData(item, {
          fallbackAltTitle: animeAltTitle || '',
        })

        useDownloadStore.getState().updateDownload(item.id, {
          animeAltTitle: preparedItem.animeAltTitle || animeAltTitle || '',
          providerId: preparedItem.providerId || item.providerId || null,
          streamUrl: preparedItem.streamUrl,
          streamType: preparedItem.streamType,
          headers: preparedItem.headers || {},
          subtitleUrl: preparedItem.subtitleUrl || item.subtitleUrl || null,
          resolvedQuality: preparedItem.qualityLabel || item.resolvedQuality || null,
        })
      }

      await startVideoDownload({
        id: item.id,
        contentId: String(preparedItem.contentId),
        contentType: preparedItem.contentType,
        title: preparedItem.title,
        poster: preparedItem.poster || null,
        season: preparedItem.season ?? null,
        episode: preparedItem.episode ?? null,
        episodeTitle: preparedItem.episodeTitle || null,
        quality: preparedItem.quality || 'high',
        imdbId: data?.imdb_id || null,
        streamUrl: preparedItem.streamUrl || null,
        streamType: preparedItem.streamType || null,
        headers: preparedItem.headers || {},
        subtitleUrl: preparedItem.subtitleUrl || null,
        totalBytes: preparedItem.totalBytes || null,
      })
    } catch (error) {
      console.warn('[downloads] start failed', error)
      useDownloadStore.getState().updateDownload(item.id, {
        status: 'failed',
        speedBytesPerSec: 0,
        errorMessage: error?.message || 'Download failed to start',
      })
    }
  }

  const queueTargetDownload = (target, quality) => {
    enqueueDownload({
      ...target,
      quality,
    })

    const queuedItem = getDownloadItemByIdentity(useDownloadStore.getState().items, target)
    if (queuedItem) {
      void startBackendDownloadForItem(queuedItem)
    }
  }

  const requestDownloadForTarget = (target) => {
    const existing = getDownloadItemByIdentity(downloadItems, target)

    if (existing?.status === 'paused') {
      resumeDownload(existing.id)
      void startBackendDownloadForItem({
        ...existing,
        status: 'queued',
      })
      return
    }

    if (!existing || existing.status === 'default' || existing.status === 'failed') {
      setPendingDownloadTarget(target)
      setQualitySheetOpen(true)
    }
  }

  const pauseDownloadForTarget = (target) => {
    const existing = getDownloadItemByIdentity(downloadItems, target)
    if (existing?.id) {
      pauseDownload(existing.id)
      void pauseVideoDownload(existing.id).catch((error) => {
        console.warn('[downloads] pause failed', error)
      })
    }
  }

  const openSeasonDownloadSheet = ({
    contentType,
    seasonNumber,
    episodes,
  }) => {
    const normalizedEpisodes = (Array.isArray(episodes) ? episodes : [])
      .map((episodeEntry, index) => ({
        episode: Number(episodeEntry?.episode ?? episodeEntry?.episodeNumber ?? index + 1),
        episodeTitle: episodeEntry?.episodeTitle ?? episodeEntry?.title ?? null,
        isReleased: episodeEntry?.isReleased !== false,
      }))
      .filter((episodeEntry) => (
        Number.isInteger(episodeEntry.episode)
        && episodeEntry.episode > 0
        && episodeEntry.isReleased !== false
      ))

    const unwatchedEpisodes = normalizedEpisodes.filter((episodeEntry) => (
      !progressMap[getEpisodeProgressKey(seasonNumber, episodeEntry.episode)]
    )).length

    setSeasonDownloadContext({
      contentType,
      seasonNumber,
      episodes: normalizedEpisodes,
      totalEpisodes: normalizedEpisodes.length,
      unwatchedEpisodes,
    })
    setSeasonDownloadSheetOpen(true)
  }

  const buildSeriesSeasonEpisodes = (seasonNumber) => {
    const episodeCount = Number(
      data.seasons?.find((seasonEntry) => seasonEntry.season_number === seasonNumber)?.episode_count || 0
    )

    return Array.from({ length: episodeCount }, (_, index) => ({
      episode: index + 1,
      episodeTitle: null,
    }))
  }

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

  const playerFallback = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: reducedEffectsMode ? 'blur(2px)' : 'blur(8px)',
        WebkitBackdropFilter: reducedEffectsMode ? 'blur(2px)' : 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div
          className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
        <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, fontFamily: 'monospace' }}>
          Loading player...
        </span>
      </div>
    </div>
  )

  return (
    <div>
      <div className="relative w-full h-[55vh] -mt-14 overflow-hidden" style={{ objectPosition: 'center top' }}>
        {backdrop ? (
          <motion.img
            src={backdrop}
            alt={title}
            className="w-full h-full object-cover"
            initial={reducedEffectsMode ? false : { scale: 1.05 }}
            animate={{ scale: 1 }}
            transition={reducedEffectsMode ? { duration: 0 } : { duration: 8, ease: 'easeOut' }}
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
            background: reducedEffectsMode ? 'rgba(10,10,16,0.88)' : 'rgba(10,10,16,0.65)',
            backdropFilter: reducedEffectsMode ? 'blur(6px)' : 'blur(16px)',
            WebkitBackdropFilter: reducedEffectsMode ? 'blur(6px)' : 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.85)',
          }}
          initial={reducedEffectsMode ? { opacity: 0 } : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: reducedEffectsMode ? 0 : 0.15, duration: reducedEffectsMode ? 0.2 : 0.3 }}
          whileHover={reducedEffectsMode ? {
            borderColor: 'var(--border-hover)',
            color: '#fff',
          } : {
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
              boxShadow: reducedEffectsMode ? '0 16px 28px rgba(0,0,0,0.36)' : '0 24px 48px rgba(0,0,0,0.6)',
              aspectRatio: '2/3',
            }}
            initial={reducedEffectsMode ? { opacity: 0, y: 10 } : { opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: reducedEffectsMode ? 0.24 : 0.6 }}
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
            initial={reducedEffectsMode ? { opacity: 0, y: 12 } : { opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: reducedEffectsMode ? 0.26 : 0.6 }}
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
                  boxShadow: reducedEffectsMode ? '0 0 16px var(--accent-glow)' : '0 0 30px var(--accent-glow)',
                }}
                whileHover={reducedEffectsMode ? { scale: 1.01 } : { scale: 1.02, boxShadow: '0 0 40px var(--accent-glow)' }}
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
                  background: reducedEffectsMode ? 'var(--bg-surface)' : 'transparent',
                  color: 'var(--text-primary)',
                  padding: '16px 40px',
                  fontSize: 18,
                  border: '1px solid var(--border)',
                  backdropFilter: reducedEffectsMode ? 'blur(6px)' : 'blur(12px)',
                }}
                whileHover={reducedEffectsMode ? {
                  scale: 1.01,
                  borderColor: 'var(--accent)',
                } : {
                  scale: 1.02,
                  borderColor: 'var(--accent)',
                  boxShadow: '0 0 20px var(--accent-glow)',
                }}
                whileTap={{ scale: 0.98 }}
              >
                {inWatchlist ? 'In Watchlist' : '+ Watchlist'}
              </motion.button>

              {/* Download button ─────────────────────────────────────────────
                Phase B: pass status/progress from useDownloadStore.getDownloadStatus(id, season, episode)
                Phase C: onDownload triggers quality sheet → enqueue → backend invoke
              */}
              <DownloadButton
                contentId={String(data.id)}
                contentType={isAnime ? 'anime' : type}
                title={title}
                poster={poster}
                season={isMovieLike ? null : playSeason}
                episode={isMovieLike ? null : playEpisode}
                status={currentDownloadStatus}
                progress={currentDownloadProgress}
                size="md"
                onDownload={() => {
                  requestDownloadForTarget(buildDownloadTarget({
                    season: isMovieLike ? null : playSeason,
                    episode: isMovieLike ? null : playEpisode,
                  }))
                }}
                onPause={() => {
                  pauseDownloadForTarget(buildDownloadTarget({
                    season: isMovieLike ? null : playSeason,
                    episode: isMovieLike ? null : playEpisode,
                  }))
                }}
              />

              {/* Play Offline button ─────────────────────────────────────────
                Phase D: shown when store.isDownloaded(id, season, episode) === true
                Phase E: onClick opens player with convertFileSrc(localFilePath) as source
              */}
              {canPlayOffline && (
                <div className="flex flex-col items-start gap-1.5">
                  <motion.button
                    onClick={() => {
                      openOfflinePlayback(currentDownloadItem, {
                        animePlaybackTitle: playbackAnimeTitle || animeTitle,
                        animePlaybackAltTitle: animeAltTitle || animeTitle,
                      })
                    }}
                    className="flex items-center gap-2.5 font-semibold rounded-xl"
                    style={{
                      background: 'rgba(74,222,128,0.10)',
                      color: '#4ade80',
                      padding: '14px 28px',
                      fontSize: 16,
                      border: '1px solid rgba(74,222,128,0.30)',
                      backdropFilter: reducedEffectsMode ? 'blur(6px)' : 'blur(12px)',
                    }}
                    whileHover={reducedEffectsMode ? {
                      scale: 1.01,
                      borderColor: 'rgba(74,222,128,0.55)',
                    } : {
                      scale: 1.02,
                      borderColor: 'rgba(74,222,128,0.55)',
                      boxShadow: '0 0 20px rgba(74,222,128,0.18)',
                    }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <WifiOff size={16} />
                    Play Offline
                  </motion.button>
                  {/* Subtitle metadata indicator — Phase D UI hook */}
                  {currentDownloadItem?.subtitleFilePath && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-medium px-2"
                      style={{ color: 'rgba(74,222,128,0.65)' }}
                    >
                      <OfflineBadge variant="dot" hasSubtitles />
                    </span>
                  )}
                </div>
              )}
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
                light={reducedEffectsMode ? (backdrop || poster || true) : false}
              />
            </div>
          </section>
        )}

        {isAnime && (
          <section>
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-display font-semibold text-xl" style={{ color: 'var(--text-primary)' }}>
                  Episodes
                </h3>
                {(() => {
                  const downloadedCount = Object.values(animeDownloadStatusMap).filter(
                    (entry) => entry?.status === 'completed'
                  ).length
                  return downloadedCount > 0 ? (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: 'rgba(74,222,128,0.10)',
                        border: '1px solid rgba(74,222,128,0.26)',
                        color: '#4ade80',
                      }}
                    >
                      {downloadedCount} downloaded
                    </span>
                  ) : null
                })()}
              </div>
              {/* Download Season — Phase C: opens season download sheet */}
              {releasedSelectedEpisodes.length > 0 && (
                <motion.button
                  onClick={() => openSeasonDownloadSheet({
                    contentType: 'anime',
                    seasonNumber: Number(selectedCanonicalEntry?.seasonNumber || playSeason || 1),
                    episodes: releasedSelectedEpisodes.map((episode, index) => ({
                      episode: Number(episode?.number || index + 1),
                      episodeTitle: episode?.title || null,
                      isReleased: episode?.isReleased !== false,
                    })),
                  })}
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
                      const isUpcomingEpisode = episode?.isReleased === false
                      const episodeAvailabilityLabel = getAnimeEpisodeAvailabilityLabel(episode)
                      const animeEpisodeDownloadState =
                        animeDownloadStatusMap[getEpisodeProgressKey(entrySeason, episodeNumber)]
                        || { status: 'default', progress: 0 }
                      const isCurrentEpisode =
                        Number(playSeason) === entrySeason && Number(playEpisode) === episodeNumber

                      const isAnimeEpisodeDownloaded = animeEpisodeDownloadState.status === 'completed'

                      return (
                        <motion.div
                          key={`${selectedCanonicalEntry?.id}-${episodeNumber}`}
                          className={`rounded-xl overflow-hidden group ${isUpcomingEpisode ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          style={{
                            background: 'var(--bg-surface)',
                            border: isCurrentEpisode
                              ? '1px solid var(--accent)'
                              : isUpcomingEpisode
                                ? '1px solid rgba(255,255,255,0.08)'
                              : isAnimeEpisodeDownloaded
                                ? '1px solid rgba(74,222,128,0.22)'
                                : '1px solid var(--border)',
                            boxShadow: isCurrentEpisode
                              ? '0 0 24px var(--accent-glow), var(--card-shadow)'
                              : 'var(--card-shadow)',
                            opacity: isUpcomingEpisode ? 0.72 : 1,
                          }}
                          whileHover={isUpcomingEpisode ? {} : {
                            y: -3,
                            borderColor: isAnimeEpisodeDownloaded ? 'rgba(74,222,128,0.45)' : 'var(--border-hover)',
                            boxShadow: '0 0 20px var(--accent-glow), 0 12px 40px rgba(0,0,0,0.3)',
                          }}
                          onClick={() => {
                            if (isUpcomingEpisode) return

                            if (isAnimeEpisodeDownloaded) {
                              const offlineAnimeItem = getDownloadItemByIdentity(downloadItems, {
                                contentId: data.id,
                                contentType: 'anime',
                                season: entrySeason,
                                episode: episodeNumber,
                              })

                              if (offlineAnimeItem?.filePath) {
                                openOfflinePlayback(offlineAnimeItem, {
                                  season: entrySeason,
                                  episode: episodeNumber,
                                  animePlaybackTitle: selectedCanonicalEntry?.title || playbackAnimeTitle || animeTitle,
                                  animePlaybackAltTitle: animeAltTitle || animeTitle,
                                })
                                return
                              }
                            }

                            handlePlay(
                              entrySeason,
                              isMainSeriesLauncher(episode) ? 1 : episodeNumber,
                              0,
                              defaultDurationHint,
                              selectedCanonicalEntry?.title || playbackAnimeTitle || animeTitle,
                              animeAltTitle || animeTitle
                            )
                          }}
                        >
                          <div className="relative h-28 overflow-hidden">
                            {!isUpcomingEpisode && getAnimeCardImage(selectedCanonicalEntry, episode) ? (
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
                                <span className="text-base font-semibold opacity-55">
                                  {isUpcomingEpisode ? 'Soon' : 'TV'}
                                </span>
                              </div>
                            )}

                            <div
                              className="absolute inset-0"
                              style={{
                                background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.15), transparent)',
                              }}
                            />

                            {/* Offline badge — always visible when downloaded */}
                            {isAnimeEpisodeDownloaded && (
                              <div className="absolute top-2 left-2 z-10">
                                <OfflineBadge variant="pill" />
                              </div>
                            )}

                            {isUpcomingEpisode && (
                              <div className="absolute top-2 left-2 z-10">
                                <span
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                  style={{
                                    background: 'rgba(251,191,36,0.14)',
                                    border: '1px solid rgba(251,191,36,0.28)',
                                    color: '#fbbf24',
                                  }}
                                >
                                  Upcoming
                                </span>
                              </div>
                            )}

                            {!isUpcomingEpisode && (
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                              <div
                                className="w-11 h-11 rounded-full flex items-center justify-center"
                                style={{
                                  background: isAnimeEpisodeDownloaded ? 'rgba(74,222,128,0.85)' : 'var(--accent)',
                                  boxShadow: '0 0 20px var(--accent-glow-strong)',
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                  <polygon points="6 3 20 12 6 21 6 3" />
                                </svg>
                              </div>
                            </div>
                            )}

                            {/* Episode download button — top-right overlay
                              Phase B: pass status from store.getDownloadStatus(data.id, entrySeason, episodeNumber)
                              Phase C: onDownload enqueues via store
                              Hidden for completed episodes — offline badge takes over
                            */}
                            {!isUpcomingEpisode && !isAnimeEpisodeDownloaded && (
                            <div
                              className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                              onClick={e => e.stopPropagation()}
                            >
                              <DownloadButton
                                size="sm"
                                contentId={String(data.id)}
                                contentType="anime"
                                title={title}
                                season={Number(selectedCanonicalEntry?.seasonNumber || 1)}
                                episode={episodeNumber}
                                status={animeEpisodeDownloadState.status}
                                progress={animeEpisodeDownloadState.progress}
                                onDownload={() => {
                                  requestDownloadForTarget(buildDownloadTarget({
                                    contentType: 'anime',
                                    season: entrySeason,
                                    episode: episodeNumber,
                                    episodeTitle: episode.title || `Episode ${episodeNumber}`,
                                  }))
                                }}
                                onPause={() => {
                                  pauseDownloadForTarget({
                                    contentId: data.id,
                                    contentType: 'anime',
                                    season: entrySeason,
                                    episode: episodeNumber,
                                  })
                                }}
                              />
                            </div>
                            )}
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
                              {isUpcomingEpisode
                                ? episodeAvailabilityLabel
                                : isMainSeriesLauncher(episode)
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
              downloadStatusMap={seriesDownloadStatusMap}
              onDownloadEpisode={(seasonNumber, episodeNumber) => {
                requestDownloadForTarget(buildDownloadTarget({
                  contentType: 'tv',
                  season: seasonNumber,
                  episode: episodeNumber,
                }))
              }}
              onPauseEpisode={(seasonNumber, episodeNumber) => {
                pauseDownloadForTarget({
                  contentId: data.id,
                  contentType: 'tv',
                  season: seasonNumber,
                  episode: episodeNumber,
                })
              }}
              onDownloadSeason={(seasonNumber, seasonEpisodes = []) => {
                openSeasonDownloadSheet({
                  contentType: 'tv',
                  seasonNumber,
                  episodes: (Array.isArray(seasonEpisodes) ? seasonEpisodes : []).map((episodeEntry, index) => ({
                    episode: Number(episodeEntry?.episode_number ?? index + 1),
                    episodeTitle: episodeEntry?.name || null,
                    isReleased: episodeEntry?.air_date ? !isFutureEpisodeDate(episodeEntry.air_date) : true,
                  })),
                })
              }}
              onPlay={(seasonNumber, episodeNumber, runtime) =>
                handlePlay(
                  seasonNumber,
                  episodeNumber,
                  0,
                  Math.max(0, Math.floor(Number(runtime || data.episode_run_time?.[0] || 0) * 60))
                )
              }
              onPlayOfflineEpisode={(seasonNumber, episodeNumber) => {
                const offlineEpisodeItem = getDownloadItemByIdentity(downloadItems, {
                  contentId: data.id,
                  contentType: 'tv',
                  season: seasonNumber,
                  episode: episodeNumber,
                })

                if (offlineEpisodeItem?.filePath) {
                  openOfflinePlayback(offlineEpisodeItem, {
                    season: seasonNumber,
                    episode: episodeNumber,
                  })
                }
              }}
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

      {!isAnime && playerOpen && (
        <Suspense fallback={playerFallback}>
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
            offlinePlayback={offlinePlaybackRequest}
            onClose={handleMoviePlayerClose}
          />
        </Suspense>
      )}

      {isAnime && animePlayerOpen && (
        <Suspense fallback={playerFallback}>
          <AnimePlayer
            animeTitle={animePlayTitle || playbackAnimeTitle || animeTitle}
            animeAltTitle={animePlayAltTitle || animeAltTitle}
            animeSearchTitles={animeDownloadSearchTitles}
            contentId={data.id}
            season={playSeason}
            episode={playEpisode}
            poster={poster}
            backdrop={backdrop}
            resumeAt={playerResumeAt}
            prefetchedAnime={animePrefetchRef.current.get(prefetchedAnimeIdRef.current) || null}
            offlinePlayback={offlinePlaybackRequest}
            onClose={handleAnimePlayerClose}
          />
        </Suspense>
      )}

      {/* Quality picker — shown on first download action ─────────────────────
        Phase B/C: onConfirm(quality) → enqueue download job in useDownloadStore
        Phase B: persist selected quality to useDownloadStore.preference
      */}
      <QualityPickerSheet
        isOpen={qualitySheetOpen}
        onClose={() => {
          setQualitySheetOpen(false)
          setPendingDownloadTarget(null)
        }}
        title={pendingDownloadTarget?.episodeTitle
          ? `${title} • ${pendingDownloadTarget.episodeTitle}`
          : title}
        defaultQuality={preferredDownloadQuality}
        onConfirm={(quality) => {
          if (pendingDownloadTarget) {
            setPreferredDownloadQuality(quality)
            queueTargetDownload(pendingDownloadTarget, quality)
          }
          setQualitySheetOpen(false)
          setPendingDownloadTarget(null)
        }}
      />

      {/* Season download sheet — shown from episode section header ───────────
        Phase B/C: onConfirm({ mode, quality }) → enqueue N jobs in useDownloadStore
      */}
      <SeasonDownloadSheet
        isOpen={seasonDownloadSheetOpen}
        onClose={() => {
          setSeasonDownloadSheetOpen(false)
          setSeasonDownloadContext(null)
        }}
        seasonNumber={seasonDownloadContext?.seasonNumber || playSeason}
        totalEpisodes={seasonDownloadContext?.totalEpisodes || 0}
        unwatchedEpisodes={seasonDownloadContext?.unwatchedEpisodes ?? null}
        defaultQuality={preferredDownloadQuality}
        onConfirm={({ mode, quality }) => {
          const selectedEpisodesForSeason = (seasonDownloadContext?.episodes || []).filter((episodeEntry) => (
            mode !== 'unwatched'
            || !progressMap[getEpisodeProgressKey(seasonDownloadContext?.seasonNumber, episodeEntry.episode)]
          ))

          if (seasonDownloadContext?.seasonNumber && selectedEpisodesForSeason.length > 0) {
            setPreferredDownloadQuality(quality)
            enqueueSeasonDownloads({
              contentId: String(data.id),
              contentType: seasonDownloadContext.contentType,
              title: seasonDownloadContext.contentType === 'anime'
                ? (selectedCanonicalEntry?.title || playbackAnimeTitle || animeTitle || title)
                : title,
              animeAltTitle: seasonDownloadContext.contentType === 'anime'
                ? (animeAltTitle || animeTitle || playbackAnimeTitle || title)
                : null,
              animeSearchTitles: seasonDownloadContext.contentType === 'anime'
                ? animeDownloadSearchTitles
                : [],
              anilistId: seasonDownloadContext.contentType === 'anime' ? anilistId : null,
              canonicalAnilistId: seasonDownloadContext.contentType === 'anime' ? canonicalAnilistId : null,
              detailMediaType: seasonDownloadContext.contentType === 'anime' ? type : null,
              providerAnimeId: seasonDownloadContext.contentType === 'anime'
                ? prefetchedAnimeData?.animeId || null
                : null,
              providerMatchedTitle: seasonDownloadContext.contentType === 'anime'
                ? prefetchedAnimeData?.matchedTitle || null
                : null,
              poster,
              season: seasonDownloadContext.seasonNumber,
              quality,
              episodes: selectedEpisodesForSeason,
            })

            const queuedItems = useDownloadStore.getState().items.filter((item) => (
              String(item.contentId) === String(data.id)
              && item.contentType === seasonDownloadContext.contentType
              && Number(item.season) === Number(seasonDownloadContext.seasonNumber)
              && selectedEpisodesForSeason.some((episodeEntry) => Number(episodeEntry.episode) === Number(item.episode))
            ))

            queuedItems.forEach((item) => {
              void startBackendDownloadForItem(item)
            })
          }
          setSeasonDownloadSheetOpen(false)
          setSeasonDownloadContext(null)
        }}
      />
    </div>
  )
}
