import { getEnabledAnimeAddonProviders } from './animeAddons'
import { resolveAnimeProviderStates, resolveEpisodeStreamCandidates } from './animeAddons/resolveAnimeStreams'
import { getAnimeEpisodes, getAnimeStream, resolveAnimeSearch } from './consumet'

const providerStateCache = new Map()
const ANIME_DOWNLOAD_RESOLVE_TIMEOUT_MS = 60000

function withTimeout(promise, timeoutMs, message) {
  let timer = null

  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timer)
  })
}

function uniqueTitles(titles = []) {
  const seen = new Set()
  const output = []

  for (const value of titles) {
    const title = String(value || '').replace(/\s+/g, ' ').trim()
    if (!title) continue

    const variants = [
      title,
      title.replace(/\bSeason\s+\d+\b.*$/gi, ''),
      title.replace(/\s*:\s*.+$/, ''),
      title.replace(/\s+-\s+.+$/, ''),
      title.split(':')[0] || '',
      title.split('-')[0] || '',
      title.replace(/\bPart\s+\d+\b/gi, ''),
      title.replace(/\bCour\s+\d+\b/gi, ''),
      title.replace(/\([^)]*\)/g, ''),
    ]

    for (const variant of variants) {
      const clean = String(variant || '')
        .replace(/\s+/g, ' ')
        .replace(/[:\-–—\s]+$/g, '')
        .trim()
      if (!clean) continue
      const key = clean.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      output.push(clean)
    }
  }

  return output
}

function buildBroaderAnimeTitles(titles = []) {
  return uniqueTitles([
    ...titles,
    ...titles.map((value) => String(value || '').split(':')[0] || ''),
    ...titles.map((value) => String(value || '').split('-')[0] || ''),
  ])
}

function inferAnimeStreamType(url = '', explicitType = '') {
  const normalizedType = String(explicitType || '').trim().toLowerCase()
  if (normalizedType) return normalizedType
  const lowerUrl = String(url || '').trim().toLowerCase()
  if (lowerUrl.includes('.m3u8')) return 'hls'
  if (lowerUrl.includes('.mp4') || lowerUrl.includes('.m4v')) return 'mp4'
  return 'unknown'
}

async function resolveViaConsumetFallback(titles = [], episodeNumber) {
  const providers = ['gogoanime', 'animepahe']

  for (const provider of providers) {
    try {
      const { anime } = await resolveAnimeSearch(titles, provider)
      if (!anime?.id) continue

      const episodes = await getAnimeEpisodes(anime.id, provider, { fresh: true })
      const match = episodes.find((item) => Number(item?.number) === Number(episodeNumber))
      if (!match?.episodeId) continue

      const payload = await getAnimeStream(match.episodeId, provider)
      const streamUrl = String(payload?.rawUrl || '').trim()
      if (!streamUrl) continue

      const subtitleTrack = pickPreferredSubtitle(payload?.tracks || [])

      return {
        streamUrl,
        streamType: inferAnimeStreamType(streamUrl, 'hls'),
        headers: payload?.headers && typeof payload.headers === 'object' ? payload.headers : {},
        subtitleUrl: subtitleTrack?.file || subtitleTrack?.url || subtitleTrack?.rawFile || null,
        providerId: provider,
        qualityLabel: null,
        resolution: null,
      }
    } catch (error) {
      console.warn('[animeDownloads] consumet fallback failed', { provider, error })
    }
  }

  return null
}

function buildAnimeStateCacheKey(titles = []) {
  return uniqueTitles(titles).join('::').toLowerCase()
}

async function getAnimeProviderStates(titles = []) {
  return getAnimeProviderStatesInternal(titles, false)
}

async function getAnimeProviderStatesInternal(titles = [], forceFresh = false) {
  const normalizedTitles = uniqueTitles(titles)
  const cacheKey = buildAnimeStateCacheKey(normalizedTitles)

  if (!cacheKey) return []
  if (forceFresh) {
    providerStateCache.delete(cacheKey)
  } else if (providerStateCache.has(cacheKey)) {
    return providerStateCache.get(cacheKey)
  }

  const promise = resolveAnimeProviderStates({
    titles: normalizedTitles,
    providers: getEnabledAnimeAddonProviders(),
  })
    .catch((error) => {
      providerStateCache.delete(cacheKey)
      throw error
    })

  providerStateCache.set(cacheKey, promise)
  return promise
}

async function getAnimeProviderStatesForDownload(titles = [], { allowRefresh = true } = {}) {
  const cachedStates = await getAnimeProviderStatesInternal(titles, false)
  if (cachedStates.length || !allowRefresh) {
    return cachedStates
  }

  return getAnimeProviderStatesInternal(titles, true)
}

function pickPreferredSubtitle(subtitles = []) {
  const tracks = Array.isArray(subtitles) ? subtitles : []
  if (!tracks.length) return null

  const englishTrack = tracks.find((track) => {
    const lang = String(track?.lang || track?.language || '').toLowerCase()
    const label = String(track?.label || track?.name || '').toLowerCase()
    return (
      lang.includes('en')
      || lang.includes('eng')
      || label.includes('english')
      || label.includes('eng')
    )
  })

  return englishTrack || tracks[0] || null
}

async function loadAnimeDownloadProvider(providerId = '') {
  const normalizedId = String(providerId || '').trim().toLowerCase()
  if (!normalizedId) return null

  const enabledProvider = getEnabledAnimeAddonProviders()
    .find((provider) => provider?.id === normalizedId)
  if (enabledProvider) return enabledProvider

  return null
}

function sortProviderStates(states = [], preferredProviderId = '') {
  const normalizedPreferredProviderId = String(preferredProviderId || '').trim().toLowerCase()
  const orderedStates = Array.isArray(states) ? [...states] : []

  if (!normalizedPreferredProviderId) {
    return orderedStates
  }

  orderedStates.sort((left, right) => {
    const leftPreferred = String(left?.providerId || '').trim().toLowerCase() === normalizedPreferredProviderId
    const rightPreferred = String(right?.providerId || '').trim().toLowerCase() === normalizedPreferredProviderId

    if (leftPreferred === rightPreferred) return 0
    return leftPreferred ? -1 : 1
  })

  return orderedStates
}

async function resolveStreamCandidateBatch({
  providerStates = [],
  episodeNumber,
  preferredProviderId = '',
  failedUrls = [],
  timeoutLabel = '',
} = {}) {
  if (!Array.isArray(providerStates) || !providerStates.length) {
    return []
  }

  return withTimeout(
    resolveEpisodeStreamCandidates({
      providerStates,
      episodeNumber,
      preferredProviderId,
      failedUrls,
    }),
    ANIME_DOWNLOAD_RESOLVE_TIMEOUT_MS,
    timeoutLabel || `Episode ${Number(episodeNumber || 0)} stream resolution timed out`
  )
}

async function resolveStreamCandidateWithFallback({
  providerStates = [],
  episodeNumber,
  preferredProviderId = '',
  failedUrls = [],
  primaryTimeoutLabel = '',
  fallbackTimeoutLabel = '',
} = {}) {
  const orderedStates = sortProviderStates(providerStates, preferredProviderId)
  if (!orderedStates.length) {
    return []
  }

  const normalizedPreferredProviderId = String(preferredProviderId || '').trim().toLowerCase()
  const preferredStates = normalizedPreferredProviderId
    ? orderedStates.filter((state) => String(state?.providerId || '').trim().toLowerCase() === normalizedPreferredProviderId)
    : []
  const fallbackStates = normalizedPreferredProviderId
    ? orderedStates.filter((state) => String(state?.providerId || '').trim().toLowerCase() !== normalizedPreferredProviderId)
    : orderedStates

  if (preferredStates.length) {
    try {
      const preferredCandidates = await resolveStreamCandidateBatch({
        providerStates: preferredStates,
        episodeNumber,
        preferredProviderId: normalizedPreferredProviderId,
        failedUrls,
        timeoutLabel: primaryTimeoutLabel,
      })

      if (preferredCandidates.length) {
        return preferredCandidates
      }
    } catch (error) {
      console.warn('[animeDownloads] preferred provider stream resolution failed, falling back', {
        preferredProviderId: normalizedPreferredProviderId,
        episodeNumber,
        error,
      })
    }
  }

  if (!fallbackStates.length) {
    return []
  }

  return resolveStreamCandidateBatch({
    providerStates: fallbackStates,
    episodeNumber,
    preferredProviderId: '',
    failedUrls,
    timeoutLabel: fallbackTimeoutLabel,
  })
}

export async function resolveAnimeDownloadStream({
  title = '',
  altTitle = '',
  extraTitles = [],
  episodeNumber,
  preferredProviderId = '',
  providerAnimeId = '',
  providerMatchedTitle = '',
} = {}) {
  const normalizedEpisode = Number(episodeNumber || 0)
  if (!normalizedEpisode) {
    throw new Error('Anime download is missing an episode number')
  }

  const titles = uniqueTitles([title, altTitle, ...(Array.isArray(extraTitles) ? extraTitles : [])])
  if (!titles.length) {
    throw new Error('Anime download is missing a title')
  }

  let providerStates = []
  const normalizedPreferredProviderId = String(preferredProviderId || '').trim()
  const normalizedProviderAnimeId = String(providerAnimeId || '').trim()
  const preferredProvider = await loadAnimeDownloadProvider(normalizedPreferredProviderId)
  const normalizedPreferredProviderIdLower = normalizedPreferredProviderId.toLowerCase()

  if (preferredProvider && normalizedProviderAnimeId) {
    if (preferredProvider?.buildProviderState) {
      try {
        const directState = await withTimeout(
          preferredProvider.buildProviderState({
            match: {
              animeId: normalizedProviderAnimeId,
              title: providerMatchedTitle || title || altTitle || titles[0] || '',
              matchedTitle: providerMatchedTitle || title || altTitle || titles[0] || '',
            },
          }),
          ANIME_DOWNLOAD_RESOLVE_TIMEOUT_MS,
          `${normalizedPreferredProviderId} provider state build timed out`
        )

        if (directState?.animeId) {
          providerStates = [directState]
        }
      } catch (error) {
        console.warn('[animeDownloads] direct provider state build failed', {
          preferredProviderId: normalizedPreferredProviderId,
          providerAnimeId: normalizedProviderAnimeId,
          error,
        })
      }
    }
  }

  if (providerStates.length) {
    try {
      const directCandidates = await resolveStreamCandidateBatch({
        providerStates,
        episodeNumber: normalizedEpisode,
        preferredProviderId: normalizedPreferredProviderIdLower,
        failedUrls: [],
        timeoutLabel: `Episode ${normalizedEpisode} stream resolution timed out`,
      })

      if (directCandidates.length) {
        const candidate = directCandidates[0]
        const subtitleTrack = pickPreferredSubtitle(candidate.subtitles)

        return {
          streamUrl: String(candidate.url || '').trim(),
          streamType: String(candidate.streamType || '').trim() || 'unknown',
          headers: candidate.headers && typeof candidate.headers === 'object' ? candidate.headers : {},
          subtitleUrl: subtitleTrack?.file || subtitleTrack?.url || subtitleTrack?.rawFile || null,
          providerId: candidate.providerId || null,
          qualityLabel: candidate.quality || null,
          resolution: Number(candidate.resolution || 0) || null,
        }
      }
    } catch (error) {
      console.warn('[animeDownloads] direct provider stream resolution failed, continuing with fallback search', {
        preferredProviderId: normalizedPreferredProviderId,
        providerAnimeId: normalizedProviderAnimeId,
        episodeNumber: normalizedEpisode,
        error,
      })
    }
  }

  const searchedProviderStates = await withTimeout(
    getAnimeProviderStatesForDownload(titles, { allowRefresh: true }),
    ANIME_DOWNLOAD_RESOLVE_TIMEOUT_MS,
    'Anime provider resolution timed out'
  )

  if (providerStates.length) {
    const mergedByProvider = new Map()
    for (const state of [...providerStates, ...searchedProviderStates]) {
      if (state?.providerId && !mergedByProvider.has(state.providerId)) {
        mergedByProvider.set(state.providerId, state)
      }
    }
    providerStates = Array.from(mergedByProvider.values())
  } else {
    providerStates = searchedProviderStates
  }

  if (!providerStates.length) {
    throw new Error('No anime providers matched this title')
  }

  const candidates = await resolveStreamCandidateWithFallback({
    providerStates,
    episodeNumber: normalizedEpisode,
    preferredProviderId: normalizedPreferredProviderIdLower,
    failedUrls: [],
    primaryTimeoutLabel: `Episode ${normalizedEpisode} stream resolution timed out`,
    fallbackTimeoutLabel: `Episode ${normalizedEpisode} fallback stream resolution timed out`,
  })

  if (!candidates.length) {
    const broaderTitles = buildBroaderAnimeTitles(titles)
    if (broaderTitles.join('::') !== titles.join('::')) {
      const broaderStates = await withTimeout(
        getAnimeProviderStatesForDownload(broaderTitles, { allowRefresh: true }),
        ANIME_DOWNLOAD_RESOLVE_TIMEOUT_MS,
        'Anime provider fallback resolution timed out'
      )

      if (broaderStates.length) {
        const broaderCandidates = await resolveStreamCandidateWithFallback({
          providerStates: broaderStates,
          episodeNumber: normalizedEpisode,
          preferredProviderId: normalizedPreferredProviderIdLower,
          failedUrls: [],
          primaryTimeoutLabel: `Episode ${normalizedEpisode} stream resolution timed out`,
          fallbackTimeoutLabel: `Episode ${normalizedEpisode} fallback stream resolution timed out`,
        })

        if (broaderCandidates.length) {
          const candidate = broaderCandidates[0]
          const subtitleTrack = pickPreferredSubtitle(candidate.subtitles)

          return {
            streamUrl: String(candidate.url || '').trim(),
            streamType: String(candidate.streamType || '').trim() || 'unknown',
            headers: candidate.headers && typeof candidate.headers === 'object' ? candidate.headers : {},
            subtitleUrl: subtitleTrack?.file || subtitleTrack?.url || subtitleTrack?.rawFile || null,
            providerId: candidate.providerId || null,
            qualityLabel: candidate.quality || null,
            resolution: Number(candidate.resolution || 0) || null,
          }
        }
      }
    }

    const consumetFallback = await resolveViaConsumetFallback(broaderTitles, normalizedEpisode)
    if (consumetFallback?.streamUrl) {
      return consumetFallback
    }
  }

  const candidate = candidates[0]
  if (!candidate?.url) {
    throw new Error(`Episode ${normalizedEpisode} could not be resolved on available anime providers`)
  }

  const subtitleTrack = pickPreferredSubtitle(candidate.subtitles)

  return {
    streamUrl: String(candidate.url || '').trim(),
    streamType: String(candidate.streamType || '').trim() || 'unknown',
    headers: candidate.headers && typeof candidate.headers === 'object' ? candidate.headers : {},
    subtitleUrl: subtitleTrack?.file || subtitleTrack?.url || subtitleTrack?.rawFile || null,
    providerId: candidate.providerId || null,
    qualityLabel: candidate.quality || null,
    resolution: Number(candidate.resolution || 0) || null,
  }
}

export async function prepareAnimeDownloadRuntimeData(download = {}, { fallbackAltTitle = '' } = {}) {
  const resolvedAnimeStream = await resolveAnimeDownloadStream({
    title: download.title,
    altTitle: download.animeAltTitle || fallbackAltTitle || '',
    extraTitles: download.animeSearchTitles || [],
    episodeNumber: download.episode,
    preferredProviderId: download.providerId || '',
    providerAnimeId: download.providerAnimeId || '',
    providerMatchedTitle: download.providerMatchedTitle || '',
  })

  return {
    ...download,
    ...resolvedAnimeStream,
    animeAltTitle: download.animeAltTitle || fallbackAltTitle || '',
    subtitleUrl: resolvedAnimeStream.subtitleUrl || download.subtitleUrl || null,
  }
}

export function clearAnimeDownloadCache() {
  providerStateCache.clear()
}
