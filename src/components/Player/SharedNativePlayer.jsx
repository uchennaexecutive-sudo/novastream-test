import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Hls from 'hls.js'
import { invoke } from '@tauri-apps/api/core'
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

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2]
const FALLBACK_RESOLUTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]
const CONTROLS_TIMEOUT_MS = 3000
const STARTUP_TIMEOUT_MS = 12000
const SESSION_STARTUP_TIMEOUT_MS = 30000

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

const formatHlsErrorDetail = (data) => {
  const parts = [
    data?.type,
    data?.details,
    data?.reason,
    data?.response?.code ? `HTTP ${data.response.code}` : '',
  ].filter(Boolean)

  return parts.join(' | ')
}

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

function createTauriLoader(base, getHeaders, getSessionId) {
  const Base = base

  return class TauriLoader extends Base {
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
      const lowerUrl = url.toLowerCase()
      const isPlaylist = lowerUrl.includes('.m3u8')
      const isImageTrack =
        lowerUrl.includes('.gif') ||
        lowerUrl.includes('.jpg') ||
        lowerUrl.includes('.jpeg') ||
        lowerUrl.includes('.png') ||
        lowerUrl.includes('.webp')
      const isSegment = lowerUrl.includes('.ts')
        || lowerUrl.includes('.m4s')
        || lowerUrl.includes('.aac')
        || lowerUrl.includes('.mp4')
      const isKey = lowerUrl.includes('.key') || context.type === 'key'

      const headers = getHeaders() || {}
      const sessionId = getSessionId?.() || null

      if (isPlaylist && !isBlobUrl) {
        const startTime = performance.now()

        invoke('fetch_hls_manifest', { url, headers, sessionId })
          .then((data) => {
            if (this.aborted) return
            callbacks.onSuccess({ data, url }, createLoaderStats(startTime, data.length), context, null)
          })
          .catch((err) => {
            if (this.aborted) return
            callbacks.onError({ code: 0, text: err.toString() }, context, null)
          })

        return
      }

      if (isImageTrack) {
        const startTime = performance.now()
        callbacks.onSuccess(
          { data: new Uint8Array(0).buffer, url },
          createLoaderStats(startTime, 0),
          context,
          null
        )
        return
      }

      if (isSegment || isKey) {
        const startTime = performance.now()

        invoke('fetch_hls_segment', { url, headers, sessionId })
          .then((data) => {
            if (this.aborted) return
            const payload = normalizeBinaryPayload(data)
            callbacks.onSuccess({ data: payload, url }, createLoaderStats(startTime, payload.byteLength), context, null)
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

export default function SharedNativePlayer({
  title,
  backdrop,
  streamUrl,
  streamHeaders = {},
  streamSessionId = null,
  streamType = 'hls',
  streamLabel = 'Source',
  streamMeta = '',
  loading = false,
  loadingStage = 'Buffering...',
  loadingHost = '',
  error = '',
  errorDetail = '',
  onRetry = null,
  onClose,
  onStreamFailure = null,
  onPersistProgress = null,
  onPlaybackSnapshot = null,
  subtitleCues = [],
  subtitleEnabled = false,
  onToggleSubtitles = null,
  hasPrev = false,
  hasNext = false,
  onPrev = null,
  onNext = null,
  prevLabel = '',
  nextLabel = '',
  resumeAt = 0,
  resumeKey = '',
}) {
  const videoRef = useRef(null)
  const playerContainerRef = useRef(null)
  const progressRef = useRef(null)
  const hlsRef = useRef(null)
  const hideTimerRef = useRef(null)
  const startupTimerRef = useRef(null)
  const resumeAppliedRef = useRef(false)
  const lastProgressRef = useRef({
    progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
    durationSeconds: 0,
  })

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

  const subtitleText = useMemo(() => {
    if (!subtitleEnabled || subtitleCues.length === 0) return ''
    const cue = subtitleCues.find(item => currentTime >= item.start && currentTime <= item.end)
    return cue?.text || ''
  }, [currentTime, subtitleCues, subtitleEnabled])

  const effectiveLoading = loading || mediaLoading
  const controlsVisible = showControls || !isPlaying || effectiveLoading || Boolean(error)
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0

  const clearHideTimer = () => {
    window.clearTimeout(hideTimerRef.current)
  }

  const clearStartupTimer = () => {
    window.clearTimeout(startupTimerRef.current)
  }

  const markStartupReady = useCallback(() => {
    clearStartupTimer()
    setMediaLoading(false)
  }, [])

  const persistProgress = useCallback((overrides = {}) => {
    const progressSeconds = Math.max(
      0,
      Math.floor(
        overrides.progressSeconds
        ?? lastProgressRef.current.progressSeconds
        ?? 0
      )
    )
    const durationSeconds = Math.max(
      0,
      Math.floor(
        overrides.durationSeconds
        ?? lastProgressRef.current.durationSeconds
        ?? 0
      )
    )

    lastProgressRef.current = { progressSeconds, durationSeconds }

    if (typeof onPersistProgress !== 'function' || progressSeconds <= 0) {
      return Promise.resolve(null)
    }

    return Promise.resolve(onPersistProgress({ progressSeconds, durationSeconds }))
  }, [onPersistProgress])

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

  const notifyStreamFailure = useCallback((detail) => {
    clearStartupTimer()
    setMediaLoading(false)
    if (typeof onStreamFailure === 'function') {
      onStreamFailure(detail)
    }
  }, [onStreamFailure])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video || effectiveLoading || error) return

    if (video.paused) video.play().catch(() => { })
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
    if (!document.fullscreenElement) container.requestFullscreen().catch(() => { })
    else document.exitFullscreen().catch(() => { })
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

  const handleClose = () => {
    persistProgress().catch(() => { })
    onClose?.()
  }

  useEffect(() => {
    resumeAppliedRef.current = false
    lastProgressRef.current = {
      progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
      durationSeconds: 0,
    }
    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
  }, [resumeAt, resumeKey])

  useEffect(() => {
    const video = videoRef.current
    if (!streamUrl || !video) {
      setMediaLoading(false)
      return undefined
    }

    let disposed = false
    let manifestBlobUrl = ''
    const isHlsStream = streamType === 'hls' || streamUrl.includes('.m3u8')

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    video.pause()
    video.removeAttribute('src')
    video.load()
    setSelectedResolution('auto')
    setAvailableResolutions(FALLBACK_RESOLUTIONS)
    setMediaLoading(true)

    const handleStartupFailure = (detail = 'Startup timeout while loading stream') => {
      const activeVideo = videoRef.current
      if (activeVideo && (activeVideo.currentTime > 0 || activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)) {
        markStartupReady()
        return
      }
      notifyStreamFailure(detail)
    }

    if (isHlsStream && Hls.isSupported()) {
      const TauriLoader = createTauriLoader(
        Hls.DefaultConfig.loader,
        () => streamHeaders || {},
        () => streamSessionId
      )
      const hls = new Hls({
        loader: TauriLoader,
        fLoader: TauriLoader,
        pLoader: TauriLoader,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        lowLatencyMode: false,
        progressive: true,
        startLevel: -1,
      })
      hlsRef.current = hls

      const attachSource = (sourceValue) => {
        if (disposed) return
        clearStartupTimer()
        startupTimerRef.current = window.setTimeout(() => {
          handleStartupFailure()
        }, streamSessionId ? SESSION_STARTUP_TIMEOUT_MS : STARTUP_TIMEOUT_MS)
        hls.loadSource(sourceValue)
        hls.attachMedia(video)
      }

      invoke('fetch_hls_manifest', {
        url: streamUrl,
        headers: streamHeaders,
        sessionId: streamSessionId,
      })
        .then((rewrittenManifest) => {
          if (disposed) return

          manifestBlobUrl = URL.createObjectURL(new Blob(
            [rewrittenManifest],
            { type: 'application/vnd.apple.mpegurl' }
          ))
          attachSource(manifestBlobUrl)
        })
        .catch((manifestError) => {
          if (disposed) return
          const detail = manifestError instanceof Error
            ? manifestError.message
            : String(manifestError)

          if (streamSessionId) {
            handleStartupFailure(detail || 'Manifest fetch failed')
            return
          }

          attachSource(streamUrl)
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

        video.play().catch(() => { })
      })

      hls.on(Hls.Events.ERROR, (_, data) => {
        const detail = formatHlsErrorDetail(data)
        if (data?.fatal) {
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

    startupTimerRef.current = window.setTimeout(() => {
      handleStartupFailure('Startup timeout while loading media source')
    }, STARTUP_TIMEOUT_MS)

    video.src = streamUrl
    video.play().catch(() => { })

    return () => {
      disposed = true
      clearStartupTimer()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [markStartupReady, notifyStreamFailure, resumeKey, streamHeaders, streamSessionId, streamType, streamUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return undefined

    const applyPendingResume = () => {
      if (resumeAppliedRef.current) return
      const safeResumeTime = video.duration
        ? Math.min(Number(resumeAt) || 0, Math.max(video.duration - 2, 0))
        : Number(resumeAt) || 0

      if (!Number.isFinite(safeResumeTime) || safeResumeTime <= 0) {
        resumeAppliedRef.current = true
        return
      }

      video.currentTime = safeResumeTime
      setCurrentTime(safeResumeTime)
      lastProgressRef.current.progressSeconds = safeResumeTime
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

      if (typeof onPlaybackSnapshot === 'function') {
        onPlaybackSnapshot({
          progressSeconds: nextProgress,
          durationSeconds: nextDuration,
        })
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
      notifyStreamFailure(detail)
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
  }, [markStartupReady, notifyStreamFailure, onPlaybackSnapshot, resumeAt, resumeKey, streamUrl])

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
  }, [effectiveLoading, error, revealControls])

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
      persistProgress().catch(() => { })
    }, 10000)

    return () => window.clearInterval(timer)
  }, [isPlaying, persistProgress])

  useEffect(() => () => {
    clearHideTimer()
    clearStartupTimer()
    persistProgress().catch(() => { })
  }, [persistProgress])

  return createPortal(
    <AnimatePresence>
      <motion.div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => { if (event.target === event.currentTarget) handleClose() }}
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
          {backdrop && <img src={backdrop} alt={title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(24px)', opacity: 0.16, transform: 'scale(1.05)' }} />}
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
                    {streamLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={toggleFullscreen} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                  </button>
                  <button onClick={handleClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all" title="Close">
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
              <div style={{ position: 'absolute', left: '50%', bottom: controlsVisible ? 132 : 88, transform: 'translateX(-50%)', zIndex: 26, maxWidth: '80%', padding: '8px 14px', borderRadius: 999, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 18, lineHeight: 1.4, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                {subtitleText}
              </div>
            )}

            {effectiveLoading && (
              <div className="flex flex-col items-center gap-3" style={{ position: 'absolute', inset: 0, justifyContent: 'center', background: 'rgba(0,0,0,0.28)', zIndex: 12 }}>
                <span className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span className="text-sm text-white/60 font-mono">{loadingStage || 'Buffering...'}</span>
                <span className="text-xs text-white/40">{streamLabel}</span>
              </div>
            )}

            {error && !effectiveLoading && (
              <div className="flex flex-col items-center gap-4 text-center" style={{ position: 'absolute', inset: 0, justifyContent: 'center', background: 'rgba(0,0,0,0.52)', zIndex: 14 }}>
                <p className="text-2xl font-display text-white">{error}</p>
                <p className="text-sm text-white/50">{streamLabel} did not return a playable source.</p>
                {errorDetail && <p className="max-w-xl text-xs text-white/35 font-mono">{errorDetail}</p>}
                {typeof onRetry === 'function' && (
                  <button onClick={onRetry} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}>
                    Retry {streamLabel}
                  </button>
                )}
              </div>
            )}
          </div>
          {!effectiveLoading && !error && (
            <AnimatePresence>
              {controlsVisible && (
                <motion.div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '18px 18px 14px', background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.78) 18%, rgba(0,0,0,0.92))', backdropFilter: 'blur(14px)' }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                  <div ref={progressRef} onPointerDown={handleProgressPointerDown} onPointerMove={handleProgressHover} onPointerLeave={() => setSeekPreviewTime(null)} style={{ position: 'relative', height: 16, marginBottom: 14, cursor: 'pointer' }}>
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
                      {hasPrev && (
                        <button onClick={onPrev} className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          {prevLabel || 'Previous'}
                        </button>
                      )}
                      {hasNext && (
                        <button onClick={onNext} className="px-4 h-10 rounded-xl text-xs font-semibold text-white whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          {nextLabel || 'Next'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 justify-self-end">
                      {typeof onToggleSubtitles === 'function' && (
                        <button onClick={onToggleSubtitles} className="px-3 h-10 rounded-xl flex items-center gap-2 text-xs font-semibold text-white" style={{ background: subtitleEnabled ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.08)', border: subtitleEnabled ? '1px solid rgba(139,92,246,0.55)' : '1px solid rgba(255,255,255,0.08)' }}>
                          <Captions size={15} />
                          {subtitleEnabled ? 'SUB ON' : 'SUB OFF'}
                        </button>
                      )}
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
                    <span>{title}</span>
                    <span>{streamMeta}</span>
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
