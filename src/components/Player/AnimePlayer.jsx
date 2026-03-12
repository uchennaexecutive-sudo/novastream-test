import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Hls from 'hls.js'
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
import { ANIWATCH_BASE_URL, getAnimeEpisodes, getAnimeStream, searchAnime } from '../../lib/consumet'

const STREAM_SERVER = { id: 'hd-2', label: 'HD-2' }
const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2]
const FALLBACK_RESOLUTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]
const CONTROLS_TIMEOUT_MS = 3000
const STREAM_RETRY_DELAY_MS = 2000
const MAX_STREAM_ATTEMPTS = 3

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

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

export default function AnimePlayer({ animeTitle, season, episode, backdrop, prefetchedAnime = null, onClose }) {
  const videoRef = useRef(null)
  const playerContainerRef = useRef(null)
  const progressRef = useRef(null)
  const hlsRef = useRef(null)
  const hideTimerRef = useRef(null)
  const retryTimerRef = useRef(null)
  const retryScheduledRef = useRef(false)
  const streamAttemptRef = useRef(0)
  const [animeId, setAnimeId] = useState('')
  const [episodes, setEpisodes] = useState([])
  const [currentEpisode, setCurrentEpisode] = useState(Number(episode) || 1)
  const [streamUrl, setStreamUrl] = useState('')
  const [streamSources, setStreamSources] = useState([])
  const [subtitleTracks, setSubtitleTracks] = useState([])
  const [subtitleCues, setSubtitleCues] = useState([])
  const [subtitleText, setSubtitleText] = useState('')
  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingStage, setLoadingStage] = useState('Finding anime...')
  const [error, setError] = useState('')
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
  const hasPrevEpisode = episodes.some(item => Number(item.number) === Number(currentEpisode) - 1)
  const hasNextEpisode = episodes.some(item => Number(item.number) === Number(currentEpisode) + 1)

  const clearHideTimer = () => {
    window.clearTimeout(hideTimerRef.current)
  }
  const clearRetryTimer = () => {
    retryScheduledRef.current = false
    window.clearTimeout(retryTimerRef.current)
  }
  const resetPlaybackState = () => {
    setStreamUrl('')
    setStreamSources([])
    setSubtitleTracks([])
    setSubtitleCues([])
    setSubtitleText('')
    setSelectedResolution('auto')
    setAvailableResolutions(FALLBACK_RESOLUTIONS)
    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
  }
  const scheduleControlsHide = () => {
    clearHideTimer()
    if (loading || error || !isPlaying) {
      setShowControls(true)
      return
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false)
      setSeekPreviewTime(null)
    }, CONTROLS_TIMEOUT_MS)
  }
  const revealControls = () => {
    setShowControls(true)
    scheduleControlsHide()
  }
  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
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
    const container = playerContainerRef.current
    if (!container) return
    if (!document.fullscreenElement) container.requestFullscreen().catch(() => {})
    else document.exitFullscreen().catch(() => {})
    revealControls()
  }
  const goToEpisode = (nextEpisode) => {
    const match = episodes.find(item => Number(item.number) === Number(nextEpisode))
    if (!match) return

    clearRetryTimer()
    streamAttemptRef.current = 0
    resetPlaybackState()
    setCurrentEpisode(Number(nextEpisode))
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    setRetryNonce(value => value + 1)
    revealControls()
  }
  const updateSeekFromClientX = (clientX) => {
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect || !duration) return null
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setSeekPreviewTime(duration * ratio)
    setSeekTooltipX(clientX - rect.left)
    return duration * ratio
  }
  const seekTo = (time) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(time)) return
    video.currentTime = time
    setCurrentTime(time)
  }
  const handleProgressPointerDown = (event) => {
    const nextTime = updateSeekFromClientX(event.clientX)
    if (!Number.isFinite(nextTime)) return
    seekTo(nextTime)
  }
  const handleProgressHover = (event) => {
    updateSeekFromClientX(event.clientX)
    revealControls()
  }
  const handleProgressLeave = () => setSeekPreviewTime(null)
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
  const retryFreshStream = () => {
    clearRetryTimer()
    streamAttemptRef.current = 0
    resetPlaybackState()
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    setRetryNonce(value => value + 1)
  }
  const scheduleFreshStreamRetry = () => {
    if (retryScheduledRef.current) return
    if (streamAttemptRef.current >= MAX_STREAM_ATTEMPTS) {
      setError('Could not load stream')
      setLoading(false)
      setLoadingStage('')
      return
    }

    retryScheduledRef.current = true
    setLoading(true)
    setLoadingStage('Fetching stream...')
    setError('')
    resetPlaybackState()

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    retryTimerRef.current = window.setTimeout(() => {
      retryScheduledRef.current = false
      setRetryNonce(value => value + 1)
    }, STREAM_RETRY_DELAY_MS)
  }

  useEffect(() => {
    clearRetryTimer()
    streamAttemptRef.current = 0
    setCurrentEpisode(Number(episode) || 1)
  }, [episode])

  useEffect(() => {
    clearRetryTimer()
    streamAttemptRef.current = 0
    resetPlaybackState()
    setAnimeId(prefetchedAnime?.animeId || '')
    setEpisodes(prefetchedAnime?.episodes || [])
    setLoading(true)
    setLoadingStage(prefetchedAnime?.animeId && prefetchedAnime?.episodes?.length ? 'Fetching stream...' : 'Finding anime...')
    setError('')

    let cancelled = false

    async function loadAnime() {
      if (prefetchedAnime?.animeId && prefetchedAnime?.episodes?.length) {
        setAnimeId(prefetchedAnime.animeId)
        setEpisodes(prefetchedAnime.episodes)
        return
      }

      try {
        const anime = await searchAnime(animeTitle)
        if (!anime?.id) throw new Error('Anime not found')
        if (cancelled) return
        setLoadingStage('Loading episodes...')
        const nextEpisodes = await getAnimeEpisodes(anime.id)
        if (cancelled) return
        setAnimeId(anime.id)
        setEpisodes(nextEpisodes)
      } catch {
        if (!cancelled) {
          setError('Could not load stream')
          setLoading(false)
          setLoadingStage('')
        }
      }
    }

    loadAnime()
    return () => { cancelled = true }
  }, [animeTitle, prefetchedAnime])

  useEffect(() => {
    if (!animeId || episodes.length === 0) return undefined

    clearRetryTimer()
    let cancelled = false

    async function resolveStream() {
      const targetEpisode = episodes.find(item => Number(item.number) === Number(currentEpisode))
      if (!targetEpisode?.episodeId) {
        setError('Could not load stream')
        setLoading(false)
        setLoadingStage('')
        return
      }

      streamAttemptRef.current += 1
      setLoading(true)
      setLoadingStage('Fetching stream...')
      setError('')
      resetPlaybackState()

      try {
        const payload = await getAnimeStream(targetEpisode.episodeId, STREAM_SERVER.id, { fresh: true })
        if (cancelled) return
        if (!payload?.url || !String(payload.url).includes('.m3u8')) throw new Error('Invalid stream')

        const captionTracks = (payload.tracks || []).filter(track => track.kind === 'captions')
        setStreamUrl(payload.url)
        setStreamSources(payload.sources || [])
        setSubtitleTracks(captionTracks)
        setSubtitleEnabled(captionTracks.length > 0)
        setLoadingStage('Buffering...')
      } catch {
        if (!cancelled) {
          scheduleFreshStreamRetry()
        }
      }
    }

    resolveStream()
    return () => { cancelled = true }
  }, [animeId, currentEpisode, episodes, retryNonce])

  useEffect(() => {
    const preferredTrack = subtitleTracks.find(track => String(track.lang || '').toLowerCase().includes('english')) || subtitleTracks[0]
    if (!subtitleEnabled || !preferredTrack?.url) {
      setSubtitleCues([])
      setSubtitleText('')
      return undefined
    }
    let cancelled = false
    fetch(preferredTrack.url)
      .then(response => response.text())
      .then(text => {
        if (!cancelled) setSubtitleCues(parseVtt(text))
      })
      .catch(() => {
        if (!cancelled) setSubtitleCues([])
      })
    return () => { cancelled = true }
  }, [subtitleEnabled, subtitleTracks])

  useEffect(() => {
    if (!subtitleEnabled || subtitleCues.length === 0) {
      setSubtitleText('')
      return
    }
    const cue = subtitleCues.find(item => currentTime >= item.start && currentTime <= item.end)
    setSubtitleText(cue?.text || '')
  }, [currentTime, subtitleCues, subtitleEnabled])

  useEffect(() => {
    const video = videoRef.current
    if (!streamUrl || !video) return undefined
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    video.pause()
    video.removeAttribute('src')
    video.load()
    setSelectedResolution('auto')
    setAvailableResolutions(FALLBACK_RESOLUTIONS)
    setLoading(true)
    setLoadingStage('Buffering...')

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        lowLatencyMode: false,
        progressive: true,
        startLevel: -1,
      })
      hlsRef.current = hls
      hls.attachMedia(video)
      hls.loadSource(streamUrl)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels
          .map(level => level.height)
          .filter(Boolean)
          .filter((value, index, array) => array.indexOf(value) === index)
          .sort((a, b) => b - a)
        if (levels.length > 0) {
          setAvailableResolutions([{ value: 'auto', label: 'Auto' }, ...levels.map(value => ({ value: String(value), label: `${value}p` }))])
        }
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          scheduleFreshStreamRetry()
        }
      })
      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
      video.play().catch(() => {})
    }

    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [streamUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const syncState = () => {
      setCurrentTime(video.currentTime || 0)
      setDuration(video.duration || 0)
      if (video.buffered.length > 0) setBufferedEnd(video.buffered.end(video.buffered.length - 1))
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleCanPlay = () => {
      setLoading(false)
      setLoadingStage('')
    }
    video.addEventListener('timeupdate', syncState)
    video.addEventListener('durationchange', syncState)
    video.addEventListener('progress', syncState)
    video.addEventListener('loadedmetadata', syncState)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    return () => {
      video.removeEventListener('timeupdate', syncState)
      video.removeEventListener('durationchange', syncState)
      video.removeEventListener('progress', syncState)
      video.removeEventListener('loadedmetadata', syncState)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [streamUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = isMuted
    video.playbackRate = playbackRate
  }, [isMuted, playbackRate, volume])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
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
  }, [isMuted, loading, isPlaying, isFullscreen])

  useEffect(() => {
    clearHideTimer()
    if (loading || error || !isPlaying) {
      setShowControls(true)
      return undefined
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false)
      setSeekPreviewTime(null)
    }, CONTROLS_TIMEOUT_MS)
    return () => clearHideTimer()
  }, [error, isFullscreen, isPlaying, loading])

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
  }, [error, isPlaying, loading])

  useEffect(() => () => {
    clearHideTimer()
    clearRetryTimer()
  }, [])

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0
  const controlsVisible = showControls || !isPlaying || loading || Boolean(error)

  return createPortal(
    <AnimatePresence>
      <motion.div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        <motion.div
          ref={playerContainerRef}
          style={{ position: 'relative', width: '92vw', height: '88vh', maxWidth: 1600, borderRadius: 16, overflow: 'hidden', background: '#000', border: '1px solid var(--border)', boxShadow: '0 0 80px rgba(0,0,0,0.9)', cursor: controlsVisible ? 'default' : 'none' }}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          onMouseMove={revealControls}
          onClickCapture={revealControls}
        >
          {backdrop && <img src={backdrop} alt={animeTitle} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(24px)', opacity: 0.16, transform: 'scale(1.05)' }} />}
          <AnimatePresence>
            {controlsVisible && (
              <motion.div
                style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0.24), transparent)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
                  <span
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                    style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 16px var(--accent-glow)' }}
                  >
                    {STREAM_SERVER.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={toggleFullscreen} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                  </button>
                  <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all" title="Close">
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 52, paddingBottom: 140 }}>
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <span className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span className="text-sm text-white/60 font-mono">{loadingStage}</span>
                <span className="text-xs text-white/40">{apiHost} / {STREAM_SERVER.label}</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-2xl font-display text-white">{error}</p>
                <p className="text-sm text-white/50">HD-2 did not return a playable source after 3 fresh attempts.</p>
                <button onClick={retryFreshStream} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}>Retry HD-2</button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  style={isFullscreen
                    ? { width: '100vw', height: '100vh', objectFit: 'contain', position: 'fixed', top: 0, left: 0, background: '#000' }
                    : { width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                  playsInline
                  controls={false}
                  onClick={() => {
                    revealControls()
                    togglePlayback()
                  }}
                />
                {subtitleEnabled && subtitleText && (
                  <div style={{ position: 'absolute', left: '50%', bottom: controlsVisible ? 132 : 88, transform: 'translateX(-50%)', zIndex: 26, maxWidth: '80%', padding: '8px 14px', borderRadius: 999, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 18, lineHeight: 1.4, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                    {subtitleText}
                  </div>
                )}
              </>
            )}
          </div>
          {!loading && !error && (
            <AnimatePresence>
              {controlsVisible && (
                <motion.div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '18px 18px 14px', background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.78) 18%, rgba(0,0,0,0.92))', backdropFilter: 'blur(14px)' }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                  <div ref={progressRef} onPointerDown={handleProgressPointerDown} onPointerMove={handleProgressHover} onPointerLeave={handleProgressLeave} style={{ position: 'relative', height: 16, marginBottom: 14, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.14)' }} />
                    <div style={{ position: 'absolute', left: 0, top: 6, height: 4, width: `${bufferedPercent}%`, borderRadius: 999, background: 'rgba(255,255,255,0.28)' }} />
                    <div style={{ position: 'absolute', left: 0, top: 6, height: 4, width: `${progressPercent}%`, borderRadius: 999, background: 'linear-gradient(90deg, #8b5cf6, #a855f7)' }} />
                    <div style={{ position: 'absolute', left: `calc(${progressPercent}% - 7px)`, top: 1, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 14px rgba(168,85,247,0.8)' }} />
                    {seekPreviewTime !== null && <div style={{ position: 'absolute', left: seekTooltipX, bottom: 18, transform: 'translateX(-50%)', padding: '4px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.82)', color: '#fff', fontSize: 11, whiteSpace: 'nowrap' }}>{formatTime(seekPreviewTime)}</div>}
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                    <div className="flex items-center gap-3 min-w-0 justify-self-start">
                      <button onClick={togglePlayback} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
                      <button onClick={() => skipBy(-10)} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}><SkipBack size={16} /></button>
                      <button onClick={() => skipBy(10)} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}><SkipForward size={16} /></button>
                      <button onClick={toggleMute} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>{isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                      <input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => { const nextVolume = Number(event.target.value); setVolume(nextVolume); setIsMuted(nextVolume === 0) }} style={{ width: 96, accentColor: '#8b5cf6' }} />
                      <span className="text-xs text-white/70 font-mono">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    </div>
                    <div className="flex items-center gap-2 justify-self-center">
                      {hasPrevEpisode && (
                        <button onClick={() => goToEpisode(currentEpisode - 1)} className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          &larr; Ep {currentEpisode - 1}
                        </button>
                      )}
                      {hasNextEpisode && (
                        <button onClick={() => goToEpisode(currentEpisode + 1)} className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          Ep {currentEpisode + 1} &rarr;
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 justify-self-end">
                      <button onClick={() => setSubtitleEnabled(value => !value)} className="px-3 h-10 rounded-xl flex items-center gap-2 text-xs font-semibold text-white" style={{ background: subtitleEnabled ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.08)', border: subtitleEnabled ? '1px solid rgba(139,92,246,0.55)' : '1px solid rgba(255,255,255,0.08)' }}>
                        <Captions size={15} />
                        {subtitleEnabled ? 'SUB ON' : 'SUB OFF'}
                      </button>
                      <select value={selectedResolution} onChange={(event) => handleResolutionChange(event.target.value)} className="h-10 rounded-xl px-3 text-xs font-semibold text-white outline-none" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {(availableResolutions.length > 0 ? availableResolutions : FALLBACK_RESOLUTIONS).map(option => <option key={option.value} value={option.value} style={{ color: '#000' }}>{option.label}</option>)}
                      </select>
                      <select value={String(playbackRate)} onChange={(event) => setPlaybackRate(Number(event.target.value))} className="h-10 rounded-xl px-3 text-xs font-semibold text-white outline-none" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {PLAYBACK_SPEEDS.map(option => <option key={option} value={option} style={{ color: '#000' }}>{option}x</option>)}
                      </select>
                      <button onClick={toggleFullscreen} className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>{isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}</button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-white/55">
                    <span>{animeTitle}</span>
                    <span>Season {season} Episode {currentEpisodeMeta?.number || currentEpisode} | {STREAM_SERVER.label} | {streamSources.length > 0 ? 'HLS' : 'Direct'}</span>
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
