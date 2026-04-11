import { create } from 'zustand'
import useAuthStore from './useAuthStore'
import useAppStore from './useAppStore'
import {
  createWatchPartyRoom,
  fetchWatchPartyRoomSnapshot,
  joinWatchPartyRoom,
  leaveWatchPartyRoom,
  normalizeWatchPartyCode,
  setWatchPartyRoomStatus,
  updateWatchPartyParticipantMuted,
  validateWatchPartyCode,
} from '../lib/watchParty'
import {
  attachWatchPartyRemoteMedia,
  clearWatchPartyPlaybackElement,
  disconnectWatchPartyLiveKit,
  ensureWatchPartyLiveKitConnection,
  hasActiveWatchPartyLiveKitConnection,
  isWatchPartyLiveKitConfigured,
  pauseWatchPartyBroadcast,
  refreshWatchPartyLiveKitConfiguration,
  resumeWatchPartyBroadcast,
  setWatchPartyLiveKitCallbacks,
  setWatchPartyPlaybackElement,
  setWatchPartySubtitleState,
  syncWatchPartyMicrophoneState,
} from '../lib/watchPartyLiveKit'
import {
  dispatchWatchPartyActiveRoomChange,
  WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY,
} from '../lib/watchPartySession'

const ROOM_SYNC_INTERVAL_MS = 5000
const ROOM_STATUS_MUTATION_TIMEOUT_MS = 12000
const ROOM_UNAVAILABLE_REASON = 'This Watch Party room is no longer available.'
const REMOVED_FROM_ROOM_REASON = 'You are no longer part of this Watch Party room.'
const HOST_DISCONNECTED_REASON = 'The host disconnected from this Watch Party room.'
const HOST_ENDED_REASON = 'The host ended this Watch Party room.'
const ROOM_REFRESH_RETRY_ERROR = 'Connection hiccup while refreshing the Watch Party room. Retrying...'
const WATCH_PARTY_TRANSPORT_CONFIGURATION_ERROR =
  'Watch Party media transport is not configured yet. Set WATCH_PARTY_LIVEKIT_URL, WATCH_PARTY_LIVEKIT_API_KEY, and WATCH_PARTY_LIVEKIT_API_SECRET for the desktop runtime, or provide VITE_WATCH_PARTY_LIVEKIT_URL and VITE_WATCH_PARTY_TOKEN_ENDPOINT for a web token service.'

const ROOMLESS_STATE = {
  roomId: null,
  roomCode: null,
  roomState: null,
  isHost: false,
  participants: [],
  isMuted: false,
  speakingUserIds: [],
  remoteSubtitleText: '',
  remoteSubtitleVisible: false,
}

const TRANSPORT_IDLE_STATE = {
  transportConfigured: isWatchPartyLiveKitConfigured(),
  transportState: 'idle',
  broadcastStatus: 'idle',
  broadcastLabel: '',
  remoteMediaReady: false,
  hasPlaybackSurface: false,
}

let activeRoomSyncTimer = null

function hasSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function normalizeDisplayNameFallback(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isMatchingRoomStatus(status, expectedStatus) {
  return String(status || '').trim().toLowerCase() === String(expectedStatus || '').trim().toLowerCase()
}

function createRoomStatusTimeoutError(nextStatus) {
  const normalizedStatus = String(nextStatus || '').trim().toLowerCase()
  const action = normalizedStatus === 'ended' ? 'ending' : normalizedStatus === 'live' ? 'starting' : 'updating'
  return new Error(`Watch Party is taking too long while ${action} the room. Please try again.`)
}

async function withRoomStatusTimeout(task, nextStatus) {
  let timeoutId = null

  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(createRoomStatusTimeoutError(nextStatus))
        }, ROOM_STATUS_MUTATION_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId)
    }
  }
}

async function resolveRoomStatusMutation({
  roomId,
  hostUserId,
  nextStatus,
}) {
  try {
    return await withRoomStatusTimeout(
      setWatchPartyRoomStatus({
        roomId,
        hostUserId,
        status: nextStatus,
      }),
      nextStatus
    )
  } catch (error) {
    const snapshot = await fetchWatchPartyRoomSnapshot(roomId).catch(() => null)
    if (snapshot?.room && isMatchingRoomStatus(snapshot.room.status, nextStatus)) {
      return snapshot.room
    }

    throw error
  }
}

function normalizeSpeakingUserIds(userIds = []) {
  return Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  ))
}

function applySpeakingStateToParticipants(participants = [], speakingUserIds = []) {
  const speakingSet = new Set(normalizeSpeakingUserIds(speakingUserIds))
  return (Array.isArray(participants) ? participants : []).map((participant) => ({
    ...participant,
    isSpeaking: speakingSet.has(String(participant?.userId || '').trim()),
  }))
}

function getWatchPartyDisplayName() {
  const authState = useAuthStore.getState()
  const profileUsername = normalizeDisplayNameFallback(authState.profile?.username)
  if (profileUsername) return profileUsername

  const emailUsername = normalizeDisplayNameFallback(authState.user?.email?.split('@')?.[0])
  if (emailUsername) return emailUsername

  const fallbackUserId = normalizeDisplayNameFallback(authState.user?.id)
  if (!fallbackUserId) return 'NOVA STREAM'
  return `Member ${fallbackUserId.slice(0, 6)}`
}

function readActiveRoomSession() {
  if (!hasSessionStorage()) return null

  try {
    const raw = window.sessionStorage.getItem(WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const roomId = String(parsed?.roomId || '').trim()
    const roomCode = normalizeWatchPartyCode(parsed?.roomCode || '')
    return roomId ? { roomId, roomCode } : null
  } catch {
    return null
  }
}

function writeActiveRoomSession(roomId, roomCode) {
  if (!hasSessionStorage()) return

  const normalizedRoomId = String(roomId || '').trim()
  const normalizedRoomCode = normalizeWatchPartyCode(roomCode || '')

  if (!normalizedRoomId || !normalizedRoomCode) {
    window.sessionStorage.removeItem(WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY)
    dispatchWatchPartyActiveRoomChange(false)
    return
  }

  window.sessionStorage.setItem(
    WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY,
    JSON.stringify({
      roomId: normalizedRoomId,
      roomCode: normalizedRoomCode,
    })
  )
  dispatchWatchPartyActiveRoomChange(true, {
    roomId: normalizedRoomId,
    roomCode: normalizedRoomCode,
  })
}

function clearActiveRoomSession() {
  if (!hasSessionStorage()) return
  window.sessionStorage.removeItem(WATCH_PARTY_ACTIVE_ROOM_STORAGE_KEY)
  dispatchWatchPartyActiveRoomChange(false)
}

function stopActiveRoomSync() {
  if (activeRoomSyncTimer) {
    window.clearInterval(activeRoomSyncTimer)
    activeRoomSyncTimer = null
  }
}

function resetTransportState(set, overrides = {}) {
  set({
    transportState: 'idle',
    broadcastStatus: 'idle',
    broadcastLabel: '',
    remoteMediaReady: false,
    ...overrides,
  })
}

function setEndedState(set, error = '') {
  stopActiveRoomSync()
  clearActiveRoomSession()
  void disconnectWatchPartyLiveKit()
  void clearWatchPartyPlaybackElement()
  set({
    ...ROOMLESS_STATE,
    ...TRANSPORT_IDLE_STATE,
    status: 'ended',
    entryPending: false,
    error: error || '',
  })
}

function hasHostParticipant(room, participants) {
  const hostUserId = String(room?.hostUserId || '').trim()
  if (!hostUserId) return false

  return (Array.isArray(participants) ? participants : []).some(
    (participant) => String(participant?.userId || '').trim() === hostUserId
  )
}

function requireWatchPartyUser() {
  const authStore = useAuthStore.getState()
  const user = authStore.user

  if (!user) {
    authStore.setAuthModalOpen(true)
    throw new Error('Sign in to create or join a Watch Party.')
  }

  return { user }
}

function startActiveRoomSync(get) {
  stopActiveRoomSync()

  if (typeof window === 'undefined') {
    return
  }

  activeRoomSyncTimer = window.setInterval(() => {
    void get().refreshActiveRoom()
  }, ROOM_SYNC_INTERVAL_MS)
}

function applyRoomSnapshotToState(set, room, participants, userId) {
  const normalizedUserId = String(userId || '').trim()
  set((state) => {
    const nextParticipants = applySpeakingStateToParticipants(participants, state.speakingUserIds)
    const selfParticipant = nextParticipants.find(
      item => String(item.userId || '') === normalizedUserId
    )

    return {
      roomId: room.id,
      roomCode: room.code,
      roomState: room.status,
      isHost: String(room.hostUserId || '') === normalizedUserId,
      participants: nextParticipants,
      isMuted: Boolean(selfParticipant?.isMuted),
      status: room.status === 'live' ? 'live' : 'lobby',
      entryPending: false,
      error: '',
    }
  })

  writeActiveRoomSession(room.id, room.code)
}

async function syncVoiceStateWithTransport(get, set, nextMuted = get().isMuted) {
  try {
    await syncWatchPartyMicrophoneState({
      isMuted: nextMuted,
      noiseSuppressionEnabled: Boolean(
        useAppStore.getState().preferences.watchPartyNoiseSuppression
      ),
    })
    return true
  } catch (error) {
    const normalizedError = error?.message || 'Could not update your Watch Party microphone state.'
    const currentUserId = String(useAuthStore.getState().user?.id || '')

    set((state) => ({
      isMuted: true,
      participants: state.participants.map((participant) => (
        String(participant.userId) === currentUserId
          ? { ...participant, isMuted: true, isSpeaking: false }
          : participant
      )),
      speakingUserIds: state.speakingUserIds.filter((userId) => userId !== currentUserId),
      error: normalizedError,
    }))

    return false
  }
}

async function persistMutedFallbackState({ roomId, userId, isMuted = true } = {}) {
  const normalizedRoomId = String(roomId || '').trim()
  const normalizedUserId = String(userId || '').trim()

  if (!normalizedRoomId || !normalizedUserId) {
    return
  }

  try {
    await updateWatchPartyParticipantMuted({
      roomId: normalizedRoomId,
      userId: normalizedUserId,
      isMuted,
    })
  } catch {
    // Best effort sync only.
  }
}

function setTransportCallbacks(set, get) {
  setWatchPartyLiveKitCallbacks({
    onConnectionStateChange: (nextState) => {
      const normalizedState = String(nextState || '').trim().toLowerCase() || 'idle'
      set((state) => ({
        transportState: normalizedState,
        speakingUserIds:
          normalizedState === 'idle' || normalizedState === 'disconnected'
            ? []
            : state.speakingUserIds,
        participants:
          normalizedState === 'idle' || normalizedState === 'disconnected'
            ? state.participants.map((participant) => ({ ...participant, isSpeaking: false }))
            : state.participants,
        remoteMediaReady:
          normalizedState === 'idle' || normalizedState === 'disconnected'
            ? false
            : state.remoteMediaReady,
      }))
    },

    onBroadcastStatusChange: ({ status, label }) => {
      const nextStatus = String(status || '').trim().toLowerCase() || 'idle'
      const nextLabel = normalizeDisplayNameFallback(label)

      set((state) => ({
        broadcastStatus:
          !state.isHost && nextStatus === 'awaiting-source'
            ? state.broadcastStatus
            : nextStatus,
        broadcastLabel:
          nextLabel
            ? nextLabel
            : nextStatus === 'idle'
              ? ''
              : state.broadcastLabel,
        remoteMediaReady:
          nextStatus === 'idle' || nextStatus === 'awaiting-source'
            ? false
            : state.remoteMediaReady,
        remoteSubtitleText:
          nextStatus === 'idle' || nextStatus === 'awaiting-source'
            ? ''
            : state.remoteSubtitleText,
        remoteSubtitleVisible:
          nextStatus === 'idle' || nextStatus === 'awaiting-source'
            ? false
            : state.remoteSubtitleVisible,
      }))
    },

    onRemoteTrackStateChange: ({ hasVideo, hasAudio }) => {
      const remoteMediaReady = Boolean(hasVideo || hasAudio)
      set((state) => ({
        remoteMediaReady,
        broadcastStatus:
          state.isHost
            ? state.broadcastStatus
            : state.status === 'live'
              ? remoteMediaReady
                ? 'receiving'
                : 'waiting-for-host'
              : 'idle',
        remoteSubtitleText: remoteMediaReady ? state.remoteSubtitleText : '',
        remoteSubtitleVisible: remoteMediaReady ? state.remoteSubtitleVisible : false,
      }))
    },

    onActiveSpeakersChange: (userIds) => {
      const speakingUserIds = normalizeSpeakingUserIds(userIds)
      set((state) => ({
        speakingUserIds,
        participants: applySpeakingStateToParticipants(state.participants, speakingUserIds),
      }))
    },

    onSubtitleStateChange: ({ text, visible }) => {
      set((state) => ({
        remoteSubtitleText: visible ? String(text || '') : '',
        remoteSubtitleVisible: Boolean(visible) && Boolean(state.remoteMediaReady),
      }))
    },

    onError: (payload) => {
      const normalizedMessage = normalizeDisplayNameFallback(
        typeof payload === 'string' ? payload : payload?.message
      )
      const category = String(
        typeof payload === 'string' ? '' : payload?.category
      ).trim().toLowerCase()
      const currentUserId = String(useAuthStore.getState().user?.id || '')

      if (category === 'microphone') {
        set((state) => ({
          error: normalizedMessage || state.error,
          isMuted: true,
          speakingUserIds: state.speakingUserIds.filter((userId) => userId !== currentUserId),
          participants: state.participants.map((participant) => (
            String(participant.userId) === currentUserId
              ? { ...participant, isMuted: true, isSpeaking: false }
              : participant
          )),
        }))
        return
      }

      set((state) => ({
        error: normalizedMessage || state.error,
        transportState: 'error',
        speakingUserIds: [],
        participants: state.participants.map((participant) => ({ ...participant, isSpeaking: false })),
        broadcastStatus:
          state.isHost
            ? state.hasPlaybackSurface
              ? 'awaiting-source'
              : 'idle'
            : state.status === 'live'
              ? 'waiting-for-host'
              : 'idle',
        remoteMediaReady: false,
        remoteSubtitleText: '',
        remoteSubtitleVisible: false,
      }))
    },
  })
}

const useWatchPartyStore = create((set, get) => {
  setTransportCallbacks(set, get)

  return {
    status: 'idle',
    ...ROOMLESS_STATE,
    ...TRANSPORT_IDLE_STATE,
    entryPending: false,
    error: '',

    refreshTransportConfiguration: async ({ forceRefresh = false } = {}) => {
      try {
        const config = await refreshWatchPartyLiveKitConfiguration({ forceRefresh })
        set({
          transportConfigured: Boolean(config?.configured),
        })
        return config
      } catch (error) {
        set({
          transportConfigured: false,
        })
        return {
          configured: false,
          error: error?.message || WATCH_PARTY_TRANSPORT_CONFIGURATION_ERROR,
        }
      }
    },

    beginCreate: () => {
      try {
        requireWatchPartyUser()
        set({
          status: 'creating',
          entryPending: false,
          error: '',
        })
      } catch (error) {
        set({
          status: 'idle',
          entryPending: false,
          error: error.message || 'Sign in to create or join a Watch Party.',
        })
      }
    },

    beginJoin: () => {
      try {
        requireWatchPartyUser()
        set({
          status: 'joining',
          entryPending: false,
          error: '',
        })
      } catch (error) {
        set({
          status: 'idle',
          entryPending: false,
          error: error.message || 'Sign in to create or join a Watch Party.',
        })
      }
    },

    cancelFlow: () => {
      set({
        status: 'idle',
        entryPending: false,
        error: '',
      })
    },

    createRoom: async () => {
      try {
        const { user } = requireWatchPartyUser()
        set({
          entryPending: true,
          error: '',
        })

        const { room, participants } = await createWatchPartyRoom({
          hostUserId: user.id,
          profile: useAuthStore.getState().profile,
        })

        applyRoomSnapshotToState(set, room, participants, user.id)
        startActiveRoomSync(get)
        void get().syncTransport()
        return room
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || 'Could not create a Watch Party room.',
        })
        return null
      }
    },

    joinRoom: async (code) => {
      try {
        const { user } = requireWatchPartyUser()
        const normalizedCode = validateWatchPartyCode(code)
        set({
          entryPending: true,
          error: '',
        })

        const { room, participants } = await joinWatchPartyRoom({
          code: normalizedCode,
          userId: user.id,
          profile: useAuthStore.getState().profile,
        })

        applyRoomSnapshotToState(set, room, participants, user.id)
        startActiveRoomSync(get)
        void get().syncTransport()
        return room
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || 'Could not join that Watch Party room.',
        })
        return null
      }
    },

    refreshActiveRoom: async () => {
      const { roomId } = get()

      if (!roomId) {
        stopActiveRoomSync()
        return null
      }

      try {
        const { user } = requireWatchPartyUser()
        const snapshot = await fetchWatchPartyRoomSnapshot(roomId)

        if (!snapshot?.room) {
          setEndedState(set, ROOM_UNAVAILABLE_REASON)
          return null
        }

        const { room, participants } = snapshot
        const selfParticipant = participants.find(
          item => String(item.userId) === String(user.id)
        )

        if (!selfParticipant) {
          setEndedState(set, REMOVED_FROM_ROOM_REASON)
          return null
        }

        if (room.status === 'ended') {
          setEndedState(set, HOST_ENDED_REASON)
          return snapshot
        }

        if (!hasHostParticipant(room, participants)) {
          setEndedState(set, HOST_DISCONNECTED_REASON)
          return null
        }

        applyRoomSnapshotToState(set, room, participants, user.id)
        void get().syncTransport()

        return snapshot
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || ROOM_REFRESH_RETRY_ERROR,
        })
        return null
      }
    },

    syncTransport: async ({ forceReconnect = false } = {}) => {
      const { roomId, roomCode, roomState, isHost, status, hasPlaybackSurface } = get()

      if (!roomId || roomState !== 'live' || status !== 'live') {
        await disconnectWatchPartyLiveKit()
        resetTransportState(set, {
          broadcastStatus: isHost && hasPlaybackSurface ? 'awaiting-source' : 'idle',
          broadcastLabel: isHost && hasPlaybackSurface ? get().broadcastLabel : '',
        })
        return null
      }

      const transportConfig = await get().refreshTransportConfiguration({
        forceRefresh: forceReconnect,
      })

      if (!transportConfig?.configured) {
        set({
          transportConfigured: false,
          transportState: 'error',
          broadcastStatus: isHost ? (hasPlaybackSurface ? 'awaiting-source' : 'idle') : 'waiting-for-host',
          error:
            transportConfig?.error || WATCH_PARTY_TRANSPORT_CONFIGURATION_ERROR,
        })
        return null
      }

      try {
        const { user } = requireWatchPartyUser()
        const desiredMuted = get().isMuted

        if (hasActiveWatchPartyLiveKitConnection({
          roomId,
          userId: user.id,
          isHost,
        })) {
          if (forceReconnect) {
            await disconnectWatchPartyLiveKit()
          } else {
          const voiceSynced = await syncVoiceStateWithTransport(get, set)
          if (!voiceSynced && !desiredMuted) {
            await persistMutedFallbackState({
              roomId,
              userId: user.id,
              isMuted: true,
            })
          }
          return null
          }
        }

        set({
          transportConfigured: true,
          transportState: 'connecting',
          error: '',
        })

        const room = await ensureWatchPartyLiveKitConnection({
          roomId,
          roomCode,
          userId: user.id,
          displayName: getWatchPartyDisplayName(),
          isHost,
        })

        const voiceSynced = await syncVoiceStateWithTransport(get, set)
        if (!voiceSynced && !desiredMuted) {
          await persistMutedFallbackState({
            roomId,
            userId: user.id,
            isMuted: true,
          })
        }

        set((state) => ({
          transportState: 'connected',
          broadcastStatus:
            state.isHost
              ? state.hasPlaybackSurface
                ? state.broadcastStatus === 'publishing' ? 'publishing' : 'awaiting-source'
                : 'awaiting-source'
              : state.remoteMediaReady
                ? 'receiving'
                : 'waiting-for-host',
        }))

        return room
      } catch (error) {
        set((state) => ({
          transportConfigured: isWatchPartyLiveKitConfigured(),
          transportState: 'error',
          broadcastStatus:
            state.isHost
              ? state.hasPlaybackSurface
                ? 'awaiting-source'
                : 'idle'
              : state.status === 'live'
                ? 'waiting-for-host'
                : 'idle',
          remoteMediaReady: false,
          error: error.message || 'Could not connect the Watch Party media transport.',
        }))
        return null
      }
    },

    startBroadcast: async () => {
      const { roomId, isHost } = get()

      if (!roomId || !isHost) {
        return null
      }

      try {
        const { user } = requireWatchPartyUser()
        stopActiveRoomSync()
        set({
          entryPending: true,
          error: '',
        })

        const room = await resolveRoomStatusMutation({
          roomId,
          hostUserId: user.id,
          nextStatus: 'live',
        })

        set({
          roomState: room.status,
          status: 'live',
          entryPending: false,
          error: '',
          broadcastStatus: 'awaiting-source',
        })

        writeActiveRoomSession(roomId, get().roomCode)
        startActiveRoomSync(get)
        await get().syncTransport()
        return room
      } catch (error) {
        startActiveRoomSync(get)
        set({
          entryPending: false,
          error: error.message || 'Could not start the Watch Party yet.',
        })
        return null
      }
    },

    stopBroadcast: async () => {
      const { isHost } = get()

      if (!isHost) {
        return
      }

      try {
        set({ entryPending: true, error: '' })
        await pauseWatchPartyBroadcast()
        set({
          entryPending: false,
          broadcastStatus: 'awaiting-source',
        })
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || 'Could not stop the Watch Party broadcast.',
        })
      }
    },

    resumeBroadcast: async () => {
      const { isHost, hasPlaybackSurface } = get()

      if (!isHost || !hasPlaybackSurface) {
        return false
      }

      try {
        set({
          entryPending: true,
          error: '',
        })

        const resumed = await resumeWatchPartyBroadcast()

        set((state) => ({
          entryPending: false,
          broadcastStatus: resumed
            ? 'publishing'
            : state.broadcastStatus === 'idle'
              ? 'awaiting-source'
              : state.broadcastStatus,
        }))

        return resumed
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || 'Could not resume the Watch Party broadcast.',
        })
        return false
      }
    },

    endRoom: async () => {
      const { roomId, isHost } = get()

      if (!roomId || !isHost) {
        return
      }

      try {
        const { user } = requireWatchPartyUser()
        stopActiveRoomSync()
        set({
          entryPending: true,
          error: '',
        })

        await resolveRoomStatusMutation({
          roomId,
          hostUserId: user.id,
          nextStatus: 'ended',
        })

        setEndedState(set)
      } catch (error) {
        startActiveRoomSync(get)
        set({
          entryPending: false,
          error: error.message || 'Could not end the Watch Party room.',
        })
      }
    },

    leaveRoom: async () => {
      const { roomId, isHost } = get()

      if (!roomId) {
        await disconnectWatchPartyLiveKit()
        void clearWatchPartyPlaybackElement()
        set({
          ...ROOMLESS_STATE,
          ...TRANSPORT_IDLE_STATE,
          status: 'idle',
          entryPending: false,
          error: '',
        })
        return
      }

      if (isHost) {
        await get().endRoom()
        return
      }

      try {
        const { user } = requireWatchPartyUser()
        set({
          entryPending: true,
          error: '',
        })

        await leaveWatchPartyRoom({
          roomId,
          userId: user.id,
        })

        stopActiveRoomSync()
        clearActiveRoomSession()
        await disconnectWatchPartyLiveKit()
        set({
          ...ROOMLESS_STATE,
          ...TRANSPORT_IDLE_STATE,
          status: 'idle',
          entryPending: false,
          error: '',
        })
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || 'Could not leave the Watch Party room.',
        })
      }
    },

    toggleMute: async () => {
      const nextMuted = !get().isMuted
      const { roomId } = get()

      set((state) => ({
        isMuted: nextMuted,
        participants: state.participants.map((participant) => (
          String(participant.userId) === String(useAuthStore.getState().user?.id || '')
            ? { ...participant, isMuted: nextMuted }
            : participant
        )),
      }))

      if (!roomId) {
        return
      }

      try {
        const { user } = requireWatchPartyUser()
        await updateWatchPartyParticipantMuted({
          roomId,
          userId: user.id,
          isMuted: nextMuted,
        })

        const voiceSynced = await syncVoiceStateWithTransport(get, set, nextMuted)
        if (!voiceSynced && !nextMuted) {
          await persistMutedFallbackState({
            roomId,
            userId: user.id,
            isMuted: true,
          })
        }
      } catch (error) {
        set((state) => ({
          isMuted: !nextMuted,
          participants: state.participants.map((participant) => (
            String(participant.userId) === String(useAuthStore.getState().user?.id || '')
              ? { ...participant, isMuted: !nextMuted }
              : participant
          )),
          error: error.message || 'Could not update your Watch Party voice state.',
        }))
      }
    },

    refreshVoiceProcessing: async () => {
      const { roomId, roomState, status, isMuted } = get()

      if (!roomId || roomState !== 'live' || status !== 'live' || isMuted) {
        return false
      }

      return syncVoiceStateWithTransport(get, set, false)
    },

    registerPlaybackSurface: async ({ element = null, label = '' } = {}) => {
      const nextLabel = normalizeDisplayNameFallback(label)

      set((state) => ({
        hasPlaybackSurface: Boolean(element),
        broadcastLabel: nextLabel || (element ? state.broadcastLabel : ''),
        broadcastStatus:
          !element
            ? state.status === 'live' && state.isHost
              ? 'awaiting-source'
              : 'idle'
            : state.status === 'live' && state.isHost
              ? state.broadcastStatus === 'publishing' ? 'publishing' : 'awaiting-source'
              : state.broadcastStatus,
      }))

      return setWatchPartyPlaybackElement({
        element,
        label: nextLabel,
      })
    },

    syncPlaybackSubtitles: async ({ text = '', visible = false } = {}) => {
      try {
        return await setWatchPartySubtitleState({
          text,
          visible,
        })
      } catch (error) {
        set({
          error: error?.message || 'Could not sync Watch Party subtitles.',
        })
        return false
      }
    },

    unregisterPlaybackSurface: async (element = null) => {
      await clearWatchPartyPlaybackElement(element)
      set((state) => ({
        hasPlaybackSurface: false,
        broadcastLabel: state.isHost && state.status === 'live' ? state.broadcastLabel : '',
        broadcastStatus:
          state.status === 'live' && state.isHost
            ? 'awaiting-source'
            : 'idle',
      }))
    },

    attachRemoteMedia: ({ videoElement = null, audioElement = null } = {}) => {
      attachWatchPartyRemoteMedia({ videoElement, audioElement })
    },

    clearSession: async () => {
      stopActiveRoomSync()
      clearActiveRoomSession()
      await disconnectWatchPartyLiveKit()
      await clearWatchPartyPlaybackElement()
      set({
        ...ROOMLESS_STATE,
        ...TRANSPORT_IDLE_STATE,
        status: 'idle',
        entryPending: false,
        error: '',
      })
    },

    setParticipants: (participants) => set({
      participants: applySpeakingStateToParticipants(participants, get().speakingUserIds),
    }),

    setParticipantSpeaking: (participantId, isSpeaking) => {
      set((state) => ({
        speakingUserIds: Boolean(isSpeaking)
          ? normalizeSpeakingUserIds([
            ...state.speakingUserIds,
            state.participants.find((participant) => String(participant.id) === String(participantId))?.userId,
          ])
          : state.speakingUserIds.filter((userId) => (
            userId !== String(
              state.participants.find((participant) => String(participant.id) === String(participantId))?.userId || ''
            )
          )),
        participants: state.participants.map((participant) => (
          String(participant.id) === String(participantId)
            ? { ...participant, isSpeaking: Boolean(isSpeaking) }
            : participant
        )),
      }))
    },

    setRoomCodeDraft: (value) => set({
      roomCode: normalizeWatchPartyCode(value),
    }),

    hydrateActiveRoom: async () => {
      if (get().roomId) {
        startActiveRoomSync(get)
        void get().syncTransport()
        return get().roomId
      }

      try {
        const { user } = requireWatchPartyUser()
        const persistedRoom = readActiveRoomSession()
        if (!persistedRoom?.roomId) {
          return null
        }

        set({
          entryPending: true,
          error: '',
        })

        const snapshot = await fetchWatchPartyRoomSnapshot(persistedRoom.roomId)

        if (!snapshot?.room) {
          setEndedState(set, ROOM_UNAVAILABLE_REASON)
          return null
        }

        const participants = Array.isArray(snapshot.participants) ? snapshot.participants : []
        const stillMember = participants.some(
          item => String(item.userId || '') === String(user.id)
        )

        if (!stillMember) {
          setEndedState(set, REMOVED_FROM_ROOM_REASON)
          return null
        }

        if (snapshot.room.status === 'ended') {
          setEndedState(set, HOST_ENDED_REASON)
          return null
        }

        if (!hasHostParticipant(snapshot.room, participants)) {
          setEndedState(set, HOST_DISCONNECTED_REASON)
          return null
        }

        applyRoomSnapshotToState(set, snapshot.room, participants, user.id)
        startActiveRoomSync(get)
        void get().syncTransport()
        return snapshot.room.id
      } catch (error) {
        set({
          entryPending: false,
          error: error.message || 'Could not restore the Watch Party room.',
        })
        return null
      }
    },
  }
})

export default useWatchPartyStore
