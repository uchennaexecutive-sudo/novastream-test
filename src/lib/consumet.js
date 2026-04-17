import { invoke } from '@tauri-apps/api/core'
import { getEnabledAnimeAddonProviders } from './animeAddons'
import { resolveAnimeProviderStates } from './animeAddons/resolveAnimeStreams'

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

const normalizeAnimeSearchText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bseason\s+\d+\b/gi, ' ')
    .replace(/\bpart\s+\d+\b/gi, ' ')
    .replace(/\bcour\s+\d+\b/gi, ' ')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getProviderAnimeTitle = (anime) =>
  anime?.title ||
  anime?.name ||
  anime?.japaneseTitle ||
  anime?.englishTitle ||
  ''

const scoreAnimeSearchResult = (query, anime) => {
  const normalizedQuery = normalizeAnimeSearchText(query)
  const normalizedTitle = normalizeAnimeSearchText(getProviderAnimeTitle(anime))

  if (!normalizedQuery || !normalizedTitle) return -1

  let score = 0

  if (normalizedTitle === normalizedQuery) score += 200
  else if (normalizedTitle.startsWith(normalizedQuery)) score += 120
  else if (normalizedTitle.includes(normalizedQuery)) score += 80
  else if (normalizedQuery.includes(normalizedTitle)) score += 50

  const episodes = Number(anime?.episodes?.length || anime?.episodeCount || anime?.subOrDubEpisodes || 0)
  score += Math.min(episodes, 300) / 10

  return score
}

const pickBestAnimeResult = (query, results = []) => {
  let best = null
  let bestScore = -1

  for (const anime of results) {
    const score = scoreAnimeSearchResult(query, anime)
    if (score > bestScore) {
      best = anime
      bestScore = score
    }
  }

  return best
}

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
  const candidates = buildAnimeSearchCandidates([].concat(titles || []))

  let bestAnime = null
  let bestTitle = ''
  let bestScore = -1

  for (const candidate of candidates) {
    try {
      const anime = await searchAnime(candidate, { provider, fresh: true })
      if (!anime?.id) continue

      const score = scoreAnimeSearchResult(candidate, anime)
      if (score > bestScore) {
        bestAnime = anime
        bestTitle = candidate
        bestScore = score
      }

      if (score >= 200) break
    } catch {
      //
    }
  }

  return {
    anime: bestAnime,
    matchedTitle: bestTitle,
    candidates,
  }
}
export async function searchAnime(title, { provider = 'animekai', fresh = false } = {}) {
  const normalizedTitle = String(title || '').trim()
  const cacheKey = `${provider}:${normalizedTitle.toLowerCase()}`

  if (!normalizedTitle) return null

  if (!fresh && animeIdCache.has(cacheKey)) {
    return animeIdCache.get(cacheKey)
  }

  const query = encodeURIComponent(normalizedTitle)
  const res = await fetch(`${ANIWATCH_BASE_URL}/anime/${provider}/${query}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`${provider} search failed`)
  }

  const data = await res.json()
  const results =
    data.results ||
    data.data?.animes ||
    data.data?.results ||
    data.data ||
    []

  const list = Array.isArray(results) ? results : []
  const anime = pickBestAnimeResult(normalizedTitle, list)

  if (anime?.id) {
    animeIdCache.set(cacheKey, anime)
  }

  return anime || null
}


export async function getAnimeEpisodes(animeId, provider = 'animekai', { fresh = false } = {}) {
  const cacheKey = `${provider}:${String(animeId || '')}`

  if (!fresh && animeEpisodesCache.has(cacheKey)) {
    return animeEpisodesCache.get(cacheKey)
  }

  let url = ''

  if (provider === 'animekai' || provider === 'kickassanime' || provider === 'animesaturn' || provider === 'animeunity') {
    url = `${ANIWATCH_BASE_URL}/anime/${provider}/info?id=${encodeURIComponent(animeId)}`
  } else {
    url = `${ANIWATCH_BASE_URL}/anime/${provider}/info/${encodeURIComponent(animeId)}`
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

  const normalizedEpisodes = rawEpisodes.map((ep, index) => ({
    episodeId: ep.session || ep.id || ep.episodeId,
    number: Number(ep.number ?? ep.episode ?? ep.ep ?? index + 1),
    title: ep.title || `Episode ${Number(ep.number ?? ep.episode ?? ep.ep ?? index + 1)}`,
  }))

  const episodeNumbers = normalizedEpisodes
    .map((episode) => Number(episode.number || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  const minEpisode = episodeNumbers.length ? Math.min(...episodeNumbers) : 0
  const maxEpisode = episodeNumbers.length ? Math.max(...episodeNumbers) : 0
  const isContiguousOffsetRange =
    episodeNumbers.length > 0 &&
    minEpisode > 1 &&
    maxEpisode - minEpisode + 1 === normalizedEpisodes.length

  const episodes = normalizedEpisodes.map((episode, index) => {
    if (!isContiguousOffsetRange) {
      return episode
    }

    return {
      ...episode,
      number: index + 1,
      title: episode.title || `Episode ${index + 1}`,
      absoluteEpisodeNumber: Number(episode.number || 0),
    }
  })

  animeEpisodesCache.set(cacheKey, episodes)
  return episodes
}

async function fetchAnimeProviderStream(provider, episodeId) {
  const watchUrl =
    provider === 'animepahe'
      ? `${ANIWATCH_BASE_URL}/anime/${provider}/watch?episodeId=${encodeURIComponent(episodeId)}`
      : `${ANIWATCH_BASE_URL}/anime/${provider}/watch/${encodeURIComponent(episodeId)}`

  const res = await fetch(watchUrl, { cache: 'no-store' })

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
  const candidateTitles = titles.flat().filter(Boolean)
  try {
    const enabledProviders = getEnabledAnimeAddonProviders()
    const providerPriority = ['gogoanime', 'animekai', 'animepahe']

    for (const providerId of providerPriority) {
      const scopedProviders = enabledProviders.filter((provider) => provider?.id === providerId)
      if (!scopedProviders.length) continue

      const states = await resolveAnimeProviderStates({
        titles: candidateTitles,
        providers: scopedProviders,
      })
      const preferred = Array.isArray(states)
        ? states.find((state) => Array.isArray(state?.episodes) && state.episodes.length > 0)
        : null

      if (!preferred?.animeId) {
        continue
      }

      return {
        providerId: preferred.providerId || '',
        animeId: preferred.animeId,
        episodes: Array.isArray(preferred.episodes) ? preferred.episodes : [],
        matchedTitle: preferred.matchedTitle || candidateTitles[0] || '',
        anime: preferred.anime || {
          id: preferred.animeId,
          title: preferred.title || candidateTitles[0] || '',
        },
      }
    }

    return null
  } catch {
    return null
  }
}

export function clearAnimePlaybackCache() {
  animeIdCache.clear()
  animeEpisodesCache.clear()
  animeStreamCache.clear()
}
