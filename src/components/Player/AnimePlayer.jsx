import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Hls from 'hls.js'
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react'
import {
  CONSUMET_BASE_URL,
  CONSUMET_INSTANCES,
  getAnimeEpisodes,
  getAnimeStream,
  searchAnime,
} from '../../lib/consumet'

const SERVER_TABS = ['GogoAnime']

export default function AnimePlayer({ animeTitle, season, episode, backdrop, onClose }) {
  const videoRef = useRef(null)
  const playerContainerRef = useRef(null)
  const hlsRef = useRef(null)
  const [streamUrl, setStreamUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [instanceIndex, setInstanceIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const currentBaseUrl = CONSUMET_INSTANCES[instanceIndex] || CONSUMET_BASE_URL

  const currentInstanceLabel = useMemo(() => {
    try {
      return new URL(currentBaseUrl).host
    } catch {
      return currentBaseUrl
    }
  }, [currentBaseUrl])

  useEffect(() => {
    let cancelled = false

    async function resolveStream() {
      setLoading(true)
      setError('')
      setStreamUrl('')

      try {
        const result = await searchAnime(animeTitle, currentBaseUrl)
        if (!result?.id) throw new Error('Anime not found')

        const episodes = await getAnimeEpisodes(result.id, currentBaseUrl)
        const targetEpisode = episodes.find(item => Number(item.number) === Number(episode))
        if (!targetEpisode?.id) throw new Error('Episode not found')

        const url = await getAnimeStream(targetEpisode.id, currentBaseUrl)
        if (!url) throw new Error('Stream not found')

        if (!cancelled) {
          setStreamUrl(url)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError('Could not load stream')
          setLoading(false)
        }
      }
    }

    resolveStream()
    return () => { cancelled = true }
  }, [animeTitle, currentBaseUrl, episode, season])

  useEffect(() => {
    const video = videoRef.current
    if (!streamUrl || !video) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (Hls.isSupported()) {
      const hls = new Hls()
      hlsRef.current = hls
      hls.loadSource(streamUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          setError('Could not load stream')
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
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
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

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  const tryNextServer = () => {
    setInstanceIndex(index => (index + 1) % CONSUMET_INSTANCES.length)
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        style={{
          position: 'fixed',
          inset: 0,
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
        onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        <motion.div
          ref={playerContainerRef}
          style={{
            position: 'relative',
            width: '92vw',
            height: '88vh',
            maxWidth: 1600,
            borderRadius: 16,
            overflow: 'hidden',
            background: '#000',
            border: '1px solid var(--border)',
            boxShadow: '0 0 80px rgba(0,0,0,0.9)',
          }}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        >
          {backdrop && (
            <img
              src={backdrop}
              alt={animeTitle}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(24px)',
                opacity: 0.16,
                transform: 'scale(1.05)',
              }}
            />
          )}

          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.7)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
              {SERVER_TABS.map(tab => (
                <button
                  key={tab}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    boxShadow: '0 0 16px var(--accent-glow)',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleFullscreen}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 52,
              paddingBottom: 92,
            }}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <span className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span className="text-sm text-white/60 font-mono">Loading stream...</span>
                <span className="text-xs text-white/40">{currentInstanceLabel}</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-2xl font-display text-white">{error}</p>
                <p className="text-sm text-white/50">
                  Consumet did not return a playable source from {currentInstanceLabel}.
                </p>
                <button
                  onClick={tryNextServer}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}
                >
                  Try Next Server
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                }}
                playsInline
                controls={false}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            )}
          </div>

          {!loading && !error && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '14px 18px',
                background: 'rgba(0,0,0,0.72)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(14px)',
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlayback}
                  className="px-4 py-2 rounded-full flex items-center gap-2"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  <span className="text-sm font-medium">{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  onClick={toggleMute}
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>

              <div className="text-right">
                <p className="font-display text-base text-white">{animeTitle}</p>
                <p className="text-xs text-white/45">Season {season} Episode {episode}</p>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
