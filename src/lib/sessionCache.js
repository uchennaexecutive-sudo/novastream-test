// In-memory session cache — automatically cleared when the app restarts.
// Use for scroll positions and API response data to avoid re-fetching on navigation.

const scrollCache = new Map()
const dataCache = new Map()

// Scroll position cache
export const saveScroll = (path, pos) => scrollCache.set(path, pos)
export const getScroll = (path) => scrollCache.get(path)
export const hasScroll = (path) => scrollCache.has(path)

// API data cache
export const saveData = (key, data) => dataCache.set(key, data)
export const getData = (key) => dataCache.get(key)
export const hasData = (key) => dataCache.has(key)
