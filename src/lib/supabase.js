// Watch progress migration for Supabase:
//
// CREATE TABLE IF NOT EXISTS watch_progress (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   device_id text NOT NULL,
//   content_id text NOT NULL,
//   content_type text NOT NULL,
//   title text,
//   poster text,
//   backdrop text,
//   season integer,
//   episode integer,
//   progress_seconds integer DEFAULT 0,
//   duration_seconds integer DEFAULT 0,
//   updated_at timestamptz DEFAULT now()
// );
// CREATE UNIQUE INDEX IF NOT EXISTS watch_progress_device_content
//   ON watch_progress(device_id, content_id, season, episode);
//
// Watchlist and history remain local storage-backed.

const WATCHLIST_KEY = 'nova-watchlist'
const HISTORY_KEY = 'nova-history'

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

// Watchlist
export const getWatchlist = async () => {
  return readStore(WATCHLIST_KEY)
}

export const addToWatchlist = async (item) => {
  const list = readStore(WATCHLIST_KEY)
  const idx = list.findIndex(i => i.tmdb_id === item.tmdb_id)
  const entry = {
    id: item.tmdb_id,
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path,
    added_at: new Date().toISOString(),
  }
  if (idx >= 0) {
    list[idx] = entry
  } else {
    list.unshift(entry)
  }
  writeStore(WATCHLIST_KEY, list)
}

export const removeFromWatchlist = async (tmdbId) => {
  const list = readStore(WATCHLIST_KEY).filter(i => i.tmdb_id !== tmdbId)
  writeStore(WATCHLIST_KEY, list)
}

export const isInWatchlist = async (tmdbId) => {
  return readStore(WATCHLIST_KEY).some(i => i.tmdb_id === tmdbId)
}

// History
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
  if (idx >= 0) {
    list.splice(idx, 1)
  }
  list.unshift(entry)
  writeStore(HISTORY_KEY, list)
}
