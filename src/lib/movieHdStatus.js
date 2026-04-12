/**
 * movieHdStatus.js
 *
 * Precise, cached HD-availability check for movie-like content.
 *
 * Strategy:
 *  - Module-level Map deduplicates fetches — each TMDB ID is fetched at most
 *    once per app session regardless of how many cards show that title.
 *  - Returns false (no badge) while the fetch is in-flight, so there are
 *    never false-positive badges during loading.
 *  - Uses parseReleaseDatesNoHd as the single source of truth (same logic as
 *    the Detail page) instead of a date-window heuristic.
 *  - Only ever fires for movie-like content (type 'movie' / 'animation' /
 *    item.media_type === 'movie'). TV and episodic anime are skipped.
 */
import { useState, useEffect } from 'react'
import { getMovieReleaseDates, parseReleaseDatesNoHd } from './tmdb'

// 'loading' | { noHd: boolean }
const hdStatusCache = new Map()
const hdStatusListeners = new Map()
const releaseDateById = new Map()

function notifyListeners(id) {
  const callbacks = hdStatusListeners.get(id)
  if (callbacks) callbacks.forEach((cb) => cb())
}

async function fetchHdStatus(id) {
  // Already cached or in-flight — nothing to do.
  if (hdStatusCache.has(id)) return

  hdStatusCache.set(id, 'loading')

  try {
    const data = await getMovieReleaseDates(id)
    hdStatusCache.set(id, {
      noHd: parseReleaseDatesNoHd(data, releaseDateById.get(id) || ''),
    })
  } catch {
    // On error default to false so we never show a spurious badge.
    hdStatusCache.set(id, { noHd: false })
  }

  notifyListeners(id)
}

function getCachedNoHd(id) {
  const entry = hdStatusCache.get(id)
  if (!entry || entry === 'loading') return false
  return entry.noHd
}

/**
 * Hook — returns true only when TMDB confirms theatrical-only release.
 *
 * @param {object} item   - TMDB item object (must have .id)
 * @param {string} [contentType] - explicit type from the row ('movie', 'tv', etc.)
 */
export function useMovieNoHd(item, contentType) {
  // Resolve the effective content type, falling back to item.media_type.
  const effectiveType = contentType || item?.media_type || ''
  const isMovieLike = effectiveType === 'movie' || effectiveType === 'animation'
  const id = isMovieLike ? (item?.id || null) : null

  const [noHd, setNoHd] = useState(false)

  useEffect(() => {
    if (!id) return
    releaseDateById.set(id, item?.release_date || '')

    // Sync state if already resolved from a previous card's fetch.
    const existing = hdStatusCache.get(id)
    if (existing && existing !== 'loading') {
      setNoHd(existing.noHd)
      return
    }

    // Subscribe for when the fetch completes.
    if (!hdStatusListeners.has(id)) hdStatusListeners.set(id, new Set())
    const callback = () => setNoHd(getCachedNoHd(id))
    hdStatusListeners.get(id).add(callback)

    // Kick off the fetch (no-op if another instance already started it).
    fetchHdStatus(id)

    return () => {
      hdStatusListeners.get(id)?.delete(callback)
    }
  }, [id, item?.release_date])

  return noHd
}
