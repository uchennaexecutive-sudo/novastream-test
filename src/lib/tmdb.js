import axios from 'axios'

const API_KEY = '49bd672b0680fac7de50e5b9f139a98b'
const BASE = 'https://api.themoviedb.org/3'
const IMG_ORIGINAL = 'https://image.tmdb.org/t/p/original'
const IMG_W1280 = 'https://image.tmdb.org/t/p/w1280'
const IMG_W500 = 'https://image.tmdb.org/t/p/w500'

const tmdb = axios.create({
  baseURL: BASE,
  timeout: 15000,
  params: { api_key: API_KEY },
})

export const imgOriginal = (path) => path ? `${IMG_ORIGINAL}${path}` : null
export const imgW1280 = (path) => path ? `${IMG_W1280}${path}` : null
export const imgW500 = (path) => path ? `${IMG_W500}${path}` : null

export const getTrending = (type = 'all', window = 'week') =>
  tmdb.get(`/trending/${type}/${window}`).then(r => r.data.results)

export const getPopularMovies = (page = 1) =>
  tmdb.get('/movie/popular', { params: { page } }).then(r => r.data)

export const getTopRatedMovies = (page = 1) =>
  tmdb.get('/movie/top_rated', { params: { page } }).then(r => r.data)

export const getNowPlaying = () =>
  tmdb.get('/movie/now_playing').then(r => r.data.results)

export const getUpcoming = () =>
  tmdb.get('/movie/upcoming').then(r => r.data.results)

export const getPopularSeries = (page = 1) =>
  tmdb.get('/tv/popular', { params: { page } }).then(r => r.data)

export const getTopRatedSeries = (page = 1) =>
  tmdb.get('/tv/top_rated', { params: { page } }).then(r => r.data)

export const getOnAir = () =>
  tmdb.get('/tv/on_the_air').then(r => r.data.results)

export const getSeriesByNetwork = (networkId, page = 1) =>
  tmdb.get('/discover/tv', { params: { with_networks: networkId, page } }).then(r => r.data)

export const getAnimationMovies = (page = 1) =>
  tmdb.get('/discover/movie', { params: { with_genres: 16, page } }).then(r => r.data)

export const getAnimeSeries = (page = 1) =>
  tmdb.get('/discover/tv', { params: { with_genres: 16, with_keywords: 210024, page } }).then(r => r.data)

export const getDetails = (type, id) =>
  tmdb.get(`/${type}/${id}`, { params: { append_to_response: 'credits,videos,similar,images' } }).then(r => r.data)

export const getSeasonDetails = (seriesId, season) =>
  tmdb.get(`/tv/${seriesId}/season/${season}`).then(r => r.data)

export const searchMulti = (query) =>
  tmdb.get('/search/multi', { params: { query } }).then(r => r.data.results)

export const getRecommendations = (type, id) =>
  tmdb.get(`/${type === 'movie' ? 'movie' : 'tv'}/${id}/recommendations`).then(r => r.data.results || [])

// Dedicated anime lookup: searches /search/tv which is more reliable than /search/multi for anime titles
export const searchAnimeOnTMDB = async (englishTitle, romajiTitle, animeYear = null) => {
  const getAnimeFranchiseTitle = (value) => {
    const title = String(value || '').trim()
    if (!title) return ''

    const markers = [
      /\b\d+(st|nd|rd|th)\s+season\b/i,
      /\bseason\s+\d+\b/i,
      /\bfinal\s+season\b/i,
      /\bpart\s+\d+\b/i,
      /\bcour\s+\d+\b/i,
    ]

    const matchedIndexes = markers
      .map((pattern) => title.search(pattern))
      .filter((index) => index >= 0)

    if (!matchedIndexes.length) {
      return title
    }

    const cutIndex = Math.min(...matchedIndexes)
    return title
      .slice(0, cutIndex)
      .replace(/\s*[:\-–]\s*$/, '')
      .trim()
  }

  const clean = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/\bseason\s+\d+\b/gi, '')
      .replace(/\bpart\s+\d+\b/gi, '')
      .replace(/\bcour\s+\d+\b/gi, '')
      .replace(/\b2nd\s+season\b/gi, '')
      .replace(/\b3rd\s+season\b/gi, '')
      .replace(/\b4th\s+season\b/gi, '')
      .replace(/\bfinal\s+season\b/gi, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const scoreResult = (result, queryTitle) => {
    const query = clean(queryTitle)
    const name = clean(result?.name || result?.original_name || '')
    const year = result?.first_air_date ? Number(String(result.first_air_date).slice(0, 4)) : null

    let score = 0

    if (name === query) score += 100
    else if (name.includes(query)) score += 60
    else if (query.includes(name)) score += 40

    if (animeYear && year) {
      const diff = Math.abs(Number(animeYear) - year)
      if (diff === 0) score += 30
      else if (diff === 1) score += 20
      else if (diff === 2) score += 10
    }

    if (result?.popularity) score += Math.min(result.popularity / 10, 20)

    return score
  }

  const tryTitle = async (title) => {
    if (!title) return null

    try {
      const res = await tmdb.get('/search/tv', { params: { query: title } })
      const results = res.data.results || []

      if (!results.length) return null

      const ranked = [...results]
        .map((result) => ({
          result,
          score: scoreResult(result, title),
        }))
        .sort((a, b) => b.score - a.score)

      return ranked[0]?.result || null
    } catch {
      return null
    }
  }

  const candidates = [...new Set([
    englishTitle,
    romajiTitle,
    getAnimeFranchiseTitle(englishTitle),
    getAnimeFranchiseTitle(romajiTitle),
  ].map((value) => String(value || '').trim()).filter(Boolean))]

  let hit = null
  for (const candidate of candidates) {
    hit = await tryTitle(candidate)
    if (hit) break
  }

  return hit
    ? {
      tmdbId: hit.id,
      mediaType: 'tv',
      title: hit.name,
    }
    : null
}

export const getImages = (type, id) =>
  tmdb.get(`/${type}/${id}/images`).then(r => r.data)

export const discoverMovies = (params = {}) =>
  tmdb.get('/discover/movie', { params }).then(r => r.data)

export const discoverTV = (params = {}) =>
  tmdb.get('/discover/tv', { params }).then(r => r.data)

export const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller',
  10752: 'War', 37: 'Western',
}
