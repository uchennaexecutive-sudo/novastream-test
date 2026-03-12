export const CONSUMET_INSTANCES = [
  'https://api.consumet.org',
  'https://consumet-api.onrender.com',
  'https://api-consumet-deploy.vercel.app',
]

export const CONSUMET_BASE_URL = CONSUMET_INSTANCES[0]

async function fetchConsumet(path, baseUrl = CONSUMET_BASE_URL) {
  const res = await fetch(`${baseUrl}${path}`)

  if (!res.ok) {
    throw new Error(`Consumet request failed: ${res.status}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Consumet did not return JSON')
  }

  return res.json()
}

// Search for anime by title, returns first result's id
export async function searchAnime(title, baseUrl = CONSUMET_BASE_URL) {
  const data = await fetchConsumet(`/anime/gogoanime/${encodeURIComponent(title)}`, baseUrl)
  return data.results?.[0] || null
}

// Get episode list for an anime id
export async function getAnimeEpisodes(animeId, baseUrl = CONSUMET_BASE_URL) {
  const data = await fetchConsumet(`/anime/gogoanime/info/${animeId}`, baseUrl)
  return data.episodes || []
}

// Get stream URL for a specific episode
export async function getAnimeStream(episodeId, baseUrl = CONSUMET_BASE_URL) {
  const data = await fetchConsumet(`/anime/gogoanime/watch/${encodeURIComponent(episodeId)}`, baseUrl)
  const sources = data.sources || []
  const m3u8 = sources.find(source => source.isM3U8) || sources[0]
  return m3u8?.url || null
}
