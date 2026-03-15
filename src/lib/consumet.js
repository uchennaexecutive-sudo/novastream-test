import { invoke } from '@tauri-apps/api/core'

export const ANIWATCH_BASE_URL = 'https://web-production-f746c.up.railway.app'

const animeIdCache = new Map()
const animeEpisodesCache = new Map()
const animeStreamCache = new Map()

const isTauri =
  typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)

// Replace your anime helpers in src/lib/consumet.js with these versions

const normalizeTracks = (tracks) =>
  (tracks || [])
    .filter((track) => {
      const url = String(track.file || track.url || '').toLowerCase()

      if (!url) return false

      // block fake subtitle tracks
      if (url.endsWith('.gif')) return false
      if (url.includes('hub26link')) return false
      if (url.includes('advert')) return false

      // only allow real subtitle formats
      if (!url.match(/\.(vtt|srt|ass|ssa)(\?|$)/)) return false

      return true
    })
    .map((track) => ({
      ...track,
      lang: track.lang || track.label || track.srclang || 'Unknown',
      kind: 'captions',
      rawFile: track.file || track.url || null,
      file: track.file || track.url || null,
      url: track.url || track.file || null,
    }))


export function buildAnimeSearchCandidates(...titles) {
  const seen = new Set()
  const candidates = []

  const push = (value) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(normalized)
  }

  for (const rawTitle of titles.flat()) {
    const title = String(rawTitle || '').replace(/\s+/g, ' ').trim()
    if (!title) continue
    push(title)
    push(title.replace(/\s*:\s*.+$/, ''))
    push(title.replace(/\s+-\s+.+$/, ''))
    push(title.replace(/\bPart\s+\d+\b/ig, ''))
    push(title.replace(/\bCour\s+\d+\b/ig, ''))
    push(title.replace(/\bSeason\s+\d+\b.*$/i, ''))
    push(title.replace(/\([^)]*\)/g, ''))
  }

  return candidates
}

export async function resolveAnimeSearch(titles, provider = 'animekai') {
  const candidates = buildAnimeSearchCandidates(...[].concat(titles || []))

  for (const candidate of candidates) {
    const anime = await searchAnime(candidate, { provider, fresh: true })
    if (anime?.id) {
      return {
        anime,
        matchedTitle: candidate,
        candidates,
      }
    }
  }

  return {
    anime: null,
    matchedTitle: '',
    candidates,
  }
}

export async function searchAnime(title, { provider = 'animekai', fresh = false } = {}) {
  const cacheKey = `${provider}:${String(title || '').trim().toLowerCase()}`

  if (!fresh && animeIdCache.has(cacheKey)) {
    return { id: animeIdCache.get(cacheKey) }
  }

  const query = encodeURIComponent(title)
  const res = await fetch(`${ANIWATCH_BASE_URL}/anime/${provider}/${query}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`${provider} search failed`)
  }

  const data = await res.json()
  const anime =
    data.results?.[0] ||
    data.data?.animes?.[0] ||
    data.data?.results?.[0] ||
    data.data?.[0] ||
    null

  if (anime?.id) {
    animeIdCache.set(cacheKey, anime.id)
  }

  return anime
}


export async function getAnimeEpisodes(animeId, provider = 'animekai', { fresh = false } = {}) {
  const cacheKey = `${provider}:${String(animeId || '')}`

  if (!fresh && animeEpisodesCache.has(cacheKey)) {
    return animeEpisodesCache.get(cacheKey)
  }

  let url = ''

  if (provider === 'animekai' || provider === 'kickassanime') {
    url = `${ANIWATCH_BASE_URL}/anime/${provider}/info?id=${encodeURIComponent(animeId)}`
  } else {
    url = `${ANIWATCH_BASE_URL}/anime/${provider}/info/${animeId}`
  }

  const res = await fetch(url, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`${provider} info failed`)
  }

  const data = await res.json()
  const rawEpisodes =
    data.episodes ||
    data.data?.episodes ||
    data.data?.results?.episodes ||
    []

  const episodes = rawEpisodes.map((ep, index) => ({
    episodeId: ep.session || ep.id || ep.episodeId,
    number: Number(ep.number ?? ep.episode ?? ep.ep ?? index + 1),
    title: ep.title || `Episode ${Number(ep.number ?? ep.episode ?? ep.ep ?? index + 1)}`,
  }))

  animeEpisodesCache.set(cacheKey, episodes)
  return episodes
}

async function fetchAnimeProviderStream(provider, episodeId) {
  const res = await fetch(
    `${ANIWATCH_BASE_URL}/anime/${provider}/watch/${episodeId}`,
    { cache: 'no-store' }
  )

  if (!res.ok) {
    throw new Error(`${provider} watch failed`)
  }

  const data = await res.json()
  const sources = data?.sources || data?.data?.sources || []
  const tracks =
    data?.subtitles ||
    data?.tracks ||
    data?.data?.subtitles ||
    data?.data?.tracks ||
    []

  const video =
    sources.find((s) => s.url?.includes('.m3u8')) ||
    sources.find((s) => s.type === 'hls') ||
    sources[0]

  if (!video?.url) {
    throw new Error(`${provider} returned no playable stream`)
  }

  return {
    rawUrl: video.url,
    sources,
    tracks: normalizeTracks(tracks),
    headers: {},
    provider,
  }
}

export async function getAnimeStream(episodeId, provider = 'animekai') {
  const cacheKey = `${provider}:${String(episodeId || '')}`

  if (animeStreamCache.has(cacheKey)) {
    return animeStreamCache.get(cacheKey)
  }

  const payload = await fetchAnimeProviderStream(provider, episodeId)
  animeStreamCache.set(cacheKey, payload)
  return payload
}


export async function preloadAnimePlayback(...titles) {
  const { anime, matchedTitle } = await resolveAnimeSearch(...titles)

  if (!anime?.id) return null

  const episodes = await getAnimeEpisodes(anime.id)

  return {
    animeId: anime.id,
    episodes,
    matchedTitle,
  }
}