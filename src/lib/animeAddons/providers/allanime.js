import { invoke } from '@tauri-apps/api/core'

import {
    ANIME_PROVIDER_IDS,
    ANIME_PROVIDER_LABELS,
    buildAnimeStreamCandidateId,
    createAnimeEpisode,
    createAnimeProviderState,
    createAnimeSearchMatch,
    createAnimeStreamCandidate,
    createAnimeSubtitleTrack,
    detectAnimeStreamType,
} from '../types'

const PROVIDER_ID = ANIME_PROVIDER_IDS.ALLANIME
const PROVIDER_LABEL = ANIME_PROVIDER_LABELS[PROVIDER_ID]

const BASE_URL = 'https://api.allanime.day/api'
const REFERER = 'https://allmanga.to'
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0'

const ALLANIME_DECRYPT_MAP = {
    '79': 'A', '7a': 'B', '7b': 'C', '7c': 'D', '7d': 'E', '7e': 'F', '7f': 'G',
    '70': 'H', '71': 'I', '72': 'J', '73': 'K', '74': 'L', '75': 'M', '76': 'N',
    '77': 'O', '68': 'P', '69': 'Q', '6a': 'R', '6b': 'S', '6c': 'T', '6d': 'U',
    '6e': 'V', '6f': 'W', '60': 'X', '61': 'Y', '62': 'Z',
    '59': 'a', '5a': 'b', '5b': 'c', '5c': 'd', '5d': 'e', '5e': 'f', '5f': 'g',
    '50': 'h', '51': 'i', '52': 'j', '53': 'k', '54': 'l', '55': 'm', '56': 'n',
    '57': 'o', '48': 'p', '49': 'q', '4a': 'r', '4b': 's', '4c': 't', '4d': 'u',
    '4e': 'v', '4f': 'w', '40': 'x', '41': 'y', '42': 'z',
    '08': '0', '09': '1', '0a': '2', '0b': '3', '0c': '4',
    '0d': '5', '0e': '6', '0f': '7', '00': '8', '01': '9',
    '15': '-', '16': '.', '67': '_', '46': '~', '02': ':', '17': '/',
    '07': '?', '1b': '#', '63': '[', '65': ']', '78': '@', '19': '!',
    '1c': '$', '1e': '&', '10': '(', '11': ')', '12': '*', '13': '+',
    '14': ',', '03': ';', '05': '=', '1d': '%',
}

const SEARCH_GQL =
    'query( $search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType ) { shows( search: $search limit: $limit page: $page translationType: $translationType countryOrigin: $countryOrigin ) { edges { _id name availableEpisodes __typename } }}'

const EPISODES_GQL =
    'query ($showId: String!) { show( _id: $showId ) { _id availableEpisodesDetail }}'

const EPISODE_SOURCES_GQL =
    'query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode( showId: $showId translationType: $translationType episodeString: $episodeString ) { episodeString sourceUrls }}'

function buildGraphqlUrl(query, variables) {
    const url = new URL(BASE_URL)
    url.searchParams.set('variables', JSON.stringify(variables))
    url.searchParams.set('query', query)
    return url.toString()
}

async function fetchProviderText(url, headers = {}, method = 'GET', body = null) {
    console.info(`[animeAddons/${PROVIDER_ID}] fetch start`, { url, method })

    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        const timeoutPromise = new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error(`AllAnime fetch timeout: ${url}`)), 15000)
        })

        const fetchPromise = invoke('fetch_anime_text', {
            url,
            headers: {
                Referer: REFERER,
                'User-Agent': USER_AGENT,
                ...headers,
            },
            method,
            body,
        })

        const result = await Promise.race([fetchPromise, timeoutPromise])
        console.info(`[animeAddons/${PROVIDER_ID}] fetch done`, { url })
        return result
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)

    try {
        const response = await fetch(url, {
            method,
            headers: {
                Referer: REFERER,
                'User-Agent': USER_AGENT,
                ...headers,
            },
            body: body ?? undefined,
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`AllAnime fetch failed with status ${response.status}`)
        }

        const text = await response.text()
        console.info(`[animeAddons/${PROVIDER_ID}] fetch done`, { url })
        return text
    } finally {
        window.clearTimeout(timer)
    }
}

async function fetchProviderJson(url, headers = {}) {
    const text = await fetchProviderText(url, headers)
    return JSON.parse(text)
}

function dedupeBy(items, getKey) {
    const seen = new Set()
    const output = []

    for (const item of items || []) {
        const key = getKey(item)
        if (!key || seen.has(key)) continue
        seen.add(key)
        output.push(item)
    }

    return output
}

function normalizeSearchItem(item = {}) {
    const animeId = String(item?._id || '').trim()
    if (!animeId) return null

    const availableEpisodes = item?.availableEpisodes
    let episodeCount = 0

    if (typeof availableEpisodes === 'number') {
        episodeCount = availableEpisodes
    } else if (availableEpisodes && typeof availableEpisodes === 'object') {
        episodeCount = Number(
            availableEpisodes.sub ??
            availableEpisodes.dub ??
            availableEpisodes.raw ??
            0
        )
    }

    return createAnimeSearchMatch({
        providerId: PROVIDER_ID,
        animeId,
        title: String(item?.name || 'Unknown').trim(),
        matchedTitle: String(item?.name || 'Unknown').trim(),
        score: Math.min(Math.max(Number(episodeCount) || 0, 0), 300) / 10,
        raw: item,
    })
}

function normalizeEpisodeNumber(value) {
    const text = String(value ?? '').trim()
    if (!text) return 0
    const numeric = Number(text)
    if (Number.isFinite(numeric)) return numeric

    const match = text.match(/(\d+(\.\d+)?)/)
    return match ? Number(match[1]) : 0
}

function normalizeEpisodeItem(episodeNumber, animeId) {
    const number = normalizeEpisodeNumber(episodeNumber)
    if (!number) return null

    return createAnimeEpisode({
        providerId: PROVIDER_ID,
        animeId,
        episodeId: `${animeId}::${String(episodeNumber)}`,
        number,
        title: `Episode ${String(episodeNumber)}`,
        raw: {
            episodeString: String(episodeNumber),
        },
    })
}

function normalizeSubtitleTrack(track = {}) {
    const url = String(track?.url || track?.file || '').trim()
    if (!url) return null

    const lang = String(track?.lang || track?.label || track?.language || 'Unknown').trim()

    return createAnimeSubtitleTrack({
        lang,
        url,
        kind: 'captions',
        label: lang,
        raw: track,
    })
}

function parseJsonLikeBody(text) {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function normalizeEscapedUrl(url = '') {
    return String(url || '')
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .trim()
}

function decryptAllAnimeSource(input = '') {
    const value = String(input || '').trim()
    if (!value) return ''

    let output = ''
    for (let i = 0; i < value.length; i += 2) {
        if (i + 1 < value.length) {
            const pair = value.slice(i, i + 2)
            output += ALLANIME_DECRYPT_MAP[pair] || pair
        } else {
            output += value[i]
        }
    }

    return output.replaceAll('/clock', '/clock.json')
}

function maybeDecryptSourcePath(sourceUrl = '') {
    const value = String(sourceUrl || '').trim()
    if (!value) return ''

    if (value.startsWith('/')) return value
    if (value.startsWith('http://') || value.startsWith('https://')) return value

    if (value.startsWith('--')) {
        return decryptAllAnimeSource(value.slice(2))
    }

    return value
}

async function parseM3u8Variants(url, referer) {
    const headers = referer ? { Referer: referer } : {}
    const playlist = await fetchProviderText(url, headers)
    const lines = String(playlist || '').split(/\r?\n/)
    const results = []
    let foundStream = false

    for (let i = 0; i < lines.length; i += 1) {
        const line = String(lines[i] || '').trim()
        if (!line.startsWith('#EXT-X-STREAM-INF')) continue

        let quality = 'auto'
        const match = line.match(/RESOLUTION=(\d+x\d+)/i)
        if (match?.[1]) {
            quality = match[1]
        }

        const nextLine = String(lines[i + 1] || '').trim()
        if (!nextLine || nextLine.startsWith('#')) continue

        let streamUrl = nextLine
        if (!/^https?:\/\//i.test(streamUrl)) {
            const base = url.slice(0, url.lastIndexOf('/') + 1)
            streamUrl = `${base}${streamUrl}`
        }

        results.push({
            url: streamUrl,
            quality,
            type: 'hls',
            headers,
        })
        foundStream = true
    }

    if (!foundStream) {
        results.push({
            url,
            quality: 'auto',
            type: 'hls',
            headers,
        })
    }

    return results
}

function extractPlayableUrlsFromHtml(html = '', sourcePageUrl = '') {
    const results = []
    const text = String(html || '')

    const pushResult = (url, type = '') => {
        const normalized = normalizeEscapedUrl(url)
        if (!normalized) return
        results.push({
            url: normalized,
            quality: 'auto',
            type: type || detectAnimeStreamType(normalized, ''),
            headers: sourcePageUrl ? { Referer: sourcePageUrl } : {},
        })
    }

    const fileRegex = /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi
    for (const match of text.matchAll(fileRegex)) {
        pushResult(match[1])
    }

    const sourceRegex = /<source[^>]+src=["']([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi
    for (const match of text.matchAll(sourceRegex)) {
        pushResult(match[1])
    }

    const genericUrlRegex = /(https?:\/\/[^"'\\\s]+(?:\.m3u8|\.mp4)(?:\?[^"'\\\s]*)?)/gi
    for (const match of text.matchAll(genericUrlRegex)) {
        pushResult(match[1])
    }

    return dedupeBy(results, (item) => item?.url)
}

async function parseSourceResponseBody(responseBody, sourceName = '', sourcePageUrl = '') {
    const sources = []
    const text = String(responseBody || '')

    let m3u8Referer = ''
    const refererMatch = text.match(/"Referer":"([^"]*)"/)
    if (refererMatch?.[1]) {
        m3u8Referer = normalizeEscapedUrl(refererMatch[1])
    }

    const linkRegex = /"link":"([^"]*)".*?"resolutionStr":"([^"]*)"/g
    for (const match of text.matchAll(linkRegex)) {
        const url = normalizeEscapedUrl(match[1] || '')
        const quality = String(match[2] || sourceName || 'auto').trim()

        if (!url) continue

        if (url.includes('.m3u8')) {
            try {
                const variants = await parseM3u8Variants(url, m3u8Referer || sourcePageUrl || REFERER)
                sources.push(...variants)
            } catch {
                sources.push({
                    url,
                    quality,
                    type: 'hls',
                    headers: (m3u8Referer || sourcePageUrl) ? { Referer: m3u8Referer || sourcePageUrl } : {},
                })
            }
        } else {
            sources.push({
                url,
                quality,
                type: 'mp4',
                headers: sourcePageUrl ? { Referer: sourcePageUrl } : {},
            })
        }
    }

    const hlsRegex = /"hls","url":"([^"]*)".*?"hardsub_lang":"en-US"/g
    for (const match of text.matchAll(hlsRegex)) {
        const url = normalizeEscapedUrl(match[1] || '')
        if (!url) continue

        if (url.includes('master.m3u8')) {
            try {
                const variants = await parseM3u8Variants(url, m3u8Referer || sourcePageUrl || REFERER)
                sources.push(...variants)
            } catch {
                sources.push({
                    url,
                    quality: 'auto',
                    type: 'hls',
                    headers: (m3u8Referer || sourcePageUrl) ? { Referer: m3u8Referer || sourcePageUrl } : {},
                })
            }
        } else {
            sources.push({
                url,
                quality: 'auto',
                type: 'hls',
                headers: (m3u8Referer || sourcePageUrl) ? { Referer: m3u8Referer || sourcePageUrl } : {},
            })
        }
    }

    if (!sources.length) {
        const htmlSources = extractPlayableUrlsFromHtml(text, sourcePageUrl)

        for (const item of htmlSources) {
            if (item.url.includes('.m3u8')) {
                try {
                    const variants = await parseM3u8Variants(item.url, sourcePageUrl || REFERER)
                    sources.push(...variants)
                } catch {
                    sources.push(item)
                }
            } else {
                sources.push(item)
            }
        }
    }

    return dedupeBy(sources, (item) => item?.url)
}

async function processSourceItem(source) {
    const timeoutPromise = new Promise((resolve) => {
        window.setTimeout(() => resolve([]), 12000)
    })

    const workPromise = (async () => {
        try {
            const sourceUrl = source?.sourceUrl
            const sourceName = source?.sourceName || ''
            if (!sourceUrl) return []

            console.info(`[animeAddons/${PROVIDER_ID}] processSourceItem start`, {
                sourceName,
                sourceUrl,
            })

            const decryptedPath = maybeDecryptSourcePath(sourceUrl)
            if (!decryptedPath) return []

            const finalUrl = /^https?:\/\//i.test(decryptedPath)
                ? decryptedPath
                : `https://allanime.day${decryptedPath}`

            if (isBadAllAnimeCandidateUrl(finalUrl)) {
                return []
            }

            const responseBody = await fetchProviderText(finalUrl, {
                Referer: REFERER,
            })

            const parsed = await parseSourceResponseBody(responseBody, sourceName, finalUrl)

            console.info(`[animeAddons/${PROVIDER_ID}] processSourceItem done`, {
                sourceName,
                parsedCount: parsed.length,
            })

            return parsed
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] processSourceItem failed`, error)
            return []
        }
    })()

    return Promise.race([workPromise, timeoutPromise])
}

function isBadAllAnimeCandidateUrl(url = '') {
    const value = String(url || '').toLowerCase()

    return (
        !value ||
        value.includes('/clock.json') ||
        value.includes('apivtwo/clock') ||
        value.includes('fast4speed.rsvp') ||
        value.includes('streamlare') ||
        value.includes('ok.ru/videoembed/') ||
        value.includes('/embed-') ||
        value.includes('/embed/') ||
        value.includes('listsend.me') ||
        value.includes('streamwish.to') ||
        value.includes('streamwish.com')
    )
}

function getAllAnimeCandidatePriority(url = '', streamType = '', quality = '') {
    const value = String(url || '').toLowerCase()
    const qualityText = String(quality || '').toLowerCase()

    let score = 0

    if (streamType === 'mp4') score += 60
    if (streamType === 'hls') score += 40

    if (value.endsWith('.mp4')) score += 40
    if (value.includes('.m3u8')) score += 25

    if (value.includes('gogo-stream.com')) score += 20
    if (value.includes('mp4upload.com')) score += 10

    if (qualityText.includes('1080')) score += 10
    else if (qualityText.includes('720')) score += 7
    else if (qualityText.includes('480')) score += 4

    if (isBadAllAnimeCandidateUrl(value)) score -= 1000

    return score
}

function buildStreamCandidates(rawSources, { animeId, episodeId }) {
    const output = []

    for (const raw of rawSources || []) {
        const url = String(raw?.url || '').trim()
        if (!url) continue
        if (isBadAllAnimeCandidateUrl(url)) continue

        const quality = String(raw?.quality || 'auto').trim()
        const streamType = detectAnimeStreamType(url, raw?.type || '')
        const resolutionMatch = quality.match(/(\d{3,4})/)
        const resolution = resolutionMatch ? Number(resolutionMatch[1]) : 0
        const headers = raw?.headers && typeof raw.headers === 'object' ? raw.headers : {}

        output.push(
            createAnimeStreamCandidate({
                id: buildAnimeStreamCandidateId({
                    providerId: PROVIDER_ID,
                    animeId,
                    episodeId,
                    url,
                    quality,
                }),
                providerId: PROVIDER_ID,
                providerLabel: PROVIDER_LABEL,
                animeId,
                episodeId,
                url,
                streamType,
                quality,
                resolution,
                headers,
                subtitles: [],
                score: getAllAnimeCandidatePriority(url, streamType, quality),
                flags: {
                    direct: streamType === 'mp4',
                    requiresHeaders: Object.keys(headers).length > 0,
                    maybeUnstable: false,
                },
                raw,
            })
        )
    }

    return dedupeBy(output, (item) => item?.url).sort((a, b) => b.score - a.score)
}

export const allanimeProvider = {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,

    async searchAnime({ titles = [] } = {}) {
        const uniqueTitles = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))]
        const results = []

        for (const title of uniqueTitles) {
            console.info(`[animeAddons/${PROVIDER_ID}] search start`, { title })
            try {
                const variables = {
                    search: {
                        allowAdult: false,
                        allowUnknown: false,
                        query: title,
                    },
                    limit: 40,
                    page: 1,
                    translationType: 'sub',
                    countryOrigin: 'ALL',
                }

                const payload = await fetchProviderJson(
                    buildGraphqlUrl(SEARCH_GQL, variables),
                    { Referer: REFERER }
                )

                const edges = Array.isArray(payload?.data?.shows?.edges)
                    ? payload.data.shows.edges
                    : []

                for (const item of edges) {
                    const normalized = normalizeSearchItem(item)
                    if (normalized?.animeId) {
                        results.push(normalized)
                    }
                }
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] search failed for "${title}"`, error)
            }
        }
        console.info(`[animeAddons/${PROVIDER_ID}] search done`, { resultCount: results.length })

        return dedupeBy(results, (item) => item.animeId)
    },

    async getEpisodes({ animeId } = {}) {
        if (!animeId) return []
        console.info(`[animeAddons/${PROVIDER_ID}] getEpisodes start`, { animeId })

        try {
            const variables = { showId: animeId }
            const payload = await fetchProviderJson(
                buildGraphqlUrl(EPISODES_GQL, variables),
                { Referer: REFERER }
            )

            const detail = payload?.data?.show?.availableEpisodesDetail
            if (!detail || typeof detail !== 'object') return []

            const episodes = new Set()
            if (Array.isArray(detail.sub)) detail.sub.forEach((ep) => episodes.add(String(ep)))
            if (Array.isArray(detail.dub)) detail.dub.forEach((ep) => episodes.add(String(ep)))
            if (Array.isArray(detail.raw)) detail.raw.forEach((ep) => episodes.add(String(ep)))

            const normalizedEpisodes = [...episodes]
                .map((ep) => normalizeEpisodeItem(ep, animeId))
                .filter(Boolean)
                .sort((a, b) => Number(a.number) - Number(b.number))

            console.info(`[animeAddons/${PROVIDER_ID}] getEpisodes done`, {
                animeId,
                episodeCount: normalizedEpisodes.length,
            })

            return normalizedEpisodes
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes failed`, error)
            return []
        }
    },

    async getStreams({ animeId = '', episodeId } = {}) {
        if (!animeId || !episodeId) return []
        console.info(`[animeAddons/${PROVIDER_ID}] getStreams start`, { animeId, episodeId })

        try {
            const episodeString = String(episodeId).split('::')[1] || ''
            if (!episodeString) return []

            const variables = {
                showId: animeId,
                translationType: 'sub',
                episodeString,
            }

            const payload = await fetchProviderJson(
                buildGraphqlUrl(EPISODE_SOURCES_GQL, variables),
                { Referer: REFERER }
            )

            const sourceUrls = Array.isArray(payload?.data?.episode?.sourceUrls)
                ? payload.data.episode.sourceUrls
                : []

            if (!sourceUrls.length) return []

            const processed = await Promise.all(sourceUrls.map((source) => processSourceItem(source)))
            const rawSources = processed.flat()
            const candidates = buildStreamCandidates(rawSources, { animeId, episodeId })

            console.info(`[animeAddons/${PROVIDER_ID}] getStreams done`, {
                animeId,
                episodeId,
                sourceCount: rawSources.length,
                candidateCount: candidates.length,
            })

            return candidates
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams failed`, error)
            return []
        }
    },

    async buildProviderState({ match } = {}) {
        if (!match?.animeId) return null

        const episodes = await this.getEpisodes({ animeId: match.animeId })

        return createAnimeProviderState({
            providerId: PROVIDER_ID,
            animeId: match.animeId,
            matchedTitle: match.matchedTitle || match.title || '',
            anime: match,
            episodes,
            streamCandidatesByEpisode: {},
        })
    },
}

export default allanimeProvider