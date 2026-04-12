import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { ANIWATCH_BASE_URL, clearAnimePlaybackCache } from '../../lib/consumet'
import { getEnabledAnimeAddonProviders } from '../../lib/animeAddons'
import {
  resolveAnimeProviderStates,
  resolveEpisodeStreamCandidates,
} from '../../lib/animeAddons/resolveAnimeStreams'
import { resolveAnimeDownloadStream } from '../../lib/animeDownloads'
import { saveProgress } from '../../lib/progress'
import { syncPlaybackHistory } from '../../lib/supabase'
import SharedNativePlayer from './SharedNativePlayer'

const STREAM_RETRY_DELAY_MS = 2000
const MAX_STREAM_ATTEMPTS = 3

const parseTimestamp = (value) => {
  const [time, milliseconds = '0'] = String(value || '0:00.0').split('.')
  const parts = time.split(':').map(Number)
  const baseSeconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : (parts[0] || 0) * 60 + (parts[1] || 0)

  return baseSeconds + Number(`0.${milliseconds}`)
}

const parseVtt = (text) => String(text || '')
  .split(/\r?\n\r?\n/)
  .map(block => block.trim())
  .filter(Boolean)
  .map(block => {
    const lines = block.split(/\r?\n/).filter(Boolean)
    const timing = lines.find(line => line.includes('-->'))
    if (!timing) return null

    const [start, end] = timing.split('-->').map(value => value.trim())

    return {
      start: parseTimestamp(start),
      end: parseTimestamp(end),
      text: lines.slice(lines.indexOf(timing) + 1).join(' ').trim(),
    }
  })
  .filter(Boolean)

function pickPreferredProviderState(states = [], {
  currentEpisode,
  lockedProviderId = '',
  lockedEpisode = null,
  successfulProviderId = '',
} = {}) {
  const normalizedEpisode = Number(currentEpisode || 0)

  if (
    lockedProviderId &&
    Number(lockedEpisode || 0) === normalizedEpisode
  ) {
    const locked = states.find(
      item =>
        item?.providerId === lockedProviderId &&
        Array.isArray(item?.episodes) &&
        item.episodes.length
    )
    if (locked) return locked
  }

  if (successfulProviderId) {
    const successful = states.find(
      item =>
        item?.providerId === successfulProviderId &&
        Array.isArray(item?.episodes) &&
        item.episodes.length
    )
    if (successful) return successful
  }

  return states.find(
    item => Array.isArray(item?.episodes) && item.episodes.length
  ) || null
}

function getCandidateMeta(candidate = {}) {
  const quality = String(candidate?.quality || '').trim()
  const resolution = Number(candidate?.resolution || 0)
  const streamType = candidate?.streamType === 'mp4' ? 'MP4' : 'HLS'

  const qualityLabel =
    quality ||
    (resolution > 0 ? `${resolution}p` : '')

  return [candidate?.providerLabel || '', qualityLabel, streamType]
    .filter(Boolean)
    .join(' | ')
}

export default function AnimePlayer({
  animeTitle,
  animeAltTitle = '',
  animeSearchTitles = [],
  contentId,
  season,
  episode,
  poster,
  backdrop,
  resumeAt = 0,
  prefetchedAnime = null,
  offlinePlayback = null,
  onClose,
}) {
  const retryTimerRef = useRef(null)
  const streamAttemptRef = useRef(0)
  const hlsHeadersRef = useRef({})
  const providerStatesRef = useRef({})
  const failedUrlsByEpisodeRef = useRef({})
  const candidateListRef = useRef([])
  const candidateIndexRef = useRef(0)
  const lockedProviderIdRef = useRef('')
  const lockedEpisodeRef = useRef(null)
  const successfulProviderIdRef = useRef('')
  const lastHistoryCheckpointRef = useRef(0)
  const lastPlaybackRef = useRef({
    progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
    durationSeconds: 0,
  })

  const [episodes, setEpisodes] = useState([])
  const [currentEpisode, setCurrentEpisode] = useState(Math.max(1, Number(episode) || 1))
  const [resumePosition, setResumePosition] = useState(Math.max(0, Math.floor(Number(resumeAt) || 0)))
  const [streamData, setStreamData] = useState({
    rawUrl: '',
    streamType: 'hls',
    providerLabel: '',
    providerId: '',
    quality: '',
    resolution: 0,
    streamSessionId: null,
  })
  const [subtitleTracks, setSubtitleTracks] = useState([])
  const [subtitleCues, setSubtitleCues] = useState([])
  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [resolvedOfflineSubtitlePath, setResolvedOfflineSubtitlePath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingStage, setLoadingStage] = useState('Finding anime...')
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const [resolverTick, setResolverTick] = useState(0)
  const offlineMode = Boolean(offlinePlayback?.filePath)

  const apiHost = useMemo(() => {
    try {
      return new URL(ANIWATCH_BASE_URL).host
    } catch {
      return ANIWATCH_BASE_URL
    }
  }, [])

  const resolvedAnimeTitles = useMemo(() => {
    const seen = new Set()
    const output = []

    for (const value of [animeTitle, animeAltTitle, ...(Array.isArray(animeSearchTitles) ? animeSearchTitles : [])]) {
      const title = String(value || '').replace(/\s+/g, ' ').trim()
      if (!title) continue
      const key = title.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      output.push(title)
    }

    return output
  }, [animeAltTitle, animeSearchTitles, animeTitle])

  const currentEpisodeMeta = useMemo(
    () => episodes.find(item => Number(item.number) === Number(currentEpisode)) || null,
    [episodes, currentEpisode]
  )

  const activeStreamUrl = useMemo(
    () => streamData.rawUrl || '',
    [streamData.rawUrl]
  )

  const activeCandidate = candidateListRef.current[candidateIndexRef.current] || null
  const activeProviderLabel = streamData.providerLabel || activeCandidate?.providerLabel || 'Anime'
  const hasPrevEpisode = episodes.some(item => Number(item.number) === Number(currentEpisode) - 1)
  const hasNextEpisode = episodes.some(item => Number(item.number) === Number(currentEpisode) + 1)

  const clearRetryTimer = () => {
    window.clearTimeout(retryTimerRef.current)
  }

  const resetPlaybackState = useCallback(() => {
    hlsHeadersRef.current = {}
    setStreamData({
      rawUrl: '',
      streamType: 'hls',
      providerLabel: '',
      providerId: '',
      quality: '',
      resolution: 0,
      streamSessionId: null,
    })
    setSubtitleTracks([])
    setSubtitleCues([])
    setErrorDetail('')
  }, [])

  const persistProgress = useCallback(async (snapshot = lastPlaybackRef.current) => {
    const effectiveContentId = contentId || animeTitle
    const progressSeconds = Math.max(0, Math.floor(Number(snapshot?.progressSeconds) || 0))
    const durationSeconds = Math.max(0, Math.floor(Number(snapshot?.durationSeconds) || 0))

    lastPlaybackRef.current = { progressSeconds, durationSeconds }

    if (!effectiveContentId || progressSeconds <= 0) return null

    const persistPromise = saveProgress({
      contentId: String(effectiveContentId),
      contentType: 'anime',
      title: animeTitle,
      poster,
      backdrop,
      season: season || 1,
      episode: currentEpisode,
      progressSeconds,
      durationSeconds,
    })

    const checkpoint = Math.max(1, Math.floor(progressSeconds / 30))
    if (checkpoint > lastHistoryCheckpointRef.current) {
      lastHistoryCheckpointRef.current = checkpoint
      syncPlaybackHistory({
        tmdbId: effectiveContentId,
        mediaType: 'anime',
        title: animeTitle,
        posterPath: poster,
        season: season || 1,
        episode: currentEpisode,
        progressSeconds,
      }).catch(() => {})
    }

    return persistPromise
  }, [animeTitle, backdrop, contentId, currentEpisode, poster, season])

  const buildClosePayload = useCallback((snapshot = lastPlaybackRef.current) => ({
    season: season || 1,
    episode: currentEpisode,
    progressSeconds: Math.max(0, Math.floor(Number(snapshot?.progressSeconds) || 0)),
    durationSeconds: Math.max(0, Math.floor(Number(snapshot?.durationSeconds) || 0)),
  }), [currentEpisode, season])

  const handleClosePlayer = useCallback(() => {
    onClose?.(buildClosePayload())
  }, [buildClosePayload, onClose])

  const retryFreshStream = useCallback(() => {
    clearRetryTimer()
    streamAttemptRef.current = 0
    candidateIndexRef.current = 0
    candidateListRef.current = []
    resetPlaybackState()
    lockedProviderIdRef.current =
      lockedProviderIdRef.current || successfulProviderIdRef.current || ''
    lockedEpisodeRef.current = Number(currentEpisode)
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    setErrorDetail('')
    setResolverTick(value => value + 1)
  }, [currentEpisode, resetPlaybackState])

  const scheduleFreshStreamRetry = useCallback((detail = '') => {
    clearRetryTimer()

    if (detail) {
      setErrorDetail(detail)
    }

    if (streamAttemptRef.current >= MAX_STREAM_ATTEMPTS) {
      setError('Could not load stream')
      setLoading(false)
      setLoadingStage('')
      return
    }

    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    resetPlaybackState()

    retryTimerRef.current = window.setTimeout(() => {
      try {
        clearAnimePlaybackCache()
      } catch (warning) {
        console.warn('[AnimePlayer] failed to clear playback cache before retry', warning)
      }

      providerStatesRef.current = {}
      failedUrlsByEpisodeRef.current = {}
      candidateListRef.current = []
      candidateIndexRef.current = 0
      streamAttemptRef.current += 1
      setEpisodes([])
      setRetryNonce(value => value + 1)
      setResolverTick(value => value + 1)
    }, STREAM_RETRY_DELAY_MS)
  }, [resetPlaybackState])

  const handleStreamFailure = useCallback((detail) => {
    if (offlineMode) {
      clearRetryTimer()
      setLoading(false)
      setLoadingStage('')
      setError('Could not open offline file')
      setErrorDetail(detail || 'The downloaded file could not be played locally')
      return
    }

    const episodeKey = String(Number(currentEpisode || 0))
    const failedSet = failedUrlsByEpisodeRef.current[episodeKey] || new Set()

    if (activeCandidate?.url) {
      failedSet.add(activeCandidate.url)
    }

    failedUrlsByEpisodeRef.current[episodeKey] = failedSet
    setErrorDetail(detail || '')

    const nextCandidateIndex = candidateIndexRef.current + 1
    const nextCandidate = candidateListRef.current[nextCandidateIndex]

    if (nextCandidate?.url) {
      clearRetryTimer()
      candidateIndexRef.current = nextCandidateIndex
      lockedProviderIdRef.current = nextCandidate.providerId || ''
      lockedEpisodeRef.current = Number(currentEpisode)

      const nextStreamData = {
        rawUrl: String(nextCandidate.url || ''),
        streamType: nextCandidate.streamType || 'hls',
        providerLabel: nextCandidate.providerLabel || '',
        providerId: nextCandidate.providerId || '',
        quality: nextCandidate.quality || '',
        resolution: Number(nextCandidate.resolution || 0),
        streamSessionId: nextCandidate.streamSessionId || null,
      }

      hlsHeadersRef.current = nextCandidate.headers || {}
      setStreamData(() => nextStreamData)
      setSubtitleTracks(() => (
        Array.isArray(nextCandidate.subtitles) ? nextCandidate.subtitles : []
      ))
      setSubtitleEnabled(() => (
        Array.isArray(nextCandidate.subtitles) && nextCandidate.subtitles.length > 0
      ))
      setError('')
      setLoading(false)
      setLoadingStage('')
      return
    }

    clearRetryTimer()
    setLoading(false)
    setLoadingStage('')
    setError('Could not load stream')
    setErrorDetail(detail || 'All available stream candidates failed')
  }, [activeCandidate, animeTitle, currentEpisode, offlineMode])

  const handlePlaybackSnapshot = useCallback((snapshot) => {
    lastPlaybackRef.current = snapshot
  }, [])

  const handlePersistProgress = useCallback((snapshot) => (
    persistProgress(snapshot)
  ), [persistProgress])

  const handleToggleSubtitles = useCallback(() => {
    setSubtitleEnabled(value => !value)
  }, [])

  const goToEpisode = useCallback((nextEpisode) => {
    const match = episodes.find(item => Number(item.number) === Number(nextEpisode))
    if (!match) return

    persistProgress().catch(() => { })
    clearRetryTimer()
    candidateIndexRef.current = 0
    candidateListRef.current = []
    lastHistoryCheckpointRef.current = 0
    lastPlaybackRef.current = { progressSeconds: 0, durationSeconds: 0 }
    setResumePosition(0)
    resetPlaybackState()
    successfulProviderIdRef.current = ''
    lockedProviderIdRef.current = ''
    lockedEpisodeRef.current = null
    setCurrentEpisode(Number(nextEpisode))
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    setResolverTick(value => value + 1)
  }, [episodes, persistProgress, resetPlaybackState])

  useEffect(() => {
    if (offlineMode) {
      clearRetryTimer()
      streamAttemptRef.current = 0
      candidateIndexRef.current = 0
      candidateListRef.current = []
      failedUrlsByEpisodeRef.current = {}
      successfulProviderIdRef.current = ''
      lockedProviderIdRef.current = ''
      lockedEpisodeRef.current = null
      lastHistoryCheckpointRef.current = 0
      lastPlaybackRef.current = {
        progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
        durationSeconds: 0,
      }
      setCurrentEpisode(Math.max(1, Number(episode) || 1))
      setResumePosition(Math.max(0, Math.floor(Number(resumeAt) || 0)))
      setEpisodes([])
      setLoading(false)
      setLoadingStage('Loading offline file...')
      setError('')
      setErrorDetail('')
      setStreamData({
        rawUrl: offlinePlayback.filePath || '',
        streamType: 'mp4',
        providerLabel: 'Offline',
        providerId: 'offline',
        quality: 'Downloaded',
        resolution: 0,
        streamSessionId: null,
      })
      const nextSubtitleTracks = resolvedOfflineSubtitlePath && isTauri()
        ? [{
          file: resolvedOfflineSubtitlePath,
          url: resolvedOfflineSubtitlePath,
          label: offlinePlayback.subtitleLabel || 'Offline',
          lang: 'en',
          source: 'offline',
        }]
        : []
      setSubtitleTracks(nextSubtitleTracks)
      setSubtitleEnabled(nextSubtitleTracks.length > 0)
      return undefined
    }

    clearRetryTimer()
    streamAttemptRef.current = 0
    candidateIndexRef.current = 0
    candidateListRef.current = []
    failedUrlsByEpisodeRef.current = {}
    successfulProviderIdRef.current = ''
    lockedProviderIdRef.current = ''
    lockedEpisodeRef.current = null
    lastHistoryCheckpointRef.current = 0
    lastPlaybackRef.current = {
      progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
      durationSeconds: 0,
    }
    setCurrentEpisode(Math.max(1, Number(episode) || 1))
    setResumePosition(Math.max(0, Math.floor(Number(resumeAt) || 0)))
  }, [episode, offlineMode, offlinePlayback, resolvedOfflineSubtitlePath, resumeAt])

  useEffect(() => {
    if (!offlineMode || !offlinePlayback?.filePath || !isTauri()) {
      setResolvedOfflineSubtitlePath(null)
      return undefined
    }

    if (offlinePlayback?.subtitleFilePath) {
      setResolvedOfflineSubtitlePath(offlinePlayback.subtitleFilePath)
      return undefined
    }

    let cancelled = false
    invoke('find_local_subtitle_sidecar', { filePath: offlinePlayback.filePath })
      .then((filePath) => {
        if (!cancelled) {
          setResolvedOfflineSubtitlePath(filePath || null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedOfflineSubtitlePath(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [offlineMode, offlinePlayback?.filePath, offlinePlayback?.subtitleFilePath])

  useEffect(() => {
    invoke('get_anime_debug_log_path')
      .then((path) => {
        console.info('[AnimePlayer] Rust debug log path:', path)
      })
      .catch((warning) => {
        console.warn('[AnimePlayer] Could not resolve Rust debug log path', warning)
      })
  }, [])

  useEffect(() => {
    if (offlineMode) return undefined

    let cancelled = false

    async function loadProviders() {
      clearRetryTimer()
      candidateIndexRef.current = 0
      candidateListRef.current = []
      providerStatesRef.current = {}
      resetPlaybackState()
      setLoading(true)
      setLoadingStage('Finding anime...')
      setError('')
      setErrorDetail('')

      const states = await resolveAnimeProviderStates({ titles: resolvedAnimeTitles })

      if (cancelled) return

      const nextStateMap = {}
      for (const state of states) {
        if (state?.providerId) {
          nextStateMap[state.providerId] = state
        }
      }

      if (
        prefetchedAnime?.providerId &&
        prefetchedAnime?.animeId &&
        Array.isArray(prefetchedAnime?.episodes) &&
        prefetchedAnime.episodes.length
      ) {
        const enabledProviderIds = new Set(
          getEnabledAnimeAddonProviders().map((provider) => provider?.id).filter(Boolean)
        )

        if (!enabledProviderIds.has(prefetchedAnime.providerId)) {
          console.info('[AnimePlayer] skipping prefetched anime override', {
            providerId: prefetchedAnime.providerId,
            animeId: prefetchedAnime.animeId,
            episodeCount: prefetchedAnime.episodes.length,
            reason: 'prefetched provider is not enabled in anime addons',
          })
        } else {
        nextStateMap[prefetchedAnime.providerId] = {
          providerId: prefetchedAnime.providerId,
          animeId: prefetchedAnime.animeId,
          matchedTitle: prefetchedAnime.matchedTitle || animeTitle,
          anime: prefetchedAnime.anime || { id: prefetchedAnime.animeId },
          episodes: prefetchedAnime.episodes,
          streamCandidatesByEpisode:
            nextStateMap[prefetchedAnime.providerId]?.streamCandidatesByEpisode || {},
        }
        }
      }

      providerStatesRef.current = nextStateMap
      const providerStates = Object.values(nextStateMap)

      const preferredState = pickPreferredProviderState(providerStates, {
        currentEpisode,
        lockedProviderId: lockedProviderIdRef.current,
        lockedEpisode: lockedEpisodeRef.current,
        successfulProviderId: successfulProviderIdRef.current,
      })

      if (!preferredState) {
        setError('Anime not found on available providers')
        setLoading(false)
        setLoadingStage('')
        return
      }

      setEpisodes(preferredState.episodes || [])
      setLoadingStage('Fetching stream...')
      setResolverTick(value => value + 1)
    }

    loadProviders().catch((loadError) => {
      console.error('[AnimePlayer] provider load failed', loadError)
      setError(loadError instanceof Error ? loadError.message : 'Failed to load anime providers')
      setLoading(false)
      setLoadingStage('')
    })

    return () => { cancelled = true }
  }, [offlineMode, prefetchedAnime, resetPlaybackState, resolvedAnimeTitles, retryNonce])

  useEffect(() => {
    if (offlineMode) return undefined

    let cancelled = false
    clearRetryTimer()

    async function resolveStreamCandidates() {
      const providerStates = Object.values(providerStatesRef.current || {})
      if (!providerStates.length) return

      const preferredState = pickPreferredProviderState(providerStates, {
        currentEpisode,
        lockedProviderId: lockedProviderIdRef.current,
        lockedEpisode: lockedEpisodeRef.current,
        successfulProviderId: successfulProviderIdRef.current,
      })

      if (preferredState?.episodes?.length) {
        setEpisodes(preferredState.episodes || [])
      }

      const episodeKey = String(Number(currentEpisode || 0))
      const failedSet = failedUrlsByEpisodeRef.current[episodeKey] || new Set()

      setLoading(true)
      setLoadingStage('Fetching stream...')
      setError('')
      setErrorDetail('')
      resetPlaybackState()

      let candidates = await resolveEpisodeStreamCandidates({
        providerStates,
        episodeNumber: Number(currentEpisode),
        preferredProviderId:
          (lockedEpisodeRef.current === Number(currentEpisode) && lockedProviderIdRef.current) ||
          successfulProviderIdRef.current ||
          '',
        failedUrls: Array.from(failedSet),
      })

      if (cancelled) return

      if (!candidates.length) {
        try {
          const fallbackStream = await resolveAnimeDownloadStream({
            title: animeTitle,
            altTitle: animeAltTitle,
            extraTitles: resolvedAnimeTitles,
            episodeNumber: Number(currentEpisode),
            preferredProviderId:
              (lockedEpisodeRef.current === Number(currentEpisode) && lockedProviderIdRef.current) ||
              successfulProviderIdRef.current ||
              '',
          })

          if (fallbackStream?.streamUrl) {
            candidates = [{
              id: `fallback::${fallbackStream.providerId || 'anime'}::${Number(currentEpisode)}::${fallbackStream.streamUrl}`,
              providerId: fallbackStream.providerId || '',
              providerLabel: fallbackStream.providerId || '',
              url: fallbackStream.streamUrl,
              streamType: fallbackStream.streamType || 'unknown',
              quality: fallbackStream.qualityLabel || '',
              resolution: Number(fallbackStream.resolution || 0),
              headers: fallbackStream.headers || {},
              subtitles: fallbackStream.subtitleUrl
                ? [{ url: fallbackStream.subtitleUrl, file: fallbackStream.subtitleUrl, lang: 'English', default: true }]
                : [],
              score: 0,
            }]
          }
        } catch {
          // Keep the original no-candidate error below if the broader fallback also fails.
        }
      }

      candidateListRef.current = candidates

      if (!candidates.length) {
        throw new Error(`Episode ${Number(currentEpisode)} not found on available providers`)
      }
      if (candidateIndexRef.current >= candidates.length) {
        candidateIndexRef.current = 0
      }

      const candidate = candidates[candidateIndexRef.current]

      console.info('[AnimePlayer] resolved candidates', {
        animeTitle,
        animeAltTitle,
        currentEpisode: Number(currentEpisode),
        candidateCount: candidates.length,
        candidates: candidates.map((item, index) => ({
          index,
          providerId: item?.providerId,
          providerLabel: item?.providerLabel,
          streamType: item?.streamType,
          quality: item?.quality,
          resolution: item?.resolution,
          hasHeaders: Boolean(item?.headers && Object.keys(item.headers).length),
          url: item?.url,
          score: item?.score,
        })),
        selectedIndex: candidateIndexRef.current,
      })

      if (!candidate?.url) {
        throw new Error('Invalid stream candidate')
      }

      hlsHeadersRef.current = candidate.headers || {}
      successfulProviderIdRef.current = candidate.providerId || successfulProviderIdRef.current
      lockedProviderIdRef.current = candidate.providerId || ''
      lockedEpisodeRef.current = Number(currentEpisode)

      console.info('[AnimePlayer] selecting candidate', {
        animeTitle,
        currentEpisode: Number(currentEpisode),
        providerId: candidate?.providerId,
        providerLabel: candidate?.providerLabel,
        streamType: candidate?.streamType,
        quality: candidate?.quality,
        resolution: candidate?.resolution,
        headers: candidate?.headers || {},
        url: candidate?.url,
        streamSessionId: candidate?.streamSessionId || null,
      })
      const nextStreamData = {
        rawUrl: String(candidate.url || ''),
        streamType: candidate.streamType || 'hls',
        providerLabel: candidate.providerLabel || '',
        providerId: candidate.providerId || '',
        quality: candidate.quality || '',
        resolution: Number(candidate.resolution || 0),
        streamSessionId: candidate.streamSessionId || null,
      }

      setStreamData(() => nextStreamData)

      setSubtitleTracks(Array.isArray(candidate.subtitles) ? candidate.subtitles : [])
      setSubtitleEnabled(Array.isArray(candidate.subtitles) && candidate.subtitles.length > 0)

      clearRetryTimer()
      setLoading(false)
      setLoadingStage('Buffering...')

      const nextEpisodeNumber = Number(currentEpisode) + 1
      resolveEpisodeStreamCandidates({
        providerStates,
        episodeNumber: nextEpisodeNumber,
        preferredProviderId: candidate.providerId || '',
        failedUrls: [],
      }).catch(() => { })
    }

    resolveStreamCandidates().catch((streamError) => {
      console.error('[AnimePlayer] stream candidate resolution failed', streamError)

      if (!cancelled) {
        const detail = streamError instanceof Error ? streamError.message : 'Stream resolution failed'
        scheduleFreshStreamRetry(detail)
      }
    })

    return () => { cancelled = true }
  }, [currentEpisode, offlineMode, resetPlaybackState, resolverTick, scheduleFreshStreamRetry])

  useEffect(() => {
    const preferredTrack = subtitleTracks.find(track => String(track.lang || '').toLowerCase().includes('english')) || subtitleTracks[0]
    const trackUrl = preferredTrack?.file || preferredTrack?.url || preferredTrack?.rawFile || null

    if (!subtitleEnabled || !trackUrl) {
      setSubtitleCues([])
      return undefined
    }

    if (/\.gif(\?|$)/i.test(trackUrl)) {
      setSubtitleCues([])
      return undefined
    }

    let cancelled = false
    const isLocalAssetTrack = String(trackUrl).startsWith('asset:')
      || String(trackUrl).includes('asset.localhost')
    const isOfflineLocalSubtitle = offlineMode
      && preferredTrack?.source === 'offline'
      && !/^https?:\/\//i.test(String(trackUrl))
      && !isLocalAssetTrack
    const subtitleRequest = isOfflineLocalSubtitle
      ? invoke('read_local_text_file', { filePath: trackUrl })
      : window.__TAURI_INTERNALS__ && !isLocalAssetTrack
      ? invoke('fetch_anime_text', {
        url: trackUrl,
        headers: hlsHeadersRef.current || {},
      })
      : fetch(trackUrl).then(response => {
        if (!response.ok) throw new Error('Subtitle fetch failed')
        return response.text()
      })

    subtitleRequest
      .then(text => {
        if (!cancelled) setSubtitleCues(parseVtt(text))
      })
      .catch((subtitleError) => {
        console.warn('[AnimePlayer] subtitle load failed', subtitleError)
        if (!cancelled) setSubtitleCues([])
      })

    return () => { cancelled = true }
  }, [offlineMode, subtitleEnabled, subtitleTracks])

  useEffect(() => () => {
    clearRetryTimer()
    persistProgress().catch(() => { })
  }, [persistProgress])

  return (
    <SharedNativePlayer
      title={animeTitle}
      backdrop={backdrop}
      streamUrl={activeStreamUrl}
      streamHeaders={hlsHeadersRef.current}
      streamType={streamData.streamType === 'mp4' ? 'file' : 'hls'}
      streamLabel={activeProviderLabel}
      streamMeta={`Season ${season} Episode ${currentEpisodeMeta?.number || currentEpisode} | ${getCandidateMeta({
        providerLabel: activeProviderLabel,
        quality: streamData.quality,
        resolution: streamData.resolution,
        streamType: streamData.streamType,
      })}`}
      streamSessionId={streamData.streamSessionId || activeCandidate?.streamSessionId || null}
      loading={loading}
      loadingStage={loadingStage}
      loadingHost={apiHost}
      error={error}
      errorDetail={errorDetail || ''}
      onRetry={retryFreshStream}
      onClose={handleClosePlayer}
      onStreamFailure={handleStreamFailure}
      onPersistProgress={handlePersistProgress}
      onPlaybackSnapshot={handlePlaybackSnapshot}
      subtitleCues={subtitleCues}
      subtitleEnabled={subtitleEnabled}
      onToggleSubtitles={handleToggleSubtitles}
      hasPrev={hasPrevEpisode}
      hasNext={hasNextEpisode}
      onPrev={hasPrevEpisode ? () => goToEpisode(currentEpisode - 1) : null}
      onNext={hasNextEpisode ? () => goToEpisode(currentEpisode + 1) : null}
      prevLabel={`← Ep ${currentEpisode - 1}`}
      nextLabel={`Ep ${currentEpisode + 1} →`}
      resumeAt={resumePosition}
      resumeKey={`${streamData.providerId || 'anime'}-${currentEpisode}-${resolverTick}-${retryNonce}-${candidateIndexRef.current}`}
    />
  )
}
