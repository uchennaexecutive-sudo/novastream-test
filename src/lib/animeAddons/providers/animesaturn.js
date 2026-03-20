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
import {
    ANIWATCH_BASE_URL,
} from '../../consumet'
import { load } from 'cheerio'
import { invoke } from '@tauri-apps/api/core'

const PROVIDER_ID = ANIME_PROVIDER_IDS.ANIMESATURN
const PROVIDER_LABEL = ANIME_PROVIDER_LABELS[PROVIDER_ID]
function buildProviderSearchUrl(query) {
    const encoded = encodeURIComponent(String(query || '').trim())
    return `${ANIWATCH_BASE_URL}/anime/${PROVIDER_ID}/${encoded}`
}

async function fetchProviderSearchResults(query) {
    const response = await fetch(buildProviderSearchUrl(query))
    if (!response.ok) {
        throw new Error(`AnimeSaturn search failed with status ${response.status}`)
    }

    const payload = await response.json()
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.results)) return payload.results
    if (Array.isArray(payload?.data)) return payload.data
    return []
}
function buildProviderInfoUrl(animeId) {
    return `https://www.animesaturn.cx/anime/${animeId}`
}

async function fetchProviderAnimeInfo(animeId) {
    const url = buildProviderInfoUrl(animeId)

    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        return invoke('fetch_anime_text', {
            url,
            headers: {
                Referer: 'https://www.animesaturn.cx/',
            },
        })
    }

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
        },
    })

    if (!response.ok) {
        throw new Error(`AnimeSaturn info failed with status ${response.status}`)
    }

    return response.text()
}

function buildProviderEpisodeUrl(episodeId) {
    return `https://www.animesaturn.cx/ep/${episodeId}`
}

async function fetchProviderHtml(url, headers = {}) {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        return invoke('fetch_anime_text', {
            url,
            headers,
        })
    }

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
    })

    if (!response.ok) {
        throw new Error(`AnimeSaturn fetch failed with status ${response.status}`)
    }

    return response.text()
}

function extractAbsoluteUrl(url = '') {
    const value = String(url || '').trim()
    if (!value) return ''
    if (value.startsWith('http://') || value.startsWith('https://')) return value
    if (value.startsWith('//')) return `https:${value}`
    if (value.startsWith('/')) return `https://www.animesaturn.cx${value}`
    return value
}

function parseAnimeSaturnSourcesFromWatchHtml(html, { episodeId = '', animeId = '' } = {}) {
    const $ = load(html)
    const output = {
        headers: {},
        subtitles: [],
        sources: [],
    }

    const pushSource = (rawUrl, quality = 'default') => {
        const url = extractAbsoluteUrl(rawUrl)
        if (!url) return
        if (!url.includes('.mp4') && !url.includes('.m3u8')) return
        if (output.sources.some((item) => item.url === url)) return

        output.sources.push({
            url,
            isM3U8: url.includes('.m3u8'),
            quality,
        })
    }

    $('video source').each((_, element) => {
        pushSource($(element).attr('src') || '', 'default')
    })

    const videoSrc = $('video#myvideo').attr('src')
    pushSource(videoSrc || '', 'default')

    $('script').each((_, element) => {
        const scriptText = $(element).text()

        if (scriptText.includes('jwplayer') || scriptText.includes('file:')) {
            const lines = scriptText.split('\n')
            for (const line of lines) {
                if (!line.includes('file:')) continue

                let url = line.split('file:')[1] || ''
                url = url.trim().replace(/['"]/g, '').replace(/,/g, '').trim()
                pushSource(url, 'default')
            }
        }

        const mp4Matches = scriptText.match(/https?:\/\/[^"'\\s]+\.mp4[^"'\\s]*/g) || []
        for (const url of mp4Matches) {
            pushSource(url, 'default')
        }

        const m3u8Matches = scriptText.match(/https?:\/\/[^"'\\s]+\.m3u8[^"'\\s]*/g) || []
        for (const url of m3u8Matches) {
            pushSource(url, 'default')
        }
    })

    const m3u8Source = output.sources.find((item) => item.isM3U8)
    if (m3u8Source && m3u8Source.url.includes('playlist.m3u8')) {
        output.subtitles.push({
            url: m3u8Source.url.replace('playlist.m3u8', 'subtitles.vtt'),
            lang: 'Italian',
        })
    }

    return {
        animeId,
        episodeId,
        headers: output.headers,
        subtitles: output.subtitles,
        sources: output.sources,
    }
}

async function fetchProviderEpisodeSources(episodeId, animeId = '') {
    const episodeUrl = buildProviderEpisodeUrl(episodeId)

    const episodeHtml = await fetchProviderHtml(episodeUrl, {
        Referer: 'https://www.animesaturn.cx/',
    })

    const $episode = load(episodeHtml)

    let watchUrl = $episode("a:contains('Guarda lo streaming')").attr('href')
    if (!watchUrl) {
        watchUrl = $episode("div:contains('Guarda lo streaming')").parent('a').attr('href')
    }
    if (!watchUrl) {
        watchUrl = $episode("a[href*='watch']").attr('href')
    }

    watchUrl = extractAbsoluteUrl(watchUrl || '')

    if (!watchUrl) {
        throw new Error('AnimeSaturn watch URL not found')
    }

    const watchHtml = await fetchProviderHtml(watchUrl, {
        Referer: episodeUrl,
    })

    const parsed = parseAnimeSaturnSourcesFromWatchHtml(watchHtml, {
        episodeId,
        animeId,
    })

    parsed.headers = {
        Referer: watchUrl,
        Origin: 'https://www.animesaturn.cx',
        'User-Agent': 'Mozilla/5.0',
    }

    if (!parsed.sources.length) {
        throw new Error('AnimeSaturn no video sources found')
    }

    return parsed
}

function parseProviderEpisodes(html, animeId) {
    const $ = load(html)
    const episodes = []

    $('.tab-pane.fade').each((_, element) => {
        $(element)
            .find('.bottone-ep')
            .each((__, episodeElement) => {
                const link = $(episodeElement).attr('href') || ''
                const rawText = $(episodeElement).text().trim()
                const episodeNumberText = rawText.replace('Episodio ', '').trim()
                const number = parseInt(episodeNumberText, 10)

                const parts = String(link).split('/').filter(Boolean)
                const episodeId = parts[parts.length - 1] || ''

                if (!episodeId || Number.isNaN(number)) return

                episodes.push(
                    createAnimeEpisode({
                        providerId: PROVIDER_ID,
                        animeId,
                        episodeId,
                        number,
                        title: `Episode ${number}`,
                        raw: {
                            link,
                            text: rawText,
                        },
                    })
                )
            })
    })

    return episodes.sort((a, b) => a.number - b.number)
}

function normalizeSearchItem(item = {}) {
    const animeId = item?.id ?? item?._id ?? item?.slug ?? item?.url ?? ''
    const title =
        item?.title?.english ||
        item?.title?.romaji ||
        item?.title?.native ||
        item?.title ||
        item?.name ||
        ''

    return createAnimeSearchMatch({
        providerId: PROVIDER_ID,
        animeId,
        title,
        matchedTitle: title,
        score: 0,
        raw: item,
    })
}

function normalizeEpisodeItem(item = {}, animeId = '') {
    const number =
        item?.number ??
        item?.episodeNumber ??
        item?.episode ??
        item?.num ??
        0

    const episodeId = item?.id ?? item?._id ?? item?.episodeId ?? item?.url ?? ''

    const title =
        item?.title ||
        item?.name ||
        (number ? `Episode ${number}` : 'Episode')

    return createAnimeEpisode({
        providerId: PROVIDER_ID,
        animeId,
        episodeId,
        number,
        title,
        raw: item,
    })
}

function normalizeSubtitleTrack(track = {}) {
    const url = track?.url || track?.file || ''
    if (!url) return null

    const lang = track?.lang || track?.language || track?.label || 'Unknown'

    return createAnimeSubtitleTrack({
        lang,
        url,
        kind: 'captions',
        label: track?.label || lang,
        raw: track,
    })
}

function normalizeHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        return {}
    }
    return headers
}

function hasHeaders(headers) {
    return Boolean(headers) && typeof headers === 'object' && Object.keys(headers).length > 0
}

function parseResolution(...values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value
        }

        const text = String(value || '')
        const match = text.match(/(\d{3,4})/)
        if (match) {
            return Number(match[1])
        }
    }

    return 0
}

function normalizeStreamItem(stream = {}, { animeId = '', episodeId = '' } = {}) {
    const url = stream?.url || stream?.file || stream?.src || ''
    if (!url) return null

    const quality =
        stream?.quality ||
        stream?.label ||
        stream?.resolution ||
        ''

    const numericResolution = parseResolution(quality, stream?.resolution)
    const streamType = detectAnimeStreamType(
        url,
        stream?.type || stream?.format || ''
    )

    const subtitles = Array.isArray(stream?.subtitles)
        ? stream.subtitles.map(normalizeSubtitleTrack).filter(Boolean)
        : []

    return createAnimeStreamCandidate({
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
        quality: String(quality || ''),
        resolution: numericResolution,
        headers: normalizeHeaders(stream?.headers),
        subtitles,
        score: 0,
        flags: {
            direct: streamType === 'mp4',
            requiresHeaders: hasHeaders(stream?.headers),
            maybeUnstable: false,
        },
        raw: stream,
    })
}

function isBadAnimeSaturnUrl(url = '') {
    const value = String(url || '').toLowerCase()

    return (
        !value ||
        value.includes('/clock.json') ||
        value.includes('streamlare') ||
        value.includes('fast4speed') ||
        value.includes('ok.ru/videoembed/') ||
        value.includes('/embed/') ||
        value.includes('/embed-')
    )
}

function getAnimeSaturnCandidateScore(stream = {}, headers = {}) {
    const url = String(stream?.url || '')
    const isM3U8 = Boolean(stream?.isM3U8)
    let score = 0

    if (isBadAnimeSaturnUrl(url)) score -= 1000
    if (isM3U8) score += 50
    else score += 25

    if (url.includes('.m3u8')) score += 20
    if (url.includes('.mp4')) score += 10

    if (url.includes('sushi.streamapeaker.org')) score += 20
    if (url.includes('streamapeaker')) score += 15

    if (hasHeaders(headers)) score += 5

    return score
}

function dedupeStreamCandidates(candidates = []) {
    const seen = new Set()
    const output = []

    for (const candidate of candidates) {
        const key = `${candidate?.providerId || ''}::${candidate?.url || ''}`
        if (!candidate?.url || seen.has(key)) continue
        seen.add(key)
        output.push(candidate)
    }

    return output
}

export const animesaturnProvider = {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,

    async searchAnime({ titles = [] } = {}) {
        const uniqueTitles = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))]
        const results = []

        for (const title of uniqueTitles) {
            try {
                const items = await fetchProviderSearchResults(title)

                for (const item of items) {
                    const normalized = normalizeSearchItem(item)
                    if (normalized.animeId) {
                        results.push(normalized)
                    }
                }
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] search failed for "${title}"`, error)
            }
        }

        return dedupeBy(results, (item) => item.animeId)
    },

    async getEpisodes({ animeId } = {}) {
        if (!animeId) return []

        try {
            const html = await fetchProviderAnimeInfo(animeId)
            return parseProviderEpisodes(html, animeId)
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes failed`, error)
            return []
        }
    },

    async getStreams({ animeId = '', episodeId } = {}) {
        if (!episodeId) return []

        try {
            const response = await fetchProviderEpisodeSources(episodeId, animeId)

            const rawStreams = Array.isArray(response?.sources) ? response.sources : []
            const sharedSubtitles = Array.isArray(response?.subtitles)
                ? response.subtitles.map(normalizeSubtitleTrack).filter(Boolean)
                : []
            const sharedHeaders = normalizeHeaders(response?.headers)

            const candidates = rawStreams
                .map((stream) => {
                    if (!stream?.url || isBadAnimeSaturnUrl(stream.url)) return null

                    const normalized = normalizeStreamItem({
                        ...stream,
                        type: stream?.isM3U8 ? 'hls' : 'mp4',
                        headers: sharedHeaders,
                        subtitles: sharedSubtitles,
                    }, { animeId, episodeId })

                    if (!normalized) return null

                    return {
                        ...normalized,
                        score: getAnimeSaturnCandidateScore(stream, sharedHeaders),
                        flags: {
                            ...normalized.flags,
                            requiresHeaders: hasHeaders(sharedHeaders),
                        },
                    }
                })
                .filter(Boolean)

            return dedupeStreamCandidates(candidates).sort(
                (a, b) => Number(b.score || 0) - Number(a.score || 0)
            )
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

export default animesaturnProvider