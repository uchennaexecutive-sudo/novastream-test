import { supabase } from './supabaseClient'
import { emitUserDataChanged } from './userDataEvents'

const WATCHLIST_KEY = 'nova-watchlist'
const HISTORY_KEY = 'nova-history'
const WATCH_PROGRESS_KEY = 'nova_watch_progress'
const HISTORY_MINIMUM_PROGRESS_SECONDS = 15

function readStore(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStore(key, data) {
  localStorage.setItem(key, JSON.stringify(Array.isArray(data) ? data : []))
}

function normalizeMediaType(value) {
  const normalized = String(value || 'movie').trim().toLowerCase()
  if (normalized === 'series') return 'tv'
  return normalized || 'movie'
}

function normalizePosterPath(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  return /^https?:\/\//i.test(normalized) ? null : normalized
}

function sortByDateDesc(items, field) {
  return [...items].sort((left, right) => (
    new Date(right?.[field] || 0).getTime()
    - new Date(left?.[field] || 0).getTime()
  ))
}

function mergeCloudFirst(localItems, cloudItems, getKey, sortField) {
  const normalizedCloud = Array.isArray(cloudItems) ? cloudItems.filter(Boolean) : []
  const normalizedLocal = Array.isArray(localItems) ? localItems.filter(Boolean) : []
  const cloudKeys = new Set(normalizedCloud.map(getKey))
  const localOnly = normalizedLocal.filter((item) => !cloudKeys.has(getKey(item)))

  return sortByDateDesc([
    ...normalizedCloud,
    ...localOnly,
  ], sortField)
}

function getWatchlistKey(item) {
  return String(item?.tmdb_id || item?.id || '')
}

function getHistoryKey(item) {
  return String(item?.tmdb_id || item?.id || '')
}

function getProgressKey(item) {
  return [
    String(item?.content_id || ''),
    Number(item?.season) || 0,
    Number(item?.episode) || 0,
  ].join('::')
}

function normalizeWatchlistEntry(item = {}) {
  return {
    id: item.tmdb_id,
    tmdb_id: item.tmdb_id,
    media_type: normalizeMediaType(item.media_type),
    title: item.title || '',
    poster_path: item.poster_path || null,
    added_at: item.added_at || new Date().toISOString(),
  }
}

function normalizeHistoryEntry(item = {}) {
  return {
    id: item.tmdb_id,
    tmdb_id: item.tmdb_id,
    media_type: normalizeMediaType(item.media_type),
    title: item.title || '',
    poster_path: normalizePosterPath(item.poster_path),
    season: Number(item.season) || null,
    episode: Number(item.episode) || null,
    progress_seconds: Math.max(0, Math.floor(Number(item.progress_seconds) || 0)),
    watched_at: item.watched_at || new Date().toISOString(),
  }
}

function normalizeProgressRow(row = {}) {
  return {
    ...row,
    content_id: String(row.content_id || ''),
    season: Number(row.season) || null,
    episode: Number(row.episode) || null,
    progress_seconds: Math.max(0, Math.floor(Number(row.progress_seconds) || 0)),
    duration_seconds: Math.max(0, Math.floor(Number(row.duration_seconds) || 0)),
    updated_at: row.updated_at || new Date().toISOString(),
  }
}

async function getUserId() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  } catch {
    return null
  }
}

async function fetchTableRows(table, userId, orderColumn) {
  const query = supabase
    .from(table)
    .select('*')
    .eq('user_id', userId)

  const { data, error } = await query.order(orderColumn, { ascending: false })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

async function upsertRows(table, rows, conflictTarget) {
  if (!Array.isArray(rows) || rows.length === 0) return

  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictTarget })

  if (error) {
    throw error
  }
}

async function mergeWatchlistState(userId) {
  const localWatchlist = readStore(WATCHLIST_KEY).map(normalizeWatchlistEntry)
  const cloudWatchlist = (await fetchTableRows('watchlist', userId, 'added_at'))
    .map(normalizeWatchlistEntry)
  const mergedWatchlist = mergeCloudFirst(
    localWatchlist,
    cloudWatchlist,
    getWatchlistKey,
    'added_at'
  )

  return {
    localWatchlist,
    cloudWatchlist,
    mergedWatchlist,
    localOnlyWatchlist: localWatchlist.filter((item) => (
      !cloudWatchlist.some((cloudItem) => getWatchlistKey(cloudItem) === getWatchlistKey(item))
    )),
  }
}

async function mergeHistoryState(userId) {
  const localHistory = readStore(HISTORY_KEY).map(normalizeHistoryEntry)
  const cloudHistory = (await fetchTableRows('watch_history', userId, 'watched_at'))
    .map(normalizeHistoryEntry)
  const mergedHistory = mergeCloudFirst(
    localHistory,
    cloudHistory,
    getHistoryKey,
    'watched_at'
  )

  return {
    localHistory,
    cloudHistory,
    mergedHistory,
    localOnlyHistory: localHistory.filter((item) => (
      !cloudHistory.some((cloudItem) => getHistoryKey(cloudItem) === getHistoryKey(item))
    )),
  }
}

async function mergeProgressState(userId) {
  const localProgress = readStore(WATCH_PROGRESS_KEY).map(normalizeProgressRow)
  const cloudProgress = (await fetchTableRows('watch_progress', userId, 'updated_at'))
    .map(normalizeProgressRow)
  const mergedProgress = mergeCloudFirst(
    localProgress,
    cloudProgress,
    getProgressKey,
    'updated_at'
  )

  return {
    localProgress,
    cloudProgress,
    mergedProgress,
    localOnlyProgress: localProgress.filter((item) => (
      !cloudProgress.some((cloudItem) => getProgressKey(cloudItem) === getProgressKey(item))
    )),
  }
}

export const getWatchlist = async () => {
  const localWatchlist = readStore(WATCHLIST_KEY).map(normalizeWatchlistEntry)
  const userId = await getUserId()

  if (!userId) {
    return sortByDateDesc(localWatchlist, 'added_at')
  }

  try {
    const { mergedWatchlist } = await mergeWatchlistState(userId)
    writeStore(WATCHLIST_KEY, mergedWatchlist)
    return mergedWatchlist
  } catch (error) {
    console.warn('[watchlist] merged read failed, using local data:', error?.message || error)
    return sortByDateDesc(localWatchlist, 'added_at')
  }
}

export const addToWatchlist = async (item) => {
  const entry = normalizeWatchlistEntry({
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path,
    added_at: item.added_at || new Date().toISOString(),
  })

  const list = readStore(WATCHLIST_KEY).map(normalizeWatchlistEntry)
  const index = list.findIndex((existing) => existing.tmdb_id === entry.tmdb_id)
  if (index >= 0) list[index] = entry
  else list.unshift(entry)
  writeStore(WATCHLIST_KEY, sortByDateDesc(list, 'added_at'))
  emitUserDataChanged({ scopes: ['watchlist'], reason: 'watchlist-add' })

  const userId = await getUserId()
  if (!userId) return entry

  supabase
    .from('watchlist')
    .upsert({
      user_id: userId,
      tmdb_id: entry.tmdb_id,
      media_type: entry.media_type,
      title: entry.title,
      poster_path: entry.poster_path,
      added_at: entry.added_at,
    }, {
      onConflict: 'user_id,tmdb_id',
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[watchlist] sync write failed:', error.message)
      }
    })

  return entry
}

export const removeFromWatchlist = async (tmdbId) => {
  const normalizedId = Number(tmdbId)
  const nextList = readStore(WATCHLIST_KEY)
    .map(normalizeWatchlistEntry)
    .filter((item) => item.tmdb_id !== normalizedId)

  writeStore(WATCHLIST_KEY, nextList)
  emitUserDataChanged({ scopes: ['watchlist'], reason: 'watchlist-remove' })

  const userId = await getUserId()
  if (!userId) return

  supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('tmdb_id', normalizedId)
    .then(({ error }) => {
      if (error) {
        console.warn('[watchlist] sync delete failed:', error.message)
      }
    })
}

export const isInWatchlist = async (tmdbId) => {
  const normalizedId = Number(tmdbId)
  const items = await getWatchlist()
  return items.some((item) => item.tmdb_id === normalizedId)
}

export const getHistory = async () => {
  const localHistory = readStore(HISTORY_KEY).map(normalizeHistoryEntry)
  const userId = await getUserId()

  if (!userId) {
    return sortByDateDesc(localHistory, 'watched_at')
  }

  try {
    const { mergedHistory } = await mergeHistoryState(userId)
    writeStore(HISTORY_KEY, mergedHistory)
    return mergedHistory
  } catch (error) {
    console.warn('[history] merged read failed, using local data:', error?.message || error)
    return sortByDateDesc(localHistory, 'watched_at')
  }
}

export const addToHistory = async (item) => {
  const entry = normalizeHistoryEntry({
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: normalizePosterPath(item.poster_path),
    season: item.season,
    episode: item.episode,
    progress_seconds: item.progress_seconds ?? item.progressSeconds ?? 0,
    watched_at: item.watched_at || new Date().toISOString(),
  })

  if (!entry.tmdb_id) return null

  const list = readStore(HISTORY_KEY).map(normalizeHistoryEntry)
  const index = list.findIndex((existing) => existing.tmdb_id === entry.tmdb_id)
  if (index >= 0) {
    list.splice(index, 1)
  }
  list.unshift(entry)
  writeStore(HISTORY_KEY, sortByDateDesc(list, 'watched_at'))
  emitUserDataChanged({ scopes: ['history'], reason: 'history-write' })

  const userId = await getUserId()
  if (!userId) return entry

  supabase
    .from('watch_history')
    .upsert({
      user_id: userId,
      tmdb_id: entry.tmdb_id,
      media_type: entry.media_type,
      title: entry.title,
      poster_path: entry.poster_path,
      season: entry.season,
      episode: entry.episode,
      progress_seconds: entry.progress_seconds,
      watched_at: entry.watched_at,
    }, {
      onConflict: 'user_id,tmdb_id',
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[history] sync write failed:', error.message)
      }
    })

  return entry
}

export const removeFromHistory = async (tmdbId) => {
  const normalizedId = Number(tmdbId)
  const nextList = readStore(HISTORY_KEY)
    .map(normalizeHistoryEntry)
    .filter((item) => item.tmdb_id !== normalizedId)

  writeStore(HISTORY_KEY, nextList)

  const userId = await getUserId()
  if (userId) {
    try {
      await supabase
        .from('watch_history')
        .delete()
        .eq('user_id', userId)
        .eq('tmdb_id', normalizedId)
    } catch (error) {
      console.warn('[history] sync delete failed:', error?.message || error)
    }
  }

  emitUserDataChanged({ scopes: ['history'], reason: 'history-remove' })
}

export const syncPlaybackHistory = async ({
  tmdbId,
  mediaType,
  title,
  posterPath,
  season = null,
  episode = null,
  progressSeconds = 0,
} = {}) => {
  const normalizedProgress = Math.max(0, Math.floor(Number(progressSeconds) || 0))
  if (!tmdbId || normalizedProgress < HISTORY_MINIMUM_PROGRESS_SECONDS) {
    return null
  }

  return addToHistory({
    tmdb_id: Number(tmdbId),
    media_type: normalizeMediaType(mediaType),
    title,
    poster_path: normalizePosterPath(posterPath),
    season,
    episode,
    progress_seconds: normalizedProgress,
    watched_at: new Date().toISOString(),
  })
}

export const syncFromCloud = async () => {
  const userId = await getUserId()
  if (!userId) return null

  const updatedScopes = []

  try {
    const {
      mergedWatchlist,
      localOnlyWatchlist,
    } = await mergeWatchlistState(userId)
    writeStore(WATCHLIST_KEY, mergedWatchlist)
    if (localOnlyWatchlist.length > 0) {
      await upsertRows(
        'watchlist',
        localOnlyWatchlist.map((item) => ({
          user_id: userId,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title,
          poster_path: item.poster_path,
          added_at: item.added_at,
        })),
        'user_id,tmdb_id'
      )
    }
    updatedScopes.push('watchlist')
  } catch (error) {
    console.warn('[sync] watchlist sync failed, using local data:', error?.message || error)
  }

  try {
    const {
      mergedHistory,
      localOnlyHistory,
    } = await mergeHistoryState(userId)
    writeStore(HISTORY_KEY, mergedHistory)
    if (localOnlyHistory.length > 0) {
      await upsertRows(
        'watch_history',
        localOnlyHistory.map((item) => ({
          user_id: userId,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title,
          poster_path: item.poster_path,
          season: item.season,
          episode: item.episode,
          progress_seconds: item.progress_seconds,
          watched_at: item.watched_at,
        })),
        'user_id,tmdb_id'
      )
    }
    updatedScopes.push('history')
  } catch (error) {
    console.warn('[sync] history sync failed, using local data:', error?.message || error)
  }

  try {
    const {
      mergedProgress,
      localOnlyProgress,
    } = await mergeProgressState(userId)
    writeStore(WATCH_PROGRESS_KEY, mergedProgress)
    if (localOnlyProgress.length > 0) {
      await upsertRows(
        'watch_progress',
        localOnlyProgress.map((item) => ({
          ...item,
          user_id: userId,
        })),
        'user_id,content_id,season,episode'
      )
    }
    updatedScopes.push('progress')
  } catch (error) {
    console.warn('[sync] progress sync failed, using local data:', error?.message || error)
  }

  if (updatedScopes.length > 0) {
    emitUserDataChanged({ scopes: updatedScopes, reason: 'cloud-sync' })
  }

  console.log('[sync] Cloud data loaded.')
  return { scopes: updatedScopes }
}

export const syncProfileSetting = async (updates) => {
  const userId = await getUserId()
  if (!userId) return

  supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .then(({ error }) => {
      if (error) {
        console.warn('[profile] setting sync failed:', error.message)
      }
    })
}
