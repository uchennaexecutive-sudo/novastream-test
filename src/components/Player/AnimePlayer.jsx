import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  ANIWATCH_BASE_URL,
  getAnimeEpisodes,
  getAnimeStream,
  resolveAnimeSearch,
} from '../../lib/consumet'
import { saveProgress } from '../../lib/progress'
import SharedNativePlayer from './SharedNativePlayer'

const STREAM_RETRY_DELAY_MS = 2000
const MAX_STREAM_ATTEMPTS = 3
const ANIME_PROVIDERS = [
  { id: 'animekai', label: 'AnimeKai' },
  { id: 'kickassanime', label: 'KickAssAnime' },
]


const parseTimestamp = (value) => {
  const [time, milliseconds = '0'] = value.split('.')
  const parts = time.split(':').map(Number)
  const baseSeconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]

  return baseSeconds + Number(`0.${milliseconds}`)
}

const parseVtt = (text) => text
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

export default function AnimePlayer({
  animeTitle,
  animeAltTitle = '',
  contentId,
  season,
  episode,
  poster,
  backdrop,
  resumeAt = 0,
  prefetchedAnime = null,
  onClose,
}) {
  const retryTimerRef = useRef(null)
  const streamAttemptRef = useRef(0)
  const hlsHeadersRef = useRef({})
  const providerIndexRef = useRef(0)
  const providerStateRef = useRef({})
  const lastPlaybackRef = useRef({
    progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
    durationSeconds: 0,
  })

  const [episodes, setEpisodes] = useState([])
  const [currentEpisode, setCurrentEpisode] = useState(Math.max(1, Number(episode) || 1))
  const [resumePosition, setResumePosition] = useState(Math.max(0, Math.floor(Number(resumeAt) || 0)))
  const [streamData, setStreamData] = useState({ rawUrl: '' })
  const [subtitleTracks, setSubtitleTracks] = useState([])
  const [subtitleCues, setSubtitleCues] = useState([])
  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingStage, setLoadingStage] = useState('Finding anime...')
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const [providerTick, setProviderTick] = useState(0)

  const activeProvider = ANIME_PROVIDERS[providerIndexRef.current] || ANIME_PROVIDERS[0]

  const apiHost = useMemo(() => {
    try {
      return new URL(ANIWATCH_BASE_URL).host
    } catch {
      return ANIWATCH_BASE_URL
    }
  }, [])

  const currentEpisodeMeta = useMemo(
    () => episodes.find(item => Number(item.number) === Number(currentEpisode)) || null,
    [episodes, currentEpisode]
  )
  const activeStreamUrl = useMemo(
    () => streamData.rawUrl || '',
    [streamData.rawUrl]
  )
  const hasPrevEpisode = episodes.some(item => Number(item.number) === Number(currentEpisode) - 1)
  const hasNextEpisode = episodes.some(item => Number(item.number) === Number(currentEpisode) + 1)

  const clearRetryTimer = () => {
    window.clearTimeout(retryTimerRef.current)
  }

  const resetPlaybackState = useCallback(() => {
    hlsHeadersRef.current = {}
    setStreamData({ rawUrl: '' })
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

    return saveProgress({
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
  }, [animeTitle, backdrop, contentId, currentEpisode, poster, season])

  const retryFreshStream = useCallback(() => {
    clearRetryTimer()
    streamAttemptRef.current = 0
    providerIndexRef.current = 0
    resetPlaybackState()
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    setErrorDetail('')
    setRetryNonce(value => value + 1)
    setProviderTick(value => value + 1)
  }, [resetPlaybackState])

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
      setRetryNonce(value => value + 1)
    }, STREAM_RETRY_DELAY_MS)
  }, [resetPlaybackState])

  const handleStreamFailure = useCallback((detail) => {
    setErrorDetail(detail || '')
    scheduleFreshStreamRetry(detail || '')
  }, [scheduleFreshStreamRetry])

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
    streamAttemptRef.current = 0
    lastPlaybackRef.current = { progressSeconds: 0, durationSeconds: 0 }
    setResumePosition(0)
    resetPlaybackState()
    setCurrentEpisode(Number(nextEpisode))
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    setRetryNonce(value => value + 1)
  }, [episodes, persistProgress, resetPlaybackState])

  useEffect(() => {
    clearRetryTimer()
    streamAttemptRef.current = 0
    providerIndexRef.current = 0
    lastPlaybackRef.current = {
      progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
      durationSeconds: 0,
    }
    setCurrentEpisode(Math.max(1, Number(episode) || 1))
    setResumePosition(Math.max(0, Math.floor(Number(resumeAt) || 0)))
  }, [episode, resumeAt])

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
    let cancelled = false

    async function loadProviders() {
      clearRetryTimer()
      streamAttemptRef.current = 0
      providerIndexRef.current = 0
      providerStateRef.current = {}
      resetPlaybackState()
      setLoading(true)
      setLoadingStage('Finding anime...')
      setError('')
      setErrorDetail('')

      const titles = [animeTitle, animeAltTitle].filter(Boolean)

      for (const provider of ANIME_PROVIDERS) {
        try {
          let anime = null
          let matchedTitle = ''

          if (prefetchedAnime?.providerId === provider.id && prefetchedAnime?.animeId) {
            anime = { id: prefetchedAnime.animeId }
            matchedTitle = prefetchedAnime.matchedTitle || animeTitle
          } else {
            const resolved = await resolveAnimeSearch(titles, provider.id)
            anime = resolved.anime
            matchedTitle = resolved.matchedTitle
          }

          if (!anime?.id) {
            console.warn(`[AnimePlayer] ${provider.id} search returned no anime`)
            continue
          }

          setLoadingStage(`Loading episodes from ${provider.label}...`)
          const providerEpisodes = await getAnimeEpisodes(anime.id, provider.id)

          if (!providerEpisodes?.length) {
            console.warn(`[AnimePlayer] ${provider.id} returned no episodes`)
            continue
          }

          providerStateRef.current[provider.id] = {
            animeId: anime.id,
            matchedTitle,
            episodes: providerEpisodes,
          }
        } catch (providerError) {
          console.warn(`[AnimePlayer] provider load failed for ${provider.id}`, providerError)
          continue
        }
      }

      const firstProvider = ANIME_PROVIDERS.find(
        (provider) => providerStateRef.current[provider.id]?.episodes?.length
      )

      if (!firstProvider) {
        throw new Error('Anime not found on available providers')
      }

      providerIndexRef.current = ANIME_PROVIDERS.findIndex(
        provider => provider.id === firstProvider.id
      )
      setEpisodes(providerStateRef.current[firstProvider.id].episodes || [])
      setProviderTick(value => value + 1)
      setLoadingStage('Fetching stream...')
    }

    loadProviders()
    return () => { cancelled = true }
  }, [animeAltTitle, animeTitle, prefetchedAnime, resetPlaybackState])

  useEffect(() => {
    const provider = activeProvider
    const providerState = providerStateRef.current[provider.id]

    if (!providerState?.episodes?.length) return undefined

    clearRetryTimer()
    let cancelled = false

    async function resolveStream() {
      const requestedEpisode = Number(currentEpisode)
      const targetEpisode = providerState.episodes.find(
        item => Number(item.number) === requestedEpisode
      )

      if (!targetEpisode?.episodeId) {
        const nextProviderIndex = providerIndexRef.current + 1
        const nextProvider = ANIME_PROVIDERS[nextProviderIndex]

        if (nextProvider && providerStateRef.current[nextProvider.id]?.episodes?.length) {
          providerIndexRef.current = nextProviderIndex
          setEpisodes(providerStateRef.current[nextProvider.id].episodes || [])
          setProviderTick(value => value + 1)
          return
        }

        throw new Error(`Episode ${requestedEpisode} not found on available providers`)
      }

      streamAttemptRef.current += 1
      setLoading(true)
      setLoadingStage(`Fetching stream from ${provider.label}...`)
      setError('')
      setErrorDetail('')
      resetPlaybackState()

      try {
        const payload = await getAnimeStream(targetEpisode.episodeId, provider.id)
        if (cancelled) return
        if (!payload?.rawUrl) throw new Error('Invalid stream')

        const captionTracks = (payload.tracks || []).filter(track => track.kind === 'captions')
        hlsHeadersRef.current = payload.headers || {}
        console.info('[AnimePlayer] resolved stream', {
          provider: payload.provider || provider.id,
          animeTitle,
          episode: currentEpisode,
          rawUrl: payload.rawUrl,
          headers: hlsHeadersRef.current,
          captionTracks: captionTracks.length,
        })

        setStreamData({ rawUrl: payload.rawUrl || '' })
        setSubtitleTracks(captionTracks)
        setSubtitleEnabled(captionTracks.length > 0)

        const nextEpisode = providerState.episodes.find(
          e => Number(e.number) === Number(currentEpisode) + 1
        )

        if (nextEpisode?.episodeId) {
          getAnimeStream(nextEpisode.episodeId, provider.id).catch(() => { })
        }

        clearRetryTimer()
        setLoading(false)
        setLoadingStage('Buffering...')
      } catch (streamError) {
        console.error('[AnimePlayer] stream resolution failed', streamError)

        const nextProviderIndex = providerIndexRef.current + 1
        const nextProvider = ANIME_PROVIDERS[nextProviderIndex]

        if (!cancelled && nextProvider && providerStateRef.current[nextProvider.id]?.episodes?.length) {
          providerIndexRef.current = nextProviderIndex
          setEpisodes(providerStateRef.current[nextProvider.id].episodes || [])
          setProviderTick(value => value + 1)
          return
        }

        if (!cancelled) {
          const detail = streamError instanceof Error ? streamError.message : 'Stream resolution failed'
          scheduleFreshStreamRetry(detail)
        }
      }
    }

    resolveStream()
    return () => { cancelled = true }
  }, [activeProvider, animeTitle, currentEpisode, providerTick, resetPlaybackState, retryNonce, scheduleFreshStreamRetry])

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
    const subtitleRequest = window.__TAURI_INTERNALS__
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
  }, [subtitleEnabled, subtitleTracks])

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
      streamType="hls"
      streamLabel={activeProvider.label}
      streamMeta={`Season ${season} Episode ${currentEpisodeMeta?.number || currentEpisode} | ${activeProvider.label} | HLS`}
      loading={loading}
      loadingStage={loadingStage}
      loadingHost={apiHost}
      error={error}
      errorDetail={errorDetail || ''}
      onRetry={retryFreshStream}
      onClose={onClose}
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
      resumeKey={`${activeProvider.id}-${currentEpisode}-${retryNonce}`}
    />
  )
}
