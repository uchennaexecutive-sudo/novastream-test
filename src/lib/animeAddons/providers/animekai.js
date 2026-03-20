import { load } from 'cheerio'
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

const PROVIDER_ID = ANIME_PROVIDER_IDS.ANIMEKAI
const PROVIDER_LABEL = ANIME_PROVIDER_LABELS[PROVIDER_ID]

function assertNotCloudflareBlock(html, context) {
    if (
        typeof html === 'string' &&
        (html.includes('Access denied') || html.includes('Just a moment')) &&
        html.includes('Cloudflare')
    ) {
        throw new Error(`[${context}] Cloudflare blocked the request`)
    }
}

function buildProviderSearchUrl(query) {
    const normalized = String(query || '').replace(/[\W_]+/g, '+').trim()
    return `https://anikai.to/browser?keyword=${normalized}&page=1`
}

function buildProviderWatchUrl(animeId) {
    return `https://anikai.to/watch/${animeId}`
}

async function fetchProviderHtml(url, headers = {}, options = {}) {
    const { method = 'GET', body = null } = options

    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        return invoke('fetch_anime_text', {
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                ...headers,
            },
            method,
            body: body ? JSON.stringify(body) : null,
        })
    }

    const response = await fetch(url, {
        method,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
        throw new Error(`AnimeKai HTML fetch failed with status ${response.status}`)
    }

    return response.text()
}

async function fetchProviderJson(url, { method = 'GET', headers = {}, body = null } = {}) {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        const responseText = await invoke('fetch_anime_text', {
            url,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0',
                ...headers,
            },
            method,
            body: body ? JSON.stringify(body) : null,
        })

        return JSON.parse(responseText)
    }

    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
        throw new Error(`AnimeKai JSON fetch failed with status ${response.status}`)
    }

    return response.json()
}

function parseProviderSearchResults(html) {
    const $ = load(html)
    const results = []

    $('.aitem').each((_, element) => {
        const card = $(element)
        const atag = card.find('div.inner > a')
        const href = atag.attr('href') || ''
        const id = href.replace('/watch/', '').trim()
        const title = atag.text().trim()
        const image =
            card.find('img').attr('data-src') ||
            card.find('img').attr('src') ||
            ''

        if (!id || !title) return

        results.push({
            id,
            title,
            image,
            japaneseTitle: card.find('a.title').attr('data-jp') || '',
            url: `https://anikai.to${href}`,
        })
    })

    return results
}

async function fetchProviderSearchResults(query) {
    const html = await fetchProviderHtml(buildProviderSearchUrl(query), {
        Referer: 'https://anikai.to/',
    })
    return parseProviderSearchResults(html)
}

function extractAnimeKaiIds(html) {
    const $ = load(html)

    const aniId =
        $('.rate-box#anime-rating').attr('data-id') ||
        $('#anime-rating').attr('data-id') ||
        ''

    return {
        aniId: String(aniId || '').trim(),
        id: '',
    }
}

function parseAnimeKaiInfo(html, animeId) {
    const $ = load(html)
    const title =
        $('.entity-scroll > .title').first().text().trim() ||
        $('.title').first().text().trim() ||
        $('h1').first().text().trim() ||
        animeId

    return {
        animeId,
        title,
        ...extractAnimeKaiIds(html),
    }
}

function parseAjaxResponse(data) {
    if (typeof data === 'object' && data !== null) return data

    if (typeof data === 'string') {
        let jsonStr = data

        if (jsonStr.trimStart().startsWith('<')) {
            const $ = load(jsonStr)
            jsonStr = $('pre').text() || jsonStr
        }

        try {
            return JSON.parse(jsonStr)
        } catch {
            return undefined
        }
    }

    return undefined
}

async function generateKaiToken(text) {
    const value = await fetchProviderJson('https://enc-dec.app/api/enc-kai?text=' + encodeURIComponent(String(text || '')), {
        method: 'GET',
        headers: {
            Referer: 'https://anikai.to/',
        },
    })

    if (typeof value === 'string') return value
    return value?.result || value?.token || value?.data || ''
}

async function decodeIframeData(token) {
    const value = await fetchProviderJson('https://enc-dec.app/api/dec-kai', {
        method: 'POST',
        headers: {
            Referer: 'https://anikai.to/',
        },
        body: { text: token },
    })

    if (typeof value === 'string') return value
    return value?.result || value?.data || ''
}

async function decodeMegaData(token) {
    const value = await fetchProviderJson('https://enc-dec.app/api/dec-mega', {
        method: 'POST',
        headers: {
            Referer: 'https://anikai.to/',
        },
        body: { text: token },
    })

    if (typeof value === 'string') return value
    return value?.result || value?.data || ''
}

function parseEpisodeListHtml(html, animeId) {
    const $ = load(html)
    const episodes = []

    $('div.eplist > ul > li > a, a.ep-item').each((_, element) => {
        const node = $(element)
        const numAttr = node.attr('num') || ''
        const tokenAttr = node.attr('token') || ''
        const href = node.attr('href') || ''
        const title =
            node.children('span').text().trim() ||
            node.find('.num').text().trim() ||
            node.text().trim()

        const number = parseInt(String(numAttr || title).replace(/[^\d]/g, ''), 10)
        if (!tokenAttr || Number.isNaN(number)) return

        const episodeId = `${animeId}$ep=${number}$token=${tokenAttr}`

        episodes.push(
            createAnimeEpisode({
                providerId: PROVIDER_ID,
                animeId,
                episodeId,
                number,
                title: title || `Episode ${number}`,
                raw: {
                    href,
                    num: numAttr,
                    token: tokenAttr,
                },
            })
        )
    })

    return episodes.sort((a, b) => a.number - b.number)
}

async function fetchProviderAnimeInfo(animeId) {
    const html = await fetchProviderHtml(buildProviderWatchUrl(animeId), {
        Referer: 'https://anikai.to/',
    })

    assertNotCloudflareBlock(html, 'AnimeKai fetchProviderAnimeInfo')

    const parsed = parseAnimeKaiInfo(html, animeId)
    if (!parsed.aniId) {
        throw new Error('AnimeKai ani_id not found')
    }

    const token = await generateKaiToken(parsed.aniId)
    if (!token) {
        throw new Error('AnimeKai episode token not found')
    }

    const episodesResponse = await fetchProviderHtml(
        `https://anikai.to/ajax/episodes/list?ani_id=${parsed.aniId}&_=${encodeURIComponent(token)}`,
        {
            Referer: buildProviderWatchUrl(animeId),
            'X-Requested-With': 'XMLHttpRequest',
        }
    )

    const episodesParsed = parseAjaxResponse(episodesResponse)
    const episodesHtml =
        typeof episodesParsed?.result === 'string'
            ? episodesParsed.result
            : String(episodesResponse || '')

    return {
        ...parsed,
        episodes: parseEpisodeListHtml(episodesHtml, animeId),
    }
}

async function fetchProviderEpisodeSources(episodeId, animeId = '') {
    const tokenPart = String(episodeId || '').split('$token=')[1] || ''
    if (!tokenPart) {
        throw new Error('AnimeKai episode token missing')
    }

    const token = await generateKaiToken(tokenPart)
    if (!token) {
        throw new Error('AnimeKai links token not found')
    }

    const linkListResponse = await fetchProviderHtml(
        `https://anikai.to/ajax/links/list?token=${encodeURIComponent(tokenPart)}&_=${encodeURIComponent(token)}`,
        {
            Referer: animeId ? buildProviderWatchUrl(animeId) : 'https://anikai.to/',
            'X-Requested-With': 'XMLHttpRequest',
        }
    )

    const linkListParsed = parseAjaxResponse(linkListResponse)
    const linkListHtml =
        typeof linkListParsed?.result === 'string'
            ? linkListParsed.result
            : String(linkListResponse || '')

    const $links = load(linkListHtml)
    const serverLinks = []

    $links('.server-items .server').each((_, element) => {
        const node = $links(element)
        const id = node.attr('data-lid') || node.attr('data-id') || ''
        const serverName = node.text().trim() || 'default'
        if (!id) return
        serverLinks.push({ id, serverName })
    })

    const allSources = []
    let sharedHeaders = {}
    const sharedSubtitles = []

    for (const server of serverLinks) {
        try {
            const idToken = await generateKaiToken(server.id)
            if (!idToken) continue

            const linkJson = await fetchProviderJson(
                `https://anikai.to/ajax/links/view?id=${encodeURIComponent(server.id)}&_=${encodeURIComponent(idToken)}`,
                {
                    method: 'GET',
                    headers: {
                        Referer: animeId ? buildProviderWatchUrl(animeId) : 'https://anikai.to/',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                }
            )

            const encodedResult = linkJson?.result || ''
            if (!encodedResult) continue

            const decodedIframe = await decodeIframeData(encodedResult)
            if (!decodedIframe) continue

            let finalUrl =
                typeof decodedIframe === 'string'
                    ? decodedIframe
                    : decodedIframe?.url || ''

            if (!/^https?:\/\//i.test(finalUrl)) {
                finalUrl = await decodeMegaData(finalUrl)
            }

            finalUrl = String(finalUrl || '').trim()
            if (!finalUrl) continue

            const streamType = detectAnimeStreamType(finalUrl, '')
            const headers = {
                Referer: 'https://anikai.to/',
                'User-Agent': 'Mozilla/5.0',
            }

            sharedHeaders = headers

            allSources.push({
                url: finalUrl,
                type: streamType === 'hls' ? 'hls' : 'mp4',
                quality: server.serverName || 'default',
                headers,
                subtitles: sharedSubtitles,
            })
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] server source resolve failed`, error)
        }
    }

    return {
        animeId,
        episodeId,
        headers: sharedHeaders,
        subtitles: sharedSubtitles,
        sources: allSources,
    }
}

function normalizeSearchItem(item = {}) {
    const animeId = item?.id ?? item?._id ?? item?.slug ?? ''
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

function normalizeStreamItem(stream = {}, { animeId = '', episodeId = '' } = {}) {
    const url = stream?.url || stream?.file || stream?.src || ''
    if (!url) return null

    const quality =
        stream?.quality ||
        stream?.label ||
        stream?.resolution ||
        ''

    const numericResolution = parseResolution(quality, stream?.resolution)

    const subtitles = Array.isArray(stream?.subtitles)
        ? stream.subtitles.map(normalizeSubtitleTrack).filter(Boolean)
        : []

    const streamType = detectAnimeStreamType(
        url,
        stream?.type || stream?.format || ''
    )

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

export const animekaiProvider = {
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
            const info = await fetchProviderAnimeInfo(animeId)
            return Array.isArray(info?.episodes) ? info.episodes : []
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

            const primaryStream =
                rawStreams.find((item) => item?.url?.includes('.m3u8')) ||
                rawStreams[0] ||
                null

            const primaryCandidate = primaryStream
                ? createAnimeStreamCandidate({
                    id: buildAnimeStreamCandidateId({
                        providerId: PROVIDER_ID,
                        animeId,
                        episodeId,
                        url: primaryStream.url,
                        quality: primaryStream.quality || '',
                    }),
                    providerId: PROVIDER_ID,
                    providerLabel: PROVIDER_LABEL,
                    animeId,
                    episodeId,
                    url: primaryStream.url,
                    streamType: detectAnimeStreamType(primaryStream.url, primaryStream.type || ''),
                    quality: primaryStream.quality || '',
                    resolution: 0,
                    headers: normalizeHeaders(response?.headers),
                    subtitles: sharedSubtitles,
                    score: 0,
                    flags: {
                        direct: detectAnimeStreamType(primaryStream.url, primaryStream.type || '') === 'mp4',
                        requiresHeaders: hasHeaders(response?.headers),
                        maybeUnstable: false,
                    },
                    raw: primaryStream,
                })
                : null

            const extraCandidates = rawStreams
                .map((stream) => {
                    const normalized = normalizeStreamItem({
                        ...stream,
                        headers: stream?.headers || response?.headers || {},
                        subtitles: sharedSubtitles,
                    }, { animeId, episodeId })

                    return normalized
                })
                .filter(Boolean)

            return [primaryCandidate, ...extraCandidates].filter(Boolean)
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

export default animekaiProvider