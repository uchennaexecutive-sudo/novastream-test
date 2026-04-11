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

    const syncPlaybackSurface = () => registerPlaybackSurface({
      element,
      label,
    })

    void syncPlaybackSurface()

    const handleMediaReady = () => {
      void syncPlaybackSurface()
    }

    const handlePlaybackGone = () => {
      void unregisterPlaybackSurface(element)
    }

    element.addEventListener('loadedmetadata', handleMediaReady)
    element.addEventListener('loadeddata', handleMediaReady)
    element.addEventListener('canplay', handleMediaReady)
    element.addEventListener('play', handleMediaReady)
    element.addEventListener('playing', handleMediaReady)
    element.addEventListener('seeked', handleMediaReady)
    element.addEventListener('waiting', handleMediaReady)
    element.addEventListener('stalled', handleMediaReady)
    element.addEventListener('suspend', handleMediaReady)
    element.addEventListener('emptied', handlePlaybackGone)
    element.addEventListener('ended', handlePlaybackGone)

    const playbackHealthTimer = window.setInterval(() => {
      if (element.ended || element.readyState < 2) {
        return
      }

      void syncPlaybackSurface()
    }, 3000)

    return () => {
      element.removeEventListener('loadedmetadata', handleMediaReady)
      element.removeEventListener('loadeddata', handleMediaReady)
      element.removeEventListener('canplay', handleMediaReady)
      element.removeEventListener('play', handleMediaReady)
      element.removeEventListener('playing', handleMediaReady)
      element.removeEventListener('seeked', handleMediaReady)
      element.removeEventListener('waiting', handleMediaReady)
      element.removeEventListener('stalled', handleMediaReady)
      element.removeEventListener('suspend', handleMediaReady)
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
