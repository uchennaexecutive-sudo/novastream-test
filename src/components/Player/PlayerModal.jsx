import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Maximize, Minimize, X } from 'lucide-react'
import {
  ANIME_SERVER_LABELS,
  getAnimeEmbeds,
  getEmbedsForMediaType,
  isMovieLikeMediaType,
} from '../../lib/embeds'
import { addToHistory } from '../../lib/supabase'
import { saveProgress } from '../../lib/progress'
import { imgOriginal, imgW500 } from '../../lib/tmdb'
import {
  buildResumeMessages,
  DEFAULT_SERVER_LABELS,
  parseMessagePayload,
  withResumeParams,
} from './iframePlayerShared'

export default function PlayerModal({
  isOpen,
  onClose,
  tmdbId,
  mediaType,
  title,
  posterPath,
  backdropPath,
  season,
  episode,
  resumeAt = 0,
  durationHintSeconds = 0,
  isAnime = false,
}) {
  const [sourceIndex, setSourceIndex] = useState(0)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showChrome, setShowChrome] = useState(true)

  const timeoutRef = useRef(null)
  const chromeTimerRef = useRef(null)
  const playerContainerRef = useRef(null)
  const iframeRef = useRef(null)
  const wasOpenRef = useRef(false)
  const playbackLoadedAtRef = useRef(0)
  const lastProgressRef = useRef({
    progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
    durationSeconds: Math.max(0, Math.floor(Number(durationHintSeconds) || 0)),
  })
  const resumeTimersRef = useRef([])

  const embeds = isAnime
    ? getAnimeEmbeds(tmdbId, season, episode)
    : getEmbedsForMediaType(mediaType, tmdbId, season, episode)

  const resumeSeconds = Math.max(
    0,
    Math.floor(lastProgressRef.current.progressSeconds || 0),
    Math.floor(Number(resumeAt) || 0)
  )
  const currentUrl = withResumeParams(embeds[sourceIndex], resumeSeconds)
  const serverLabels = isAnime ? ANIME_SERVER_LABELS : DEFAULT_SERVER_LABELS
  const serverLabel = serverLabels[sourceIndex] || `Server ${sourceIndex + 1}`
  const contentType = isAnime ? 'anime' : mediaType
  const normalizedSeason = isMovieLikeMediaType(mediaType) ? null : (Number(season) || null)
  const normalizedEpisode = isMovieLikeMediaType(mediaType) ? null : (Number(episode) || null)
  const poster = posterPath?.startsWith?.('http') ? posterPath : imgW500(posterPath)
  const backdrop = backdropPath?.startsWith?.('http') ? backdropPath : imgOriginal(backdropPath)

  const clearResumeTimers = useCallback(() => {
    resumeTimersRef.current.forEach(timer => window.clearTimeout(timer))
    resumeTimersRef.current = []
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

    if (!tmdbId || progressSeconds <= 0) return Promise.resolve(null)

    const durationSeconds = Math.max(
      0,
      Math.floor(
        overrides.durationSeconds
        ?? lastProgressRef.current.durationSeconds
        ?? durationHintSeconds
        ?? 0
      )
    )

    lastProgressRef.current = { progressSeconds, durationSeconds }

    return saveProgress({
      contentId: String(tmdbId),
      contentType,
      title,
      poster,
      backdrop,
      season: normalizedSeason,
      episode: normalizedEpisode,
      progressSeconds,
      durationSeconds,
    })
  }, [backdrop, contentType, normalizedEpisode, normalizedSeason, poster, title, tmdbId])

  const persistBestGuessProgress = useCallback(() => {
    const elapsedSeconds = playbackLoadedAtRef.current
      ? Math.max(0, Math.floor((Date.now() - playbackLoadedAtRef.current) / 1000))
      : 0

    const guessedProgress = Math.max(
      lastProgressRef.current.progressSeconds || 0,
      Math.max(0, Math.floor(Number(resumeAt) || 0)) + elapsedSeconds
    )

    return persistProgress({
      progressSeconds: guessedProgress,
      durationSeconds: lastProgressRef.current.durationSeconds || 0,
    })
  }, [persistProgress, resumeAt])

  const sendResumeMessages = useCallback(() => {
    const targetWindow = iframeRef.current?.contentWindow
    if (!targetWindow || resumeSeconds <= 0) return

    clearResumeTimers()

    const messages = buildResumeMessages(resumeSeconds)
    const delays = [300, 1000, 2500]

    delays.forEach((delay) => {
      const timer = window.setTimeout(() => {
        messages.forEach(message => targetWindow.postMessage(message, '*'))
      }, delay)

      resumeTimersRef.current.push(timer)
    })
  }, [clearResumeTimers, resumeSeconds])

  const startTimeout = useCallback(() => {
    window.clearTimeout(timeoutRef.current)
    setLoading(true)
    timeoutRef.current = window.setTimeout(() => {
      setLoading(false)
      if (sourceIndex < embeds.length - 1) {
        setSourceIndex(index => index + 1)
      } else {
        setError(true)
      }
    }, 8000)
  }, [embeds.length, sourceIndex])

  const handleIframeLoad = useCallback(() => {
    window.clearTimeout(timeoutRef.current)
    if (!playbackLoadedAtRef.current) playbackLoadedAtRef.current = Date.now()
    setLoading(false)
    sendResumeMessages()
  }, [sendResumeMessages])

  useEffect(() => {
    if (!isOpen) return undefined

    const handleBlur = () => {
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') {
          window.focus()
        }
      }, 0)
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined

    const originalOpen = window.open
    window.open = () => null

    return () => {
      window.open = originalOpen
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      lastProgressRef.current = {
        progressSeconds: Math.max(0, Math.floor(Number(resumeAt) || 0)),
        durationSeconds: Math.max(0, Math.floor(Number(durationHintSeconds) || 0)),
      }
      playbackLoadedAtRef.current = 0
      clearResumeTimers()
      setSourceIndex(0)
      setError(false)
      setLoading(true)
      setShowChrome(true)

      addToHistory({
        tmdb_id: tmdbId,
        media_type: mediaType,
        title,
        poster_path: posterPath,
        season,
        episode,
      }).catch(() => {})
    } else if (wasOpenRef.current) {
      persistBestGuessProgress().catch(() => {})
      clearResumeTimers()
      wasOpenRef.current = false

    }

    return () => window.clearTimeout(timeoutRef.current)
  }, [
    clearResumeTimers,
    episode,
    isOpen,
    mediaType,
    persistBestGuessProgress,
    posterPath,
    resumeAt,
    durationHintSeconds,
    season,
    title,
    tmdbId,
  ])

  useEffect(() => {
    if (isOpen && !error) {
      startTimeout()
    }

    return () => window.clearTimeout(timeoutRef.current)
  }, [error, isOpen, sourceIndex, startTimeout])

  useEffect(() => {
    return () => { invoke('set_player_fullscreen', { fullscreen: false }).catch(() => {}) }
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        setIsFullscreen((prev) => {
          const next = !prev
          invoke('set_player_fullscreen', { fullscreen: next }).catch(() => {})
          return next
        })
      }

      if (event.key === 'Escape') {
        if (isFullscreen) {
          invoke('set_player_fullscreen', { fullscreen: false }).catch(() => {})
          setIsFullscreen(false)
        } else {
          persistBestGuessProgress().catch(() => {})
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, persistBestGuessProgress])

  const resetChromeTimer = useCallback(() => {
    setShowChrome(true)
    window.clearTimeout(chromeTimerRef.current)
    chromeTimerRef.current = window.setTimeout(() => setShowChrome(false), 3000)
  }, [])

  useEffect(() => {
    if (isOpen) {
      resetChromeTimer()
    }

    return () => window.clearTimeout(chromeTimerRef.current)
  }, [isOpen, resetChromeTimer])

  useEffect(() => {
    if (!isOpen) return undefined

    const handleMessage = (event) => {
      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow || event.source !== iframeWindow) return

      const progressUpdate = parseMessagePayload(event.data)
      if (!progressUpdate) return

      if (!playbackLoadedAtRef.current) playbackLoadedAtRef.current = Date.now()

      lastProgressRef.current = {
        progressSeconds: progressUpdate.progressSeconds,
        durationSeconds: progressUpdate.durationSeconds || lastProgressRef.current.durationSeconds || Math.max(0, Math.floor(Number(durationHintSeconds) || 0)),
      }

      persistProgress(progressUpdate).catch(() => {})
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [durationHintSeconds, isOpen, persistProgress])

  useEffect(() => () => {
    window.clearTimeout(timeoutRef.current)
    window.clearTimeout(chromeTimerRef.current)
    clearResumeTimers()

    if (wasOpenRef.current) {
      persistBestGuessProgress().catch(() => {})
    }
  }, [clearResumeTimers, persistBestGuessProgress])

  const handleClose = () => {
    persistBestGuessProgress().catch(() => {})
    onClose()
  }

  const toggleFullscreen = () => {
    const next = !isFullscreen
    invoke('set_player_fullscreen', { fullscreen: next }).catch(() => {})
    setIsFullscreen(next)
  }

  const switchSource = (nextIndex) => {
    persistBestGuessProgress().catch(() => {})
    clearResumeTimers()
    playbackLoadedAtRef.current = 0
    setSourceIndex(nextIndex)
    setError(false)
    setLoading(true)
  }

  if (!isOpen) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) handleClose()
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
            boxShadow: isFullscreen ? 'none' : '0 0 80px rgba(0,0,0,0.9)',
          }}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          onMouseMove={resetChromeTimer}
        >
          <AnimatePresence>
            {showChrome && (
              <motion.div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  flexShrink: 0,
                  background: 'rgba(0,0,0,0.7)',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(12px)',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  zIndex: 20,
                }}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
                  {embeds.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => switchSource(index)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5"
                      style={{
                        background: index === sourceIndex ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                        color: index === sourceIndex ? '#fff' : 'rgba(255,255,255,0.5)',
                        boxShadow: index === sourceIndex ? '0 0 16px var(--accent-glow)' : 'none',
                      }}
                    >
                      {index === sourceIndex && loading && (
                        <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      )}
                      {serverLabels[index] || `Server ${index + 1}`}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <button
                    onClick={toggleFullscreen}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                    title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
                  >
                    {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                  </button>
                  <button
                    onClick={handleClose}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4">
              <span className="text-4xl opacity-40">!</span>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                All servers exhausted. Try opening in a new tab.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => switchSource(0)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                >
                  Retry {serverLabels[0] || 'Server 1'}
                </button>
                <a
                  href={withResumeParams(embeds[0], resumeSeconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}
                >
                  Open in New Tab
                </a>
              </div>
            </div>
          ) : (
            <>
              <iframe
                ref={iframeRef}
                key={`${currentUrl}-${sourceIndex}-${resumeSeconds}`}
                src={currentUrl}
                allowFullScreen
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                referrerPolicy="no-referrer"
                loading="lazy"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                }}
                onLoad={handleIframeLoad}
                onError={() => {
                  window.clearTimeout(timeoutRef.current)
                  if (sourceIndex < embeds.length - 1) {
                    setSourceIndex(index => index + 1)
                  } else {
                    setError(true)
                  }
                }}
              />

              {loading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.6)',
                    zIndex: 5,
                  }}
                >
                  <div className="flex flex-col items-center gap-3">
                    <span className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    <span className="text-xs text-white/50 font-mono">
                      Loading {serverLabel}...
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
