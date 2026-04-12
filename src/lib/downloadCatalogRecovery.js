import { getDetails, getSeasonDetails, imgW342 } from './tmdb'
import { getDownloadItemByIdentity } from '../store/useDownloadStore'

const normalizeText = (value) => {
  const normalized = String(value || '').trim()
  return normalized || null
}

const buildFilePathMatch = (items, filePath) => {
  const normalizedPath = normalizeText(filePath)
  if (!normalizedPath) return null

  return (Array.isArray(items) ? items : []).find((item) => (
    normalizeText(item?.filePath) === normalizedPath
  )) || null
}

const resolveExistingMatch = (items, scanItem) => (
  getDownloadItemByIdentity(items, scanItem)
  || buildFilePathMatch(items, scanItem?.filePath ?? scanItem?.file_path)
)

const resolveDetailLookupType = (item) => {
  if (item?.contentType === 'tv' || item?.contentType === 'anime') {
    return 'tv'
  }

  if (item?.detailMediaType === 'tv') {
    return 'tv'
  }

  return 'movie'
}

const buildDetailsCacheKey = (item) => `${resolveDetailLookupType(item)}::${String(item?.contentId ?? item?.content_id ?? '')}`
const buildSeasonCacheKey = (item) => `${String(item?.contentId ?? item?.content_id ?? '')}::${Number(item?.season) || 0}`

async function fetchDetailsCached(item, detailsCache) {
  const cacheKey = buildDetailsCacheKey(item)
  if (!cacheKey.endsWith('::')) {
    if (!detailsCache.has(cacheKey)) {
      const detailType = resolveDetailLookupType(item)
      detailsCache.set(cacheKey, getDetails(detailType, String(item.contentId ?? item.content_id), '').catch(() => null))
    }

    return detailsCache.get(cacheKey)
  }

  return null
}

async function fetchSeasonDetailsCached(item, seasonCache) {
  const normalizedSeason = Number(item?.season) || 0
  if (normalizedSeason <= 0) return null

  const cacheKey = buildSeasonCacheKey(item)
  if (!seasonCache.has(cacheKey)) {
    seasonCache.set(
      cacheKey,
      getSeasonDetails(String(item.contentId ?? item.content_id), normalizedSeason).catch(() => null)
    )
  }

  return seasonCache.get(cacheKey)
}

function buildRecoveredBaseItem(scanItem, existingItem) {
  return {
    ...scanItem,
    id: existingItem?.id ?? scanItem?.id,
    title: normalizeText(existingItem?.title) || normalizeText(scanItem?.title) || 'Downloaded',
    poster: existingItem?.poster ?? scanItem?.poster ?? null,
    animeAltTitle: existingItem?.animeAltTitle ?? scanItem?.animeAltTitle ?? scanItem?.anime_alt_title ?? null,
    animeSearchTitles: Array.isArray(existingItem?.animeSearchTitles)
      ? existingItem.animeSearchTitles
      : (Array.isArray(scanItem?.animeSearchTitles ?? scanItem?.anime_search_titles)
          ? (scanItem.animeSearchTitles ?? scanItem.anime_search_titles)
          : []),
    anilistId: existingItem?.anilistId ?? scanItem?.anilistId ?? scanItem?.anilist_id ?? null,
    canonicalAnilistId: existingItem?.canonicalAnilistId ?? scanItem?.canonicalAnilistId ?? scanItem?.canonical_anilist_id ?? null,
    detailMediaType: existingItem?.detailMediaType ?? scanItem?.detailMediaType ?? scanItem?.detail_media_type ?? null,
    providerAnimeId: existingItem?.providerAnimeId ?? scanItem?.providerAnimeId ?? scanItem?.provider_anime_id ?? null,
    providerMatchedTitle: existingItem?.providerMatchedTitle ?? scanItem?.providerMatchedTitle ?? scanItem?.provider_matched_title ?? null,
    episodeTitle: normalizeText(existingItem?.episodeTitle)
      || normalizeText(scanItem?.episodeTitle)
      || normalizeText(scanItem?.episode_title)
      || null,
    quality: existingItem?.quality ?? scanItem?.quality ?? 'high',
    resolvedQuality: existingItem?.resolvedQuality ?? scanItem?.resolvedQuality ?? scanItem?.resolved_quality ?? 'Downloaded',
    headers: existingItem?.headers ?? scanItem?.headers ?? {},
    streamType: existingItem?.streamType ?? scanItem?.streamType ?? scanItem?.stream_type ?? 'mp4',
    resumeSupported: existingItem?.resumeSupported ?? scanItem?.resumeSupported ?? scanItem?.resume_supported ?? true,
    filePath: existingItem?.filePath ?? scanItem?.filePath ?? scanItem?.file_path ?? null,
    subtitleFilePath: existingItem?.subtitleFilePath ?? scanItem?.subtitleFilePath ?? scanItem?.subtitle_file_path ?? null,
    queuedAt: existingItem?.queuedAt ?? scanItem?.queuedAt ?? scanItem?.queued_at ?? null,
    completedAt: existingItem?.completedAt ?? scanItem?.completedAt ?? scanItem?.completed_at ?? null,
    totalBytes: existingItem?.totalBytes ?? scanItem?.totalBytes ?? scanItem?.total_bytes ?? 0,
    bytesDownloaded: existingItem?.bytesDownloaded ?? scanItem?.bytesDownloaded ?? scanItem?.bytes_downloaded ?? 0,
  }
}

function applyRecoveredDetails(baseItem, details, seasonDetails) {
  const posterPath = normalizeText(details?.poster_path)
  const seriesEpisode = Array.isArray(seasonDetails?.episodes)
    ? seasonDetails.episodes.find((episode) => Number(episode?.episode_number) === Number(baseItem?.episode))
    : null

  return {
    ...baseItem,
    title: baseItem.title
      || normalizeText(details?.title)
      || normalizeText(details?.name)
      || 'Downloaded',
    poster: baseItem.poster || (posterPath ? imgW342(posterPath) : null),
    animeAltTitle: baseItem.animeAltTitle
      || normalizeText(details?.original_name)
      || normalizeText(details?.original_title)
      || null,
    detailMediaType: baseItem.detailMediaType || resolveDetailLookupType(baseItem),
    episodeTitle: baseItem.episodeTitle || normalizeText(seriesEpisode?.name) || null,
  }
}

export async function recoverCompletedDownloadCatalog(scanItems = [], existingItems = []) {
  const normalizedItems = Array.isArray(scanItems) ? scanItems : []
  if (normalizedItems.length === 0) return []

  const detailsCache = new Map()
  const seasonCache = new Map()

  return Promise.all(normalizedItems.map(async (scanItem) => {
    const existingItem = resolveExistingMatch(existingItems, scanItem)
    const baseItem = buildRecoveredBaseItem(scanItem, existingItem)

    const needsDetails = !baseItem.poster || !normalizeText(baseItem.title)
    const needsEpisodeTitle = (baseItem.contentType === 'tv' || baseItem.contentType === 'anime')
      && Number(baseItem.season) > 0
      && Number(baseItem.episode) > 0
      && !normalizeText(baseItem.episodeTitle)

    if (!needsDetails && !needsEpisodeTitle) {
      return baseItem
    }

    const [details, seasonDetails] = await Promise.all([
      fetchDetailsCached(baseItem, detailsCache),
      needsEpisodeTitle ? fetchSeasonDetailsCached(baseItem, seasonCache) : Promise.resolve(null),
    ])

    return applyRecoveredDetails(baseItem, details, seasonDetails)
  }))
}
