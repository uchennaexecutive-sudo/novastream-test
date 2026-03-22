import { supabase } from './supabaseClient'

const WATCHLIST_KEY = 'nova-watchlist'
const HISTORY_KEY = 'nova-history'

// --- Local store helpers ---
function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

function writeStore(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

// Returns the signed-in user ID without needing React hooks
async function getUserId() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  } catch {
    return null
  }
}

// --- Watchlist ---

export const getWatchlist = async () => {
  return readStore(WATCHLIST_KEY)
}

export const addToWatchlist = async (item) => {
  const list = readStore(WATCHLIST_KEY)
  const entry = {
    id: item.tmdb_id,
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path,
    added_at: new Date().toISOString(),
  }
  const idx = list.findIndex(i => i.tmdb_id === item.tmdb_id)
  if (idx >= 0) list[idx] = entry
  else list.unshift(entry)
  writeStore(WATCHLIST_KEY, list)

  // Write-through to Supabase
  const userId = await getUserId()
  if (userId) {
    supabase.from('watchlist').upsert(
      { user_id: userId, tmdb_id: entry.tmdb_id, media_type: entry.media_type, title: entry.title, poster_path: entry.poster_path, added_at: entry.added_at },
      { onConflict: 'user_id,tmdb_id' }
    ).then(({ error }) => { if (error) console.warn('[watchlist] sync write failed:', error.message) })
  }
}

export const removeFromWatchlist = async (tmdbId) => {
  const list = readStore(WATCHLIST_KEY).filter(i => i.tmdb_id !== tmdbId)
  writeStore(WATCHLIST_KEY, list)

  // Remove from Supabase
  const userId = await getUserId()
  if (userId) {
    supabase.from('watchlist').delete().eq('user_id', userId).eq('tmdb_id', tmdbId)
      .then(({ error }) => { if (error) console.warn('[watchlist] sync delete failed:', error.message) })
  }
}

export const isInWatchlist = async (tmdbId) => {
  return readStore(WATCHLIST_KEY).some(i => i.tmdb_id === tmdbId)
}

// --- History ---

export const getHistory = async () => {
  return readStore(HISTORY_KEY)
}

export const addToHistory = async (item) => {
  const list = readStore(HISTORY_KEY)
  const idx = list.findIndex(i => i.tmdb_id === item.tmdb_id)
  const entry = {
    id: item.tmdb_id,
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path,
    season: item.season || null,
    episode: item.episode || null,
    progress_seconds: item.progress_seconds || 0,
    watched_at: new Date().toISOString(),
  }
  if (idx >= 0) list.splice(idx, 1)
  list.unshift(entry)
  writeStore(HISTORY_KEY, list)

  // Write-through to Supabase
  const userId = await getUserId()
  if (userId) {
    supabase.from('watch_history').upsert(
      { user_id: userId, tmdb_id: entry.tmdb_id, media_type: entry.media_type, title: entry.title, poster_path: entry.poster_path, season: entry.season, episode: entry.episode, progress_seconds: entry.progress_seconds, watched_at: entry.watched_at },
      { onConflict: 'user_id,tmdb_id' }
    ).then(({ error }) => { if (error) console.warn('[history] sync write failed:', error.message) })
  }
}

// --- Cloud sync ---
// Called after sign-in or on app start with an active session.
// Pulls cloud data down and merges it with local storage (cloud wins on conflicts).
export const syncFromCloud = async () => {
  const userId = await getUserId()
  if (!userId) return

  try {
    // Sync watchlist
    const { data: cloudWatchlist, error: wErr } = await supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false })

    if (!wErr && cloudWatchlist?.length) {
      const local = readStore(WATCHLIST_KEY)
      const cloudIds = new Set(cloudWatchlist.map(i => i.tmdb_id))
      const localOnly = local.filter(i => !cloudIds.has(i.tmdb_id))
      const merged = [
        ...cloudWatchlist.map(i => ({ ...i, id: i.tmdb_id })),
        ...localOnly,
      ].sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
      writeStore(WATCHLIST_KEY, merged)
    }

    // Sync history
    const { data: cloudHistory, error: hErr } = await supabase
      .from('watch_history')
      .select('*')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false })

    if (!hErr && cloudHistory?.length) {
      const local = readStore(HISTORY_KEY)
      const cloudIds = new Set(cloudHistory.map(i => i.tmdb_id))
      const localOnly = local.filter(i => !cloudIds.has(i.tmdb_id))
      const merged = [
        ...cloudHistory.map(i => ({ ...i, id: i.tmdb_id })),
        ...localOnly,
      ].sort((a, b) => new Date(b.watched_at) - new Date(a.watched_at))
      writeStore(HISTORY_KEY, merged)
    }

    // Sync watch progress
    const { data: cloudProgress, error: pErr } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (!pErr && cloudProgress?.length) {
      try {
        const local = JSON.parse(localStorage.getItem('nova_watch_progress') || '[]')
        const cloudMap = new Map(cloudProgress.map(r => [`${r.content_id}::${r.season ?? 0}::${r.episode ?? 0}`, r]))
        const localOnly = local.filter(r => !cloudMap.has(`${r.content_id}::${r.season ?? 0}::${r.episode ?? 0}`))
        const merged = [...cloudProgress, ...localOnly].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        localStorage.setItem('nova_watch_progress', JSON.stringify(merged))
      } catch {
        // non-fatal
      }
    }

    console.log('[sync] Cloud data loaded.')
  } catch (err) {
    console.warn('[sync] Cloud sync failed, using local data:', err.message)
  }
}

// Sync a single profile field to Supabase (fire-and-forget)
export const syncProfileSetting = async (updates) => {
  const userId = await getUserId()
  if (!userId) return
  supabase.from('profiles').update(updates).eq('id', userId)
    .then(({ error }) => { if (error) console.warn('[profile] setting sync failed:', error.message) })
}
