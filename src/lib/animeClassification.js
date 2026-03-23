import { searchAnime as searchAniListAnime } from './anilist'

const ANIMATION_GENRE_ID = 16
const anilistMatchCache = new Map()

const normalizeTitle = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bseason\s+\d+\b/gi, ' ')
    .replace(/\bpart\s+\d+\b/gi, ' ')
    .replace(/\bcour\s+\d+\b/gi, ' ')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, ' ')
    .replace(/\bfinal\s+season\b/gi, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getGenreIds = (item) => {
  if (Array.isArray(item?.genre_ids)) return item.genre_ids
  if (Array.isArray(item?.genres)) {
    return item.genres.map((genre) => Number(genre?.id)).filter(Boolean)
  }
  return []
}

export const getTmdbMediaType = (item, explicitType) =>
  explicitType || item?.media_type || (item?.title ? 'movie' : 'tv')

export const getTmdbPrimaryTitle = (item) =>
  item?.title || item?.name || item?.original_title || item?.original_name || 'Untitled'

export const getTmdbAlternateTitle = (item) =>
  item?.original_name || item?.original_title || item?.name || item?.title || ''

export const getTmdbYear = (item) => {
  const rawDate = item?.release_date || item?.first_air_date || ''
  const year = Number(String(rawDate).slice(0, 4))
  return Number.isFinite(year) && year > 0 ? year : null
}

export function isLikelyAnimeTmdbItem(item, explicitType) {
  const mediaType = getTmdbMediaType(item, explicitType)
  const genreIds = getGenreIds(item)
  const hasAnimationGenre = genreIds.includes(ANIMATION_GENRE_ID)
  const originCountries = Array.isArray(item?.origin_country) ? item.origin_country : []
  const hasJapanSignal =
    String(item?.original_language || '').toLowerCase() === 'ja' ||
    originCountries.includes('JP')

  if (!hasAnimationGenre || !hasJapanSignal) return false

  // Anime routing should apply to Japanese animation regardless of TMDB media type.
  return mediaType === 'tv' || mediaType === 'movie'
}

const buildAniListMatchCacheKey = (item, explicitType) =>
  [
    getTmdbMediaType(item, explicitType),
    item?.id,
    getTmdbPrimaryTitle(item),
    getTmdbAlternateTitle(item),
    getTmdbYear(item),
  ].join(':')

const toAniListCandidate = (candidate) => ({
  id: Number(candidate?.id) || null,
  title: candidate?.title?.english || candidate?.title?.romaji || candidate?.title?.native || '',
  altTitle: candidate?.title?.romaji || candidate?.title?.english || candidate?.title?.native || '',
  year: candidate?.seasonYear || candidate?.startDate?.year || null,
  format: String(candidate?.format || '').toUpperCase(),
})

const scoreAniListCandidate = (candidate, item, explicitType, queryTitle) => {
  const mediaType = getTmdbMediaType(item, explicitType)
  const expectedFormat = mediaType === 'movie' ? 'MOVIE' : 'TV'
  const candidateTitle = normalizeTitle(
    candidate?.title?.english || candidate?.title?.romaji || candidate?.title?.native || ''
  )
  const normalizedQuery = normalizeTitle(queryTitle)
  const tmdbYear = getTmdbYear(item)
  const candidateYear = candidate?.seasonYear || candidate?.startDate?.year || null

  let score = 0

  if (candidateTitle && normalizedQuery) {
    if (candidateTitle === normalizedQuery) score += 120
    else if (candidateTitle.includes(normalizedQuery)) score += 80
    else if (normalizedQuery.includes(candidateTitle)) score += 60
  }

  if (candidate?.format === expectedFormat) score += 25
  else if (expectedFormat === 'TV' && candidate?.format === 'TV_SHORT') score += 20

  if (tmdbYear && candidateYear) {
    const diff = Math.abs(Number(tmdbYear) - Number(candidateYear))
    if (diff === 0) score += 30
    else if (diff === 1) score += 20
    else if (diff === 2) score += 10
  }

  if (candidate?.popularity) score += Math.min(Number(candidate.popularity) / 2000, 10)

  return score
}

export async function resolveAniListMatchForTmdbItem(item, explicitType) {
  if (!isLikelyAnimeTmdbItem(item, explicitType)) return null

  const cacheKey = buildAniListMatchCacheKey(item, explicitType)
  if (anilistMatchCache.has(cacheKey)) {
    return anilistMatchCache.get(cacheKey)
  }

  const titles = Array.from(
    new Set([getTmdbPrimaryTitle(item), getTmdbAlternateTitle(item)].filter(Boolean))
  )

  let bestMatch = null
  let bestScore = -1

  for (const title of titles) {
    try {
      const results = await searchAniListAnime(title)
      for (const candidate of Array.isArray(results) ? results : []) {
        const score = scoreAniListCandidate(candidate, item, explicitType, title)
        if (score > bestScore) {
          bestScore = score
          bestMatch = toAniListCandidate(candidate)
        }
      }
    } catch {
      // Ignore AniList lookup failures and fall back to TMDB identity.
    }
  }

  const resolved = bestScore >= 80 ? bestMatch : null
  anilistMatchCache.set(cacheKey, resolved)
  return resolved
}

export async function buildDetailNavigationForTmdbItem(item, explicitType) {
  const mediaType = getTmdbMediaType(item, explicitType)
  const path = `/detail/${mediaType}/${item.id}`

  if (!isLikelyAnimeTmdbItem(item, explicitType)) {
    return { path, state: undefined }
  }

  const aniListMatch = await resolveAniListMatchForTmdbItem(item, explicitType)

  return {
    path,
    state: {
      isAnime: true,
      anilistId: aniListMatch?.id || null,
      animeTitle: aniListMatch?.title || getTmdbPrimaryTitle(item),
      animeAltTitle: aniListMatch?.altTitle || getTmdbAlternateTitle(item),
      animeYear: aniListMatch?.year || getTmdbYear(item),
    },
  }
}
