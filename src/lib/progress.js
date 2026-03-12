import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://owymezptcmwmrlkeuxcg.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eW1lenB0Y213bXJsa2V1eGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NjEsImV4cCI6MjA4ODU4OTY2MX0.4OZvH_afMKK-CCEgSrW4ga7oC2y0Hqh3uz5ZeRVtvPQ'
const DEVICE_ID_STORAGE_KEY = 'nova_device_id'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const hasLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const createDeviceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `nova-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const toNullableInteger = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const normalizeProgressNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

const buildEpisodeKey = (season, episode) => `${season || 0}:${episode || 0}`

const normalizeRow = (row) => {
  if (!row) return null

  return {
    ...row,
    content_id: String(row.content_id),
    season: row.season ?? null,
    episode: row.episode ?? null,
    progress_seconds: normalizeProgressNumber(row.progress_seconds),
    duration_seconds: normalizeProgressNumber(row.duration_seconds),
  }
}

export function getDeviceId() {
  if (!hasLocalStorage()) return 'nova-device'

  let id = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (!id) {
    id = createDeviceId()
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, id)
  }

  return id
}

export function getProgressPercent(item) {
  if (!item?.duration_seconds) return 0
  return Math.max(0, Math.min(item.progress_seconds / item.duration_seconds, 1))
}

export function isResumableProgress(item) {
  const percent = getProgressPercent(item)
  return percent > 0.05 && percent < 0.95
}

function buildPayload(item) {
  const season = toNullableInteger(item.season)
  const episode = toNullableInteger(item.episode)
  const durationSeconds = normalizeProgressNumber(item.durationSeconds)
  const progressSeconds = durationSeconds > 0
    ? Math.min(normalizeProgressNumber(item.progressSeconds), durationSeconds)
    : normalizeProgressNumber(item.progressSeconds)

  return {
    device_id: getDeviceId(),
    content_id: String(item.contentId),
    content_type: item.contentType,
    title: item.title || null,
    poster: item.poster || null,
    backdrop: item.backdrop || null,
    season,
    episode,
    progress_seconds: progressSeconds,
    duration_seconds: durationSeconds,
    updated_at: new Date().toISOString(),
  }
}

async function findExistingProgressRow(deviceId, contentId, season, episode) {
  let query = supabase
    .from('watch_progress')
    .select('id')
    .eq('device_id', deviceId)
    .eq('content_id', contentId)

  query = season === null ? query.is('season', null) : query.eq('season', season)
  query = episode === null ? query.is('episode', null) : query.eq('episode', episode)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function saveProgress(item) {
  if (!item?.contentId || !item?.contentType) return null

  const payload = buildPayload(item)

  try {
    const existing = await findExistingProgressRow(
      payload.device_id,
      payload.content_id,
      payload.season,
      payload.episode
    )

    if (existing?.id) {
      const { data, error } = await supabase
        .from('watch_progress')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .maybeSingle()

      if (error) throw error
      return normalizeRow(data)
    }

    const { data, error } = await supabase
      .from('watch_progress')
      .insert(payload)
      .select()
      .maybeSingle()

    if (error) throw error
    return normalizeRow(data)
  } catch (error) {
    console.error('[progress] save failed', error)
    return null
  }
}

export async function getContinueWatching() {
  try {
    const deviceId = getDeviceId()
    const { data, error } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('device_id', deviceId)
      .gt('progress_seconds', 0)
      .order('updated_at', { ascending: false })
      .limit(20)

    if (error) throw error

    const seen = new Set()

    return (data || [])
      .map(normalizeRow)
      .filter((item) => {
        const key = buildEpisodeKey(item.season, item.episode)
        const dedupeKey = `${item.content_id}:${key}`
        if (seen.has(dedupeKey)) return false
        seen.add(dedupeKey)
        return true
      })
      .filter(isResumableProgress)
  } catch (error) {
    console.error('[progress] continue watching fetch failed', error)
    return []
  }
}

export async function getProgress(contentId, season, episode) {
  if (!contentId) return null

  try {
    const deviceId = getDeviceId()
    const normalizedSeason = toNullableInteger(season)
    const normalizedEpisode = toNullableInteger(episode)

    let query = supabase
      .from('watch_progress')
      .select('*')
      .eq('device_id', deviceId)
      .eq('content_id', String(contentId))

    query = normalizedSeason === null ? query.is('season', null) : query.eq('season', normalizedSeason)
    query = normalizedEpisode === null ? query.is('episode', null) : query.eq('episode', normalizedEpisode)

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return normalizeRow(data)
  } catch (error) {
    console.error('[progress] item fetch failed', error)
    return null
  }
}

export async function getLatestProgress(contentId) {
  if (!contentId) return null

  try {
    const deviceId = getDeviceId()
    const { data, error } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('device_id', deviceId)
      .eq('content_id', String(contentId))
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) throw error
    return normalizeRow(data?.[0] || null)
  } catch (error) {
    console.error('[progress] latest fetch failed', error)
    return null
  }
}

export async function getContentProgressMap(contentId) {
  if (!contentId) return {}

  try {
    const deviceId = getDeviceId()
    const { data, error } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('device_id', deviceId)
      .eq('content_id', String(contentId))

    if (error) throw error

    return (data || []).reduce((accumulator, row) => {
      const normalized = normalizeRow(row)
      accumulator[buildEpisodeKey(normalized.season, normalized.episode)] = {
        ...normalized,
        percent: getProgressPercent(normalized),
      }
      return accumulator
    }, {})
  } catch (error) {
    console.error('[progress] progress map fetch failed', error)
    return {}
  }
}

export function getEpisodeProgressKey(season, episode) {
  return buildEpisodeKey(season, episode)
}
