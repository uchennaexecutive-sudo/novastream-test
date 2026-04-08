import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Hls from 'hls.js'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  Captions,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { getSeasonDetails } from '../../lib/tmdb'
import { saveProgress } from '../../lib/progress'
import {
  getAnimationStreams,
  getMovieStreams,
  getSeriesStreams,
} from '../../lib/movieStreams'
import {
  getAnimationSubtitles,
  getMovieSubtitles,
  getSeriesSubtitles,
} from '../../lib/movieSubtitles'
import useAppStore, { getReducedEffectsMode } from '../../store/useAppStore'

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2]
const FALLBACK_RESOLUTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
]
const CONTROLS_TIMEOUT_MS = 3000
const STARTUP_TIMEOUT_MS = 20000

const parseTimestamp = (value) => {
  const normalized = String(value || '').trim().replace(',', '.')
  const [time, milliseconds = '0'] = normalized.split('.')
  const parts = time.split(':').map(Number)
  const baseSeconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]

  return baseSeconds + Number(`0.${milliseconds}`)
}

const parseSubtitles = (text) => text
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
  .filter(item => item?.text)

const isSubtitleFilePath = (value) => /\.(srt|vtt|ass|ssa|sub)$/i.test(String(value || '').trim())

const SUBTITLE_TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'for',
  'from',
  'this',
  'that',
  'movie',
  'english',
  'subtitle',
  'subtitles',
  'subs',
  'resync',
  'proper',
  'original',
  'source',
  'audio',
  'dual',
  'multi',
  'hindi',
  'chinese',
  'moviesmod',
  'cafe',
  'eng',
  'non',
  'hi',
])

const tokenizeSubtitleContext = (value) => String(value || '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(token => token.length >= 3 && !SUBTITLE_TOKEN_STOPWORDS.has(token))

const getSubtitleTrackScore = (track, stream) => {
  const streamTitle = String(stream?.title || '').toLowerCase()
  const streamProvider = String(stream?.provider || '').toLowerCase()
  const trackText = [
    track?.release,
    track?.fileName,
    track?.origin,
    track?.label,
  ].filter(Boolean).join(' ').toLowerCase()

  let score = 0

  const streamHas = (token) => streamTitle.includes(token)
  const trackHas = (token) => trackText.includes(token)

  if (String(track?.language || '').toLowerCase() === 'en') score += 30
  if (!track?.hearingImpaired) score += 8
  if (String(track?.source || '').toLowerCase().includes('opensubtitles')) score += 4

  const streamTokens = tokenizeSubtitleContext(streamTitle)
  const trackTokens = new Set(tokenizeSubtitleContext(trackText))
  for (const token of streamTokens) {
    if (trackTokens.has(token)) score += 6
  }

  if (streamHas('1080p') && trackHas('1080p')) score += 24
  if (streamHas('720p') && trackHas('720p')) score += 14
  if ((streamHas('4k') || streamHas('2160')) && (trackHas('4k') || trackHas('2160p'))) score += 14

  if (streamHas('web-dl') && (trackHas('web-dl') || trackHas('webdl'))) score += 26
  if (streamHas('web') && trackHas('web')) score += 10
  if (streamHas('webrip') && trackHas('webrip')) score += 10

  if (streamHas('10bit') && trackHas('10bit')) score += 18
  if (!streamHas('10bit') && trackHas('10bit')) score -= 22

  if ((streamHas('h264') || streamHas('x264')) && (trackHas('h264') || trackHas('x264'))) score += 14
  if ((streamHas('h264') || streamHas('x264')) && trackHas('x265')) score -= 18
  if (streamHas('x265') && trackHas('x265')) score += 10

  if (streamHas('esubs') && (trackHas('esub') || trackHas('esubs'))) score += 16
  if (streamHas('atmos') && trackHas('atmos')) score += 5
  if (streamHas('amzn') && trackHas('amzn')) score += 6

  if (!streamHas('dubbed') && trackHas('dubbed')) score -= 22
  if (!streamHas('hc') && (trackHas('.hc.') || trackHas(' hc ') || trackHas('hc-web') || trackHas('hc-sub'))) score -= 26
  if (!streamHas('hdts') && trackHas('hdts')) score -= 30
  if (!streamHas('cam') && trackHas('cam')) score -= 28
  if (!streamHas('bluray') && trackHas('bluray')) score -= 24
  if (!streamHas('bdrip') && trackHas('bdrip')) score -= 20
  if (!streamHas('dv') && trackHas('dv')) score -= 8
  if (!streamHas('hdr') && trackHas('hdr')) score -= 8

  if (trackHas('retail') && trackHas('english dub') && !streamHas('dubbed')) score -= 14
  if (trackHas('forced') && !streamHas('forced')) score -= 8

  if (streamProvider.includes('moviesmod') && trackText.includes('web')) score += 6

  return score
}

const sortSubtitleTracksForStream = (tracks, stream) => {
  const list = Array.isArray(tracks) ? [...tracks] : []
  if (!stream?.title) {
    return list
  }

  list.sort((a, b) => (
    getSubtitleTrackScore(b, stream) - getSubtitleTrackScore(a, stream)
    || String(a?.label || '').localeCompare(String(b?.label || ''))
    || String(a?.url || '').localeCompare(String(b?.url || ''))
  ))

  return list
}

const formatSubtitleTrackOptionLabel = (track, index) => {
  const language = track?.label || track?.language || `Track ${index + 1}`
  const release = track?.release || track?.fileName || track?.origin || ''
  const compactRelease = String(release)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!compactRelease) return language
  if (compactRelease.length <= 38) return `${language} | ${compactRelease}`
  return `${language} | ${compactRelease.slice(0, 35)}...`
}

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

const inferStreamType = (stream) => {
  if (stream?.streamType === 'hls' || stream?.streamType === 'mp4') {
    return stream.streamType
  }
  const url = String(stream?.url || '').toLowerCase()
  return (
    url.includes('.m3u8')
    || url.includes('/playlist/')
    || url.includes('/manifest')
    || url.includes('/hls/')
    || url.includes('format=m3u8')
  )
    ? 'hls'
    : 'mp4'
}

const getMovieProviderPreferenceScore = (provider, contentType) => {
  const normalized = String(provider || '').toLowerCase()

  if (contentType === 'animation') {
    if (normalized.includes('uhdmovies')) return 6
    if (normalized.includes('moviesmod')) return 5
    if (normalized.includes('vixsrc')) return 4
    if (normalized.includes('moviesdrive') || normalized.includes('moviebox')) return 3
  } else {
    if (normalized.includes('vixsrc')) return 5
    if (normalized.includes('moviesmod')) return 4
    if (normalized.includes('uhdmovies')) return 3
    if (normalized.includes('moviesdrive') || normalized.includes('moviebox')) return 3
  }

  if (normalized.includes('auto')) return 1
  if (normalized.includes('4khdhub')) return contentType === 'animation' ? -20 : -12
  return 0
}

const getMovieQualityPreferenceScore = (quality) => {
  const normalized = String(quality || '').toLowerCase()
  if (normalized.includes('1080')) return 4
  if (normalized.includes('4k') || normalized.includes('2160')) return 3
  if (normalized.includes('720')) return 2
  if (normalized.includes('auto')) return 1
  return 0
}

const getMovieAudioPreferenceScore = (stream) => {
  const combined = [
    stream?.title,
    stream?.provider,
    stream?.url,
  ].filter(Boolean).join(' ').toLowerCase()

  const englishMarkers = [
    'english',
    'eng',
    'english dub',
    'dubbed',
    'amzn',
    'itunes',
  ]
  const nonEnglishMarkers = [
    'hindi',
    'tamil',
    'telugu',
    'malayalam',
    'kannada',
    'punjabi',
    'bengali',
    'urdu',
    'arabic',
    'korean',
    'japanese',
    'french',
    'german',
    'italian',
    'russian',
    'spanish',
    'latino',
    'chinese',
    'mandarin',
    'dual audio',
    'multi audio',
    'multi-audio',
    'esubs',
  ]

  let score = 0

  if (englishMarkers.some(marker => combined.includes(marker))) score += 10

  const nonEnglishHits = nonEnglishMarkers.filter(marker => combined.includes(marker)).length
  if (nonEnglishHits > 0) {
    score -= nonEnglishHits * 18
    if (!combined.includes('english') && !combined.includes('eng')) score -= 12
  }

  return score
}

const sortStreamsByPreference = (items, contentType) => [...items].sort((left, right) => {
  const leftType = inferStreamType(left)
  const rightType = inferStreamType(right)
  const leftTypeScore = leftType === 'hls' ? 3 : leftType === 'mp4' ? 1 : 0
  const rightTypeScore = rightType === 'hls' ? 3 : rightType === 'mp4' ? 1 : 0

  return rightTypeScore - leftTypeScore
    || getMovieAudioPreferenceScore(right) - getMovieAudioPreferenceScore(left)
    || getMovieProviderPreferenceScore(right.provider, contentType)
      - getMovieProviderPreferenceScore(left.provider, contentType)
    || getMovieQualityPreferenceScore(right.quality)
      - getMovieQualityPreferenceScore(left.quality)
    || String(left.provider || '').localeCompare(String(right.provider || ''))
    || String(left.url || '').localeCompare(String(right.url || ''))
})

const normalizeBinaryPayload = (data) => {
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data).buffer
  }
  return new Uint8Array(0).buffer
}

const createLoaderStats = (startTime, loaded) => {
  const endTime = performance.now()
  const size = Number.isFinite(loaded) ? loaded : 0

  return {
    aborted: false,
    loaded: size,
    total: size,
    retry: 0,
    chunkCount: 1,
    bwEstimate: 0,
    loading: {
      start: startTime,
      first: endTime,
      end: endTime,
    },
    parsing: {
      start: endTime,
      end: endTime,
    },
    buffering: {
      start: 0,
      first: 0,
      end: 0,
    },
  }
}

function createMovieLoader(base, getHeaders) {
  const Base = base

  return class MovieLoader extends Base {
    constructor(config) {
      super(config)
      this.aborted = false
    }

    destroy() {
      this.aborted = true
      if (super.destroy) super.destroy()
    }

    abort(...args) {
      this.aborted = true
      if (super.abort) super.abort(...args)
    }

    load(context, config, callbacks) {
      this.aborted = false

      const url = context.url
      const isBlobUrl = url.startsWith('blob:')
      const isSegment = url.includes('.ts')
        || url.includes('.m4s')
        || url.includes('.aac')
        || url.includes('.mp4')
      const isKey = url.includes('.key') || context.type === 'key'
      const shouldFetchManifest = !isBlobUrl && !isSegment && !isKey
      const headers = getHeaders() || {}

      if (shouldFetchManifest) {
        const startTime = performance.now()

        invoke('fetch_movie_manifest', { url, headers })
          .then((data) => {
            if (this.aborted) return
            callbacks.onSuccess(
              { data, url },
              createLoaderStats(startTime, data.length),
              context,
              null
            )
          })
          .catch((err) => {
            if (this.aborted) return
            callbacks.onError({ code: 0, text: err.toString() }, context, null)
          })

        return
      }

      if (isSegment || isKey) {
        const startTime = performance.now()

        invoke('fetch_movie_segment', { url, headers })
          .then((data) => {
            if (this.aborted) return
            const payload = normalizeBinaryPayload(data)
            callbacks.onSuccess(
              { data: payload, url },
              createLoaderStats(startTime, payload.byteLength),
              context,
              null
            )
          })
          .catch((err) => {
            if (this.aborted) return
            callbacks.onError({ code: 0, text: err.toString() }, context, null)
          })

        return
      }

      super.load(context, config, callbacks)
    }
  }
}

const isSeriesContent = (contentType) => contentType === 'series'

export default function MoviePlayer({
  tmdbId,
  imdbId = null,
  title,
  poster,
  backdrop,
  contentType,
  season = 1,
  episode = 1,
  resumeAt = 0,
  offlinePlayback = null,
  onClose,
}) {
  const reducedEffectsMode = useAppStore(getReducedEffectsMode)
  const videoRef = useRef(null)
  const playerContainerRef = useRef(null)
  const progressRef = useRef(null)
  const hlsRef = useRef(null)
  const hideTimerRef = useRef(null)
  const startupTimerRef = useRef(null)
  const resumeAppliedRef = useRef(false)
  const directMediaUrlRef = useRef('')
  const handledFailureKeyRef = useRef('')
  const streamLoadRequestIdRef = useRef(0)
  const expandedFallbackUsedRef = useRef(false)
  const lastProgressRef = useRef({
    progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
    durationSeconds: 0,
  })

  const [currentSeason, setCurrentSeason] = useState(Number(season) || 1)
  const [currentEpisode, setCurrentEpisode] = useState(Number(episode) || 1)
  const [seasonEpisodes, setSeasonEpisodes] = useState([])
  const [streams, setStreams] = useState([])
  const [streamIndex, setStreamIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingStage, setLoadingStage] = useState('Finding stream...')
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [seekPreviewTime, setSeekPreviewTime] = useState(null)
  const [seekTooltipX, setSeekTooltipX] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [availableResolutions, setAvailableResolutions] = useState(FALLBACK_RESOLUTIONS)
  const [selectedResolution, setSelectedResolution] = useState('auto')
  const [mediaLoading, setMediaLoading] = useState(false)
  const [subtitleTracks, setSubtitleTracks] = useState([])
  const [fallbackSubtitleTracks, setFallbackSubtitleTracks] = useState([])
  const [subtitleCues, setSubtitleCues] = useState([])
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [subtitleMode, setSubtitleMode] = useState('none')
  const [selectedSubtitleTrackKey, setSelectedSubtitleTrackKey] = useState('auto')
  const [resolvedOfflineSubtitlePath, setResolvedOfflineSubtitlePath] = useState(null)
  const offlineMode = Boolean(offlinePlayback?.filePath)
  const offlineStream = useMemo(() => {
    if (!offlineMode || !offlinePlayback?.filePath || !isTauri()) return null

    const subtitleTracks = resolvedOfflineSubtitlePath
      ? [{
        url: resolvedOfflineSubtitlePath,
        label: offlinePlayback.subtitleLabel || 'Offline',
        language: 'en',
        source: 'offline',
      }]
      : []

    return {
      url: offlinePlayback.filePath,
      provider: 'Offline',
      quality: 'Downloaded',
      streamType: 'mp4',
      subtitles: subtitleTracks,
      headers: {},
    }
  }, [offlineMode, offlinePlayback, resolvedOfflineSubtitlePath])

  useEffect(() => {
    if (!offlineMode || !offlinePlayback?.filePath || !isTauri()) {
      setResolvedOfflineSubtitlePath(null)
      return undefined
    }

    if (isSubtitleFilePath(offlinePlayback?.subtitleFilePath)) {
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

  const stream = streams[streamIndex] || null
  const streamType = inferStreamType(stream)
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0
  const effectiveLoading = loading || mediaLoading
  const controlsVisible = showControls || !isPlaying || effectiveLoading || Boolean(error)
  const seasonEpisodeLabel = isSeriesContent(contentType)
    ? `S${String(currentSeason).padStart(2, '0')}E${String(currentEpisode).padStart(2, '0')}`
    : null
  const currentEpisodeIndex = seasonEpisodes.findIndex(
    (item) => Number(item.episode_number) === Number(currentEpisode)
  )
  const hasPrevEpisode = isSeriesContent(contentType) && currentEpisodeIndex > 0
  const hasNextEpisode = isSeriesContent(contentType)
    && currentEpisodeIndex >= 0
    && currentEpisodeIndex < seasonEpisodes.length - 1
  const playerMeta = isSeriesContent(contentType)
    ? `${seasonEpisodeLabel} | ${stream?.provider || 'Provider'} | ${stream?.quality || streamType.toUpperCase()}`
    : `${stream?.provider || 'Provider'} | ${stream?.quality || streamType.toUpperCase()}`
  const subtitleText = useMemo(() => {
    if (!subtitleEnabled || subtitleCues.length === 0) return ''
    const cue = subtitleCues.find(item => currentTime >= item.start && currentTime <= item.end)
    return cue?.text || ''
  }, [currentTime, subtitleCues, subtitleEnabled])
  const isFallbackSubtitleMode = subtitleMode === 'fallback' && subtitleTracks.length > 0
  const subtitleSelectionOptions = useMemo(() => (
    subtitleTracks.map((track, index) => ({
      key: track?.url || `${track?.label || track?.language || 'track'}-${index}`,
      label: formatSubtitleTrackOptionLabel(track, index),
    }))
  ), [subtitleTracks])

  const clearHideTimer = () => {
    window.clearTimeout(hideTimerRef.current)
  }

  const clearStartupTimer = () => {
    window.clearTimeout(startupTimerRef.current)
  }

  const markStartupReady = useCallback(() => {
    clearStartupTimer()
    setError('')
    setErrorDetail('')
    setMediaLoading(false)
  }, [])

  const persistProgress = useCallback((overrides = {}) => {
    const progressSeconds = Math.max(
      0,
      Math.floor(overrides.progressSeconds ?? lastProgressRef.current.progressSeconds ?? 0)
    )
    const durationSeconds = Math.max(
      0,
      Math.floor(overrides.durationSeconds ?? lastProgressRef.current.durationSeconds ?? 0)
    )

    lastProgressRef.current = { progressSeconds, durationSeconds }

    if (progressSeconds <= 0) return Promise.resolve(null)

    return saveProgress({
      contentId: String(tmdbId),
      contentType: contentType === 'series' ? 'tv' : contentType,
      title,
      poster,
      backdrop,
      season: isSeriesContent(contentType) ? currentSeason : null,
      episode: isSeriesContent(contentType) ? currentEpisode : null,
      progressSeconds,
      durationSeconds,
    })
  }, [backdrop, contentType, currentEpisode, currentSeason, poster, title, tmdbId])

  const buildClosePayload = useCallback((snapshot = lastProgressRef.current) => ({
    season: isSeriesContent(contentType) ? currentSeason : null,
    episode: isSeriesContent(contentType) ? currentEpisode : null,
    progressSeconds: Math.max(0, Math.floor(Number(snapshot?.progressSeconds) || 0)),
    durationSeconds: Math.max(0, Math.floor(Number(snapshot?.durationSeconds) || 0)),
  }), [contentType, currentEpisode, currentSeason])

  const handleClosePlayer = useCallback(() => {
    if (isFullscreen) invoke('set_player_fullscreen', { fullscreen: false }).catch(() => {})
    const payload = buildClosePayload()
    persistProgress(payload).catch(() => {})
    onClose?.(payload)
  }, [buildClosePayload, isFullscreen, onClose, persistProgress])

  const scheduleControlsHide = useCallback(() => {
    clearHideTimer()
    if (effectiveLoading || error || !isPlaying) {
      setShowControls(true)
      return
    }

    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false)
      setSeekPreviewTime(null)
    }, CONTROLS_TIMEOUT_MS)
  }, [effectiveLoading, error, isPlaying])

  const revealControls = useCallback(() => {
    setShowControls(true)
    scheduleControlsHide()
  }, [scheduleControlsHide])

  const moveToNextStream = useCallback(() => {
    if (streamIndex < streams.length - 1) {
      setStreamIndex(index => index + 1)
      setError('')
      setErrorDetail('')
      setLoading(false)
      setMediaLoading(true)
      setLoadingStage('Loading player...')
      return
    }

    setError('Could not load stream')
    setLoading(false)
    setMediaLoading(false)
  }, [streamIndex, streams.length])

  const loadResolverStreams = useCallback(async ({ forceRefresh = false, excludeUrls = [] } = {}) => {
    if (offlineMode) {
      return Boolean(offlineStream)
    }

    const requestId = ++streamLoadRequestIdRef.current

    setLoading(true)
    setLoadingStage(forceRefresh ? 'Trying broader fallback...' : 'Finding stream...')
    setError('')
    setErrorDetail('')
    setStreams([])
    setStreamIndex(0)

    try {
      const nextStreams = contentType === 'series'
        ? await getSeriesStreams(tmdbId, currentSeason, currentEpisode, imdbId, { forceRefresh, excludeUrls })
        : contentType === 'animation'
          ? await getAnimationStreams(tmdbId, imdbId, { forceRefresh, excludeUrls })
          : await getMovieStreams(tmdbId, imdbId, { forceRefresh, excludeUrls })

      if (requestId !== streamLoadRequestIdRef.current) return false

      const orderedStreams = sortStreamsByPreference(nextStreams, contentType)
      console.log('[MoviePlayer] resolved streams', {
        forceRefresh,
        count: orderedStreams.length,
        streams: orderedStreams,
      })

      setStreams(orderedStreams)
      setLoading(false)
      setLoadingStage('Loading player...')
      return orderedStreams.length > 0
    } catch (streamError) {
      if (requestId !== streamLoadRequestIdRef.current) return false

      setLoading(false)
      setMediaLoading(false)
      setError('Could not load stream')
      setErrorDetail(streamError instanceof Error ? streamError.message : String(streamError))
      return false
    }
  }, [contentType, currentEpisode, currentSeason, imdbId, offlineMode, offlineStream, tmdbId])

  const tryExpandedFallback = useCallback((detail) => {
    if (expandedFallbackUsedRef.current) {
      setMediaLoading(false)
      setError('Could not load stream')
      setErrorDetail(detail || '')
      return
    }

    expandedFallbackUsedRef.current = true
    handledFailureKeyRef.current = ''
    setError('')
    setErrorDetail('')
    setLoading(false)
    setMediaLoading(true)
    setLoadingStage('Trying broader fallback...')

    const excludeUrls = streams
      .map(item => String(item?.url || '').trim())
      .filter(Boolean)

    console.warn('[MoviePlayer] exhausted current validated streams, requesting broader fallback', {
      contentType,
      attemptedCount: excludeUrls.length,
      attemptedProviders: streams.map(item => item?.provider).filter(Boolean),
      detail: detail || '',
    })

    void loadResolverStreams({ forceRefresh: true, excludeUrls })
      .then((loaded) => {
        if (!loaded) {
          setMediaLoading(false)
          setError('Could not load stream')
          setErrorDetail(detail || 'Broader fallback did not return a playable source')
        }
      })
  }, [contentType, loadResolverStreams, streams])

  const handleStreamFailure = useCallback((detail) => {
    if (offlineMode) {
      clearStartupTimer()
      setLoading(false)
      setMediaLoading(false)
      setError('Could not open offline file')
      setErrorDetail(detail || 'The downloaded file could not be played locally')
      return
    }

    const failureKey = `${streamIndex}:${stream?.url || ''}`
    if (handledFailureKeyRef.current === failureKey) {
      return
    }
    handledFailureKeyRef.current = failureKey
    clearStartupTimer()
    if (streamIndex < streams.length - 1) {
      console.warn('[MoviePlayer] stream failed, trying next candidate', {
        provider: stream?.provider,
        quality: stream?.quality,
        streamType,
        detail: detail || '',
        index: streamIndex,
        nextProvider: streams[streamIndex + 1]?.provider || null,
      })
      moveToNextStream()
      return
    }

    tryExpandedFallback(detail)
  }, [moveToNextStream, offlineMode, stream, streamIndex, streamType, streams, tryExpandedFallback])

  const retryCurrentState = useCallback(() => {
    if (offlineMode) {
      setStreams(offlineStream ? [offlineStream] : [])
      setStreamIndex(0)
      setError('')
      setErrorDetail('')
      setLoading(false)
      setLoadingStage('Loading offline file...')
      setMediaLoading(true)
      setRetryNonce(value => value + 1)
      return
    }

    if (error && streamIndex < streams.length - 1) {
      moveToNextStream()
      return
    }

    expandedFallbackUsedRef.current = false
    setStreams([])
    setStreamIndex(0)
    setError('')
    setErrorDetail('')
    setLoading(true)
    setLoadingStage('Finding stream...')
    setRetryNonce(value => value + 1)
  }, [error, moveToNextStream, offlineMode, offlineStream, streamIndex, streams.length])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video || effectiveLoading || error) return

    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  const skipBy = (delta) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta))
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    const nextMuted = !video.muted
    video.muted = nextMuted
    setIsMuted(nextMuted)
  }

  const toggleFullscreen = () => {
    const next = !isFullscreen
    invoke('set_player_fullscreen', { fullscreen: next }).catch(() => {})
    setIsFullscreen(next)
    revealControls()
  }

  const updateSeekFromClientX = (clientX) => {
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect || !duration) return null

    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const nextTime = duration * ratio
    setSeekPreviewTime(nextTime)
    setSeekTooltipX(clientX - rect.left)
    return nextTime
  }

  const seekTo = (time) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(time)) return
    video.currentTime = time
    setCurrentTime(time)
  }

  const handleResolutionChange = (value) => {
    setSelectedResolution(value)
    const hls = hlsRef.current
    if (!hls) return

    if (value === 'auto') {
      hls.currentLevel = -1
      return
    }

    const levelIndex = hls.levels.findIndex(level => String(level.height) === String(value))
    if (levelIndex >= 0) hls.currentLevel = levelIndex
  }

  const navigateEpisode = useCallback((offset) => {
    if (!isSeriesContent(contentType)) return

    const nextEpisodeMeta = seasonEpisodes[currentEpisodeIndex + offset]
    if (!nextEpisodeMeta) return

    persistProgress().catch(() => {})
    lastProgressRef.current = { progressSeconds: 0, durationSeconds: 0 }
    expandedFallbackUsedRef.current = false
    setCurrentEpisode(Number(nextEpisodeMeta.episode_number))
    setStreams([])
    setStreamIndex(0)
    setError('')
    setErrorDetail('')
    setLoading(true)
    setLoadingStage('Finding stream...')
    setRetryNonce(value => value + 1)
  }, [contentType, currentEpisodeIndex, persistProgress, seasonEpisodes])

  useEffect(() => {
    setCurrentSeason(Number(season) || 1)
    setCurrentEpisode(Number(episode) || 1)
    expandedFallbackUsedRef.current = false
    lastProgressRef.current = {
      progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
      durationSeconds: 0,
    }
  }, [episode, resumeAt, season])

  useEffect(() => {
    if (!isSeriesContent(contentType)) {
      setSeasonEpisodes([])
      return undefined
    }

    let cancelled = false
    getSeasonDetails(tmdbId, currentSeason)
      .then((data) => {
        if (!cancelled) {
          setSeasonEpisodes(data?.episodes || [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeasonEpisodes([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [contentType, currentSeason, tmdbId])

  useEffect(() => {
    if (offlineMode) {
      setFallbackSubtitleTracks([])
      setSubtitleCues([])
      return undefined
    }

    let cancelled = false

    async function loadFallbackSubtitles() {
      try {
        const nextTracks = contentType === 'series'
          ? await getSeriesSubtitles(tmdbId, currentSeason, currentEpisode, imdbId)
          : contentType === 'animation'
            ? await getAnimationSubtitles(tmdbId, imdbId)
            : await getMovieSubtitles(tmdbId, imdbId)

        if (cancelled) return

        setFallbackSubtitleTracks(nextTracks)
      } catch {
        if (cancelled) return
        setFallbackSubtitleTracks([])
      }
    }

    setFallbackSubtitleTracks([])
    setSubtitleCues([])
    loadFallbackSubtitles()

    return () => {
      cancelled = true
    }
  }, [contentType, currentEpisode, currentSeason, imdbId, offlineMode, retryNonce, tmdbId])

  useEffect(() => {
    const providerSubtitleTracks = Array.isArray(stream?.subtitles) ? stream.subtitles : []
    const rankedFallbackTracks = sortSubtitleTracksForStream(fallbackSubtitleTracks, stream)
    const nextTracks = providerSubtitleTracks.length > 0 ? providerSubtitleTracks : rankedFallbackTracks

    setSubtitleTracks(nextTracks)
    setSubtitleEnabled(nextTracks.length > 0)
    setSubtitleMode(
      providerSubtitleTracks.length > 0
        ? 'provider'
        : nextTracks.length > 0
          ? 'fallback'
          : 'none'
    )
    setSelectedSubtitleTrackKey('auto')

    const chosenSource = providerSubtitleTracks.length > 0
      ? `provider:${stream?.provider || 'unknown'}`
      : nextTracks.length > 0
        ? `fallback:${nextTracks[0]?.source || 'wyzie'}`
        : 'none'

    console.log('[MoviePlayer] subtitle source selected', {
      provider: stream?.provider || null,
      chosenSource,
      trackCount: nextTracks.length,
      labels: nextTracks.map(track => track.label || track.language || 'Unknown'),
      topRelease: nextTracks[0]?.release || nextTracks[0]?.fileName || null,
    })
  }, [fallbackSubtitleTracks, stream])

  useEffect(() => {
    if (offlineMode) {
      expandedFallbackUsedRef.current = false
      setStreams(offlineStream ? [offlineStream] : [])
      setStreamIndex(0)
      setError('')
      setErrorDetail('')
      setLoading(false)
      setLoadingStage('Loading offline file...')
      return undefined
    }

    expandedFallbackUsedRef.current = false
    void loadResolverStreams()

    return () => {
      streamLoadRequestIdRef.current += 1
    }
  }, [loadResolverStreams, offlineMode, offlineStream, retryNonce])

  useEffect(() => {
    handledFailureKeyRef.current = ''
    resumeAppliedRef.current = false
    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
    setSelectedResolution('auto')
    setAvailableResolutions(FALLBACK_RESOLUTIONS)
  }, [streamIndex, currentEpisode, currentSeason, retryNonce])

  useEffect(() => {
    const preferredTrack = (
      isFallbackSubtitleMode && selectedSubtitleTrackKey !== 'auto'
        ? subtitleTracks.find(track => (track?.url || '') === selectedSubtitleTrackKey)
        : null
    ) || subtitleTracks.find(track => String(track.language || '').toLowerCase() === 'en')
      || subtitleTracks[0]
    const trackUrl = preferredTrack?.url || null
    const rankedFallbackTracks = sortSubtitleTracksForStream(fallbackSubtitleTracks, stream)

    const switchToFallbackSubtitles = (reason) => {
      if (subtitleMode !== 'provider' || rankedFallbackTracks.length === 0) {
        setSubtitleCues([])
        return
      }

      console.warn('[MoviePlayer] provider subtitles failed, switching to Wyzie fallback', {
        provider: stream?.provider || null,
        reason,
        failedTrack: preferredTrack?.label || preferredTrack?.language || 'Unknown',
        fallbackCount: rankedFallbackTracks.length,
      })
      setSubtitleTracks(rankedFallbackTracks)
      setSubtitleMode('fallback')
      setSelectedSubtitleTrackKey('auto')
      setSubtitleEnabled(true)
      setSubtitleCues([])
    }

    if (!subtitleEnabled || !trackUrl) {
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
      ? invoke('fetch_movie_text', { url: trackUrl })
      : fetch(trackUrl).then(response => {
        if (!response.ok) throw new Error('Subtitle fetch failed')
        return response.text()
      })

    subtitleRequest
      .then(text => {
        if (!cancelled) {
          const parsedCues = parseSubtitles(text)
          if (parsedCues.length === 0) {
            switchToFallbackSubtitles('parsed-empty')
            return
          }
          console.log('[MoviePlayer] subtitle track loaded', {
            source: preferredTrack?.source || 'unknown',
            label: preferredTrack?.label || preferredTrack?.language || 'Unknown',
            release: preferredTrack?.release || preferredTrack?.fileName || null,
            mode: subtitleMode,
            url: trackUrl,
          })
          setSubtitleCues(parsedCues)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          switchToFallbackSubtitles(error?.message || 'fetch-failed')
        }
      })

    return () => {
      cancelled = true
    }
  }, [fallbackSubtitleTracks, isFallbackSubtitleMode, offlineMode, selectedSubtitleTrackKey, stream, subtitleEnabled, subtitleMode, subtitleTracks])

  useEffect(() => {
    if (!stream?.url) return
    console.log('[MoviePlayer] selected stream', {
      provider: stream.provider,
      strategy: stream.strategy || 'unknown',
      quality: stream.quality,
      streamType,
      contentType: stream.contentType || '',
      subtitleCount: Array.isArray(stream.subtitles) ? stream.subtitles.length : 0,
      url: stream.url,
      headers: stream.headers || {},
      index: streamIndex,
      total: streams.length,
    })
  }, [stream, streamIndex, streamType, streams.length])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream?.url) {
      setMediaLoading(false)
      return undefined
    }

    let disposed = false
    let manifestBlobUrl = ''

    clearStartupTimer()
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (directMediaUrlRef.current) {
      directMediaUrlRef.current = ''
    }

    video.pause()
    video.removeAttribute('src')
    video.load()
    setMediaLoading(true)
    setLoadingStage('Loading player...')

    const handleStartupFailure = (detail = 'Startup timeout while loading stream') => {
      const activeVideo = videoRef.current
      if (activeVideo && (activeVideo.currentTime > 0 || activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)) {
        markStartupReady()
        return
      }
      handleStreamFailure(detail)
    }

    startupTimerRef.current = window.setTimeout(() => {
      handleStartupFailure()
    }, STARTUP_TIMEOUT_MS)

    if (streamType === 'hls' && Hls.isSupported()) {
      const MovieLoader = createMovieLoader(Hls.DefaultConfig.loader, () => stream.headers || {})
      const hls = new Hls({
        loader: MovieLoader,
        fLoader: MovieLoader,
        pLoader: MovieLoader,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        lowLatencyMode: false,
        progressive: true,
        startLevel: -1,
      })

      hlsRef.current = hls

      invoke('fetch_movie_manifest', {
        url: stream.url,
        headers: stream.headers || {},
      })
        .then((rewrittenManifest) => {
          if (disposed) return

          manifestBlobUrl = URL.createObjectURL(new Blob(
            [rewrittenManifest],
            { type: 'application/vnd.apple.mpegurl' }
          ))

          hls.loadSource(manifestBlobUrl)
          hls.attachMedia(video)
        })
        .catch((manifestError) => {
          if (disposed) return
          handleStartupFailure(
            manifestError instanceof Error ? manifestError.message : String(manifestError)
          )
        })

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels
          .map(level => level.height)
          .filter(Boolean)
          .filter((value, index, array) => array.indexOf(value) === index)
          .sort((a, b) => b - a)

        if (levels.length > 0) {
          setAvailableResolutions([
            { value: 'auto', label: 'Auto' },
            ...levels.map(value => ({ value: String(value), label: `${value}p` })),
          ])
        }

        video.play().catch(() => {})
      })

      hls.on(Hls.Events.LEVEL_LOADED, () => {
        clearStartupTimer()
        startupTimerRef.current = window.setTimeout(() => {
          handleStartupFailure('Startup timeout after initial HLS level load')
        }, 15000)
      })

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        markStartupReady()
      })

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          const detail = [data.type, data.details, data.reason].filter(Boolean).join(' | ')
          handleStartupFailure(detail || 'Fatal HLS playback error')
        }
      })

      return () => {
        disposed = true
        clearStartupTimer()
        if (manifestBlobUrl) {
          URL.revokeObjectURL(manifestBlobUrl)
        }
        hls.destroy()
        hlsRef.current = null
      }
    }

    const isLocalAssetStream = offlineMode
      || stream.url.startsWith('asset:')
      || stream.url.includes('asset.localhost')

    if (isLocalAssetStream) {
      invoke('register_media_proxy_file', {
        filePath: offlinePlayback?.filePath || stream.url,
        contentType: 'video/mp4',
      })
        .then((proxyUrl) => {
          if (disposed) return
          directMediaUrlRef.current = proxyUrl
          video.src = proxyUrl
          video.load()
          video.play().catch(() => {})
        })
        .catch((proxyError) => {
          if (disposed) return
          handleStartupFailure(
            proxyError instanceof Error ? proxyError.message : String(proxyError)
          )
        })

      return () => {
        disposed = true
        clearStartupTimer()
        video.pause()
        video.removeAttribute('src')
        video.load()
        if (directMediaUrlRef.current) {
          directMediaUrlRef.current = ''
        }
      }
    }

    invoke('register_media_proxy_stream', {
      url: stream.url,
      headers: stream.headers || {},
      sessionId: null,
    })
      .then((proxyUrl) => {
        if (disposed) return
        directMediaUrlRef.current = proxyUrl
        video.src = proxyUrl
        video.load()
        video.play().catch(() => {})
      })
      .catch((proxyError) => {
        if (disposed) return
        handleStartupFailure(
          proxyError instanceof Error ? proxyError.message : String(proxyError)
        )
      })

    return () => {
      disposed = true
      clearStartupTimer()
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (directMediaUrlRef.current) {
        directMediaUrlRef.current = ''
      }
    }
  }, [handleStreamFailure, markStartupReady, offlineMode, stream, streamType])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream?.url) return undefined

    const applyPendingResume = () => {
      if (resumeAppliedRef.current) return
      const safeResumeTime = video.duration
        ? Math.min(lastProgressRef.current.progressSeconds || 0, Math.max(video.duration - 2, 0))
        : lastProgressRef.current.progressSeconds || 0

      if (!Number.isFinite(safeResumeTime) || safeResumeTime <= 0) {
        resumeAppliedRef.current = true
        return
      }

      video.currentTime = safeResumeTime
      setCurrentTime(safeResumeTime)
      resumeAppliedRef.current = true
    }

    const syncState = () => {
      const nextProgress = video.currentTime || 0
      const nextDuration = video.duration || 0

      setCurrentTime(nextProgress)
      setDuration(nextDuration)
      if (video.buffered.length > 0) {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1))
      }

      lastProgressRef.current = {
        progressSeconds: nextProgress,
        durationSeconds: nextDuration,
      }

      if (nextProgress > 0 || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        markStartupReady()
      }
    }

    const handlePlay = () => {
      setIsPlaying(true)
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        markStartupReady()
      }
    }
    const handlePlaying = () => {
      setIsPlaying(true)
      markStartupReady()
    }
    const handlePause = () => setIsPlaying(false)
    const handleCanPlay = () => {
      applyPendingResume()
      markStartupReady()
    }
    const handleLoadedData = () => {
      applyPendingResume()
      markStartupReady()
    }
    const handleLoadedMetadata = () => {
      syncState()
      applyPendingResume()
    }
    const handleVideoError = () => {
      const mediaError = video.error
      const detail = mediaError
        ? `MediaError code ${mediaError.code}${mediaError.message ? ` | ${mediaError.message}` : ''}`
        : 'HTMLVideoElement error'
      handleStreamFailure(detail)
    }

    video.addEventListener('timeupdate', syncState)
    video.addEventListener('durationchange', syncState)
    video.addEventListener('progress', syncState)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('play', handlePlay)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleVideoError)

    return () => {
      video.removeEventListener('timeupdate', syncState)
      video.removeEventListener('durationchange', syncState)
      video.removeEventListener('progress', syncState)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleVideoError)
    }
  }, [handleStreamFailure, markStartupReady, stream?.url])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = isMuted
    video.playbackRate = playbackRate
  }, [isMuted, playbackRate, volume])

  useEffect(() => {
    return () => { invoke('set_player_fullscreen', { fullscreen: false }).catch(() => {}) }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event) => {
      const activeTag = document.activeElement?.tagName
      if (activeTag === 'INPUT' || activeTag === 'SELECT') return
      if (event.code === 'Space') { event.preventDefault(); revealControls(); togglePlayback() }
      if (event.code === 'ArrowLeft') { event.preventDefault(); revealControls(); skipBy(-10) }
      if (event.code === 'ArrowRight') { event.preventDefault(); revealControls(); skipBy(10) }
      if (event.key?.toLowerCase() === 'm') { revealControls(); toggleMute() }
      if (event.key?.toLowerCase() === 'f') toggleFullscreen()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectiveLoading, error, revealControls, isFullscreen])

  useEffect(() => {
    clearHideTimer()
    if (effectiveLoading || error || !isPlaying) {
      setShowControls(true)
      return undefined
    }

    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false)
      setSeekPreviewTime(null)
    }, CONTROLS_TIMEOUT_MS)

    return () => clearHideTimer()
  }, [effectiveLoading, error, isPlaying, isFullscreen])

  useEffect(() => {
    const handleUserActivity = () => {
      setShowControls(true)
      scheduleControlsHide()
    }

    document.addEventListener('mousemove', handleUserActivity)
    document.addEventListener('pointermove', handleUserActivity)
    document.addEventListener('pointerdown', handleUserActivity)
    document.addEventListener('click', handleUserActivity, true)

    return () => {
      document.removeEventListener('mousemove', handleUserActivity)
      document.removeEventListener('pointermove', handleUserActivity)
      document.removeEventListener('pointerdown', handleUserActivity)
      document.removeEventListener('click', handleUserActivity, true)
    }
  }, [scheduleControlsHide])

  useEffect(() => {
    if (!isPlaying) return undefined

    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video || video.paused) return
      persistProgress().catch(() => {})
    }, 10000)

    return () => window.clearInterval(timer)
  }, [isPlaying, persistProgress])

  useEffect(() => () => {
    clearHideTimer()
    clearStartupTimer()
    persistProgress().catch(() => {})
    if (directMediaUrlRef.current) {
      directMediaUrlRef.current = ''
    }
  }, [persistProgress])

  return createPortal(
    <AnimatePresence>
      <motion.div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: reducedEffectsMode ? 'blur(2px)' : 'blur(8px)',
          WebkitBackdropFilter: reducedEffectsMode ? 'blur(2px)' : 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            handleClosePlayer()
          }
        }}
      >
        <motion.div
          ref={playerContainerRef}
          style={{
            position: 'relative',
            width: isFullscreen ? '100vw' : '92vw',
            height: isFullscreen ? '100vh' : '88vh',
            maxWidth: isFullscreen ? '100vw' : 1600,
            borderRadius: isFullscreen ? 0 : 16,
            overflow: 'hidden',
            background: '#000',
            border: isFullscreen ? 'none' : '1px solid var(--border)',
            boxShadow: isFullscreen ? 'none' : reducedEffectsMode ? '0 0 42px rgba(0,0,0,0.64)' : '0 0 80px rgba(0,0,0,0.9)',
            cursor: controlsVisible ? 'default' : 'none',
          }}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: reducedEffectsMode ? 0.18 : 0.35, ease: [0.4, 0, 0.2, 1] }}
          onMouseMove={revealControls}
          onClickCapture={revealControls}
        >
          {backdrop && (
            <img
              src={backdrop}
              alt={title}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: reducedEffectsMode ? 'blur(10px)' : 'blur(24px)',
                opacity: reducedEffectsMode ? 0.1 : 0.16,
                transform: 'scale(1.05)',
              }}
            />
          )}

          <AnimatePresence>
            {controlsVisible && (
              <motion.div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  zIndex: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0.24), transparent)',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
                  <span
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                    style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 16px var(--accent-glow)' }}
                  >
                    {stream?.quality || 'Auto'}
                  </span>
                  <span
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                    style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    {stream?.provider || 'Provider'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={toggleFullscreen} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                  </button>
                  <button onClick={handleClosePlayer} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all" title="Close">
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 52, paddingBottom: 140 }}>
            <video
              ref={videoRef}
              style={isFullscreen
                ? { width: '100vw', height: '100vh', objectFit: 'contain', position: 'fixed', top: 0, left: 0, background: '#000', opacity: error ? 0.2 : 1 }
                : { width: '100%', height: '100%', objectFit: 'contain', background: '#000', opacity: error ? 0.2 : 1 }}
              playsInline
              controls={false}
              onClick={() => {
                revealControls()
                if (!effectiveLoading && !error) {
                  togglePlayback()
                }
              }}
            />

            {subtitleEnabled && subtitleText && !effectiveLoading && !error && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: controlsVisible ? 132 : 88,
                  transform: 'translateX(-50%)',
                  zIndex: 26,
                  maxWidth: '80%',
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: 18,
                  lineHeight: 1.4,
                  textAlign: 'center',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                {subtitleText}
              </div>
            )}

            {effectiveLoading && (
              <div
                className="flex flex-col items-center justify-center gap-4 text-center"
                style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 12, padding: 24 }}
              >
                {poster && (
                  <img
                    src={poster}
                    alt={title}
                    style={{
                      width: 140,
                      height: 210,
                      objectFit: 'cover',
                      borderRadius: 16,
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
                    }}
                  />
                )}
                <span className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <p className="text-xl font-display text-white">{title}</p>
                {seasonEpisodeLabel && <p className="text-sm text-white/50">{seasonEpisodeLabel}</p>}
                <p className="text-sm text-white/60 font-mono">{loadingStage || 'Loading player...'}</p>
              </div>
            )}

            {error && !effectiveLoading && (
              <div className="flex flex-col items-center gap-4 text-center" style={{ position: 'absolute', inset: 0, justifyContent: 'center', background: 'rgba(0,0,0,0.52)', zIndex: 14 }}>
                <p className="text-2xl font-display text-white">{error}</p>
                <p className="text-sm text-white/50">
                  {stream
                    ? `${stream.provider || 'This provider'} did not return a playable source.`
                    : 'No playable stream was returned.'}
                </p>
                {errorDetail && <p className="max-w-xl text-xs text-white/35 font-mono">{errorDetail}</p>}
                <button onClick={retryCurrentState} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}>
                  {streamIndex < streams.length - 1 && streams[streamIndex + 1]
                    ? `Try ${streams[streamIndex + 1].provider || 'Next Provider'}`
                    : 'Retry Streams'}
                </button>
              </div>
            )}
          </div>

          {!effectiveLoading && !error && (
            <AnimatePresence>
              {controlsVisible && (
                <motion.div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 30,
                    padding: '18px 18px 14px',
                    background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.78) 18%, rgba(0,0,0,0.92))',
                    backdropFilter: reducedEffectsMode ? 'blur(6px)' : 'blur(14px)',
                  }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                >
                  <div
                    ref={progressRef}
                    onPointerDown={(event) => {
                      const nextTime = updateSeekFromClientX(event.clientX)
                      if (Number.isFinite(nextTime)) seekTo(nextTime)
                    }}
                    onPointerMove={(event) => {
                      updateSeekFromClientX(event.clientX)
                      revealControls()
                    }}
                    onPointerLeave={() => setSeekPreviewTime(null)}
                    style={{ position: 'relative', height: 16, marginBottom: 14, cursor: 'pointer' }}
                  >
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.14)' }} />
                    <div style={{ position: 'absolute', left: 0, top: 6, height: 4, width: `${bufferedPercent}%`, borderRadius: 999, background: 'rgba(255,255,255,0.28)' }} />
                    <div style={{ position: 'absolute', left: 0, top: 6, height: 4, width: `${progressPercent}%`, borderRadius: 999, background: 'linear-gradient(90deg, #8b5cf6, #a855f7)' }} />
                    <div style={{ position: 'absolute', left: `calc(${progressPercent}% - 7px)`, top: 1, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 14px rgba(168,85,247,0.8)' }} />
                    {seekPreviewTime !== null && (
                      <div style={{ position: 'absolute', left: seekTooltipX, bottom: 18, transform: 'translateX(-50%)', padding: '4px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.82)', color: '#fff', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {formatTime(seekPreviewTime)}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                    <div className="flex items-center gap-3 min-w-0 justify-self-start">
                      <button onClick={togglePlayback} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button onClick={() => skipBy(-10)} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <SkipBack size={16} />
                      </button>
                      <button onClick={() => skipBy(10)} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <SkipForward size={16} />
                      </button>
                      <button onClick={toggleMute} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={isMuted ? 0 : volume}
                        onChange={(event) => {
                          const nextVolume = Number(event.target.value)
                          setVolume(nextVolume)
                          setIsMuted(nextVolume === 0)
                        }}
                        style={{ width: 96, accentColor: '#8b5cf6' }}
                      />
                      <span className="text-xs text-white/70 font-mono">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 justify-self-center">
                      {hasPrevEpisode && (
                        <button onClick={() => navigateEpisode(-1)} className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          Prev Episode
                        </button>
                      )}
                      {seasonEpisodeLabel && (
                        <span className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap flex items-center" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          {seasonEpisodeLabel}
                        </span>
                      )}
                      {hasNextEpisode && (
                        <button onClick={() => navigateEpisode(1)} className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          Next Episode
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 justify-self-end">
                      {subtitleTracks.length > 0 && (
                        <button
                          onClick={() => setSubtitleEnabled(value => !value)}
                          className="px-3 h-10 rounded-xl flex items-center gap-2 text-xs font-semibold text-white"
                          style={{
                            background: subtitleEnabled ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.08)',
                            border: subtitleEnabled ? '1px solid rgba(139,92,246,0.55)' : '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          <Captions size={15} />
                          {subtitleEnabled ? 'SUB ON' : 'SUB OFF'}
                        </button>
                      )}
                      {isFallbackSubtitleMode && (
                        <select
                          value={selectedSubtitleTrackKey}
                          onChange={(event) => setSelectedSubtitleTrackKey(event.target.value)}
                          disabled={!subtitleEnabled}
                          className="h-10 rounded-xl px-3 text-xs font-semibold text-white outline-none"
                          style={{
                            background: subtitleEnabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
                            border: subtitleEnabled ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.05)',
                            color: subtitleEnabled ? '#fff' : 'rgba(255,255,255,0.45)',
                            cursor: subtitleEnabled ? 'pointer' : 'not-allowed',
                            width: selectedSubtitleTrackKey === 'auto' ? 92 : 'auto',
                            maxWidth: 220,
                          }}
                          title={subtitleEnabled ? 'Choose subtitle track' : 'Turn subtitles on to choose a track'}
                        >
                          <option value="auto" style={{ color: '#000' }}>CC Auto</option>
                          {subtitleSelectionOptions.map(option => (
                            <option key={option.key} value={option.key} style={{ color: '#000' }}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <select value={selectedResolution} onChange={(event) => handleResolutionChange(event.target.value)} className="h-10 rounded-xl px-3 text-xs font-semibold text-white outline-none" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {(availableResolutions.length > 0 ? availableResolutions : FALLBACK_RESOLUTIONS).map(option => (
                          <option key={option.value} value={option.value} style={{ color: '#000' }}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select value={String(playbackRate)} onChange={(event) => setPlaybackRate(Number(event.target.value))} className="h-10 rounded-xl px-3 text-xs font-semibold text-white outline-none" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {PLAYBACK_SPEEDS.map(option => (
                          <option key={option} value={option} style={{ color: '#000' }}>
                            {option}x
                          </option>
                        ))}
                      </select>
                      <button onClick={toggleFullscreen} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-white/55">
                    <span>{title}</span>
                    <span>{playerMeta}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
