import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://owymezptcmwmrlkeuxcg.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eW1lenB0Y213bXJsa2V1eGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NjEsImV4cCI6MjA4ODU4OTY2MX0.4OZvH_afMKK-CCEgSrW4ga7oC2y0Hqh3uz5ZeRVtvPQ'
const DEVICE_ID_STORAGE_KEY = 'nova_device_id'
const LOCAL_PROGRESS_STORAGE_KEY = 'nova_watch_progress'

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
const buildProgressKey = (contentId, season, episode) => `${String(contentId)}::${buildEpisodeKey(season, episode)}`

const getUpdatedAtValue = (row) => {
  const parsed = Date.parse(row?.updated_at || '')
  return Number.isFinite(parsed) ? parsed : 0
}

const sortByUpdatedAtDesc = (items) => [...items].sort((a, b) => getUpdatedAtValue(b) - getUpdatedAtValue(a))

const normalizeRow = (row) => {
  if (!row) return null

  return {
    ...row,
    content_id: String(row.content_id),
    season: row.season ?? null,
    episode: row.episode ?? null,
    progress_seconds: normalizeProgressNumber(row.progress_seconds),
    duration_seconds: normalizeProgressNumber(row.duration_seconds),
    updated_at: row.updated_at || new Date().toISOString(),
  }
}

const readLocalRows = () => {
  if (!hasLocalStorage()) return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_PROGRESS_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(normalizeRow).filter(Boolean) : []
  } catch {
    return []
  }
}

const writeLocalRows = (rows) => {
  if (!hasLocalStorage()) return
  window.localStorage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(rows))
}

const mergeRows = (...collections) => {
  const map = new Map()

  collections.flat().filter(Boolean).forEach((row) => {
    const normalized = normalizeRow(row)
    const key = buildProgressKey(normalized.content_id, normalized.season, normalized.episode)
    const existing = map.get(key)

    if (!existing || getUpdatedAtValue(normalized) >= getUpdatedAtValue(existing)) {
      map.set(key, normalized)
    }
  })

  return sortByUpdatedAtDesc(Array.from(map.values()))
}

const upsertLocalRow = (row) => {
  const rows = readLocalRows()
  const key = buildProgressKey(row.content_id, row.season, row.episode)
  const nextRows = mergeRows([{ ...row, updated_at: row.updated_at || new Date().toISOString() }], rows)
    .filter(item => item.device_id === getDeviceId())

  writeLocalRows(nextRows)
  return nextRows.find(item => buildProgressKey(item.content_id, item.season, item.episode) === key) || normalizeRow(row)
}

const filterExactRow = (rows, contentId, season, episode) => rows.find((row) => (
  row.content_id === String(contentId)
  && row.season === season
  && row.episode === episode
)) || null

async function fetchRemoteRows({ contentId = null, season = undefined, episode = undefined } = {}) {
  try {
    let query = supabase
      .from('watch_progress')
      .select('*')
      .eq('device_id', getDeviceId())

    if (contentId !== null) {
      query = query.eq('content_id', String(contentId))
    }

    if (season !== undefined) {
      query = season === null ? query.is('season', null) : query.eq('season', season)
    }

    if (episode !== undefined) {
      query = episode === null ? query.is('episode', null) : query.eq('episode', episode)
    }

    const { data, error } = await query
    if (error) throw error

    return (data || []).map(normalizeRow).filter(Boolean)
  } catch (error) {
    console.error('[progress] remote fetch failed', error)
    return []
  }
}

async function findExistingRemoteRow(deviceId, contentId, season, episode) {
  const rows = await fetchRemoteRows({ contentId, season, episode })
  return rows.find(row => row.device_id === deviceId) || null
}

async function getMergedRowsForContent(contentId) {
  const [remoteRows, localRows] = await Promise.all([
    fetchRemoteRows({ contentId }),
    Promise.resolve(readLocalRows().filter(row => row.content_id === String(contentId))),
  ])

  return mergeRows(remoteRows, localRows)
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
  if (!item?.progress_seconds) return false

  if (item.duration_seconds > 0) {
    const percent = getProgressPercent(item)
    return percent > 0 && percent < 0.98
  }

  return item.progress_seconds > 15
}

function buildPayload(item) {
  const season = toNullableInteger(item.season)
  const episode = toNullableInteger(item.episode)
  const durationSeconds = normalizeProgressNumber(item.durationSeconds || item.durationHintSeconds)
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

export async function saveProgress(item) {
  if (!item?.contentId || !item?.contentType) return null

  const payload = buildPayload(item)
  const localRow = upsertLocalRow(payload)

  try {
    const existing = await findExistingRemoteRow(
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
      return normalizeRow(data) || localRow
    }

    const { data, error } = await supabase
      .from('watch_progress')
      .insert(payload)
      .select()
      .maybeSingle()

    if (error) throw error
    return normalizeRow(data) || localRow
  } catch (error) {
    console.error('[progress] save failed', error)
    return localRow
  }
}

export async function getContinueWatching() {
  const [remoteRows, localRows] = await Promise.all([
    fetchRemoteRows(),
    Promise.resolve(readLocalRows()),
  ])

  const seen = new Set()

  return mergeRows(remoteRows, localRows)
    .filter(item => item.progress_seconds > 0)
    .filter(isResumableProgress)
    .filter((item) => {
      const key = buildProgressKey(item.content_id, item.season, item.episode)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

export async function getProgress(contentId, season, episode) {
  if (!contentId) return null

  const normalizedSeason = toNullableInteger(season)
  const normalizedEpisode = toNullableInteger(episode)
  const rows = await getMergedRowsForContent(contentId)

  return filterExactRow(rows, contentId, normalizedSeason, normalizedEpisode)
}

export async function getLatestProgress(contentId) {
  if (!contentId) return null

  const rows = await getMergedRowsForContent(contentId)
  return rows[0] || null
}

export async function getContentProgressMap(contentId) {
  if (!contentId) return {}

  const rows = await getMergedRowsForContent(contentId)

  return rows.reduce((accumulator, row) => {
    accumulator[buildEpisodeKey(row.season, row.episode)] = {
      ...row,
      percent: getProgressPercent(row),
    }
    return accumulator
  }, {})
}

export async function getAllProgressRows() {
  const [remoteRows, localRows] = await Promise.all([
    fetchRemoteRows(),
    Promise.resolve(readLocalRows()),
  ])

  return mergeRows(remoteRows, localRows)
}

export function getEpisodeProgressKey(season, episode) {
  return buildEpisodeKey(season, episode)
}
