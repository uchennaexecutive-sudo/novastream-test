import { useEffect } from 'react'
import useWatchPartyStore from '../../store/useWatchPartyStore'

export default function useWatchPartyPlaybackBridge({
  videoRef,
  enabled,
  label,
  subtitleText = '',
  subtitleEnabled = false,
}) {
  const registerPlaybackSurface = useWatchPartyStore((state) => state.registerPlaybackSurface)
  const unregisterPlaybackSurface = useWatchPartyStore((state) => state.unregisterPlaybackSurface)
  const syncPlaybackSubtitles = useWatchPartyStore((state) => state.syncPlaybackSubtitles)

  useEffect(() => {
    const element = videoRef.current

    if (!enabled || !element) {
      return undefined
    }

    let hasRegisteredSurface = false

    const elementLooksReady = () => (
      element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      || (!element.paused && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
      || element.currentTime > 0
    )

    const syncPlaybackSurface = () => registerPlaybackSurface({
      element,
      label,
    })

    const syncPlaybackSurfaceIfReady = () => {
      if (!elementLooksReady()) {
        return
      }

      hasRegisteredSurface = true
      void syncPlaybackSurface()
    }

    const handleMediaReady = () => {
      syncPlaybackSurfaceIfReady()
    }

    const handlePlaybackGone = () => {
      hasRegisteredSurface = false
      void unregisterPlaybackSurface(element)
    }

    element.addEventListener('canplay', handleMediaReady)
    element.addEventListener('play', handleMediaReady)
    element.addEventListener('playing', handleMediaReady)
    element.addEventListener('emptied', handlePlaybackGone)
    element.addEventListener('ended', handlePlaybackGone)

    syncPlaybackSurfaceIfReady()

    const playbackHealthTimer = window.setInterval(() => {
      if (element.ended || (!hasRegisteredSurface && !elementLooksReady())) {
        return
      }

      hasRegisteredSurface = true
      void syncPlaybackSurface()
    }, 10000)

    return () => {
      element.removeEventListener('canplay', handleMediaReady)
      element.removeEventListener('play', handleMediaReady)
      element.removeEventListener('playing', handleMediaReady)
      element.removeEventListener('emptied', handlePlaybackGone)
      element.removeEventListener('ended', handlePlaybackGone)
      window.clearInterval(playbackHealthTimer)
      void unregisterPlaybackSurface(element)
    }
  }, [enabled, label, registerPlaybackSurface, unregisterPlaybackSurface, videoRef])

  useEffect(() => {
    if (!enabled) {
      void syncPlaybackSubtitles({ text: '', visible: false })
      return undefined
    }

    const normalizedText = String(subtitleText || '').trim()

    void syncPlaybackSubtitles({
      text: normalizedText,
      visible: Boolean(subtitleEnabled && normalizedText),
    })

    return () => {
      void syncPlaybackSubtitles({ text: '', visible: false })
    }
  }, [enabled, subtitleEnabled, subtitleText, syncPlaybackSubtitles])
}
