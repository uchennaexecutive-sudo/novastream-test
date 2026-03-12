export const ANIWATCH_BASE_URL = 'https://aniwatch-api-orcin-six.vercel.app'

// Search anime by title
export async function searchAnime(title) {
  const res = await fetch(`${ANIWATCH_BASE_URL}/api/v2/hianime/search?q=${encodeURIComponent(title)}&page=1`)
  const data = await res.json()
  return data.data?.animes?.[0] || null
}

// Get episode list for an anime
export async function getAnimeEpisodes(animeId) {
  const res = await fetch(`${ANIWATCH_BASE_URL}/api/v2/hianime/anime/${animeId}/episodes`)
  const data = await res.json()
  return data.data?.episodes || []
}

// Get stream payload for a specific episode
export async function getAnimeStream(episodeId, server = 'hd-2') {
  const res = await fetch(
    `${ANIWATCH_BASE_URL}/api/v2/hianime/episode/sources?animeEpisodeId=${encodeURIComponent(episodeId)}&server=${encodeURIComponent(server)}&category=sub`
  )
  const data = await res.json()
  const sources = data.data?.sources || []
  const tracks = (data.data?.tracks || []).map((track) => ({
    ...track,
    kind: track.kind || (String(track.lang).toLowerCase() === 'thumbnails' ? 'thumbnails' : 'captions'),
  }))
  const m3u8 = sources.find(source => source.type === 'hls') || sources[0]

  return {
    url: m3u8?.url || null,
    sources,
    tracks,
    headers: data.data?.headers || {},
  }
}
