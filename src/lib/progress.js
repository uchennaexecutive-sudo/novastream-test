import { supabase } from './supabaseClient'
import { emitUserDataChanged } from './userDataEvents'

const DEVICE_ID_STORAGE_KEY = 'nova_device_id'
const LOCAL_PROGRESS_STORAGE_KEY = 'nova_watch_progress'
const HIDDEN_CONTINUE_STORAGE_KEY = 'nova_hidden_continue'

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
const buildContinueWatchingKey = (item) => {
  const contentType = item?.content_type || item?.media_type || 'movie'
  const contentId = String(item?.content_id || item?.tmdb_id || item?.id || '')
  const isEpisodic = contentType === 'tv' || contentType === 'anime' || (Number(item?.season) > 0 && Number(item?.episode) > 0)

  return isEpisodic
    ? `${contentType}::${contentId}`
    : `${contentType}::${contentId}::${buildEpisodeKey(item?.season, item?.episode)}`
}

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

const readHiddenContinueKeys = () => {
  if (!hasLocalStorage()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_CONTINUE_STORAGE_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.map(value => String(value || '').trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

const writeHiddenContinueKeys = (keys) => {
  if (!hasLocalStorage()) return
  const uniqueKeys = [...new Set((Array.isArray(keys) ? keys : []).map(value => String(value || '').trim()).filter(Boolean))]
  window.localStorage.setItem(HIDDEN_CONTINUE_STORAGE_KEY, JSON.stringify(uniqueKeys))
}

const clearHiddenContinueKey = (item) => {
  const hiddenKey = buildContinueWatchingKey(item)
  const currentKeys = readHiddenContinueKeys()
  if (!currentKeys.includes(hiddenKey)) return false
  writeHiddenContinueKeys(currentKeys.filter(key => key !== hiddenKey))
  return true
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
  writeLocalRows(nextRows)
  return nextRows.find(item => buildProgressKey(item.content_id, item.season, item.episode) === key) || normalizeRow(row)
}

const filterExactRow = (rows, contentId, season, episode) => rows.find((row) => (
  row.content_id === String(contentId)
  && row.season === season
  && row.episode === episode
)) || null

// Get signed-in user ID (no React hooks required)
async function getUserId() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  } catch {
    return null
  }
}

async function fetchRemoteRows({ contentId = null, season = undefined, episode = undefined } = {}) {
  const userId = await getUserId()
  if (!userId) return [] // guests: localStorage only

  try {
    let query = supabase
      .from('watch_progress')
      .select('*')
      .eq('user_id', userId)

    if (contentId !== null) query = query.eq('content_id', String(contentId))
    if (season !== undefined) query = season === null ? query.is('season', null) : query.eq('season', season)
    if (episode !== undefined) query = episode === null ? query.is('episode', null) : query.eq('episode', episode)

    const { data, error } = await query
    if (error) throw error
    return (data || []).map(normalizeRow).filter(Boolean)
  } catch (error) {
    console.error('[progress] remote fetch failed', error)
    const message = String(error?.message || error || '')
    if (/watch_progress|user_id|device_id|season|episode|constraint/i.test(message)) {
      console.warn('[progress] schema compatibility issue is likely affecting remote progress reads')
    }
    return []
  }
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

function buildPayload(item, userId) {
  const season = toNullableInteger(item.season)
  const episode = toNullableInteger(item.episode)
  const durationSeconds = normalizeProgressNumber(item.durationSeconds || item.durationHintSeconds)
  const progressSeconds = durationSeconds > 0
    ? Math.min(normalizeProgressNumber(item.progressSeconds), durationSeconds)
    : normalizeProgressNumber(item.progressSeconds)

  return {
    user_id: userId || null,
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

  const userId = await getUserId()
  const payload = buildPayload(item, userId)
  const localRow = upsertLocalRow(payload)
  clearHiddenContinueKey(payload)
  emitUserDataChanged({ scopes: ['progress'], reason: 'progress-save' })

  // Only sync to cloud when signed in
  if (!userId) return localRow

  try {
    const { error } = await supabase
      .from('watch_progress')
      .upsert(payload, { onConflict: 'user_id,content_id,season,episode' })
    if (error) throw error
  } catch (error) {
    console.error('[progress] cloud save failed', error)
    const message = String(error?.message || error || '')
    if (/watch_progress|user_id|device_id|season|episode|constraint/i.test(message)) {
      console.warn('[progress] schema compatibility issue is likely affecting cloud progress saves')
    }
  }

  return localRow
}

export async function getContinueWatching() {
  const [remoteRows, localRows] = await Promise.all([
    fetchRemoteRows(),
    Promise.resolve(readLocalRows()),
  ])
  const hiddenKeys = new Set(readHiddenContinueKeys())

  const seen = new Set()
  return mergeRows(remoteRows, localRows)
    .filter(item => item.progress_seconds > 0)
    .filter(isResumableProgress)
    .filter(item => !hiddenKeys.has(buildContinueWatchingKey(item)))
    .filter((item) => {
      const key = buildContinueWatchingKey(item)
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

export async function deleteProgressEntry(contentId, season, episode) {
  const normalizedContentId = String(contentId || '')
  const normalizedSeason = toNullableInteger(season)
  const normalizedEpisode = toNullableInteger(episode)

  const rows = readLocalRows().filter((row) => !(
    row.content_id === normalizedContentId
    && row.season === normalizedSeason
    && row.episode === normalizedEpisode
  ))
  writeLocalRows(rows)

  const userId = await getUserId()
  if (!userId) {
    emitUserDataChanged({ scopes: ['progress'], reason: 'progress-remove' })
    return
  }

  try {
    let query = supabase
      .from('watch_progress')
      .delete()
      .eq('user_id', userId)
      .eq('content_id', normalizedContentId)

    query = normalizedSeason === null ? query.is('season', null) : query.eq('season', normalizedSeason)
    query = normalizedEpisode === null ? query.is('episode', null) : query.eq('episode', normalizedEpisode)

    const { error } = await query
    if (error) throw error
  } catch (error) {
    console.error('[progress] delete failed', error)
  }

  emitUserDataChanged({ scopes: ['progress'], reason: 'progress-remove' })
}

export async function dismissContinueWatchingItem(item) {
  const hiddenKey = buildContinueWatchingKey(item)
  const currentKeys = readHiddenContinueKeys()

  if (!currentKeys.includes(hiddenKey)) {
    writeHiddenContinueKeys([...currentKeys, hiddenKey])
  }

  emitUserDataChanged({ scopes: ['progress'], reason: 'continue-dismiss' })
  return hiddenKey
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
