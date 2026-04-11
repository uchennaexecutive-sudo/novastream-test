import { supabase } from './supabaseClient'

export const WATCH_PARTY_CODE_LENGTH = 6
export const WATCH_PARTY_CODE_REGEX = /^[A-Z0-9]{6}$/
const ACTIVE_ROOM_STATUSES = ['lobby', 'live']
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const WATCH_PARTY_TABLE_HINT = 'Run docs/watchparty-phase-c-supabase.sql to create the required Watch Party tables and policies.'

function buildFriendlyWatchPartyError(error, fallbackMessage) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').trim()
  const details = String(error?.details || '').trim()
  const combined = `${message} ${details}`.toLowerCase()

  if (code === '42P01' || combined.includes('watch_party_')) {
    return `${fallbackMessage} ${WATCH_PARTY_TABLE_HINT}`.trim()
  }

  if (code === '23505') {
    return 'That room code is already in use. Please try again.'
  }

  if (code === 'PGRST116') {
    return fallbackMessage
  }

  if (combined.includes('row-level security') || combined.includes('permission denied')) {
    return `Watch Party permissions are not set up yet. ${WATCH_PARTY_TABLE_HINT}`
  }

  return fallbackMessage
}

function createWatchPartyError(error, fallbackMessage) {
  const next = new Error(buildFriendlyWatchPartyError(error, fallbackMessage))
  next.cause = error
  return next
}

function randomRoomCodeCharacter() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return ROOM_CODE_ALPHABET[buffer[0] % ROOM_CODE_ALPHABET.length]
  }

  const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)
  return ROOM_CODE_ALPHABET[index]
}

function createRandomRoomCode() {
  let output = ''
  while (output.length < WATCH_PARTY_CODE_LENGTH) {
    output += randomRoomCodeCharacter()
  }
  return output
}

export function normalizeWatchPartyCode(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, WATCH_PARTY_CODE_LENGTH)
    .toUpperCase()
}

export function isValidWatchPartyCode(value) {
  return WATCH_PARTY_CODE_REGEX.test(normalizeWatchPartyCode(value))
}

export function validateWatchPartyCode(value) {
  const normalized = normalizeWatchPartyCode(value)
  if (!WATCH_PARTY_CODE_REGEX.test(normalized)) {
    throw new Error('Enter a valid 6-character room code.')
  }
  return normalized
}

function buildParticipantDisplayName(row, profile, userId) {
  const persistedName = String(row?.display_name || '').trim()
  if (persistedName) return persistedName

  const username = String(profile?.username || '').trim()
  if (username) return username

  const fallback = String(userId || '').trim()
  if (!fallback) return 'Member'
  return `Member ${fallback.slice(0, 6)}`
}

function mapParticipantRow(row, profileMap, hostUserId) {
  const profile = profileMap.get(String(row?.user_id || ''))
  const fallbackSeed = String(row?.user_id || row?.id || 'nova').trim() || 'nova'

  return {
    id: String(row?.id || row?.user_id || fallbackSeed),
    userId: String(row?.user_id || ''),
    name: buildParticipantDisplayName(row, profile, row?.user_id),
    avatarStyle: String(row?.avatar_style || profile?.avatar_style || '').trim() || 'bottts',
    avatarSeed: String(row?.avatar_seed || profile?.avatar_seed || '').trim() || fallbackSeed,
    isHost: Boolean(row?.is_host) || String(row?.user_id || '') === String(hostUserId || ''),
    isMuted: Boolean(row?.is_muted),
    isSpeaking: false,
    joinedAt: row?.joined_at || null,
  }
}

function sortParticipantsForRoom(participants = []) {
  return [...participants].sort((left, right) => {
    if (Boolean(left?.isHost) !== Boolean(right?.isHost)) {
      return left?.isHost ? -1 : 1
    }

    const leftJoinedAt = Date.parse(left?.joinedAt || '')
    const rightJoinedAt = Date.parse(right?.joinedAt || '')
    const leftValue = Number.isFinite(leftJoinedAt) ? leftJoinedAt : 0
    const rightValue = Number.isFinite(rightJoinedAt) ? rightJoinedAt : 0

    return leftValue - rightValue
      || String(left?.name || '').localeCompare(String(right?.name || ''))
      || String(left?.id || '').localeCompare(String(right?.id || ''))
  })
}

async function fetchProfilesByUserIds(userIds) {
  const normalized = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  ))

  if (normalized.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_style, avatar_seed')
    .in('id', normalized)

  if (error) {
    throw createWatchPartyError(error, 'Could not load Watch Party profiles.')
  }

  return new Map((data || []).map((item) => [String(item.id), item]))
}

function hasPersistedParticipantIdentity(row) {
  return Boolean(
    String(row?.display_name || '').trim()
    || String(row?.avatar_style || '').trim()
    || String(row?.avatar_seed || '').trim()
  )
}

async function fetchRoomParticipants(roomId, hostUserId) {
  const { data, error } = await supabase
    .from('watch_party_participants')
    .select('*')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true })

  if (error) {
    throw createWatchPartyError(error, 'Could not load Watch Party participants.')
  }

  const rows = Array.isArray(data) ? data : []
  const missingProfileUserIds = rows
    .filter((row) => !hasPersistedParticipantIdentity(row))
    .map((item) => item?.user_id)
  const profiles = await fetchProfilesByUserIds(missingProfileUserIds)
  return sortParticipantsForRoom(rows.map(row => mapParticipantRow(row, profiles, hostUserId)))
}

function mapRoomRow(row) {
  if (!row) return null

  return {
    id: String(row.id),
    code: normalizeWatchPartyCode(row.code),
    hostUserId: String(row.host_user_id || ''),
    status: String(row.status || 'lobby'),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    endedAt: row.ended_at || null,
  }
}

export async function fetchWatchPartyRoomByCode(code) {
  const normalizedCode = validateWatchPartyCode(code)
  const { data, error } = await supabase
    .from('watch_party_rooms')
    .select('id, code, host_user_id, status, created_at, updated_at, ended_at')
    .eq('code', normalizedCode)
    .in('status', ACTIVE_ROOM_STATUSES)
    .maybeSingle()

  if (error) {
    throw createWatchPartyError(error, 'Could not look up that room right now.')
  }

  return mapRoomRow(data)
}

export async function fetchWatchPartyRoomById(roomId) {
  const normalizedRoomId = String(roomId || '').trim()
  if (!normalizedRoomId) return null

  const { data, error } = await supabase
    .from('watch_party_rooms')
    .select('id, code, host_user_id, status, created_at, updated_at, ended_at')
    .eq('id', normalizedRoomId)
    .maybeSingle()

  if (error) {
    throw createWatchPartyError(error, 'Could not refresh the Watch Party room.')
  }

  return mapRoomRow(data)
}

export async function fetchWatchPartyRoomSnapshot(roomId) {
  const room = await fetchWatchPartyRoomById(roomId)
  if (!room) {
    return null
  }

  const participants = await fetchRoomParticipants(room.id, room.hostUserId)
  return { room, participants }
}

function buildParticipantUpsertPayload({ roomId, userId, isHost = false, profile = null }) {
  return {
    room_id: roomId,
    user_id: userId,
    is_host: Boolean(isHost),
    joined_at: new Date().toISOString(),
    display_name: String(profile?.username || '').trim() || null,
    avatar_style: String(profile?.avatar_style || '').trim() || 'bottts',
    avatar_seed: String(profile?.avatar_seed || userId || '').trim() || 'nova',
  }
}

function shouldRetryParticipantUpsertWithoutProfileColumns(error) {
  const combined = `${String(error?.message || '')} ${String(error?.details || '')}`.toLowerCase()

  return (
    combined.includes('display_name')
    || combined.includes('avatar_style')
    || combined.includes('avatar_seed')
  )
}

async function upsertParticipantRecord(roomId, userId, isHost = false, profile = null) {
  const payload = buildParticipantUpsertPayload({
    roomId,
    userId,
    isHost,
    profile,
  })

  let { error } = await supabase
    .from('watch_party_participants')
    .upsert(payload, { onConflict: 'room_id,user_id' })

  if (error && shouldRetryParticipantUpsertWithoutProfileColumns(error)) {
    const fallbackPayload = {
      room_id: roomId,
      user_id: userId,
      is_host: Boolean(isHost),
      joined_at: payload.joined_at,
    }

    const retryResult = await supabase
      .from('watch_party_participants')
      .upsert(fallbackPayload, { onConflict: 'room_id,user_id' })

    error = retryResult.error
  }

  if (error) {
    throw createWatchPartyError(error, 'Could not join the Watch Party room.')
  }
}

export async function createWatchPartyRoom({ hostUserId, profile = null }) {
  const normalizedHostUserId = String(hostUserId || '').trim()
  if (!normalizedHostUserId) {
    throw new Error('You need to be signed in to create a Watch Party room.')
  }

  let createdRoom = null
  let lastInsertError = null

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const nextCode = createRandomRoomCode()
    const payload = {
      code: nextCode,
      host_user_id: normalizedHostUserId,
      status: 'lobby',
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('watch_party_rooms')
      .insert(payload)
      .select('id, code, host_user_id, status, created_at, updated_at, ended_at')
      .single()

    if (!error) {
      createdRoom = mapRoomRow(data)
      break
    }

    lastInsertError = error

    if (String(error?.code || '').trim() !== '23505') {
      throw createWatchPartyError(error, 'Could not create the Watch Party room.')
    }
  }

  if (!createdRoom) {
    throw createWatchPartyError(lastInsertError, 'Could not create the Watch Party room.')
  }

  try {
    await upsertParticipantRecord(createdRoom.id, normalizedHostUserId, true, profile)
    const participants = await fetchRoomParticipants(createdRoom.id, createdRoom.hostUserId)
    return { room: createdRoom, participants }
  } catch (error) {
    await supabase.from('watch_party_rooms').delete().eq('id', createdRoom.id)
    throw error
  }
}

export async function joinWatchPartyRoom({ code, userId, profile = null }) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) {
    throw new Error('You need to be signed in to join a Watch Party room.')
  }

  const room = await fetchWatchPartyRoomByCode(code)
  if (!room) {
    throw new Error('Room not found. Check the code and try again.')
  }

  await upsertParticipantRecord(room.id, normalizedUserId, room.hostUserId === normalizedUserId, profile)
  const participants = await fetchRoomParticipants(room.id, room.hostUserId)
  return { room, participants }
}

export async function setWatchPartyRoomStatus({ roomId, hostUserId, status }) {
  const normalizedRoomId = String(roomId || '').trim()
  const normalizedHostUserId = String(hostUserId || '').trim()
  const nextStatus = String(status || '').trim()

  if (!normalizedRoomId || !normalizedHostUserId || !nextStatus) {
    throw new Error('Watch Party room state is incomplete.')
  }

  const updates = {
    status: nextStatus,
    updated_at: new Date().toISOString(),
  }

  if (nextStatus === 'ended') {
    updates.ended_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('watch_party_rooms')
    .update(updates)
    .eq('id', normalizedRoomId)
    .eq('host_user_id', normalizedHostUserId)
    .select('id, code, host_user_id, status, created_at, updated_at, ended_at')
    .single()

  if (error) {
    throw createWatchPartyError(error, 'Could not update the Watch Party room state.')
  }

  return mapRoomRow(data)
}

export async function leaveWatchPartyRoom({ roomId, userId }) {
  const normalizedRoomId = String(roomId || '').trim()
  const normalizedUserId = String(userId || '').trim()

  if (!normalizedRoomId || !normalizedUserId) {
    return
  }

  const { error } = await supabase
    .from('watch_party_participants')
    .delete()
    .eq('room_id', normalizedRoomId)
    .eq('user_id', normalizedUserId)

  if (error) {
    throw createWatchPartyError(error, 'Could not leave the Watch Party room.')
  }
}

export async function updateWatchPartyParticipantMuted({ roomId, userId, isMuted }) {
  const normalizedRoomId = String(roomId || '').trim()
  const normalizedUserId = String(userId || '').trim()

  if (!normalizedRoomId || !normalizedUserId) {
    return
  }

  const { error } = await supabase
    .from('watch_party_participants')
    .update({
      is_muted: Boolean(isMuted),
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', normalizedRoomId)
    .eq('user_id', normalizedUserId)

  if (error) {
    throw createWatchPartyError(error, 'Could not update your Watch Party voice state.')
  }
}
