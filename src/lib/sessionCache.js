// In-memory session cache — automatically cleared when the app restarts.
// Use for scroll positions and API response data to avoid re-fetching on navigation.

const scrollCache = new Map()
const dataCache = new Map()
const MAX_SCROLL_ENTRIES = 40
const MAX_DATA_ENTRIES = 24

function setBounded(cache, key, value, maxEntries) {
  if (cache.has(key)) {
    cache.delete(key)
  }

  cache.set(key, value)

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (typeof oldestKey === 'undefined') break
    cache.delete(oldestKey)
  }
}

// Scroll position cache
export const saveScroll = (path, pos) => setBounded(scrollCache, path, pos, MAX_SCROLL_ENTRIES)
export const getScroll = (path) => scrollCache.get(path)
export const hasScroll = (path) => scrollCache.has(path)

// API data cache
export const saveData = (key, data) => setBounded(dataCache, key, data, MAX_DATA_ENTRIES)
export const getData = (key) => dataCache.get(key)
export const hasData = (key) => dataCache.has(key)
