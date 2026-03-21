import { invoke } from '@tauri-apps/api/core'
import { load } from 'cheerio'

import {
    ANIME_PROVIDER_IDS,
    ANIME_PROVIDER_LABELS,
    createAnimeEpisode,
    createAnimeSearchMatch,
    createAnimeStreamCandidate,
    buildAnimeStreamCandidateId,
    detectAnimeStreamType,
} from '../types'

const PROVIDER_ID = ANIME_PROVIDER_IDS.ANIMEPAHE
const PROVIDER_LABEL = ANIME_PROVIDER_LABELS[PROVIDER_ID]
const BASE_URL = 'https://animepahe.si'
const HOME_URL = `${BASE_URL}/`
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
}

const providerSessionByAnimeId = new Map()
let globalProviderSessionId = null
const RETRYABLE_SESSION_ERROR_PATTERNS = [
    'Resolver session window did not finish loading',
    'timeout',
    'channel closed',
]

function uniqueTitles(titles = []) {
    const seen = new Set()
    const output = []

    for (const value of titles.flat()) {
        const title = String(value || '').replace(/\s+/g, ' ').trim()
        if (!title) continue
        const key = title.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        output.push(title)
    }

    return output
}

function dedupeBy(items = [], getKey) {
    const seen = new Set()
    const output = []

    for (const item of items) {
        const key = getKey(item)
        if (!key || seen.has(key)) continue
        seen.add(key)
        output.push(item)
    }

    return output
}

function buildSearchUrl(query = '') {
    return `${BASE_URL}/api?m=search&q=${encodeURIComponent(String(query || '').trim())}`
}

function buildAnimePageUrl(animeId = '') {
    return `${BASE_URL}/anime/${encodeURIComponent(String(animeId || '').trim())}`
}

function buildReleasesUrl(releaseId = '', page = 1) {
    return `${BASE_URL}/api?m=release&id=${encodeURIComponent(String(releaseId || '').trim())}&sort=episode_asc&page=${Number(page) || 1}`
}

function buildPlayPageUrl(animeId = '', episodeSession = '') {
    return `${BASE_URL}/play/${encodeURIComponent(String(animeId || '').trim())}/${encodeURIComponent(String(episodeSession || '').trim())}`
}

function resolveProviderSession(animeId = '', preferredSessionId = null) {
    if (preferredSessionId) return preferredSessionId

    const cacheKey = String(animeId || '').trim().toLowerCase()
    if (cacheKey && providerSessionByAnimeId.has(cacheKey)) {
        return providerSessionByAnimeId.get(cacheKey)
    }

    return globalProviderSessionId || null
}

function rememberProviderSession(animeId = '', sessionId = null) {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return null

    globalProviderSessionId = normalizedSessionId

    const cacheKey = String(animeId || '').trim().toLowerCase()
    if (cacheKey) {
        providerSessionByAnimeId.set(cacheKey, normalizedSessionId)
    }

    return normalizedSessionId
}

function clearProviderSession(animeId = '') {
    const cacheKey = String(animeId || '').trim().toLowerCase()
    if (cacheKey) {
        providerSessionByAnimeId.delete(cacheKey)
    }

    if (!cacheKey || providerSessionByAnimeId.size === 0) {
        globalProviderSessionId = null
    }
}

function isRetryableSessionError(error) {
    const message = error instanceof Error ? error.message : String(error || '')
    return RETRYABLE_SESSION_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

async function fetchProviderTextWithSession(
    url,
    headers = {},
    method = 'GET',
    body = null,
    animeId = '',
    preferredSessionId = null
) {
    let lastError = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const useFreshSession = attempt > 0
        const sessionId = useFreshSession
            ? null
            : resolveProviderSession(animeId, preferredSessionId)

        try {
            if (useFreshSession) {
                clearProviderSession(animeId)
            }

            const result = await invoke('fetch_anime_text_with_session', {
                url,
                headers: {
                    ...BROWSER_HEADERS,
                    ...headers,
                },
                method,
                body,
                sessionId,
            })

            const text = typeof result?.text === 'string' ? result.text : ''
            const nextSessionId = rememberProviderSession(
                animeId,
                result?.sessionId || sessionId || null
            )

            return {
                text,
                sessionId: nextSessionId,
            }
        } catch (error) {
            lastError = error

            if (!isRetryableSessionError(error) || attempt >= 2) {
                throw error
            }

            console.warn(`[animeAddons/${PROVIDER_ID}] session fetch retry`, {
                animeId,
                url,
                attempt: attempt + 1,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    throw lastError || new Error('AnimePahe session fetch failed')
}

async function fetchProviderTextWithOptionalPageFallback(
    url,
    headers = {},
    method = 'GET',
    body = null,
    animeId = '',
    preferredSessionId = null
) {
    try {
        return await fetchProviderTextWithSession(
            url,
            headers,
            method,
            body,
            animeId,
            preferredSessionId
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('HTTP 404')) {
            throw error
        }

        return {
            text: '',
            sessionId: resolveProviderSession(animeId, preferredSessionId),
        }
    }
}

async function fetchIsolatedTextWithSession(
    url,
    headers = {},
    method = 'GET',
    body = null
) {
    const result = await invoke('fetch_anime_text_with_session', {
        url,
        headers: {
            ...BROWSER_HEADERS,
            ...headers,
        },
        method,
        body,
        sessionId: null,
    })

    return {
        text: typeof result?.text === 'string' ? result.text : '',
        sessionId: result?.sessionId || null,
    }
}

async function fetchProviderJsonWithSession(
    url,
    headers = {},
    animeId = '',
    preferredSessionId = null
) {
    const result = await fetchProviderTextWithSession(
        url,
        headers,
        'GET',
        null,
        animeId,
        preferredSessionId
    )

    return {
        payload: JSON.parse(result.text || '{}'),
        sessionId: result.sessionId,
    }
}

async function warmProviderSession(animeId = '', preferredSessionId = null) {
    const result = await fetchProviderTextWithSession(
        HOME_URL,
        { Referer: HOME_URL },
        'GET',
        null,
        animeId,
        preferredSessionId
    )

    return result.sessionId
}

function normalizeSearchItem(item = {}) {
    const animeId = String(item?.session || item?.slug || '').trim()
    const releaseId = String(item?.id || item?.anime_id || '').trim()
    const title = String(item?.title || item?.name || '').replace(/\s+/g, ' ').trim()
    const image = String(item?.poster || item?.image || '').trim()

    if (!animeId || !title) return null

    return createAnimeSearchMatch({
        providerId: PROVIDER_ID,
        animeId,
        title,
        matchedTitle: title,
        score: 0,
        raw: {
            ...item,
            image,
            releaseId,
        },
    })
}

function extractReleaseId(html = '', fallbackAnimeId = '') {
    const $ = load(String(html || ''))

    const metaId = String($('meta[name="id"]').attr('content') || '').trim()
    if (metaId) return metaId

    const ogUrl = String($('meta[property="og:url"]').attr('content') || '').trim()
    if (ogUrl) {
        const slug = ogUrl.split('/').filter(Boolean).pop()
        if (slug) return slug
    }

    return String(fallbackAnimeId || '').trim()
}

function parseAnimeInfoHtml(html = '', fallbackAnimeId = '') {
    const $ = load(String(html || ''))

    return {
        animeId: String(fallbackAnimeId || '').trim(),
        releaseId: extractReleaseId(html, fallbackAnimeId),
        title:
            $('div.title-wrapper > h1 > span').first().text().replace(/\s+/g, ' ').trim() ||
            $('title').text().replace(/\s+/g, ' ').trim() ||
            String(fallbackAnimeId || '').trim(),
        image:
            String($('.poster-wrapper .anime-poster img').attr('data-src') || '').trim() ||
            String($('.poster-wrapper .anime-poster img').attr('src') || '').trim(),
    }
}

function normalizeEpisodeItem(item = {}, animeId = '') {
    const episodeSession = String(item?.session || item?.episode_session || '').trim()
    const episodeNumber = Number(item?.episode || item?.number || 0)

    if (!episodeSession || !episodeNumber) return null

    return createAnimeEpisode({
        providerId: PROVIDER_ID,
        animeId,
        episodeId: episodeSession,
        number: episodeNumber,
        title: String(item?.title || `Episode ${episodeNumber}`).replace(/\s+/g, ' ').trim(),
        raw: item,
    })
}

function normalizeEpisodeSequence(items = [], animeId = '') {
    const sortedItems = [...items].sort((a, b) => {
        const left = Number(a?.episode || a?.number || 0)
        const right = Number(b?.episode || b?.number || 0)
        return left - right
    })

    const episodeNumbers = sortedItems
        .map((item) => Number(item?.episode || item?.number || 0))
        .filter((value) => Number.isFinite(value) && value > 0)

    const minEpisode = episodeNumbers.length ? Math.min(...episodeNumbers) : 0
    const maxEpisode = episodeNumbers.length ? Math.max(...episodeNumbers) : 0
    const isContiguousOffsetRange =
        episodeNumbers.length > 0 &&
        minEpisode > 1 &&
        maxEpisode - minEpisode + 1 === sortedItems.length

    return sortedItems
        .map((item, index) => {
            const normalized = normalizeEpisodeItem(item, animeId)
            if (!normalized) return null

            if (!isContiguousOffsetRange) {
                return normalized
            }

            return {
                ...normalized,
                number: index + 1,
                title: normalized.title || `Episode ${index + 1}`,
                raw: {
                    ...normalized.raw,
                    absoluteEpisodeNumber: Number(item?.episode || item?.number || 0),
                    normalizedEpisodeNumber: index + 1,
                },
            }
        })
        .filter(Boolean)
}

async function fetchAllEpisodes(animeId = '', releaseId = '', preferredSessionId = null) {
    const requestHeaders = {
        Referer: buildAnimePageUrl(animeId),
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
    }

    const firstPage = await fetchProviderJsonWithSession(
        buildReleasesUrl(releaseId || animeId, 1),
        requestHeaders,
        animeId,
        preferredSessionId
    )

    let sessionId = firstPage.sessionId
    const items = Array.isArray(firstPage.payload?.data) ? firstPage.payload.data : []
    const lastPage = Number(firstPage.payload?.last_page || 1) || 1

    for (let page = 2; page <= lastPage; page += 1) {
        const nextPage = await fetchProviderJsonWithSession(
            buildReleasesUrl(releaseId || animeId, page),
            requestHeaders,
            animeId,
            sessionId
        )
        sessionId = nextPage.sessionId || sessionId
        if (Array.isArray(nextPage.payload?.data)) {
            items.push(...nextPage.payload.data)
        }
    }

    return {
        episodes: normalizeEpisodeSequence(items, animeId),
        sessionId,
    }
}

function parseResolutionButtons(html = '') {
    const $ = load(String(html || ''))
    const resolutions = []

    $('#resolutionMenu button').each((_, element) => {
        const button = $(element)
        const embedUrl = String(button.attr('data-src') || '').trim()
        if (!embedUrl) return

        resolutions.push({
            embedUrl,
            resolution: Number(button.attr('data-resolution') || 0) || 0,
            resolutionLabel: String(button.attr('data-resolution') || '').trim(),
            fanSub: String(button.attr('data-fansub') || '').trim(),
            isDub: String(button.attr('data-audio') || '').trim().toLowerCase() === 'eng',
        })
    })

    return dedupeBy(resolutions, (item) => `${item.embedUrl}::${item.resolutionLabel}::${item.fanSub}::${item.isDub}`)
}

function extractDirectMediaUrls(html = '') {
    return dedupeBy(
        String(html || '')
            .replace(/\\\//g, '/')
            .match(/https?:\/\/[^"'`\s<>]+(?:\.m3u8|\.mp4)[^"'`\s<>]*/gi) || [],
        (url) => url
    )
}

function extractHostname(value = '') {
    try {
        return new URL(String(value || '').trim()).hostname || ''
    } catch {
        return ''
    }
}

function buildAnimepaheMp4Url(m3u8Url = '', embedUrl = '') {
    const streamUrl = String(m3u8Url || '').trim()
    if (!streamUrl || !streamUrl.includes('/stream/')) return ''

    try {
        const url = new URL(streamUrl)
        const embedHost = extractHostname(embedUrl)
        if (embedHost) {
            const streamHostParts = url.hostname.split('.')
            if (streamHostParts[0]?.startsWith('vault-')) {
                url.hostname = `${streamHostParts[0]}.${embedHost}`
            } else {
                url.hostname = embedHost
            }
        }

        url.pathname = url.pathname.replace('/stream/', '/mp4/')
        if (url.pathname.endsWith('/uwu.m3u8')) {
            url.pathname = url.pathname.replace('/uwu.m3u8', '')
        } else if (url.pathname.endsWith('.m3u8')) {
            url.pathname = url.pathname.replace(/\.m3u8$/i, '')
        }

        return url.toString()
    } catch {
        return ''
    }
}

async function tryDirectHtmlResolution(embedUrl = '', animeId = '', preferredSessionId = null, referer = '') {
    try {
        const result = await fetchIsolatedTextWithSession(
            embedUrl,
            {
                Referer: referer || BASE_URL,
            },
            'GET',
            null
        )

        const directUrls = extractDirectMediaUrls(result.text)
        if (!directUrls.length) {
            return {
                playableUrl: '',
                streamType: '',
                sessionId: result.sessionId,
                subtitles: [],
                headers: {},
            }
        }

        const playableUrl = String(directUrls[0] || '').trim()
        return {
            playableUrl,
            streamType: detectAnimeStreamType(playableUrl),
            sessionId: result.sessionId,
            subtitles: [],
            headers: {
                Referer: embedUrl,
            },
        }
    } catch (error) {
        console.warn(`[animeAddons/${PROVIDER_ID}] direct html resolution failed`, {
            embedUrl,
            error: error instanceof Error ? error.message : String(error),
        })
        return {
            playableUrl: '',
            streamType: '',
            sessionId: preferredSessionId || null,
            subtitles: [],
            headers: {},
        }
    }
}

async function tryDynamicEmbedCapture(embedUrl = '', sessionId = null) {
    const payload = await invoke('resolve_embed_stream', {
        payload: {
            providerId: PROVIDER_ID,
            embedUrl,
        },
    })

    return {
        playableUrl: String(payload?.streamUrl || '').trim(),
        streamType: String(payload?.streamType || '').trim(),
        headers: payload?.headers && typeof payload.headers === 'object' ? payload.headers : {},
        subtitles: Array.isArray(payload?.subtitles) ? payload.subtitles : [],
        sessionId: payload?.sessionId || sessionId || null,
    }
}

async function resolveAnimepaheEmbed(embedUrl = '', animeId = '', sessionId = null, playPageUrl = '') {
    const directResult = await tryDirectHtmlResolution(
        embedUrl,
        animeId,
        null,
        playPageUrl || buildAnimePageUrl(animeId)
    )

    if (directResult.playableUrl) {
        return directResult
    }

    try {
        return await tryDynamicEmbedCapture(embedUrl, directResult.sessionId || sessionId)
    } catch (error) {
        console.warn(`[animeAddons/${PROVIDER_ID}] dynamic capture failed`, {
            embedUrl,
            error: error instanceof Error ? error.message : String(error),
        })
        return {
            playableUrl: '',
            streamType: '',
            headers: {},
            subtitles: [],
            sessionId: directResult.sessionId || sessionId || null,
        }
    }
}

function scoreResolutionOption(option = {}) {
    let score = 0

    if (!option?.isDub) score += 20
    score += Number(option?.resolution || 0)

    return score
}

function shouldStopAfterAnimepaheCandidate(option = {}) {
    const resolution = Number(option?.resolution || 0)
    return resolution >= 720 || !Number.isFinite(resolution) || resolution === 0
}

const animepaheProvider = {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,

    async searchAnime({ titles = [] } = {}) {
        const searchTitles = uniqueTitles(titles)
        const matches = []
        let sessionId = await warmProviderSession('', null)

        for (const title of searchTitles) {
            try {
                console.warn(`[animeAddons/${PROVIDER_ID}] search start`, { title })

                const response = await fetchProviderJsonWithSession(
                    buildSearchUrl(title),
                    {
                        Referer: HOME_URL,
                        Accept: 'application/json, text/javascript, */*; q=0.01',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    '',
                    sessionId
                )
                sessionId = response.sessionId || sessionId

                const items = Array.isArray(response.payload?.data) ? response.payload.data : []
                for (const item of items) {
                    const normalized = normalizeSearchItem(item)
                    if (normalized) {
                        matches.push(normalized)
                    }
                }
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] search failed for "${title}"`, error)
            }
        }

        const deduped = dedupeBy(matches, (item) => item?.animeId)

        console.warn(`[animeAddons/${PROVIDER_ID}] search done`, {
            resultCount: deduped.length,
        })

        return deduped
    },

    async getEpisodes({ animeId } = {}) {
        if (!animeId) return []

        try {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes start`, { animeId })

            let sessionId = await warmProviderSession(animeId, null)
            let animeInfo = {
                animeId,
                releaseId: '',
                title: animeId,
                image: '',
            }

            try {
                const animePage = await fetchProviderTextWithOptionalPageFallback(
                    buildAnimePageUrl(animeId),
                    { Referer: HOME_URL },
                    'GET',
                    null,
                    animeId,
                    sessionId
                )
                sessionId = animePage.sessionId || sessionId
                animeInfo = parseAnimeInfoHtml(animePage.text, animeId)
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] anime page fetch failed during getEpisodes`, {
                    animeId,
                    error: error instanceof Error ? error.message : String(error),
                })
            }

            const releases = await fetchAllEpisodes(
                animeId,
                animeInfo.releaseId || animeId,
                sessionId
            )

            rememberProviderSession(animeId, releases.sessionId || sessionId)

            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes done`, {
                animeId,
                episodeCount: releases.episodes.length,
            })

            return releases.episodes
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes failed`, error)
            return []
        }
    },

    async buildProviderState({ match } = {}) {
        if (!match?.animeId) return null

        const sessionId = await warmProviderSession(match.animeId, null)
        let animeInfo = {
            animeId: match.animeId,
            releaseId: String(match.animeId || '').trim(),
            title: match.title || match.matchedTitle || match.animeId,
            image: String(match?.raw?.image || '').trim(),
        }
        let finalSessionId = sessionId

        const releases = await fetchAllEpisodes(
            match.animeId,
            animeInfo.releaseId || match.animeId,
            finalSessionId
        )

        if (!animeInfo.image || !animeInfo.title || animeInfo.title === match.animeId) {
            try {
                const animePage = await fetchProviderTextWithOptionalPageFallback(
                    buildAnimePageUrl(match.animeId),
                    { Referer: HOME_URL },
                    'GET',
                    null,
                    match.animeId,
                    finalSessionId
                )
                finalSessionId = animePage.sessionId || finalSessionId
                if (animePage.text) {
                    const parsedAnimeInfo = parseAnimeInfoHtml(animePage.text, match.animeId)
                    animeInfo = {
                        ...animeInfo,
                        ...parsedAnimeInfo,
                        releaseId: parsedAnimeInfo.releaseId || animeInfo.releaseId,
                        title: parsedAnimeInfo.title || animeInfo.title,
                        image: parsedAnimeInfo.image || animeInfo.image,
                    }
                }
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] anime page fetch failed during buildProviderState`, {
                    animeId: match.animeId,
                    fallbackReleaseId: match.animeId,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }

        finalSessionId = rememberProviderSession(
            match.animeId,
            releases.sessionId || finalSessionId
        )

        return {
            providerId: PROVIDER_ID,
            providerLabel: PROVIDER_LABEL,
            animeId: match.animeId,
            title: animeInfo.title || match.title || match.matchedTitle || '',
            image: animeInfo.image || String(match?.raw?.image || '').trim(),
            matchedTitle: match.matchedTitle || match.title || animeInfo.title || '',
            episodes: releases.episodes,
            streamCandidatesByEpisode: {},
            meta: {
                match,
                sessionId: finalSessionId,
                releaseId: animeInfo.releaseId || match.animeId,
            },
        }
    },

    async getStreams({ animeId = '', episodeId = '' } = {}) {
        const episodeSession = String(episodeId || '').trim()
        if (!animeId || !episodeSession) return []

        try {
            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams start`, {
                animeId,
                episodeId: episodeSession,
            })

            let sessionId = await warmProviderSession(animeId, resolveProviderSession(animeId))
            const playPageUrl = buildPlayPageUrl(animeId, episodeSession)
            const playPage = await fetchProviderTextWithSession(
                playPageUrl,
                { Referer: buildAnimePageUrl(animeId) },
                'GET',
                null,
                animeId,
                sessionId
            )
            sessionId = playPage.sessionId || sessionId

            const resolutionOptions = parseResolutionButtons(playPage.text)
                .sort((a, b) => scoreResolutionOption(b) - scoreResolutionOption(a))

            console.warn(`[animeAddons/${PROVIDER_ID}] play page parsed`, {
                animeId,
                episodeId: episodeSession,
                resolutionCount: resolutionOptions.length,
            })

            const candidates = []

            for (const option of resolutionOptions) {
                const resolved = await resolveAnimepaheEmbed(
                    option.embedUrl,
                    animeId,
                    sessionId,
                    playPageUrl
                )
                sessionId = resolved.sessionId || sessionId

                const playableUrl = String(resolved.playableUrl || '').trim()
                if (!playableUrl) continue

                const streamType = detectAnimeStreamType(playableUrl, resolved.streamType || '')
                const quality = option.resolutionLabel
                    ? `${option.resolutionLabel}p${option.isDub ? ' Dub' : ''}${option.fanSub ? ` ${option.fanSub}` : ''}`
                    : `${option.isDub ? 'Dub' : 'Sub'}`

                const directMp4Url =
                    streamType === 'hls'
                        ? buildAnimepaheMp4Url(playableUrl, option.embedUrl)
                        : ''

                if (directMp4Url) {
                    candidates.push(createAnimeStreamCandidate({
                        id: buildAnimeStreamCandidateId({
                            providerId: PROVIDER_ID,
                            animeId,
                            episodeId: episodeSession,
                            url: directMp4Url,
                            quality: `${quality} Direct`,
                        }),
                        providerId: PROVIDER_ID,
                        providerLabel: PROVIDER_LABEL,
                        animeId,
                        episodeId: episodeSession,
                        url: directMp4Url,
                        streamType: 'mp4',
                        quality: `${quality} Direct`,
                        resolution: Number(option.resolution || 0),
                        headers: resolved.headers || {},
                        subtitles: Array.isArray(resolved.subtitles) ? resolved.subtitles : [],
                        streamSessionId: resolved.sessionId || null,
                        score: scoreResolutionOption(option) + 200,
                        flags: {
                            direct: true,
                            requiresHeaders: Boolean(resolved.headers && Object.keys(resolved.headers).length),
                            maybeUnstable: false,
                        },
                        raw: {
                            option,
                            embedUrl: option.embedUrl,
                            derivedFrom: playableUrl,
                            strategy: 'animepahe-m3u8-to-mp4',
                        },
                    }))
                }

                candidates.push(createAnimeStreamCandidate({
                    id: buildAnimeStreamCandidateId({
                        providerId: PROVIDER_ID,
                        animeId,
                        episodeId: episodeSession,
                        url: playableUrl,
                        quality,
                    }),
                    providerId: PROVIDER_ID,
                    providerLabel: PROVIDER_LABEL,
                    animeId,
                    episodeId: episodeSession,
                    url: playableUrl,
                    streamType,
                    quality,
                    resolution: Number(option.resolution || 0),
                    headers: resolved.headers || {},
                    subtitles: Array.isArray(resolved.subtitles) ? resolved.subtitles : [],
                    streamSessionId: resolved.sessionId || null,
                    score: scoreResolutionOption(option),
                    flags: {
                        direct: streamType === 'mp4',
                        requiresHeaders: Boolean(resolved.headers && Object.keys(resolved.headers).length),
                        maybeUnstable: streamType === 'hls',
                    },
                    raw: {
                        option,
                        embedUrl: option.embedUrl,
                    },
                }))

                if (candidates.length > 0 && shouldStopAfterAnimepaheCandidate(option)) {
                    console.warn(`[animeAddons/${PROVIDER_ID}] stopping after first playable resolution`, {
                        animeId,
                        episodeId: episodeSession,
                        resolution: Number(option.resolution || 0),
                        candidateCount: candidates.length,
                    })
                    break
                }
            }

            const deduped = dedupeBy(candidates, (item) => item?.url)

            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams done`, {
                animeId,
                episodeId: episodeSession,
                candidateCount: deduped.length,
            })

            rememberProviderSession(animeId, sessionId)
            return deduped
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams failed`, error)
            return []
        }
    },
}

export default animepaheProvider
