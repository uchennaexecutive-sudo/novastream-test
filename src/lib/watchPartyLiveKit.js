import { invoke, isTauri } from '@tauri-apps/api/core'
import { supabase } from './supabaseClient'

export const WATCH_PARTY_VIDEO_TRACK_NAME = 'watch-party-video'
export const WATCH_PARTY_AUDIO_TRACK_NAME = 'watch-party-audio'
const WATCH_PARTY_MEDIA_STREAM_NAME = 'watch-party-media'
const TRACK_KIND_AUDIO = 'audio'
const TRACK_KIND_VIDEO = 'video'
const TRACK_SOURCE_MICROPHONE = 'microphone'
const TRACK_SOURCE_SCREEN_SHARE = 'screen_share'
const TRACK_SOURCE_SCREEN_SHARE_AUDIO = 'screen_share_audio'
const TRACK_STREAM_STATE_ACTIVE = 'active'
const ROOM_EVENT_CONNECTION_STATE_CHANGED = 'connectionStateChanged'
const ROOM_EVENT_RECONNECTED = 'reconnected'
const ROOM_EVENT_MEDIA_DEVICES_ERROR = 'mediaDevicesError'
const ROOM_EVENT_TRACK_SUBSCRIBED = 'trackSubscribed'
const ROOM_EVENT_TRACK_MUTED = 'trackMuted'
const ROOM_EVENT_TRACK_UNMUTED = 'trackUnmuted'
const ROOM_EVENT_TRACK_STREAM_STATE_CHANGED = 'trackStreamStateChanged'
const ROOM_EVENT_AUDIO_PLAYBACK_STATUS_CHANGED = 'audioPlaybackChanged'
const ROOM_EVENT_VIDEO_PLAYBACK_STATUS_CHANGED = 'videoPlaybackChanged'
const ROOM_EVENT_TRACK_UNSUBSCRIBED = 'trackUnsubscribed'
const ROOM_EVENT_ACTIVE_SPEAKERS_CHANGED = 'activeSpeakersChanged'
const ROOM_EVENT_DISCONNECTED = 'disconnected'
const ROOM_EVENT_DATA_RECEIVED = 'dataReceived'
const VOICE_TRACK_NAME = 'watch-party-voice'
const WATCH_PARTY_SUBTITLE_MESSAGE_KIND = 'watch-party-subtitle'

const DEFAULT_CALLBACKS = {
  onConnectionStateChange: () => {},
  onBroadcastStatusChange: () => {},
  onRemoteTrackStateChange: () => {},
  onActiveSpeakersChange: () => {},
  onSubtitleStateChange: () => {},
  onError: () => {},
}

const WATCH_PARTY_NATIVE_TRANSPORT_HELP =
  'Watch Party media transport is not configured yet. Set WATCH_PARTY_LIVEKIT_URL, WATCH_PARTY_LIVEKIT_API_KEY, and WATCH_PARTY_LIVEKIT_API_SECRET for the desktop runtime, or provide VITE_WATCH_PARTY_LIVEKIT_URL and VITE_WATCH_PARTY_TOKEN_ENDPOINT for a web token service.'

const transport = {
  callbacks: { ...DEFAULT_CALLBACKS },
  room: null,
  sessionKey: '',
  roomId: '',
  roomCode: '',
  isHost: false,
  remoteVideoTrack: null,
  remoteAudioTrack: null,
  remoteVoiceTracks: new Map(),
  remoteVideoElement: null,
  remoteAudioElement: null,
  sourceElement: null,
  sourceLabel: '',
  captureStream: null,
  publishedVideoTrack: null,
  publishedAudioTrack: null,
  publishedElement: null,
  publishedMicrophoneTrack: null,
  microphoneCleanup: null,
  microphoneNoiseSuppressionEnabled: false,
  broadcastAudioContext: null,
  broadcastAudioSourceNode: null,
  broadcastAudioDestinationNode: null,
  broadcastAudioElement: null,
  subtitleState: {
    text: '',
    visible: false,
  },
  healthMonitorId: null,
}

const runtimeTransportConfig = {
  loaded: false,
  loading: null,
  value: null,
}

const liveKitRuntime = {
  loaded: false,
  loading: null,
  value: null,
}

const noiseSuppressionRuntime = {
  loaded: false,
  loading: null,
  value: null,
}

function normalizeValue(value) {
  return String(value || '').trim()
}

function createWatchPartyTransportError(message) {
  return new Error(message)
}

async function loadLiveKitModule() {
  if (liveKitRuntime.loaded) {
    return liveKitRuntime.value
  }

  if (!liveKitRuntime.loading) {
    liveKitRuntime.loading = import('livekit-client')
      .then((module) => {
        liveKitRuntime.loaded = true
        liveKitRuntime.value = module
        return module
      })
      .finally(() => {
        liveKitRuntime.loading = null
      })
  }

  return liveKitRuntime.loading
}

async function loadNoiseSuppressionModule() {
  if (noiseSuppressionRuntime.loaded) {
    return noiseSuppressionRuntime.value
  }

  if (!noiseSuppressionRuntime.loading) {
    noiseSuppressionRuntime.loading = import('./watchPartyNoiseSuppression')
      .then((module) => {
        noiseSuppressionRuntime.loaded = true
        noiseSuppressionRuntime.value = module
        return module
      })
      .finally(() => {
        noiseSuppressionRuntime.loading = null
      })
  }

  return noiseSuppressionRuntime.loading
}

function getConfiguredLiveKitUrl() {
  return normalizeValue(import.meta.env.VITE_WATCH_PARTY_LIVEKIT_URL)
}

function getConfiguredTokenEndpoint() {
  return normalizeValue(import.meta.env.VITE_WATCH_PARTY_TOKEN_ENDPOINT)
}

function getTransportConfigurationError() {
  return createWatchPartyTransportError(
    WATCH_PARTY_NATIVE_TRANSPORT_HELP
  )
}

function createResolvedTransportConfig({
  configured = false,
  url = '',
  tokenEndpoint = '',
  tokenProvider = '',
  error = '',
} = {}) {
  return {
    configured: Boolean(configured),
    url: normalizeValue(url),
    tokenEndpoint: normalizeValue(tokenEndpoint),
    tokenProvider: normalizeValue(tokenProvider),
    error: normalizeValue(error),
  }
}

function getEnvironmentTransportConfig() {
  const url = getConfiguredLiveKitUrl()
  const tokenEndpoint = getConfiguredTokenEndpoint()

  if (!url || !tokenEndpoint) {
    return createResolvedTransportConfig()
  }

  return createResolvedTransportConfig({
    configured: true,
    url,
    tokenEndpoint,
    tokenProvider: 'http',
  })
}

async function loadRuntimeTransportConfig(forceRefresh = false) {
  if (!isTauri()) {
    return createResolvedTransportConfig()
  }

  if (runtimeTransportConfig.loaded && !forceRefresh) {
    return runtimeTransportConfig.value || createResolvedTransportConfig()
  }

  if (runtimeTransportConfig.loading && !forceRefresh) {
    return runtimeTransportConfig.loading
  }

  runtimeTransportConfig.loading = invoke('get_watch_party_transport_config')
    .then((payload) => {
      const resolved = createResolvedTransportConfig({
        configured: Boolean(payload?.configured),
        url: payload?.url,
        tokenProvider: payload?.tokenProvider || (payload?.configured ? 'native' : ''),
        error: payload?.error,
      })
      runtimeTransportConfig.loaded = true
      runtimeTransportConfig.value = resolved
      return resolved
    })
    .catch((error) => {
      const resolved = createResolvedTransportConfig({
        error: error?.message || 'Could not read the desktop Watch Party transport configuration.',
      })
      runtimeTransportConfig.loaded = true
      runtimeTransportConfig.value = resolved
      return resolved
    })
    .finally(() => {
      runtimeTransportConfig.loading = null
    })

  return runtimeTransportConfig.loading
}

async function resolveTransportConfiguration({ forceRefresh = false } = {}) {
  const environmentConfig = getEnvironmentTransportConfig()
  if (environmentConfig.configured) {
    return environmentConfig
  }

  const runtimeConfig = await loadRuntimeTransportConfig(forceRefresh)
  if (runtimeConfig.configured) {
    return runtimeConfig
  }

  return createResolvedTransportConfig({
    error: runtimeConfig.error || WATCH_PARTY_NATIVE_TRANSPORT_HELP,
  })
}

function emitConnectionState(nextState) {
  transport.callbacks.onConnectionStateChange(normalizeValue(nextState).toLowerCase() || 'disconnected')
}

function emitBroadcastStatus(status, label = '') {
  transport.callbacks.onBroadcastStatusChange({
    status: normalizeValue(status).toLowerCase() || 'idle',
    label: normalizeValue(label),
  })
}

function emitRemoteTrackState() {
  transport.callbacks.onRemoteTrackStateChange({
    hasVideo: Boolean(transport.remoteVideoTrack && !transport.remoteVideoTrack.isMuted),
    hasAudio: Boolean(transport.remoteAudioTrack && !transport.remoteAudioTrack.isMuted),
  })
}

function emitTransportError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Watch Party transport failed.')
  const category = error?.name === 'WatchPartyMicrophoneError' ? 'microphone' : 'transport'
  transport.callbacks.onError({
    message,
    category,
  })
}

function createMicrophonePermissionError(message = '') {
  const normalizedMessage = normalizeValue(message)
  const error = createWatchPartyTransportError(
    normalizedMessage || 'Microphone access is blocked. Allow microphone permission to join Watch Party voice chat.'
  )
  error.name = 'WatchPartyMicrophoneError'
  return error
}

function emitActiveSpeakersChange(participants = []) {
  const userIds = Array.from(new Set(
    (Array.isArray(participants) ? participants : [])
      .map(participant => normalizeValue(participant?.identity))
      .filter(Boolean)
  ))

  transport.callbacks.onActiveSpeakersChange(userIds)
}

function normalizeSubtitleState({ text = '', visible = false } = {}) {
  const normalizedText = String(text || '').trim()
  return {
    text: normalizedText,
    visible: Boolean(visible) && Boolean(normalizedText),
  }
}

function emitSubtitleState(state = {}) {
  transport.callbacks.onSubtitleStateChange(normalizeSubtitleState(state))
}

function subtitleStateChanged(nextState = {}) {
  const normalizedNextState = normalizeSubtitleState(nextState)
  return (
    normalizedNextState.text !== transport.subtitleState.text
    || normalizedNextState.visible !== transport.subtitleState.visible
  )
}

function createSubtitlePayload(state = {}) {
  return JSON.stringify({
    kind: WATCH_PARTY_SUBTITLE_MESSAGE_KIND,
    state: normalizeSubtitleState(state),
  })
}

function decodeDataPayload(payload) {
  try {
    return JSON.parse(new TextDecoder().decode(payload))
  } catch {
    return null
  }
}

function detachTrack(track, element) {
  if (!track || !element) return
  try {
    track.detach(element)
  } catch {
    // Best effort cleanup only.
  }
}

function stopTransportHealthMonitor() {
  if (transport.healthMonitorId) {
    window.clearInterval(transport.healthMonitorId)
    transport.healthMonitorId = null
  }
}

function clearRemoteTracks() {
  detachTrack(transport.remoteVideoTrack, transport.remoteVideoElement)
  detachTrack(transport.remoteAudioTrack, transport.remoteAudioElement)
  transport.remoteVideoTrack = null
  transport.remoteAudioTrack = null
  emitRemoteTrackState()
}

function syncRemoteTracksFromRoom() {
  if (!transport.room) {
    return false
  }

  let changed = false

  for (const participant of transport.room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      const track = publication?.track
      if (!track) continue

      if (isWatchPartyVoicePublication(publication) && track.kind === TRACK_KIND_AUDIO) {
        attachRemoteVoiceTrack(track, publication, participant)
        continue
      }

      if (!isWatchPartyMediaPublication(publication)) {
        continue
      }

      if (track.kind === TRACK_KIND_VIDEO && transport.remoteVideoTrack?.sid !== track.sid) {
        transport.remoteVideoTrack = track
        changed = true
      }

      if (track.kind === TRACK_KIND_AUDIO && transport.remoteAudioTrack?.sid !== track.sid) {
        transport.remoteAudioTrack = track
        changed = true
      }
    }
  }

  if (changed) {
    attachRemoteTracks()
  }

  return changed
}

function cleanupRemoteVoiceTrackEntry(entry) {
  if (!entry) return

  detachTrack(entry.track, entry.element)

  try {
    entry.element.pause()
  } catch {
    // Best effort cleanup only.
  }

  entry.element.srcObject = null
  entry.element.removeAttribute('src')
}

function clearRemoteVoiceTracks() {
  transport.remoteVoiceTracks.forEach((entry) => {
    cleanupRemoteVoiceTrackEntry(entry)
  })

  transport.remoteVoiceTracks.clear()
}

function primeMediaElement(element, { muted = false } = {}) {
  if (!element) return

  element.autoplay = true
  element.playsInline = true
  element.muted = muted

  if (typeof element.volume === 'number') {
    element.volume = 1
  }
}

function ensureElementPlayback(element) {
  if (!element) return

  const tryPlay = () => {
    void element.play().catch(() => {})
  }

  tryPlay()

  const retryPlayback = () => {
    tryPlay()
    element.removeEventListener('loadedmetadata', retryPlayback)
    element.removeEventListener('canplay', retryPlayback)
    element.removeEventListener('playing', retryPlayback)
  }

  element.addEventListener('loadedmetadata', retryPlayback, { once: true })
  element.addEventListener('canplay', retryPlayback, { once: true })
  element.addEventListener('playing', retryPlayback, { once: true })
}

function ensureRoomPlaybackStarted() {
  if (!transport.room) {
    return
  }

  if (!transport.room.canPlaybackAudio) {
    void transport.room.startAudio().catch(() => {})
  }

  if (!transport.room.canPlaybackVideo) {
    void transport.room.startVideo().catch(() => {})
  }
}

function startTransportHealthMonitor() {
  stopTransportHealthMonitor()

  if (typeof window === 'undefined') {
    return
  }

  transport.healthMonitorId = window.setInterval(() => {
    if (!transport.room || transport.room.state !== 'connected') {
      return
    }

    ensureRoomPlaybackStarted()

    if (transport.isHost) {
      const shouldRepublish = Boolean(
        transport.sourceElement
        && transport.sourceElement.readyState >= 2
        && !transport.sourceElement.ended
        && (
          !hasActivePublishedSource()
          || sourceCaptureNeedsRepublish()
        )
      )

      if (shouldRepublish) {
        void publishCurrentPlaybackSource().catch((error) => {
          emitTransportError(error)
        })
      }

      if (transport.subtitleState.visible) {
        void publishSubtitleState().catch(() => {})
      }

      return
    }

    if (!transport.remoteVideoTrack && !transport.remoteAudioTrack) {
      syncRemoteTracksFromRoom()
    }

    if (transport.remoteVideoTrack || transport.remoteAudioTrack) {
      attachRemoteTracks()
    }
  }, 2500)
}

function attachRemoteTracks() {
  if (transport.remoteVideoTrack && transport.remoteVideoElement) {
    primeMediaElement(transport.remoteVideoElement, { muted: false })
    transport.remoteVideoTrack.attach(transport.remoteVideoElement)
    ensureElementPlayback(transport.remoteVideoElement)
  }

  if (transport.remoteAudioTrack && transport.remoteAudioElement) {
    primeMediaElement(transport.remoteAudioElement, { muted: false })
    transport.remoteAudioTrack.attach(transport.remoteAudioElement)
    ensureElementPlayback(transport.remoteAudioElement)
  }

  ensureRoomPlaybackStarted()
  emitRemoteTrackState()
}

function isWatchPartyMediaPublication(publication) {
  const trackName = normalizeValue(publication?.trackName)
  return (
    trackName === WATCH_PARTY_VIDEO_TRACK_NAME
    || trackName === WATCH_PARTY_AUDIO_TRACK_NAME
    || publication?.source === TRACK_SOURCE_SCREEN_SHARE
    || publication?.source === TRACK_SOURCE_SCREEN_SHARE_AUDIO
  )
}

function isWatchPartyVoicePublication(publication) {
  return publication?.source === TRACK_SOURCE_MICROPHONE
}

function getRemoteVoiceTrackKey(publication, participant, track) {
  const trackSid = normalizeValue(publication?.trackSid || track?.sid)
  if (trackSid) {
    return trackSid
  }

  return [
    normalizeValue(participant?.identity),
    normalizeValue(publication?.trackName || track?.mediaStreamTrack?.id || track?.sid),
  ].filter(Boolean).join(':')
}

function attachRemoteVoiceTrack(track, publication, participant) {
  const key = getRemoteVoiceTrackKey(publication, participant, track)
  if (!key || track.kind !== TRACK_KIND_AUDIO) {
    return
  }

  const existingEntry = transport.remoteVoiceTracks.get(key)
  if (existingEntry) {
    cleanupRemoteVoiceTrackEntry(existingEntry)
  }

  const element = new Audio()
  primeMediaElement(element, { muted: false })

  track.attach(element)
  ensureElementPlayback(element)
  ensureRoomPlaybackStarted()

  transport.remoteVoiceTracks.set(key, {
    track,
    element,
  })
}

function detachRemoteVoiceTrack(track, publication, participant) {
  const key = getRemoteVoiceTrackKey(publication, participant, track)
  if (!key) {
    return
  }

  const entry = transport.remoteVoiceTracks.get(key)
  if (!entry) {
    return
  }

  cleanupRemoteVoiceTrackEntry(entry)
  transport.remoteVoiceTracks.delete(key)
}

function capturePlaybackStream(element) {
  if (!element) {
    throw createWatchPartyTransportError('No playback element is available for Watch Party broadcast.')
  }

  if (typeof element.captureStream === 'function') {
    return element.captureStream()
  }

  if (typeof element.mozCaptureStream === 'function') {
    return element.mozCaptureStream()
  }

  throw createWatchPartyTransportError(
    'This runtime does not support media-element capture for Watch Party broadcasting.'
  )
}

function sourceCaptureNeedsRepublish() {
  return [
    transport.publishedVideoTrack,
    transport.publishedAudioTrack,
  ].filter(Boolean).some((track) => (
    track.readyState === 'ended' || track.muted
  ))
}

async function cleanupBroadcastAudioGraph() {
  const audioContext = transport.broadcastAudioContext
  const sourceNode = transport.broadcastAudioSourceNode
  const destinationNode = transport.broadcastAudioDestinationNode

  transport.broadcastAudioContext = null
  transport.broadcastAudioSourceNode = null
  transport.broadcastAudioDestinationNode = null
  transport.broadcastAudioElement = null

  if (sourceNode) {
    try {
      sourceNode.disconnect()
    } catch {
      // Best effort cleanup only.
    }
  }

  if (destinationNode) {
    try {
      destinationNode.disconnect()
    } catch {
      // Best effort cleanup only.
    }
  }

  if (audioContext) {
    try {
      await audioContext.close()
    } catch {
      // Best effort cleanup only.
    }
  }
}

async function ensureBroadcastAudioTrack(element) {
  if (!element) {
    return null
  }

  if (
    transport.broadcastAudioElement === element
    && transport.broadcastAudioDestinationNode
  ) {
    const [existingTrack] = transport.broadcastAudioDestinationNode.stream.getAudioTracks()
    if (existingTrack && existingTrack.readyState !== 'ended') {
      if (transport.broadcastAudioContext?.state === 'suspended') {
        await transport.broadcastAudioContext.resume().catch(() => {})
      }
      return existingTrack
    }
  }

  if (transport.broadcastAudioElement && transport.broadcastAudioElement !== element) {
    await cleanupBroadcastAudioGraph()
  }

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextConstructor) {
    return null
  }

  const audioContext = new AudioContextConstructor()
  const sourceNode = audioContext.createMediaElementSource(element)
  const destinationNode = audioContext.createMediaStreamDestination()

  sourceNode.connect(destinationNode)
  sourceNode.connect(audioContext.destination)

  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {})
  }

  const [audioTrack] = destinationNode.stream.getAudioTracks()
  if (!audioTrack) {
    await cleanupBroadcastAudioGraph()
    return null
  }

  transport.broadcastAudioContext = audioContext
  transport.broadcastAudioSourceNode = sourceNode
  transport.broadcastAudioDestinationNode = destinationNode
  transport.broadcastAudioElement = element

  return audioTrack
}

async function unpublishTrack(track, { stopTrack = true } = {}) {
  if (!transport.room || !track) return

  try {
    await transport.room.localParticipant.unpublishTrack(track, false)
  } catch {
    // Best effort cleanup only.
  }

  if (stopTrack) {
    try {
      track.stop()
    } catch {
      // Best effort cleanup only.
    }
  }
}

async function clearPublishedTracks({ keepAudioGraph = false } = {}) {
  await unpublishTrack(transport.publishedVideoTrack)
  await unpublishTrack(transport.publishedAudioTrack, {
    stopTrack: !keepAudioGraph,
  })

  transport.publishedVideoTrack = null
  transport.publishedAudioTrack = null
  transport.captureStream = null
  transport.publishedElement = null

  if (!keepAudioGraph) {
    await cleanupBroadcastAudioGraph()
  }
}

function createMicrophoneConstraints() {
  return {
    autoGainControl: true,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    voiceIsolation: true,
  }
}

async function clearPublishedMicrophoneTrack() {
  await unpublishTrack(transport.publishedMicrophoneTrack, {
    stopTrack: false,
  })

  transport.publishedMicrophoneTrack = null
  transport.microphoneNoiseSuppressionEnabled = false

  const cleanup = transport.microphoneCleanup
  transport.microphoneCleanup = null

  if (cleanup) {
    await cleanup().catch(() => {})
  }
}

async function createRawMicrophoneSource() {
  const inputStream = await navigator.mediaDevices.getUserMedia({
    audio: createMicrophoneConstraints(),
  })
  const [track] = inputStream.getAudioTracks()

  if (!track) {
    inputStream.getTracks().forEach((streamTrack) => {
      try {
        streamTrack.stop()
      } catch {
        // Best effort cleanup only.
      }
    })
    throw createWatchPartyTransportError('Could not access a microphone track for Watch Party voice chat.')
  }

  track.enabled = true

  return {
    track,
    cleanup: async () => {
      inputStream.getTracks().forEach((streamTrack) => {
        try {
          streamTrack.stop()
        } catch {
          // Best effort cleanup only.
        }
      })
    },
  }
}

async function createWatchPartyMicrophoneSource({ noiseSuppressionEnabled = false } = {}) {
  if (!noiseSuppressionEnabled) {
    return createRawMicrophoneSource()
  }

  const { createNoiseSuppressedMicrophoneSource } = await loadNoiseSuppressionModule()

  return createNoiseSuppressedMicrophoneSource({
    constraints: createMicrophoneConstraints(),
  })
}

async function publishWatchPartyMicrophoneTrack({ noiseSuppressionEnabled = false } = {}) {
  if (!transport.room) {
    return false
  }

  await transport.room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
  await clearPublishedMicrophoneTrack()

  const microphoneSource = await createWatchPartyMicrophoneSource({
    noiseSuppressionEnabled,
  })

  try {
    await transport.room.localParticipant.publishTrack(microphoneSource.track, {
      source: TRACK_SOURCE_MICROPHONE,
      name: VOICE_TRACK_NAME,
    })

    transport.publishedMicrophoneTrack = microphoneSource.track
    transport.microphoneCleanup = microphoneSource.cleanup
    transport.microphoneNoiseSuppressionEnabled = Boolean(noiseSuppressionEnabled)
    return true
  } catch (error) {
    await microphoneSource.cleanup?.().catch(() => {})
    throw error
  }
}

function trackIsActive(track) {
  return Boolean(track && track.readyState !== 'ended')
}

function hasActivePublishedSource() {
  return Boolean(
    transport.publishedElement
    && transport.publishedElement === transport.sourceElement
    && (
      trackIsActive(transport.publishedVideoTrack)
      || trackIsActive(transport.publishedAudioTrack)
    )
  )
}

async function publishSubtitleState() {
  if (!transport.room || !transport.isHost || transport.room.state !== 'connected') {
    return false
  }

  const payload = new TextEncoder().encode(
    createSubtitlePayload(transport.subtitleState)
  )

  await transport.room.localParticipant.publishData(payload, {
    reliable: true,
  })

  return true
}

async function publishCurrentPlaybackSource() {
  if (!transport.room || !transport.isHost) {
    return false
  }

  if (transport.room.state !== 'connected') {
    emitBroadcastStatus('connecting', transport.sourceLabel)
    return false
  }

  if (!transport.sourceElement) {
    await clearPublishedTracks()
    emitBroadcastStatus('awaiting-source', '')
    return false
  }

  if (hasActivePublishedSource() && !sourceCaptureNeedsRepublish()) {
    emitBroadcastStatus('publishing', transport.sourceLabel)
    return true
  }

  let captureStream
  try {
    captureStream = capturePlaybackStream(transport.sourceElement)
  } catch (error) {
    await clearPublishedTracks()
    emitBroadcastStatus('awaiting-source', transport.sourceLabel)
    throw error
  }

  const [videoTrack] = captureStream.getVideoTracks()
  let audioTrack = null

  try {
    audioTrack = await ensureBroadcastAudioTrack(transport.sourceElement)
  } catch {
    // Fall back to the capture stream's audio track if the media-element audio graph
    // is unavailable for this source/runtime.
  }

  if (!audioTrack) {
    ;[audioTrack] = captureStream.getAudioTracks()
  }

  if (!videoTrack && !audioTrack) {
    await clearPublishedTracks()
    emitBroadcastStatus('awaiting-source', transport.sourceLabel)
    throw createWatchPartyTransportError(
      'The active player is not exposing any audio or video tracks for Watch Party broadcast yet.'
    )
  }

  await clearPublishedTracks({
    keepAudioGraph: Boolean(
      audioTrack
      && transport.broadcastAudioElement
      && transport.broadcastAudioElement === transport.sourceElement
    ),
  })

  try {
    if (videoTrack) {
      transport.publishedVideoTrack = videoTrack
      await transport.room.localParticipant.publishTrack(videoTrack, {
        name: WATCH_PARTY_VIDEO_TRACK_NAME,
        source: TRACK_SOURCE_SCREEN_SHARE,
        stream: WATCH_PARTY_MEDIA_STREAM_NAME,
      })
    }

    if (audioTrack) {
      transport.publishedAudioTrack = audioTrack
      await transport.room.localParticipant.publishTrack(audioTrack, {
        name: WATCH_PARTY_AUDIO_TRACK_NAME,
        source: TRACK_SOURCE_SCREEN_SHARE_AUDIO,
        stream: WATCH_PARTY_MEDIA_STREAM_NAME,
      })
    }

    transport.captureStream = captureStream
    transport.publishedElement = transport.sourceElement
    await publishSubtitleState().catch(() => {})
    emitBroadcastStatus('publishing', transport.sourceLabel)
    return true
  } catch (error) {
    await clearPublishedTracks()
    emitBroadcastStatus('awaiting-source', transport.sourceLabel)
    throw error
  }
}

async function getSupabaseAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return normalizeValue(session?.access_token)
}

async function requestWatchPartyToken({ roomId, roomCode, userId, displayName, isHost }) {
  const accessToken = await getSupabaseAccessToken()
  if (!accessToken) {
    throw createWatchPartyTransportError('Your session expired. Sign in again to continue with Watch Party media.')
  }

  const transportConfig = await resolveTransportConfiguration()
  if (!transportConfig.configured || !transportConfig.url) {
    throw createWatchPartyTransportError(transportConfig.error || getTransportConfigurationError().message)
  }

  let payload = {}

  if (transportConfig.tokenProvider === 'native') {
    payload = await invoke('create_watch_party_token', {
      payload: {
        accessToken,
        roomId: normalizeValue(roomId),
        roomCode: normalizeValue(roomCode),
        identity: normalizeValue(userId),
        displayName: normalizeValue(displayName),
        role: isHost ? 'host' : 'guest',
      },
    }).catch((error) => {
      throw createWatchPartyTransportError(error?.message || 'Could not get a Watch Party media token.')
    })
  } else {
    const response = await fetch(transportConfig.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        roomId: normalizeValue(roomId),
        roomCode: normalizeValue(roomCode),
        identity: normalizeValue(userId),
        displayName: normalizeValue(displayName),
        role: isHost ? 'host' : 'guest',
      }),
    })

    payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw createWatchPartyTransportError(
        normalizeValue(payload?.error || payload?.message) || 'Could not get a Watch Party media token.'
      )
    }
  }

  const token = normalizeValue(payload?.token)
  const resolvedUrl = normalizeValue(payload?.url) || transportConfig.url

  if (!token || !resolvedUrl) {
    throw createWatchPartyTransportError('The Watch Party token service returned an incomplete LiveKit session payload.')
  }

  return {
    token,
    url: resolvedUrl,
  }
}

function bindRoomEvents(room) {
  room.on(ROOM_EVENT_CONNECTION_STATE_CHANGED, (state) => {
    emitConnectionState(state)
  })

  room.on(ROOM_EVENT_RECONNECTED, () => {
    emitConnectionState(room.state)
    ensureRoomPlaybackStarted()

    if (transport.isHost) {
      void publishCurrentPlaybackSource()
        .then(() => publishSubtitleState().catch(() => {}))
        .catch((error) => {
          emitTransportError(error)
        })
      return
    }

    attachRemoteTracks()
    emitBroadcastStatus(
      transport.remoteVideoTrack || transport.remoteAudioTrack ? 'receiving' : 'waiting-for-host',
      ''
    )
  })

  room.on(ROOM_EVENT_MEDIA_DEVICES_ERROR, (error, kind) => {
    if (kind === 'audioinput') {
      emitTransportError(createMicrophonePermissionError(error?.message))
      return
    }

    emitTransportError(error)
  })

  room.on(ROOM_EVENT_DATA_RECEIVED, (payload) => {
    const message = decodeDataPayload(payload)
    if (message?.kind !== WATCH_PARTY_SUBTITLE_MESSAGE_KIND || transport.isHost) {
      return
    }

    emitSubtitleState(message.state || {})
  })

  room.on(ROOM_EVENT_TRACK_SUBSCRIBED, (track, publication, participant) => {
    if (isWatchPartyVoicePublication(publication) && track.kind === TRACK_KIND_AUDIO) {
      attachRemoteVoiceTrack(track, publication, participant)
      return
    }

    if (!isWatchPartyMediaPublication(publication)) {
      return
    }

    if (track.kind === TRACK_KIND_VIDEO) {
      transport.remoteVideoTrack = track
    }

    if (track.kind === TRACK_KIND_AUDIO) {
      transport.remoteAudioTrack = track
    }

    attachRemoteTracks()
    emitBroadcastStatus('receiving', '')
  })

  room.on(ROOM_EVENT_TRACK_MUTED, (publication, participant) => {
    if (isWatchPartyVoicePublication(publication)) {
      if (publication.track?.kind === TRACK_KIND_AUDIO) {
        detachRemoteVoiceTrack(publication.track, publication, participant)
      }
      return
    }

    if (!isWatchPartyMediaPublication(publication)) {
      return
    }

    if (publication.kind === TRACK_KIND_VIDEO && transport.remoteVideoTrack?.sid === publication.trackSid) {
      transport.remoteVideoTrack = publication.track || transport.remoteVideoTrack
    }

    if (publication.kind === TRACK_KIND_AUDIO && transport.remoteAudioTrack?.sid === publication.trackSid) {
      transport.remoteAudioTrack = publication.track || transport.remoteAudioTrack
    }

    emitRemoteTrackState()
  })

  room.on(ROOM_EVENT_TRACK_UNMUTED, (publication, participant) => {
    if (isWatchPartyVoicePublication(publication)) {
      if (publication.track?.kind === TRACK_KIND_AUDIO) {
        attachRemoteVoiceTrack(publication.track, publication, participant)
      }
      return
    }

    if (!isWatchPartyMediaPublication(publication)) {
      return
    }

    if (publication.track?.kind === TRACK_KIND_VIDEO) {
      transport.remoteVideoTrack = publication.track
    }

    if (publication.track?.kind === TRACK_KIND_AUDIO) {
      transport.remoteAudioTrack = publication.track
    }

    attachRemoteTracks()
    emitBroadcastStatus('receiving', '')
  })

  room.on(ROOM_EVENT_TRACK_STREAM_STATE_CHANGED, (publication, streamState) => {
    if (!isWatchPartyMediaPublication(publication)) {
      return
    }

    if (streamState === TRACK_STREAM_STATE_ACTIVE) {
      if (publication.track?.kind === TRACK_KIND_VIDEO) {
        transport.remoteVideoTrack = publication.track
      }

      if (publication.track?.kind === TRACK_KIND_AUDIO) {
        transport.remoteAudioTrack = publication.track
      }

      attachRemoteTracks()
      emitBroadcastStatus('receiving', '')
      return
    }

    if (!transport.isHost) {
      emitRemoteTrackState()
    }
  })

  room.on(ROOM_EVENT_AUDIO_PLAYBACK_STATUS_CHANGED, () => {
    ensureRoomPlaybackStarted()
    attachRemoteTracks()
  })

  room.on(ROOM_EVENT_VIDEO_PLAYBACK_STATUS_CHANGED, () => {
    ensureRoomPlaybackStarted()
    attachRemoteTracks()
  })

  room.on(ROOM_EVENT_TRACK_UNSUBSCRIBED, (track, publication, participant) => {
    if (isWatchPartyVoicePublication(publication) && track.kind === TRACK_KIND_AUDIO) {
      detachRemoteVoiceTrack(track, publication, participant)
      return
    }

    if (!isWatchPartyMediaPublication(publication)) {
      return
    }

    if (track.kind === TRACK_KIND_VIDEO) {
      detachTrack(transport.remoteVideoTrack, transport.remoteVideoElement)
      transport.remoteVideoTrack = null
    }

    if (track.kind === TRACK_KIND_AUDIO) {
      detachTrack(transport.remoteAudioTrack, transport.remoteAudioElement)
      transport.remoteAudioTrack = null
    }

    emitRemoteTrackState()

    if (!transport.isHost) {
      emitSubtitleState({ text: '', visible: false })
      emitBroadcastStatus('waiting-for-host', '')
    }
  })

  room.on(ROOM_EVENT_ACTIVE_SPEAKERS_CHANGED, (participants) => {
    emitActiveSpeakersChange(participants)
  })

  room.on(ROOM_EVENT_DISCONNECTED, () => {
    clearRemoteTracks()
    clearRemoteVoiceTracks()
    emitConnectionState('disconnected')
    emitActiveSpeakersChange([])
    emitSubtitleState({ text: '', visible: false })
    emitBroadcastStatus(transport.isHost ? 'awaiting-source' : 'idle', transport.isHost ? transport.sourceLabel : '')
  })
}

export function setWatchPartyLiveKitCallbacks(callbacks = {}) {
  transport.callbacks = {
    ...DEFAULT_CALLBACKS,
    ...(callbacks || {}),
  }
}

export function isWatchPartyLiveKitConfigured() {
  return Boolean(getEnvironmentTransportConfig().configured || runtimeTransportConfig.value?.configured)
}

export async function refreshWatchPartyLiveKitConfiguration({ forceRefresh = false } = {}) {
  return resolveTransportConfiguration({ forceRefresh })
}

export function hasActiveWatchPartyLiveKitConnection({
  roomId,
  userId,
  isHost,
}) {
  const sessionKey = JSON.stringify({
    roomId: normalizeValue(roomId),
    userId: normalizeValue(userId),
    isHost: Boolean(isHost),
  })

  return Boolean(
    transport.room
    && transport.sessionKey === sessionKey
    && transport.room.state !== 'disconnected'
  )
}

export async function ensureWatchPartyLiveKitConnection({
  roomId,
  roomCode,
  userId,
  displayName,
  isHost,
}) {
  const { Room } = await loadLiveKitModule()
  const normalizedRoomId = normalizeValue(roomId)
  const normalizedRoomCode = normalizeValue(roomCode)
  const normalizedUserId = normalizeValue(userId)
  const sessionKey = JSON.stringify({
    roomId: normalizedRoomId,
    userId: normalizedUserId,
    isHost: Boolean(isHost),
  })

  if (
    transport.room
    && transport.sessionKey === sessionKey
    && transport.room.state !== 'disconnected'
  ) {
    return transport.room
  }

  await disconnectWatchPartyLiveKit()

  const session = await requestWatchPartyToken({
    roomId: normalizedRoomId,
    roomCode: normalizedRoomCode,
    userId: normalizedUserId,
    displayName,
    isHost,
  })

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    stopLocalTrackOnUnpublish: false,
  })
  bindRoomEvents(room)

  transport.room = room
  transport.sessionKey = sessionKey
  transport.roomId = normalizedRoomId
  transport.roomCode = normalizedRoomCode
  transport.isHost = Boolean(isHost)

  emitConnectionState('connecting')
  emitBroadcastStatus(isHost ? 'connecting' : 'waiting-for-host', transport.sourceLabel)

  try {
    await room.prepareConnection(session.url, session.token).catch(() => {})
    await room.connect(session.url, session.token, {
      autoSubscribe: true,
      adaptiveStream: true,
      dynacast: true,
    })
    emitConnectionState(room.state)
    emitActiveSpeakersChange(room.activeSpeakers)
    ensureRoomPlaybackStarted()
    startTransportHealthMonitor()

    if (transport.isHost) {
      await publishCurrentPlaybackSource()
    } else {
      emitBroadcastStatus(
        transport.remoteVideoTrack || transport.remoteAudioTrack ? 'receiving' : 'waiting-for-host',
        ''
      )
    }

    return room
  } catch (error) {
    await disconnectWatchPartyLiveKit()
    throw error
  }
}

export async function disconnectWatchPartyLiveKit() {
  const existingRoom = transport.room

  stopTransportHealthMonitor()
  await clearPublishedMicrophoneTrack()
  await clearPublishedTracks()
  clearRemoteTracks()
  clearRemoteVoiceTracks()
  transport.subtitleState = {
    text: '',
    visible: false,
  }

  transport.sessionKey = ''
  transport.room = null
  transport.roomId = ''
  transport.roomCode = ''
  transport.isHost = false

  if (existingRoom) {
    try {
      await existingRoom.disconnect(false)
    } catch {
      // Best effort cleanup only.
    }
  }

  emitConnectionState('idle')
  emitActiveSpeakersChange([])
  emitBroadcastStatus('idle', '')
}

export function attachWatchPartyRemoteMedia({ videoElement = null, audioElement = null } = {}) {
  if (transport.remoteVideoElement && transport.remoteVideoElement !== videoElement) {
    detachTrack(transport.remoteVideoTrack, transport.remoteVideoElement)
  }

  if (transport.remoteAudioElement && transport.remoteAudioElement !== audioElement) {
    detachTrack(transport.remoteAudioTrack, transport.remoteAudioElement)
  }

  transport.remoteVideoElement = videoElement
  transport.remoteAudioElement = audioElement
  if (transport.remoteVideoElement) {
    primeMediaElement(transport.remoteVideoElement, { muted: false })
  }
  if (transport.remoteAudioElement) {
    primeMediaElement(transport.remoteAudioElement, { muted: false })
  }
  attachRemoteTracks()
}

export async function setWatchPartyPlaybackElement({ element = null, label = '' } = {}) {
  transport.sourceElement = element || null
  transport.sourceLabel = normalizeValue(label)

  if (transport.isHost && transport.room && transport.room.state === 'connected') {
    try {
      return await publishCurrentPlaybackSource()
    } catch (error) {
      emitTransportError(error)
      return false
    }
  }

  if (transport.isHost) {
    emitBroadcastStatus(element ? 'awaiting-source' : 'idle', transport.sourceLabel)
  }
  return Boolean(element)
}

export async function clearWatchPartyPlaybackElement(element = null) {
  if (element && transport.sourceElement && transport.sourceElement !== element) {
    return
  }

  transport.sourceElement = null
  transport.sourceLabel = ''
  transport.subtitleState = {
    text: '',
    visible: false,
  }

  await clearPublishedTracks()
  await publishSubtitleState().catch(() => {})

  if (transport.isHost) {
    if (transport.room && transport.room.state === 'connected') {
      emitBroadcastStatus('awaiting-source', '')
    } else {
      emitBroadcastStatus('idle', '')
    }
  }
}

export async function pauseWatchPartyBroadcast() {
  if (!transport.isHost) {
    return false
  }

  await clearPublishedTracks({
    keepAudioGraph: Boolean(
      transport.sourceElement
      && transport.broadcastAudioElement === transport.sourceElement
    ),
  })

  if (transport.room && transport.room.state === 'connected') {
    emitBroadcastStatus('awaiting-source', transport.sourceLabel)
  } else {
    emitBroadcastStatus('idle', transport.sourceLabel)
  }

  return true
}

export async function resumeWatchPartyBroadcast() {
  if (!transport.isHost) {
    return false
  }

  if (!transport.sourceElement) {
    emitBroadcastStatus('awaiting-source', transport.sourceLabel)
    return false
  }

  if (!transport.room || transport.room.state !== 'connected') {
    emitBroadcastStatus('connecting', transport.sourceLabel)
    return false
  }

  return publishCurrentPlaybackSource()
}

export async function setWatchPartySubtitleState({ text = '', visible = false } = {}) {
  const nextState = normalizeSubtitleState({ text, visible })

  if (!subtitleStateChanged(nextState)) {
    return false
  }

  transport.subtitleState = nextState

  if (transport.isHost && transport.room && transport.room.state === 'connected') {
    await publishSubtitleState()
  }

  return true
}

export async function syncWatchPartyMicrophoneState({
  isMuted = false,
  noiseSuppressionEnabled = false,
} = {}) {
  if (!transport.room || transport.room.state !== 'connected') {
    return true
  }

  const shouldEnableMicrophone = !Boolean(isMuted)
  const { localParticipant } = transport.room

  if (!shouldEnableMicrophone) {
    await localParticipant.setMicrophoneEnabled(false).catch(() => {})
    await clearPublishedMicrophoneTrack()
    return true
  }

  try {
    if (
      transport.publishedMicrophoneTrack
      && transport.publishedMicrophoneTrack.readyState !== 'ended'
      && transport.microphoneNoiseSuppressionEnabled === noiseSuppressionEnabled
    ) {
      return true
    }

    await publishWatchPartyMicrophoneTrack({
      noiseSuppressionEnabled,
    })
    return true
  } catch (error) {
    throw createMicrophonePermissionError(error?.message)
  }
}
