import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const DOWNLOADS_STORAGE_KEY = 'nova-downloads'
const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'paused'])

const MOVIE_SIZE_ESTIMATES = {
  standard: 900 * 1024 * 1024,
  high: Math.round(2.7 * 1024 * 1024 * 1024),
  highest: Math.round(7.2 * 1024 * 1024 * 1024),
}

const EPISODE_SIZE_ESTIMATES = {
  standard: 360 * 1024 * 1024,
  high: 900 * 1024 * 1024,
  highest: Math.round(2.4 * 1024 * 1024 * 1024),
}

const clampProgress = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

const toNullableInteger = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.trunc(numeric)
}

const toByteCount = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return Math.round(numeric)
}

const nowIso = () => new Date().toISOString()
const normalizeTimestamp = (value, fallback = null) => {
  if (value == null || value === '') return fallback

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()

    const numeric = Number(trimmed)
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback
    const millis = numeric > 1e12 ? numeric : numeric * 1000
    return new Date(millis).toISOString()
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  const millis = numeric > 1e12 ? numeric : numeric * 1000
  return new Date(millis).toISOString()
}

const normalizeSubtitleFilePath = (value) => {
  const normalized = String(value || '').trim()
  return /\.(srt|vtt|ass|ssa|sub)$/i.test(normalized) ? normalized : null
}

export const normalizeDownloadContentType = (contentType = 'movie') => {
  const normalized = String(contentType || 'movie').trim().toLowerCase()

  if (normalized === 'series') return 'tv'
  if (normalized === 'tv' || normalized === 'movie' || normalized === 'anime' || normalized === 'animation') {
    return normalized
  }

  return 'movie'
}

export const buildDownloadLookupKey = ({
  contentId,
  contentType,
  season = null,
  episode = null,
}) => {
  const normalizedContentId = String(contentId || '').trim()
  const normalizedContentType = normalizeDownloadContentType(contentType)

  if (!normalizedContentId) return ''

  if (normalizedContentType === 'tv' || normalizedContentType === 'anime') {
    return `${normalizedContentType}::${normalizedContentId}::${toNullableInteger(season) || 0}::${toNullableInteger(episode) || 0}`
  }

  return `${normalizedContentType}::${normalizedContentId}`
}

export const getDownloadItemByIdentity = (items, identity) => {
  const lookupKey = buildDownloadLookupKey(identity)
  if (!lookupKey) return null

  return (Array.isArray(items) ? items : []).find((item) => (
    buildDownloadLookupKey(item) === lookupKey
  )) || null
}

const getDownloadItemByFilePath = (items, filePath) => {
  const normalizedPath = String(filePath || '').trim()
  if (!normalizedPath) return null

  return (Array.isArray(items) ? items : []).find((item) => (
    String(item?.filePath || '').trim() === normalizedPath
  )) || null
}

export const getDownloadStatusSnapshot = (items, identity) => {
  const item = getDownloadItemByIdentity(items, identity)

  return {
    item,
    status: item?.status || 'default',
    progress: clampProgress(item?.progress || 0),
  }
}

const estimateDownloadBytes = ({ contentType, quality = 'high' }) => {
  const normalizedContentType = normalizeDownloadContentType(contentType)
  const sizeTable = normalizedContentType === 'tv' || normalizedContentType === 'anime'
    ? EPISODE_SIZE_ESTIMATES
    : MOVIE_SIZE_ESTIMATES

  return toByteCount(sizeTable[quality] || sizeTable.high)
}

const normalizeDownloadItem = (payload = {}, existing = null) => {
  const normalizedContentType = normalizeDownloadContentType(
    payload.contentType ?? payload.content_type ?? existing?.contentType
  )
  const normalizedContentId = String(
    payload.contentId ?? payload.content_id ?? existing?.contentId ?? ''
  ).trim()
  const normalizedSeason = normalizedContentType === 'tv' || normalizedContentType === 'anime'
    ? toNullableInteger(payload.season ?? existing?.season)
    : null
  const normalizedEpisode = normalizedContentType === 'tv' || normalizedContentType === 'anime'
    ? toNullableInteger(payload.episode ?? existing?.episode)
    : null
  const normalizedQuality = String(
    payload.quality ?? existing?.quality ?? 'high'
  ).trim().toLowerCase() || 'high'
  const estimatedBytes = estimateDownloadBytes({
    contentType: normalizedContentType,
    quality: normalizedQuality,
  })
  const lookupKey = buildDownloadLookupKey({
    contentId: normalizedContentId,
    contentType: normalizedContentType,
    season: normalizedSeason,
    episode: normalizedEpisode,
  })

  return {
    id: String(payload.id || existing?.id || lookupKey),
    contentId: normalizedContentId,
    contentType: normalizedContentType,
    title: String(payload.title ?? existing?.title ?? '').trim(),
    animeAltTitle: payload.animeAltTitle ?? payload.anime_alt_title ?? existing?.animeAltTitle ?? null,
    animeSearchTitles: Array.isArray(payload.animeSearchTitles ?? payload.anime_search_titles)
      ? [...new Set((payload.animeSearchTitles ?? payload.anime_search_titles).map((value) => String(value || '').trim()).filter(Boolean))]
      : (Array.isArray(existing?.animeSearchTitles) ? existing.animeSearchTitles : []),
    anilistId: payload.anilistId ?? payload.anilist_id ?? existing?.anilistId ?? null,
    canonicalAnilistId: payload.canonicalAnilistId ?? payload.canonical_anilist_id ?? existing?.canonicalAnilistId ?? null,
    detailMediaType: payload.detailMediaType ?? payload.detail_media_type ?? existing?.detailMediaType ?? null,
    providerAnimeId: payload.providerAnimeId ?? payload.provider_anime_id ?? existing?.providerAnimeId ?? null,
    providerMatchedTitle: payload.providerMatchedTitle ?? payload.provider_matched_title ?? existing?.providerMatchedTitle ?? null,
    poster: payload.poster ?? existing?.poster ?? null,
    season: normalizedSeason,
    episode: normalizedEpisode,
    episodeTitle: payload.episodeTitle ?? payload.episode_title ?? existing?.episodeTitle ?? null,
    quality: normalizedQuality,
    streamUrl: payload.streamUrl ?? payload.stream_url ?? existing?.streamUrl ?? null,
    headers: payload.headers ?? existing?.headers ?? {},
    subtitleUrl: payload.subtitleUrl ?? payload.subtitle_url ?? existing?.subtitleUrl ?? null,
    providerId: payload.providerId ?? payload.provider_id ?? existing?.providerId ?? null,
    resolvedQuality: payload.resolvedQuality ?? payload.resolved_quality ?? existing?.resolvedQuality ?? null,
    status: String(payload.status ?? existing?.status ?? 'queued').trim().toLowerCase() || 'queued',
    progress: clampProgress(payload.progress ?? existing?.progress ?? 0),
    bytesDownloaded: toByteCount(payload.bytesDownloaded ?? payload.bytes_downloaded ?? existing?.bytesDownloaded ?? 0),
    totalBytes: toByteCount(payload.totalBytes ?? payload.total_bytes ?? existing?.totalBytes ?? estimatedBytes),
    speedBytesPerSec: toByteCount(payload.speedBytesPerSec ?? payload.speed_bytes_per_sec ?? existing?.speedBytesPerSec ?? 0),
    streamType: payload.streamType ?? payload.stream_type ?? existing?.streamType ?? null,
    resumeSupported: typeof (payload.resumeSupported ?? payload.resume_supported ?? existing?.resumeSupported) === 'boolean'
      ? (payload.resumeSupported ?? payload.resume_supported ?? existing?.resumeSupported)
      : null,
    filePath: payload.filePath ?? payload.file_path ?? existing?.filePath ?? null,
    subtitleFilePath: normalizeSubtitleFilePath(
      payload.subtitleFilePath ?? payload.subtitle_file_path ?? existing?.subtitleFilePath ?? null
    ),
    errorMessage: payload.errorMessage ?? payload.error_message ?? existing?.errorMessage ?? '',
    queuedAt: normalizeTimestamp(payload.queuedAt ?? payload.queued_at, existing?.queuedAt ?? nowIso()),
    startedAt: normalizeTimestamp(payload.startedAt ?? payload.started_at, existing?.startedAt ?? null),
    completedAt: normalizeTimestamp(payload.completedAt ?? payload.completed_at, existing?.completedAt ?? null),
  }
}

const upsertItem = (items, payload) => {
  const existing = getDownloadItemByIdentity(items, payload)
  const nextItem = normalizeDownloadItem(payload, existing)
  const nextItems = Array.isArray(items) ? [...items] : []
  const existingIndex = nextItems.findIndex((item) => item.id === nextItem.id)

  if (existingIndex >= 0) {
    nextItems[existingIndex] = nextItem
    return nextItems
  }

  nextItems.unshift(nextItem)
  return nextItems
}

const sortByTimestampDesc = (items, field) => (
  [...items].sort((left, right) => (
    new Date(right?.[field] || right?.queuedAt || 0).getTime()
    - new Date(left?.[field] || left?.queuedAt || 0).getTime()
  ))
)

const getItemStoredBytes = (item) => Math.max(
  toByteCount(item?.totalBytes || 0),
  toByteCount(item?.bytesDownloaded || 0),
)

const getDerivedStorageBreakdown = (items) => {
  const breakdown = {
    movies: 0,
    series: 0,
    anime: 0,
    animation: 0,
  }

  for (const item of Array.isArray(items) ? items : []) {
    if (item?.status !== 'completed') continue

    const bytes = getItemStoredBytes(item)
    if (item.contentType === 'movie') breakdown.movies += bytes
    if (item.contentType === 'tv') breakdown.series += bytes
    if (item.contentType === 'anime') breakdown.anime += bytes
    if (item.contentType === 'animation') breakdown.animation += bytes
  }

  return breakdown
}

const getDerivedUsedBytes = (breakdown) => (
  Object.values(breakdown).reduce((total, value) => total + toByteCount(value), 0)
)

const resolveEventItem = (items, payload = {}) => {
  const explicitId = String(payload.id || '').trim()
  if (explicitId) {
    return (Array.isArray(items) ? items : []).find((item) => item.id === explicitId) || null
  }

  return getDownloadItemByIdentity(items, {
    contentId: payload.contentId ?? payload.content_id,
    contentType: payload.contentType ?? payload.content_type,
    season: payload.season,
    episode: payload.episode,
  })
}

const useDownloadStore = create(persist((set, get) => ({
  items: [],
  preferredQuality: 'high',
  maxConcurrent: 2,
  storage: {
    totalBytes: 0,
    freeBytes: null,
    usedBytes: null,
    breakdown: null,
  },

  setPreferredQuality: (quality) => {
    const normalizedQuality = String(quality || 'high').trim().toLowerCase() || 'high'
    set({ preferredQuality: normalizedQuality })
  },

  setMaxConcurrent: (value) => {
    const normalized = Number(value)
    set({
      maxConcurrent: Number.isFinite(normalized) && normalized > 0
        ? Math.trunc(normalized)
        : 0,
    })
  },

  setStorageInfo: (info = {}) => {
    set((state) => ({
      storage: {
        totalBytes: toByteCount(info.totalBytes ?? info.total_bytes ?? state.storage.totalBytes ?? 0),
        freeBytes: info.freeBytes ?? info.free_bytes ?? state.storage.freeBytes ?? null,
        usedBytes: info.usedBytes ?? info.used_bytes ?? state.storage.usedBytes ?? null,
        breakdown: info.breakdown ?? state.storage.breakdown ?? null,
      },
    }))
  },

  hydrateCompletedDownloads: (payloads = []) => {
    const discoveredItems = Array.isArray(payloads) ? payloads : []
    if (discoveredItems.length === 0) return

    set((state) => {
      let nextItems = Array.isArray(state.items) ? [...state.items] : []

      for (const payload of discoveredItems) {
        const existing = getDownloadItemByIdentity(nextItems, payload)
          || getDownloadItemByFilePath(nextItems, payload.filePath ?? payload.file_path)
        if (existing && ACTIVE_STATUSES.has(existing.status)) {
          continue
        }

        nextItems = upsertItem(nextItems, {
          id: existing?.id ?? payload.id,
          ...payload,
          status: 'completed',
          progress: 100,
          speedBytesPerSec: 0,
          errorMessage: '',
        })
      }

      return { items: nextItems }
    })
  },

  upsertDownload: (payload = {}) => {
    set((state) => ({
      items: upsertItem(state.items, payload),
    }))
  },

  enqueueDownload: (payload = {}) => {
    const existing = getDownloadItemByIdentity(get().items, payload)
    if (existing?.status === 'completed') return existing.id

    const nextPayload = {
      ...payload,
      id: existing?.id,
      status: 'queued',
      progress: existing?.status === 'paused' ? existing.progress : 0,
      bytesDownloaded: existing?.status === 'paused' ? existing.bytesDownloaded : 0,
      speedBytesPerSec: 0,
      startedAt: null,
      completedAt: null,
      errorMessage: '',
      queuedAt: nowIso(),
    }

    set((state) => ({
      items: upsertItem(state.items, nextPayload),
    }))

    return existing?.id || buildDownloadLookupKey(nextPayload)
  },

  enqueueSeasonDownloads: ({
    contentId,
    contentType,
    title,
    animeAltTitle = null,
    animeSearchTitles = [],
    anilistId = null,
    canonicalAnilistId = null,
    detailMediaType = null,
    providerAnimeId = null,
    providerMatchedTitle = null,
    poster = null,
    season = 1,
    episodes = [],
    quality = 'high',
  } = {}) => {
    const nextItems = Array.isArray(episodes) ? episodes : []
    const ids = []

    for (const episodeItem of nextItems) {
      const episodeNumber = toNullableInteger(episodeItem?.episode ?? episodeItem?.episodeNumber)
      if (!episodeNumber) continue

      ids.push(get().enqueueDownload({
        contentId,
        contentType,
        title,
        animeAltTitle,
        animeSearchTitles,
        anilistId,
        canonicalAnilistId,
        detailMediaType,
        providerAnimeId,
        providerMatchedTitle,
        poster,
        season,
        episode: episodeNumber,
        episodeTitle: episodeItem?.episodeTitle ?? episodeItem?.title ?? null,
        quality,
      }))
    }

    return ids.filter(Boolean)
  },

  updateDownload: (id, patch = {}) => {
    const normalizedId = String(id || '').trim()
    if (!normalizedId) return

    set((state) => ({
      items: state.items.map((item) => (
        item.id === normalizedId
          ? normalizeDownloadItem({ ...item, ...patch, id: normalizedId }, item)
          : item
      )),
    }))
  },

  removeDownload: (id) => {
    const normalizedId = String(id || '').trim()
    if (!normalizedId) return

    set((state) => ({
      items: state.items.filter((item) => item.id !== normalizedId),
    }))
  },

  pauseDownload: (id) => {
    get().updateDownload(id, {
      status: 'paused',
      speedBytesPerSec: 0,
    })
  },

  resumeDownload: (id) => {
    const existing = get().items.find((item) => item.id === id)
    const shouldRestart = existing?.resumeSupported === false || existing?.streamType === 'hls'

    get().updateDownload(id, {
      status: 'queued',
      progress: shouldRestart ? 0 : existing?.progress,
      bytesDownloaded: shouldRestart ? 0 : existing?.bytesDownloaded,
      speedBytesPerSec: 0,
      errorMessage: '',
      queuedAt: nowIso(),
    })
  },

  cancelDownload: (id) => {
    get().removeDownload(id)
  },

  deleteDownload: (id) => {
    get().removeDownload(id)
  },

  applyProgressEvent: (payload = {}) => {
    const existing = resolveEventItem(get().items, payload)
    const id = String(payload.id || existing?.id || '').trim()
    if (!id) return

    get().updateDownload(id, {
      status: payload.status || 'downloading',
      progress: payload.progress,
      bytesDownloaded: payload.bytesDownloaded ?? payload.bytes_downloaded,
      totalBytes: payload.totalBytes ?? payload.total_bytes,
      speedBytesPerSec: payload.speedBytesPerSec ?? payload.speed_bytes_per_sec,
      streamType: payload.streamType ?? payload.stream_type,
      resolvedQuality: payload.resolvedQuality ?? payload.resolved_quality,
      resumeSupported: payload.resumeSupported ?? payload.resume_supported,
      startedAt: existing?.startedAt || nowIso(),
      errorMessage: '',
    })
  },

  applyStatusEvent: (payload = {}) => {
    const existing = resolveEventItem(get().items, payload)
    const status = String(payload.status || '').trim().toLowerCase()
    const id = String(payload.id || existing?.id || '').trim()

    if (!id) return
    if (status === 'cancelled') {
      get().removeDownload(id)
      return
    }

    get().updateDownload(id, {
      status: status || existing?.status || 'queued',
      streamType: payload.streamType ?? payload.stream_type ?? existing?.streamType ?? null,
      resumeSupported: payload.resumeSupported ?? payload.resume_supported ?? existing?.resumeSupported ?? null,
      errorMessage: payload.errorMessage ?? payload.error_message ?? existing?.errorMessage ?? '',
      startedAt: payload.startedAt ?? payload.started_at ?? existing?.startedAt,
      completedAt: payload.completedAt ?? payload.completed_at ?? existing?.completedAt,
    })
  },

  applyCompletedEvent: (payload = {}) => {
    const existing = resolveEventItem(get().items, payload)
    const id = String(payload.id || existing?.id || '').trim()
    if (!id) return

    get().updateDownload(id, {
      status: 'completed',
      progress: 100,
      bytesDownloaded: payload.bytesDownloaded ?? payload.bytes_downloaded ?? existing?.totalBytes ?? existing?.bytesDownloaded,
      totalBytes: payload.totalBytes ?? payload.total_bytes ?? existing?.totalBytes ?? existing?.bytesDownloaded,
      speedBytesPerSec: 0,
      streamType: payload.streamType ?? payload.stream_type ?? existing?.streamType ?? null,
      resolvedQuality: payload.resolvedQuality ?? payload.resolved_quality ?? existing?.resolvedQuality ?? null,
      resumeSupported: payload.resumeSupported ?? payload.resume_supported ?? existing?.resumeSupported ?? null,
      filePath: payload.filePath ?? payload.file_path ?? existing?.filePath ?? null,
      subtitleFilePath: payload.subtitleFilePath ?? payload.subtitle_file_path ?? existing?.subtitleFilePath ?? null,
      completedAt: payload.completedAt ?? payload.completed_at ?? nowIso(),
      errorMessage: '',
    })
  },

  applyFailedEvent: (payload = {}) => {
    const existing = resolveEventItem(get().items, payload)
    const id = String(payload.id || existing?.id || '').trim()
    if (!id) return

    get().updateDownload(id, {
      status: 'failed',
      speedBytesPerSec: 0,
      streamType: payload.streamType ?? payload.stream_type ?? existing?.streamType ?? null,
      resolvedQuality: payload.resolvedQuality ?? payload.resolved_quality ?? existing?.resolvedQuality ?? null,
      resumeSupported: payload.resumeSupported ?? payload.resume_supported ?? existing?.resumeSupported ?? null,
      errorMessage: payload.errorMessage ?? payload.error_message ?? 'Download failed',
    })
  },

  getActiveDownloads: () => {
    const items = get().items.filter((item) => ACTIVE_STATUSES.has(item.status))
    return sortByTimestampDesc(items, 'queuedAt')
  },

  getCompletedDownloads: () => {
    const items = get().items.filter((item) => item.status === 'completed')
    return sortByTimestampDesc(items, 'completedAt')
  },

  getDownloadStatus: ({
    contentId,
    contentType,
    season = null,
    episode = null,
  } = {}) => getDownloadStatusSnapshot(get().items, {
    contentId,
    contentType,
    season,
    episode,
  }),

  isDownloaded: ({
    contentId,
    contentType,
    season = null,
    episode = null,
  } = {}) => {
    const item = getDownloadItemByIdentity(get().items, {
      contentId,
      contentType,
      season,
      episode,
    })

    return Boolean(item?.status === 'completed' && item?.filePath)
  },

  getFilePath: ({
    contentId,
    contentType,
    season = null,
    episode = null,
  } = {}) => {
    const item = getDownloadItemByIdentity(get().items, {
      contentId,
      contentType,
      season,
      episode,
    })

    return item?.filePath || null
  },

  getStorageSummary: () => {
    const items = get().items
    const derivedBreakdown = getDerivedStorageBreakdown(items)
    const derivedUsedBytes = getDerivedUsedBytes(derivedBreakdown)
    const storage = get().storage || {}

    return {
      usedBytes: storage.usedBytes != null ? toByteCount(storage.usedBytes) : derivedUsedBytes,
      totalBytes: toByteCount(storage.totalBytes || 0),
      freeBytes: storage.freeBytes != null ? toByteCount(storage.freeBytes) : null,
      breakdown: storage.breakdown || derivedBreakdown,
    }
  },
}), {
  name: DOWNLOADS_STORAGE_KEY,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    items: state.items,
    preferredQuality: state.preferredQuality,
    maxConcurrent: state.maxConcurrent,
    storage: state.storage,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state || !Array.isArray(state.items)) return

    state.items = state.items.map((item) => (
      item?.status === 'downloading'
        ? {
          ...item,
          status: 'paused',
          speedBytesPerSec: 0,
        }
        : item
    ))
  },
}))

export default useDownloadStore
