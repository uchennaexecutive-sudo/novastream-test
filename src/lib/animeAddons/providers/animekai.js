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
const ANIMEKAI_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const ANIMEKAI_BASE_HEADERS = {
    'User-Agent': ANIMEKAI_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://anikai.to/',
}
const ANIMEKAI_JSON_HEADERS = {
    ...ANIMEKAI_BASE_HEADERS,
    Accept: 'application/json, text/plain, */*',
}
const animekaiValueCache = new Map()
const animekaiPromiseCache = new Map()

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
}

function logAnimeKaiTiming(stage, details = {}) {
    console.info('[animekai/timing]', { stage, ...details })
}

async function cachedAnimekaiRequest(cacheKey, factory, options = {}) {
    const { label = '', ttlMs = 0 } = options

    if (animekaiValueCache.has(cacheKey)) {
        const cached = animekaiValueCache.get(cacheKey)
        if (cached?.__animekaiCacheEntry) {
            if (!cached.expiresAt || cached.expiresAt > Date.now()) {
                if (label) {
                    logAnimeKaiTiming(`${label}.cacheHit`, { cacheKey })
                }
                return cached.value
            }

            animekaiValueCache.delete(cacheKey)
        } else {
            if (label) {
                logAnimeKaiTiming(`${label}.cacheHit`, { cacheKey })
            }
            return cached
        }
    }

    if (animekaiPromiseCache.has(cacheKey)) {
        if (label) {
            logAnimeKaiTiming(`${label}.promiseHit`, { cacheKey })
        }
        return animekaiPromiseCache.get(cacheKey)
    }

    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0

    const promise = Promise.resolve()
        .then(factory)
        .then((result) => {
            animekaiPromiseCache.delete(cacheKey)
            animekaiValueCache.set(cacheKey, {
                __animekaiCacheEntry: true,
                expiresAt,
                value: result,
            })
            return result
        })
        .catch((error) => {
            animekaiPromiseCache.delete(cacheKey)
            throw error
        })

    animekaiPromiseCache.set(cacheKey, promise)
    return promise
}

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
                ...ANIMEKAI_BASE_HEADERS,
                ...headers,
            },
            method,
            body: body ? JSON.stringify(body) : null,
        })
    }

    const response = await fetch(url, {
        method,
        headers: {
            ...ANIMEKAI_BASE_HEADERS,
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
        console.warn('[animekai] fetchProviderJson headers', {
            url,
            headers: {
                ...ANIMEKAI_JSON_HEADERS,
                'Content-Type': 'application/json',
                ...headers,
            },
            method,
            body: body ? JSON.stringify(body) : null,
        })

        const responseText = await invoke('fetch_anime_text', {
            url,
            headers: {
                ...ANIMEKAI_JSON_HEADERS,
                'Content-Type': 'application/json',
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
            ...ANIMEKAI_JSON_HEADERS,
            'Content-Type': 'application/json',
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
    return cachedAnimekaiRequest(`enc-kai:${text}`, async () => {
        const value = await fetchProviderJson(
            'https://enc-dec.app/api/enc-kai?text=' + encodeURIComponent(String(text || '')),
            {
                method: 'GET',
                headers: {
                    Referer: 'https://anikai.to/',
                },
            }
        )

        if (typeof value === 'string') return value
        return value?.result || value?.token || value?.data || ''
    })
}

async function decodeIframeData(token) {
    return cachedAnimekaiRequest(`dec-kai:${token}`, async () => {
        const value = await fetchProviderJson('https://enc-dec.app/api/dec-kai', {
            method: 'POST',
            headers: {
                Referer: 'https://anikai.to/',
            },
            body: { text: token },
        })

        if (typeof value === 'string') return value
        return value?.result || value?.data || ''
    })
}
async function decodeMegaData(token) {
    return cachedAnimekaiRequest(`dec-mega:${token}`, async () => {
        const value = await fetchProviderJson('https://enc-dec.app/api/dec-mega', {
            method: 'POST',
            headers: {
                Referer: 'https://anikai.to/',
                'User-Agent': ANIMEKAI_AGENT,
            },
            body: {
                text: token,
                agent: ANIMEKAI_AGENT,
            },
        })

        if (typeof value === 'string') return value
        return value?.result || value?.data || ''
    }, { ttlMs: 2 * 60 * 1000 })
}

async function fetchMegaMediaJson(embedBase, videoId) {
    const mediaUrl = `${embedBase}/media/${encodeURIComponent(videoId)}`

    return cachedAnimekaiRequest(`media:${mediaUrl}`, async () => {
        if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
            const mediaResponseText = await invoke('fetch_anime_text', {
                url: mediaUrl,
                headers: {
                    ...ANIMEKAI_JSON_HEADERS,
                },
                method: 'GET',
                body: null,
            })

            return JSON.parse(mediaResponseText)
        }

        const mediaResponse = await fetch(mediaUrl, {
            method: 'GET',
            headers: {
                ...ANIMEKAI_JSON_HEADERS,
            },
        })

        if (!mediaResponse.ok) {
            throw new Error(`AnimeKai media fetch failed with status ${mediaResponse.status}`)
        }

        return mediaResponse.json()
    }, { label: 'media', ttlMs: 2 * 60 * 1000 })
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

async function resolveMegaUpToPlayableUrl(pageUrl) {
    const normalizedUrl = String(pageUrl || '').trim()
    if (!normalizedUrl) {
        return {
            playableUrl: '',
            headers: {},
            streamType: '',
        }
    }

    const pageHtml = await fetchProviderHtml(normalizedUrl, {
        Referer: 'https://anikai.to/',
        'User-Agent': ANIMEKAI_AGENT,
    })
    console.warn('[animekai] megaup html preview', pageHtml.slice(0, 3000))

    const iframeMatch = pageHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i)
    console.warn('[animekai] megaup iframe match', iframeMatch?.[1] || null)
    let iframeUrl = iframeMatch?.[1] ? String(iframeMatch[1]).trim() : ''

    if (iframeUrl.startsWith('//')) {
        iframeUrl = `https:${iframeUrl}`
    }

    if (!iframeUrl) {
        const directM3u8Match = pageHtml.match(/https?:\/\/[^"'`\s<>]+\.m3u8[^"'`\s<>]*/i)
        const directMp4Match = pageHtml.match(/https?:\/\/[^"'`\s<>]+\.mp4[^"'`\s<>]*/i)
        const directUrl = directM3u8Match?.[0] || directMp4Match?.[0] || ''

        if (directUrl) {
            return {
                playableUrl: directUrl,
                headers: {
                    Referer: normalizedUrl,
                    Origin: new URL(normalizedUrl).origin,
                    'User-Agent': ANIMEKAI_AGENT,
                },
                streamType: detectAnimeStreamType(directUrl, ''),
            }
        }

        return {
            playableUrl: '',
            headers: {},
            streamType: '',
        }
    }

    const iframeHtml = await fetchProviderHtml(iframeUrl, {
        Referer: normalizedUrl,
        Origin: new URL(normalizedUrl).origin,
        'User-Agent': ANIMEKAI_AGENT,
    })

    const iframeM3u8Match = iframeHtml.match(/https?:\/\/[^"'`\s<>]+\.m3u8[^"'`\s<>]*/i)
    const iframeMp4Match = iframeHtml.match(/https?:\/\/[^"'`\s<>]+\.mp4[^"'`\s<>]*/i)
    const playableUrl = iframeM3u8Match?.[0] || iframeMp4Match?.[0] || ''

    if (!playableUrl) {
        return {
            playableUrl: '',
            headers: {},
            streamType: '',
        }
    }

    return {
        playableUrl,
        headers: {
            Referer: iframeUrl,
            Origin: new URL(iframeUrl).origin,
            'User-Agent': ANIMEKAI_AGENT,
        },
        streamType: detectAnimeStreamType(playableUrl, ''),
    }
}

async function fetchProviderEpisodeSources(episodeId, animeId = '') {
    return cachedAnimekaiRequest(
        `episode-sources:${animeId}:${episodeId}`,
        () => fetchProviderEpisodeSourcesUncached(episodeId, animeId),
        { label: 'episodeSources', ttlMs: 2 * 60 * 1000 }
    )
}

async function fetchProviderEpisodeSourcesUncached(episodeId, animeId = '') {
    const totalStart = nowMs()
    const tokenPart = String(episodeId || '').split('$token=')[1] || ''
    if (!tokenPart) {
        throw new Error('AnimeKai episode token missing')
    }

    const tokenStart = nowMs()
    const token = await generateKaiToken(tokenPart)
    logAnimeKaiTiming('encEpisodeToken', {
        animeId,
        episodeId,
        elapsedMs: Math.round(nowMs() - tokenStart),
    })

    if (!token) {
        throw new Error('AnimeKai links token not found')
    }

    const linksListStart = nowMs()
    const linkListResponse = await cachedAnimekaiRequest(
        `links-list:${tokenPart}`,
        () => fetchProviderHtml(
            `https://anikai.to/ajax/links/list?token=${encodeURIComponent(tokenPart)}&_=${encodeURIComponent(token)}`,
            {
                Referer: animeId ? buildProviderWatchUrl(animeId) : 'https://anikai.to/',
                'X-Requested-With': 'XMLHttpRequest',
            }
        ),
        { label: 'linksList', ttlMs: 5 * 60 * 1000 }
    )
    logAnimeKaiTiming('linksList', {
        animeId,
        episodeId,
        elapsedMs: Math.round(nowMs() - linksListStart),
    })

    const linkListParsed = parseAjaxResponse(linkListResponse)
    const linkListHtml =
        typeof linkListParsed?.result === 'string'
            ? linkListParsed.result
            : String(linkListResponse || '')

    const $links = load(linkListHtml)
    const serverTypeTabs = []

    $links('.server-type span, .server-type button, .server-type a').each((_, element) => {
        const node = $links(element)
        const serverType = normalizeAnimeKaiServerType([
            node.attr('data-value'),
            node.attr('data-type'),
            node.attr('class'),
            node.text(),
        ])
        if (serverType) serverTypeTabs.push(serverType)
    })

    const serverLinks = []
    const serverItems = $links('.server-items')

    serverItems.each((groupIndex, groupElement) => {
        const group = $links(groupElement)
        const groupType = normalizeAnimeKaiServerType([
            group.attr('data-value'),
            group.attr('data-type'),
            group.attr('class'),
            serverTypeTabs[groupIndex],
        ]) || inferAnimeKaiServerTypeFromIndex(groupIndex)

        group.find('.server').each((_, element) => {
            const node = $links(element)
            const id = node.attr('data-lid') || node.attr('data-id') || ''
            const serverName = node.text().trim() || 'default'
            const serverType = normalizeAnimeKaiServerType([
                node.attr('data-value'),
                node.attr('data-type'),
                node.attr('class'),
                groupType,
                serverName,
            ]) || groupType

            if (!id || serverType === 'dub') return

            serverLinks.push({
                id,
                serverName,
                serverType,
                priority: getAnimeKaiServerPriority(serverType),
            })
        })
    })

    if (!serverLinks.length) {
        $links('.server-items .server, .server').each((_, element) => {
            const node = $links(element)
            const id = node.attr('data-lid') || node.attr('data-id') || ''
            const serverName = node.text().trim() || 'default'
            const serverType = normalizeAnimeKaiServerType([
                node.attr('data-value'),
                node.attr('data-type'),
                node.attr('class'),
                serverName,
            ]) || 'unknown'

            if (!id || serverType === 'dub') return

            serverLinks.push({
                id,
                serverName,
                serverType,
                priority: getAnimeKaiServerPriority(serverType),
            })
        })
    }

    serverLinks.sort((a, b) => (
        a.priority - b.priority ||
        a.serverName.localeCompare(b.serverName)
    ))

    logAnimeKaiTiming('serverPlan', {
        animeId,
        episodeId,
        serverCount: serverLinks.length,
        serverTypes: serverLinks.map((server) => server.serverType).filter(Boolean),
    })

    const allSources = []
    let sharedHeaders = {}
    let sharedSubtitles = []

    for (const server of serverLinks) {
        const serverStart = nowMs()
        try {
            const idTokenStart = nowMs()
            const idToken = await generateKaiToken(server.id)
            logAnimeKaiTiming('encServerId', {
                animeId,
                episodeId,
                serverName: server.serverName,
                serverType: server.serverType,
                elapsedMs: Math.round(nowMs() - idTokenStart),
            })

            if (!idToken) continue

            const linksViewStart = nowMs()
            const linkJson = await cachedAnimekaiRequest(
                `links-view:${server.id}`,
                () => fetchProviderJson(
                    `https://anikai.to/ajax/links/view?id=${encodeURIComponent(server.id)}&_=${encodeURIComponent(idToken)}`,
                    {
                        method: 'GET',
                        headers: {
                            Referer: animeId ? buildProviderWatchUrl(animeId) : 'https://anikai.to/',
                            'X-Requested-With': 'XMLHttpRequest',
                        },
                    }
                ),
                { label: 'linksView', ttlMs: 5 * 60 * 1000 }
            )
            logAnimeKaiTiming('linksView', {
                animeId,
                episodeId,
                serverName: server.serverName,
                serverType: server.serverType,
                elapsedMs: Math.round(nowMs() - linksViewStart),
            })

            const encodedResult = linkJson?.result || ''
            if (!encodedResult) continue

            const decKaiStart = nowMs()
            const decodedIframe = await decodeIframeData(encodedResult)
            logAnimeKaiTiming('decKai', {
                animeId,
                episodeId,
                serverName: server.serverName,
                serverType: server.serverType,
                elapsedMs: Math.round(nowMs() - decKaiStart),
            })

            if (!decodedIframe) continue

            const embedUrl = String(
                typeof decodedIframe === 'string'
                    ? decodedIframe
                    : decodedIframe?.url || ''
            ).trim()

            if (!embedUrl) continue

            const videoId = embedUrl.replace(/\/+$/, '').split('/').pop() || ''
            const embedBase = embedUrl.includes('/e/')
                ? embedUrl.split('/e/')[0]
                : embedUrl.replace(/\/[^/]+$/, '')

            if (!videoId || !embedBase) continue

            const mediaStart = nowMs()
            const mediaJson = await fetchMegaMediaJson(embedBase, videoId)
            logAnimeKaiTiming('media', {
                animeId,
                episodeId,
                serverName: server.serverName,
                serverType: server.serverType,
                elapsedMs: Math.round(nowMs() - mediaStart),
            })

            const encryptedMedia = mediaJson?.result || ''
            if (!encryptedMedia) continue

            const decMegaStart = nowMs()
            const finalData = await decodeMegaData(encryptedMedia)
            logAnimeKaiTiming('decMega', {
                animeId,
                episodeId,
                serverName: server.serverName,
                serverType: server.serverType,
                elapsedMs: Math.round(nowMs() - decMegaStart),
            })

            if (!finalData) continue

            const rawSources = Array.isArray(finalData?.sources) ? finalData.sources : []
            const rawTracks = Array.isArray(finalData?.tracks) ? finalData.tracks : []

            const headers = {
                Referer: embedUrl,
                Origin: new URL(embedUrl).origin,
                'User-Agent': ANIMEKAI_AGENT,
            }

            sharedHeaders = headers
            sharedSubtitles = rawTracks

            for (const source of rawSources) {
                const sourceUrl = String(source?.file || source?.url || source?.src || '').trim()
                if (!sourceUrl) continue

                const streamType = detectAnimeStreamType(
                    sourceUrl,
                    source?.type || source?.format || ''
                )

                allSources.push({
                    url: sourceUrl,
                    type: streamType === 'hls' ? 'hls' : 'mp4',
                    quality: source?.label || source?.quality || server.serverName || 'default',
                    headers,
                    subtitles: rawTracks,
                })
            }

            if (allSources.length) {
                logAnimeKaiTiming('serverResolved', {
                    animeId,
                    episodeId,
                    serverName: server.serverName,
                    serverType: server.serverType,
                    sourceCount: allSources.length,
                    elapsedMs: Math.round(nowMs() - serverStart),
                    totalElapsedMs: Math.round(nowMs() - totalStart),
                })

                return {
                    animeId,
                    episodeId,
                    headers: sharedHeaders,
                    subtitles: sharedSubtitles,
                    sources: allSources,
                }
            }
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] server source resolve failed`, error)
            logAnimeKaiTiming('serverFailed', {
                animeId,
                episodeId,
                serverName: server.serverName,
                serverType: server.serverType,
                elapsedMs: Math.round(nowMs() - serverStart),
                message: error instanceof Error ? error.message : String(error),
            })
        }
    }

    logAnimeKaiTiming('episodeSources.empty', {
        animeId,
        episodeId,
        elapsedMs: Math.round(nowMs() - totalStart),
    })

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
    const lowerUrl = String(url || '').toLowerCase()
    const lowerLang = String(lang || '').toLowerCase()
    const lowerKind = String(track?.kind || '').toLowerCase()
    const lowerLabel = String(track?.label || '').toLowerCase()

    if (
        lowerKind === 'thumbnails' ||
        lowerLang.includes('thumbnail') ||
        lowerLabel.includes('thumbnail') ||
        lowerUrl.includes('thumbnails.') ||
        lowerUrl.includes('/thumbnails')
    ) {
        return null
    }

    return createAnimeSubtitleTrack({
        lang,
        url,
        kind: 'captions',
        label: track?.label || lang,
        raw: track,
    })
}

function normalizeAnimeKaiServerType(values = []) {
    const text = values
        .filter(Boolean)
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
        .replace(/[_-]+/g, ' ')

    if (!text.trim()) return ''
    if (/\bdub\b/.test(text) || text.includes('dubbed')) return 'dub'
    if (text.includes('soft sub') || text.includes('softsub') || text.includes('soft subtitle')) return 'soft'
    if (text.includes('hard sub') || text.includes('hardsub') || text.includes('hard subtitle')) return 'hard'
    if (/\bsub\b/.test(text) || text.includes('subbed')) return 'hard'
    return ''
}

function inferAnimeKaiServerTypeFromIndex(index) {
    if (index === 0) return 'hard'
    if (index === 1) return 'soft'
    if (index === 2) return 'dub'
    return 'unknown'
}

function getAnimeKaiServerPriority(serverType) {
    if (serverType === 'hard') return 0
    if (serverType === 'soft') return 1
    if (serverType === 'unknown') return 2
    return 99
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
                .filter((stream) => String(stream?.url || '').trim() !== String(primaryStream?.url || '').trim())
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
