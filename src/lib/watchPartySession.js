export const WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY = 'nova-watch-party-active-room'
export const WATCH_PARTY_ACTIVE_ROOM_EVENT = 'nova-watch-party-active-room-change'

function hasSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function readWatchPartyActiveRoomSession() {
  if (!hasSessionStorage()) return null

  try {
    const raw = window.sessionStorage.getItem(WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const roomId = String(parsed?.roomId || '').trim()
    const roomCode = String(parsed?.roomCode || '').trim()

    if (!roomId) return null

    return { roomId, roomCode }
  } catch {
    return null
  }
}

export function hasActiveWatchPartyRoomSession() {
  return Boolean(readWatchPartyActiveRoomSession()?.roomId)
}

export function dispatchWatchPartyActiveRoomChange(active, detail = null) {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent(WATCH_PARTY_ACTIVE_ROOM_EVENT, {
    detail: {
      active: Boolean(active),
      ...(detail || {}),
    },
  }))
}
