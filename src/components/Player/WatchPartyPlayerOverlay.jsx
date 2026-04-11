import { lazy, Suspense, useEffect, useState } from 'react'
import {
  hasActiveWatchPartyRoomSession,
  WATCH_PARTY_ACTIVE_ROOM_EVENT,
  WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY,
} from '../../lib/watchPartySession'

const WatchPartyPlayerRuntime = lazy(() => import('./WatchPartyPlayerRuntime'))

export default function WatchPartyPlayerOverlay({
  videoRef,
  enabled,
  label,
  subtitleText = '',
  subtitleEnabled = false,
}) {
  const [shouldLoadWatchParty, setShouldLoadWatchParty] = useState(() => (
    enabled && hasActiveWatchPartyRoomSession()
  ))

  useEffect(() => {
    const syncActiveRoomState = () => {
      setShouldLoadWatchParty(enabled && hasActiveWatchPartyRoomSession())
    }

    syncActiveRoomState()

    const handleRoomChange = () => {
      syncActiveRoomState()
    }

    const handleStorage = (event) => {
      if (!event.key || event.key === WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY) {
        syncActiveRoomState()
      }
    }

    window.addEventListener(WATCH_PARTY_ACTIVE_ROOM_EVENT, handleRoomChange)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(WATCH_PARTY_ACTIVE_ROOM_EVENT, handleRoomChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [enabled])

  if (!enabled || !shouldLoadWatchParty) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <WatchPartyPlayerRuntime
        videoRef={videoRef}
        enabled={enabled}
        label={label}
        subtitleText={subtitleText}
        subtitleEnabled={subtitleEnabled}
      />
    </Suspense>
  )
}
