import { AccessToken, TrackSource } from 'livekit-server-sdk'

const WATCH_PARTY_TOKEN_TTL = 60 * 60

function normalizeValue(value) {
  const normalized = String(value ?? '').trim()
  return normalized || ''
}

function getFirstEnvValue(...keys) {
  for (const key of keys) {
    const value = normalizeValue(process.env[key])
    if (value) {
      return value
    }
  }

  return ''
}

function getEnvironmentConfig() {
  return {
    liveKitUrl: getFirstEnvValue(
      'LIVEKIT_URL',
      'WATCH_PARTY_LIVEKIT_URL',
      'VITE_WATCH_PARTY_LIVEKIT_URL'
    ),
    liveKitApiKey: getFirstEnvValue(
      'LIVEKIT_API_KEY',
      'WATCH_PARTY_LIVEKIT_API_KEY'
    ),
    liveKitApiSecret: getFirstEnvValue(
      'LIVEKIT_API_SECRET',
      'WATCH_PARTY_LIVEKIT_API_SECRET'
    ),
    supabaseUrl: getFirstEnvValue('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    supabaseAnonKey: getFirstEnvValue('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'),
  }
}

function getConfigurationError() {
  const config = getEnvironmentConfig()
  const missing = []

  if (!config.liveKitUrl) {
    missing.push('LIVEKIT_URL')
  }
  if (!config.liveKitApiKey) {
    missing.push('LIVEKIT_API_KEY')
  }
  if (!config.liveKitApiSecret) {
    missing.push('LIVEKIT_API_SECRET')
  }
  if (!config.supabaseUrl) {
    missing.push('SUPABASE_URL')
  }
  if (!config.supabaseAnonKey) {
    missing.push('SUPABASE_ANON_KEY')
  }

  return missing.length
    ? `Watch Party token service is missing environment variables: ${missing.join(', ')}.`
    : ''
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
}

function sendJson(res, status, payload) {
  setCorsHeaders(res)
  res.status(status).json(payload)
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body)
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw ? JSON.parse(raw) : {}
}

function getBearerToken(req) {
  const authorization = normalizeValue(req.headers.authorization)
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return ''
  }

  return normalizeValue(authorization.slice('bearer '.length))
}

async function fetchJson(url, { accessToken = '', apikey = '', method = 'GET' } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey,
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const text = await response.text()
  let payload = null

  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

function buildSupabaseUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

async function fetchSupabaseUser(config, accessToken) {
  const response = await fetchJson(
    buildSupabaseUrl(config.supabaseUrl, '/auth/v1/user'),
    {
      accessToken,
      apikey: config.supabaseAnonKey,
    }
  )

  if (!response.ok || !response.payload?.id) {
    throw new Error(
      `Your Watch Party session could not be verified (${response.status}). ${
        typeof response.payload === 'string'
          ? response.payload.trim()
          : JSON.stringify(response.payload || {})
      }`
    )
  }

  return response.payload
}

async function fetchWatchPartyRoom(config, accessToken, roomId, roomCode) {
  const url = new URL(buildSupabaseUrl(config.supabaseUrl, '/rest/v1/watch_party_rooms'))
  url.searchParams.set('select', 'id,code,host_user_id,status')
  url.searchParams.set('id', `eq.${roomId}`)
  url.searchParams.set('code', `eq.${roomCode}`)
  url.searchParams.set('limit', '1')

  const response = await fetchJson(url.toString(), {
    accessToken,
    apikey: config.supabaseAnonKey,
  })

  if (!response.ok) {
    throw new Error(
      `Could not verify the Watch Party room (${response.status}). ${
        typeof response.payload === 'string'
          ? response.payload.trim()
          : JSON.stringify(response.payload || {})
      }`
    )
  }

  const room = Array.isArray(response.payload) ? response.payload[0] : null
  if (!room?.id) {
    throw new Error('This Watch Party room could not be found.')
  }

  return room
}

async function fetchWatchPartyParticipant(config, accessToken, roomId, userId) {
  const url = new URL(buildSupabaseUrl(config.supabaseUrl, '/rest/v1/watch_party_participants'))
  url.searchParams.set('select', 'user_id')
  url.searchParams.set('room_id', `eq.${roomId}`)
  url.searchParams.set('user_id', `eq.${userId}`)
  url.searchParams.set('limit', '1')

  const response = await fetchJson(url.toString(), {
    accessToken,
    apikey: config.supabaseAnonKey,
  })

  if (!response.ok) {
    throw new Error(
      `Could not verify Watch Party room membership (${response.status}). ${
        typeof response.payload === 'string'
          ? response.payload.trim()
          : JSON.stringify(response.payload || {})
      }`
    )
  }

  const participant = Array.isArray(response.payload) ? response.payload[0] : null
  if (!participant?.user_id) {
    throw new Error('You are not part of this Watch Party room yet.')
  }

  return participant
}

function resolveDisplayName(requestedName, user) {
  const explicitName = normalizeValue(requestedName)
  if (explicitName) {
    return explicitName
  }

  const metadataUsername = normalizeValue(
    user?.user_metadata?.username
      ?? user?.raw_user_meta_data?.username
  )

  if (metadataUsername) {
    return metadataUsername
  }

  const emailUsername = normalizeValue(user?.email).split('@')[0]
  if (emailUsername) {
    return emailUsername
  }

  const fallbackId = normalizeValue(user?.id) || 'NOVA STREAM'
  return `Member ${fallbackId.slice(0, 6)}`
}

function buildRoomName(roomId) {
  return `watch-party:${roomId}`
}

async function createWatchPartyToken({
  config,
  room,
  user,
  displayName,
  isHost,
}) {
  const accessToken = new AccessToken(
    config.liveKitApiKey,
    config.liveKitApiSecret,
    {
      identity: user.id,
      name: displayName,
      ttl: WATCH_PARTY_TOKEN_TTL,
      metadata: JSON.stringify({
        roomId: room.id,
        roomCode: room.code,
        role: isHost ? 'host' : 'guest',
      }),
    }
  )

  accessToken.addGrant({
    roomJoin: true,
    room: buildRoomName(room.id),
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: isHost
      ? [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
      : [TrackSource.MICROPHONE],
  })

  return accessToken.toJwt()
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res)
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'Method not allowed. Use POST.',
    })
    return
  }

  const configurationError = getConfigurationError()
  if (configurationError) {
    sendJson(res, 500, {
      error: configurationError,
    })
    return
  }

  try {
    const config = getEnvironmentConfig()
    const accessToken = getBearerToken(req)

    if (!accessToken) {
      sendJson(res, 401, {
        error: 'Missing Supabase bearer token.',
      })
      return
    }

    const body = await parseJsonBody(req)
    const roomId = normalizeValue(body?.roomId)
    const roomCode = normalizeValue(body?.roomCode)
    const requestedIdentity = normalizeValue(body?.identity)

    if (!roomId || !roomCode || !requestedIdentity) {
      sendJson(res, 400, {
        error: 'roomId, roomCode, and identity are required.',
      })
      return
    }

    const user = await fetchSupabaseUser(config, accessToken)
    if (normalizeValue(user.id) !== requestedIdentity) {
      sendJson(res, 403, {
        error: 'Your Watch Party session does not match the requested participant identity.',
      })
      return
    }

    const room = await fetchWatchPartyRoom(config, accessToken, roomId, roomCode)
    if (normalizeValue(room.status).toLowerCase() === 'ended') {
      sendJson(res, 409, {
        error: 'This Watch Party room has already ended.',
      })
      return
    }

    await fetchWatchPartyParticipant(config, accessToken, room.id, user.id)

    const isHost = normalizeValue(room.host_user_id) === normalizeValue(user.id)
    const displayName = resolveDisplayName(body?.displayName, user)
    const token = await createWatchPartyToken({
      config,
      room,
      user,
      displayName,
      isHost,
    })

    sendJson(res, 200, {
      token,
      url: config.liveKitUrl,
    })
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Could not get a Watch Party media token.',
    })
  }
}
