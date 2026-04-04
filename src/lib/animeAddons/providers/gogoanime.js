import {
    ANIME_PROVIDER_IDS,
    ANIME_PROVIDER_LABELS,
    createAnimeSearchMatch,
    createAnimeEpisode,
    createAnimeStreamCandidate,
    buildAnimeStreamCandidateId,
    detectAnimeStreamType,
} from '../types'
import { invoke } from '@tauri-apps/api/core'
import {
    gogoanimeGetAnime,
    gogoanimeGetStreamingLinks,
    gogoanimeSearch,
} from './gogoanimeScraper'

const PROVIDER_ID = ANIME_PROVIDER_IDS.GOGOANIME
const PROVIDER_LABEL = ANIME_PROVIDER_LABELS[PROVIDER_ID]

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

async function fetchTextWithSession(url, headers = {}, sessionId = null) {
    const result = await invoke('fetch_anime_text_with_session', {
        url,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
        sessionId,
    })

    return {
        text: typeof result?.text === 'string' ? result.text : '',
        sessionId: result?.sessionId || null,
    }
}

async function fetchText(url, headers = {}) {
    const result = await invoke('fetch_anime_text', {
        url,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
    })

    if (typeof result === 'string') {
        return result
    }

    if (result && typeof result.text === 'string') {
        return result.text
    }

    throw new Error(`fetch_anime_text returned unexpected payload for ${url}`)
}

const searchResultCache = new Map()
const animeInfoCache = new Map()
const streamingLinksCache = new Map()
const preferredServerHostCache = new Map()

function getCachedPromise(cache, key, factory) {
    if (cache.has(key)) {
        return cache.get(key)
    }

    const promise = Promise.resolve()
        .then(factory)
        .catch((error) => {
            cache.delete(key)
            throw error
        })

    cache.set(key, promise)
    return promise
}

function normalizeSearchItem(item = {}) {
    const animeId = String(item?.id || '').trim()
    const title = String(item?.name || '').trim()
    const image = String(item?.img || item?.image || '').trim()

    if (!animeId || !title) return null

    return createAnimeSearchMatch({
        providerId: PROVIDER_ID,
        animeId,
        title,
        matchedTitle: title,
        score: 0,
        raw: item,
    })
}

function normalizeEpisodeItem(number, animeId) {
    const episodeNumber = Number(number || 0)
    if (!episodeNumber) return null

    return createAnimeEpisode({
        providerId: PROVIDER_ID,
        animeId,
        episodeId: String(episodeNumber),
        number: episodeNumber,
        title: `Episode ${episodeNumber}`,
        raw: {
            rawEpisodeNumber: number,
        },
    })
}

function extractCanonicalAnimeId(data = {}, fallbackAnimeId = '') {
    return String(data?.alias || data?.id || fallbackAnimeId || '').trim()
}

function normalizeAnimeInfoPayload(data = {}, fallbackAnimeId = '') {
    const canonicalAnimeId = extractCanonicalAnimeId(data, fallbackAnimeId)
    const rawEpisodes = Array.isArray(data?.episodes) ? data.episodes : []
    const normalizedEpisodes = rawEpisodes
        .map((number) => normalizeEpisodeItem(number, canonicalAnimeId || fallbackAnimeId))
        .filter(Boolean)
        .sort((a, b) => Number(a.number) - Number(b.number))

    const episodeNumbers = normalizedEpisodes
        .map((episode) => Number(episode?.number || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
    const minEpisode = episodeNumbers.length ? Math.min(...episodeNumbers) : 0
    const maxEpisode = episodeNumbers.length ? Math.max(...episodeNumbers) : 0
    const isContiguousOffsetRange =
        episodeNumbers.length > 0 &&
        minEpisode > 1 &&
        maxEpisode - minEpisode + 1 === normalizedEpisodes.length

    const episodes = normalizedEpisodes.map((episode, index) => {
        if (!isContiguousOffsetRange) {
            return episode
        }

        return {
            ...episode,
            number: index + 1,
            title: `Episode ${index + 1}`,
            raw: {
                ...episode.raw,
                absoluteEpisodeNumber: Number(episode?.raw?.rawEpisodeNumber || episode.number || 0),
                normalizedEpisodeNumber: index + 1,
            },
        }
    })

    return {
        canonicalAnimeId,
        episodes,
    }
}

function extractHost(value = '') {
    const trimmed = String(value || '').trim()
    if (!trimmed) return ''

    try {
        return new URL(trimmed).host.toLowerCase()
    } catch {
        return trimmed
            .replace(/^[a-z]+:\/\//i, '')
            .replace(/^\/\//, '')
            .split('/')[0]
            .toLowerCase()
    }
}

function getPreferredServerHost(animeId = '') {
    const cacheKey = String(animeId || '').trim().toLowerCase()
    return cacheKey ? preferredServerHostCache.get(cacheKey) || '' : ''
}

function rememberPreferredServerHost(animeId = '', ...values) {
    const cacheKey = String(animeId || '').trim().toLowerCase()
    if (!cacheKey) return

    for (const value of values) {
        const host = extractHost(value)
        if (!host) continue
        preferredServerHostCache.set(cacheKey, host)
        return
    }
}

function scoreServer(server = {}, preferredHostHint = '') {
    const label = String(server?.server_label || server?.server_class || '').toLowerCase()
    const url = String(server?.url || '').toLowerCase()
    const serverHost = extractHost(url)
    const preferredHost = extractHost(preferredHostHint)

    let score = 0

    if (label.includes('hd-2')) score += 100
    if (label.includes('hd-1')) score += 60

    if (url.includes('type=hd-2')) score += 40
    if (url.includes('type=hd-1')) score += 20

    if (url.includes('megacloud.') || url.includes('/stream/e-')) score += 120
    if (url.includes('megaplay.') || url.includes('/stream/s-')) score -= 120

    if (preferredHost && serverHost === preferredHost) {
        score += 240
    }

    return score
}

function isRejectedServer(server = {}) {
    const label = String(server?.server_label || server?.server_class || '').toLowerCase()
    const url = String(server?.url || '').toLowerCase()

    if (label.includes('cam')) return true
    if (label.includes('omega')) return true
    if (label.includes('moon')) return true
    if (url.includes('vidmoly.')) return true
    if (url.includes('filemoon.')) return true

    return false
}

function extractIframeSrc(html = '') {
    const text = String(html || '')
    const iframeMatch = text.match(/<iframe[^>]+src=["']([^"']+)["']/i)
    const value = iframeMatch?.[1] ? String(iframeMatch[1]).trim() : ''
    if (value.startsWith('//')) {
        return `https:${value}`
    }
    return value
}

function dedupeStrings(values = []) {
    const seen = new Set()
    const output = []

    for (const value of values) {
        const item = String(value || '').trim()
        if (!item || seen.has(item)) continue
        seen.add(item)
        output.push(item)
    }

    return output
}

function isDirectPlayableUrl(url = '') {
    const value = String(url || '').toLowerCase()
    return value.includes('.m3u8') || value.includes('.mp4')
}

function isKnownWrapperUrl(url = '') {
    const value = String(url || '').toLowerCase()

    return (
        value.includes('/newplayer.php') ||
        value.includes('/stream/s-') ||
        value.includes('megacloud.') ||
        value.includes('megaplay.') ||
        value.includes('bloggy.click') ||
        value.includes('vidmoly.') ||
        value.includes('filemoon.')
    )
}

function looksLikeHtmlDocument(text = '') {
    const value = String(text || '').trim().toLowerCase()
    return value.startsWith('<!doctype html') || value.startsWith('<html') || value.includes('<head>')
}

function looksLikeHlsManifest(text = '') {
    const value = String(text || '').trim()
    return value.startsWith('#EXTM3U') || value.includes('\n#EXTINF:') || value.includes('\n#EXT-X-')
}

function extractMegacloudRuntime(html = '') {
    const text = String(html || '')

    const epId =
        text.match(/data-ep-id=["'](\d+)["']/i)?.[1] ||
        text.match(/episode_id\s*[:=]\s*["']?(\d+)["']?/i)?.[1] ||
        ''

    const cid =
        text.match(/\bcid\s*:\s*['"]([^'"]+)['"]/i)?.[1] ||
        text.match(/\bcid\s*=\s*['"]([^'"]+)['"]/i)?.[1] ||
        ''

    const domain2Url =
        text.match(/\bdomain2_url\s*:\s*['"]([^'"]+)['"]/i)?.[1] ||
        ''

    const type =
        text.match(/\btype\s*:\s*['"]([^'"]+)['"]/i)?.[1] ||
        ''

    return {
        epId: String(epId || '').trim(),
        cid: String(cid || '').trim(),
        domain2Url: String(domain2Url || '').trim(),
        type: String(type || '').trim(),
    }
}

function extractMegaplayPlayerId(html = '') {
    const text = String(html || '')

    return (
        text.match(/id=["']megaplay-player["'][^>]*data-id=["']([^"']+)["']/i)?.[1] ||
        text.match(/data-id=["']([^"']+)["'][^>]*id=["']megaplay-player["']/i)?.[1] ||
        text.match(/id=["']megaplay-player["'][^>]*data-ep-id=["']([^"']+)["']/i)?.[1] ||
        text.match(/data-ep-id=["']([^"']+)["'][^>]*id=["']megaplay-player["']/i)?.[1] ||
        ''
    )
}

// Scan raw embed page HTML for any HLS .m3u8 URL that is NOT from DotStream CDN.
// Embed players (Megaplay, Megacloud, etc.) often embed the source URL directly
// in the page JS config, giving us a clean CDN URL without touching getSources.
// DotStream URLs are excluded because they are Cloudflare-protected.
function extractNonDotStreamUrlsFromHtml(html = '') {
    const text = String(html || '')

    // Match all raw https .m3u8 URLs found anywhere in the HTML source
    const allUrls = text.match(/https?:\/\/[^"'\s\\`<>]+\.m3u8(?:[^"'\s\\`<>]*)?/gi) || []

    const filtered = []
    for (const rawUrl of allUrls) {
        // Strip trailing junk characters
        const url = rawUrl.replace(/[,;)\]]+$/, '').trim()
        if (!url || !url.startsWith('http')) continue
        // Skip DotStream (Cloudflare-blocked)
        if (url.includes('dotstream') || url.includes('cdn.dotstream')) continue
        // Skip duplicates
        if (filtered.includes(url)) continue
        filtered.push(url)
    }

    return filtered
}

function buildPlaybackHeaders(refererUrl = '', originUrl = '') {
    const referer = String(refererUrl || '').trim()
    const origin = String(originUrl || '').trim() || originFromUrl(referer)
    const headers = {}

    if (referer) headers.Referer = referer
    if (origin) headers.Origin = origin

    return headers
}

function normalizeTrackList(tracks = []) {
    if (!Array.isArray(tracks)) return []

    return tracks
        .filter((track) => track && (track.file || track.src || track.url))
        .map((track) => ({
            url: String(track.file || track.src || track.url || '').trim(),
            lang: String(track.label || track.kind || 'Unknown').trim(),
            default: Boolean(track.default),
        }))
        .filter((track) => track.url)
}

function originFromUrl(url = '') {
    try {
        return new URL(url).origin
    } catch {
        return ''
    }
}

function classifyIframeUrl(url = '') {
    const value = String(url || '').toLowerCase()

    if (isDirectPlayableUrl(value)) return 'direct'
    if (value.includes('/stream/s-') || value.includes('megaplay.buzz/stream/')) return 'stream-player'
    if (value.includes('/stream/e-') || value.includes('megacloud.bloggy.click/stream/')) return 'stream-embed'
    if (value.includes('/embed-2/')) return 'embed-player'
    if (value.includes('vidmoly.') || value.includes('filemoon.') || value.includes('/embed-') || /\/e\/[^/]+/.test(value)) {
        return 'external-embed'
    }
    if (isKnownWrapperUrl(value)) return 'wrapper'
    return 'unknown'
}

// Extract the video ID from a Megacloud/Gogoanime-style embed URL.
// URL pattern: /<player>/e-1/<videoId>/<language>
// e.g. megacloud.bloggy.click/stream/e-1/16780/sub  → "16780"
//      megacloud.bloggy.click/embed-2/e-1/abc123    → "abc123"
//
// The ID is the segment AFTER the episode-type marker (e-1, e-2, etc.),
// NOT the last segment (which is often a language code like 'sub' or 'dub').
function extractEmbedVideoId(url = '') {
    const LANGUAGE_SUFFIXES = /^(sub|dub|raw|eng|jpn|ita|por|spa)$/i

    try {
        const parsed = new URL(String(url || ''))
        const parts = parsed.pathname.split('/').filter(Boolean)

        // Primary: find 'e-N' in path and take the NEXT segment as the ID
        const epTypeIndex = parts.findIndex((p) => /^e-\d+$/i.test(p))
        if (epTypeIndex >= 0) {
            const candidate = parts[epTypeIndex + 1] || ''
            if (candidate && !/\.\w+$/.test(candidate) && !LANGUAGE_SUFFIXES.test(candidate)) {
                return candidate
            }
        }

        // Fallback A: last segment if it's not a file extension and not a language suffix
        const last = parts[parts.length - 1] || ''
        if (last && !/\.\w+$/.test(last) && !LANGUAGE_SUFFIXES.test(last)) {
            return last
        }

        // Fallback B: second-to-last segment
        if (parts.length >= 2) {
            const prev = parts[parts.length - 2] || ''
            if (prev && !/\.\w+$/.test(prev)) return prev
        }
    } catch {
        // fall through
    }
    return ''
}

// Build the Megacloud getSources API endpoint by inferring the AJAX path from the embed URL.
// Pattern: /<player>/e-1/<videoId>  →  /<player>/ajax/e-1/getSources?id=<videoId>
// e.g. megacloud.bloggy.click/stream/e-1/16780  →  /stream/ajax/e-1/getSources?id=16780
//      megacloud.tv/embed-2/e-1/abc             →  /embed-2/ajax/e-1/getSources?id=abc
function buildMegacloudSourcesUrl(iframeUrl = '', videoId = '') {
    try {
        const parsed = new URL(String(iframeUrl || ''))
        const pathParts = parsed.pathname.split('/').filter(Boolean)

        // Find the 'e-N' segment (episode/embed type like e-1, e-2, e-4)
        const episodeSegmentIndex = pathParts.findIndex((part) => /^e-\d+$/i.test(part))

        if (episodeSegmentIndex > 0) {
            // Insert 'ajax' before the episode segment to get the AJAX endpoint
            const playerPath = pathParts.slice(0, episodeSegmentIndex).join('/')
            const episodeSegment = pathParts[episodeSegmentIndex]
            return `${parsed.origin}/${playerPath}/ajax/${episodeSegment}/getSources?id=${encodeURIComponent(videoId)}`
        }

        // Generic fallback if path pattern is unrecognized
        return `${parsed.origin}/embed-2/ajax/e-1/getSources?id=${encodeURIComponent(videoId)}`
    } catch {
        return ''
    }
}

function buildStreamPlayerSourcesUrls(iframeUrl = '', videoId = '') {
    try {
        const parsed = new URL(String(iframeUrl || ''))
        const pathParts = parsed.pathname.split('/').filter(Boolean)
        const episodeSegmentIndex = pathParts.findIndex((part) => /^[se]-\d+$/i.test(part))
        const urls = []

        if (episodeSegmentIndex > 0) {
            const playerPath = pathParts.slice(0, episodeSegmentIndex).join('/')
            const episodeSegment = pathParts[episodeSegmentIndex]

            urls.push(
                `${parsed.origin}/${playerPath}/ajax/${episodeSegment}/getSources?id=${encodeURIComponent(videoId)}`
            )
            urls.push(
                `${parsed.origin}/${playerPath}/ajax/${episodeSegment}/getSources?id=${encodeURIComponent(videoId)}&server=1`
            )
        }

        urls.push(`${parsed.origin}/stream/getSources?id=${encodeURIComponent(videoId)}`)
        urls.push(`${parsed.origin}/stream/getSources?id=${encodeURIComponent(videoId)}&server=1`)
        urls.push(
            `${parsed.origin}/stream/getSources?id=${encodeURIComponent(videoId)}&id=${encodeURIComponent(videoId)}`
        )

        return dedupeStrings(urls)
    } catch {
        return []
    }
}

function extractPlayableUrlsFromSourcesJson(payload = {}) {
    const urls = []
    const pushUrl = (value) => {
        const candidate = String(value || '').trim()
        if (!candidate) return
        urls.push(candidate)
    }

    if (typeof payload?.sources?.file === 'string') pushUrl(payload.sources.file)
    if (typeof payload?.file === 'string') pushUrl(payload.file)

    const sourceLists = [payload?.sources, payload?.source, payload?.backup, payload?.backups]

    for (const sourceList of sourceLists) {
        if (!Array.isArray(sourceList)) continue

        for (const source of sourceList) {
            pushUrl(source?.url)
            pushUrl(source?.file)
            pushUrl(source?.src)
        }
    }

    return dedupeStrings(urls)
}

async function validatePlayableUrl(
    playableUrl = '',
    headers = {},
    sessionId = null,
    explicitStreamType = '',
    context = {}
) {
    const normalizedUrl = String(playableUrl || '').trim()
    const streamType = detectAnimeStreamType(normalizedUrl, explicitStreamType)
    let activeSessionId = sessionId || null

    if (!normalizedUrl || !isDirectPlayableUrl(normalizedUrl)) {
        return { ok: false, playableUrl: '', streamType: '', sessionId: activeSessionId }
    }

    if (normalizedUrl.includes('dotstream')) {
        console.warn(`[animeAddons/${PROVIDER_ID}] rejecting DotStream candidate before handoff`, {
            ...context,
            playableUrl: normalizedUrl,
        })
        return { ok: false, playableUrl: '', streamType: '', sessionId: activeSessionId }
    }

    if (streamType === 'mp4') {
        return { ok: true, playableUrl: normalizedUrl, streamType, sessionId: activeSessionId }
    }

    try {
        const manifestResult = await fetchTextWithSession(
            normalizedUrl,
            {
                Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, application/x-mpegurl, */*',
                ...headers,
            },
            activeSessionId
        )
        activeSessionId = manifestResult.sessionId || activeSessionId
        const manifestText = manifestResult.text

        if (looksLikeHtmlDocument(manifestText) || !looksLikeHlsManifest(manifestText)) {
            console.warn(`[animeAddons/${PROVIDER_ID}] rejected non-manifest candidate`, {
                ...context,
                playableUrl: normalizedUrl,
                preview: String(manifestText || '').slice(0, 300),
            })
            return { ok: false, playableUrl: '', streamType: '', sessionId: activeSessionId }
        }

        return {
            ok: true,
            playableUrl: normalizedUrl,
            streamType,
            sessionId: activeSessionId,
        }
    } catch (error) {
        console.warn(`[animeAddons/${PROVIDER_ID}] manifest validation failed`, {
            ...context,
            playableUrl: normalizedUrl,
            error: error instanceof Error ? error.message : String(error),
        })
        return { ok: false, playableUrl: '', streamType: '', sessionId: activeSessionId }
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
        subtitles: normalizeTrackList(payload?.subtitles || payload?.tracks || []),
        sessionId: payload?.sessionId || sessionId || null,
        pageUrl: String(payload?.pageUrl || '').trim(),
        providerHost: String(payload?.providerHost || '').trim(),
    }
}

// Fetch Megacloud getSources and return { playableUrl, subtitles, sessionId }
// Returns null on network failure, { playableUrl: '' } if encrypted or empty.
async function tryMegacloudGetSources(iframeUrl, videoId, activeSessionId) {
    const sourcesUrl = buildMegacloudSourcesUrl(iframeUrl, videoId)
    if (!sourcesUrl) return null

    console.warn(`[animeAddons/${PROVIDER_ID}] megacloud getSources attempt`, {
        iframeUrl,
        sourcesUrl,
        videoId,
    })

    const sourcesResult = await fetchTextWithSession(
        sourcesUrl,
        {
            Referer: iframeUrl,
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        activeSessionId
    )
    const newSessionId = sourcesResult.sessionId || activeSessionId
    const sourcesText = sourcesResult.text

    let sourcesJson = null
    try {
        sourcesJson = JSON.parse(sourcesText)
    } catch {
        console.warn(`[animeAddons/${PROVIDER_ID}] megacloud getSources JSON parse failed`, {
            sourcesUrl,
            preview: String(sourcesText || '').slice(0, 400),
        })
        return { playableUrl: '', subtitles: [], sessionId: newSessionId }
    }

    // Encrypted response: sources is a string, not an array.
    // We cannot decrypt without the player's AES key — skip gracefully.
    if (typeof sourcesJson?.sources === 'string') {
        console.warn(`[animeAddons/${PROVIDER_ID}] megacloud getSources returned encrypted sources, skipping`, {
            sourcesUrl,
        })
        return { playableUrl: '', subtitles: [], sessionId: newSessionId }
    }

    const rawSources = Array.isArray(sourcesJson?.sources) ? sourcesJson.sources : []
    const playableUrl = extractPlayableUrlsFromSourcesJson(sourcesJson)[0] || ''
    const subtitles = normalizeTrackList(sourcesJson?.tracks || [])

    console.warn(`[animeAddons/${PROVIDER_ID}] megacloud getSources response`, {
        sourcesUrl,
        playableUrl: playableUrl || '(empty)',
        hasPlayableUrl: Boolean(playableUrl),
        subtitleCount: subtitles.length,
        sourceCount: rawSources.length,
    })

    return { playableUrl, subtitles, sessionId: newSessionId }
}

async function resolveServerToPlayableUrl(serverUrl = '', sessionId = null) {
    const normalizedServerUrl = String(serverUrl || '').trim().startsWith('//')
        ? `https:${String(serverUrl || '').trim()}`
        : String(serverUrl || '').trim()

    if (!normalizedServerUrl) {
        return {
            playableUrl: '',
            subtitles: [],
            streamType: '',
            headers: {},
            sessionId: sessionId || null,
        }
    }

    let activeSessionId = sessionId || null

    const wrapperResult = await fetchTextWithSession(
        normalizedServerUrl,
        { Referer: 'https://gogoanime.me.uk/' },
        activeSessionId
    )
    activeSessionId = wrapperResult.sessionId || activeSessionId
    const wrapperHtml = wrapperResult.text

    let activeIframeUrl = extractIframeSrc(wrapperHtml)
    let activeIframeReferer = normalizedServerUrl
    let iframeHtml = ''

    if (!activeIframeUrl) {
        const directServerHeaders = buildPlaybackHeaders(normalizedServerUrl)
        const directServerCandidates = extractNonDotStreamUrlsFromHtml(wrapperHtml)

        if (directServerCandidates.length > 0) {
            console.warn(`[animeAddons/${PROVIDER_ID}] direct server page html scan found candidates`, {
                serverUrl: normalizedServerUrl,
                count: directServerCandidates.length,
                found: directServerCandidates.slice(0, 5),
            })

            for (const directCandidate of directServerCandidates) {
                const validatedDirectCandidate = await validatePlayableUrl(
                    directCandidate,
                    directServerHeaders,
                    activeSessionId,
                    'hls',
                    { serverUrl: normalizedServerUrl, strategy: 'direct-server-html-scan' }
                )
                activeSessionId = validatedDirectCandidate.sessionId || activeSessionId

                if (!validatedDirectCandidate.ok) continue

                return {
                    playableUrl: validatedDirectCandidate.playableUrl,
                    subtitles: [],
                    streamType: validatedDirectCandidate.streamType,
                    headers: directServerHeaders,
                    sessionId: activeSessionId,
                }
            }
        }

        const serverUrlType = classifyIframeUrl(normalizedServerUrl)
        const canTreatServerAsEmbed =
            serverUrlType === 'external-embed' ||
            (!normalizedServerUrl.includes('/newplayer.php') && looksLikeHtmlDocument(wrapperHtml))

        if (canTreatServerAsEmbed) {
            console.warn(`[animeAddons/${PROVIDER_ID}] treating server url as direct embed page`, {
                serverUrl: normalizedServerUrl,
                serverUrlType,
            })

            activeIframeUrl = normalizedServerUrl
            activeIframeReferer = 'https://gogoanime.me.uk/'
            iframeHtml = wrapperHtml
        } else {
            console.warn(`[animeAddons/${PROVIDER_ID}] no iframe found in newplayer page`, { serverUrl: normalizedServerUrl })
            return {
                playableUrl: '',
                subtitles: [],
                streamType: '',
                headers: {},
                sessionId: activeSessionId,
            }
        }
    }

    for (let depth = 0; depth < 3; depth += 1) {
        if (isDirectPlayableUrl(activeIframeUrl)) {
            const directHeaders = buildPlaybackHeaders(activeIframeReferer)
            const validated = await validatePlayableUrl(
                activeIframeUrl,
                directHeaders,
                activeSessionId,
                '',
                { serverUrl, iframeUrl: activeIframeUrl, strategy: 'direct-iframe', depth }
            )

            if (validated.ok) {
                return {
                    playableUrl: validated.playableUrl,
                    subtitles: [],
                    streamType: validated.streamType,
                    headers: directHeaders,
                    sessionId: validated.sessionId,
                }
            }
        }

        const iframeResult = await fetchTextWithSession(
            activeIframeUrl,
            { Referer: activeIframeReferer },
            activeSessionId
        )
        if (iframeHtml && activeIframeUrl === normalizedServerUrl && depth === 0) {
            // Reuse the already fetched direct embed page HTML instead of refetching it immediately.
        } else {
            activeSessionId = iframeResult.sessionId || activeSessionId
            iframeHtml = iframeResult.text
        }

        const nestedIframeUrl = extractIframeSrc(iframeHtml)
        const shouldFollowNestedWrapper =
            nestedIframeUrl &&
            nestedIframeUrl !== activeIframeUrl &&
            !isDirectPlayableUrl(nestedIframeUrl) &&
            isKnownWrapperUrl(nestedIframeUrl)

        if (shouldFollowNestedWrapper) {
            console.warn(`[animeAddons/${PROVIDER_ID}] following nested wrapper iframe`, {
                depth,
                from: activeIframeUrl,
                to: nestedIframeUrl,
            })

            activeIframeReferer = activeIframeUrl
            activeIframeUrl = nestedIframeUrl
            continue
        }

        if (nestedIframeUrl && isDirectPlayableUrl(nestedIframeUrl)) {
            const nestedHeaders = buildPlaybackHeaders(activeIframeUrl)
            const validated = await validatePlayableUrl(
                nestedIframeUrl,
                nestedHeaders,
                activeSessionId,
                '',
                { serverUrl, iframeUrl: activeIframeUrl, nestedIframeUrl, strategy: 'nested-direct' }
            )

            if (validated.ok) {
                return {
                    playableUrl: validated.playableUrl,
                    subtitles: [],
                    streamType: validated.streamType,
                    headers: nestedHeaders,
                    sessionId: validated.sessionId,
                }
            }
        }

        break
    }

    const iframeUrlType = classifyIframeUrl(activeIframeUrl)
    const megacloudRuntime = extractMegacloudRuntime(iframeHtml)

    console.warn(`[animeAddons/${PROVIDER_ID}] megacloud runtime extracted`, {
        serverUrl: normalizedServerUrl,
        iframeUrl: activeIframeUrl,
        iframeUrlType,
        ...megacloudRuntime,
    })

    // Log a preview of the raw iframe HTML so we can inspect its content structure.
    // This is critical for diagnosing which extraction path to take.
    console.warn(`[animeAddons/${PROVIDER_ID}] iframe html preview`, {
        iframeUrl: activeIframeUrl,
        length: iframeHtml.length,
        preview: iframeHtml.slice(0, 600),
    })

    const genericEmbeddedUrls = extractNonDotStreamUrlsFromHtml(iframeHtml)
    if (genericEmbeddedUrls.length > 0) {
        console.warn(`[animeAddons/${PROVIDER_ID}] generic html scan found embedded stream urls`, {
            iframeUrl: activeIframeUrl,
            count: genericEmbeddedUrls.length,
            found: genericEmbeddedUrls.slice(0, 5),
        })

        const genericPlaybackHeaders = buildPlaybackHeaders(activeIframeUrl)
        for (const embeddedUrl of genericEmbeddedUrls) {
            const validatedEmbeddedUrl = await validatePlayableUrl(
                embeddedUrl,
                genericPlaybackHeaders,
                activeSessionId,
                'hls',
                { serverUrl: normalizedServerUrl, iframeUrl: activeIframeUrl, strategy: 'generic-html-scan' }
            )
            activeSessionId = validatedEmbeddedUrl.sessionId || activeSessionId

            if (!validatedEmbeddedUrl.ok) continue

            return {
                playableUrl: validatedEmbeddedUrl.playableUrl,
                subtitles: [],
                streamType: validatedEmbeddedUrl.streamType,
                headers: genericPlaybackHeaders,
                sessionId: activeSessionId,
            }
        }
    }

    if (iframeUrlType === 'external-embed' || iframeUrlType === 'unknown') {
        try {
            console.warn(`[animeAddons/${PROVIDER_ID}] attempting generic external embed capture`, {
                serverUrl: normalizedServerUrl,
                iframeUrl: activeIframeUrl,
                iframeUrlType,
            })

            const genericCapture = await tryDynamicEmbedCapture(activeIframeUrl, activeSessionId)
            activeSessionId = genericCapture.sessionId || activeSessionId

            if (genericCapture.playableUrl) {
                const genericCaptureHeaders = {
                    ...buildPlaybackHeaders(
                        genericCapture.pageUrl || activeIframeUrl,
                        originFromUrl(genericCapture.pageUrl || activeIframeUrl)
                    ),
                    ...(genericCapture.headers || {}),
                }

                const validatedGenericCapture = await validatePlayableUrl(
                    genericCapture.playableUrl,
                    genericCaptureHeaders,
                    activeSessionId,
                    genericCapture.streamType || 'hls',
                    { serverUrl: normalizedServerUrl, iframeUrl: activeIframeUrl, strategy: 'generic-external-capture' }
                )
                activeSessionId = validatedGenericCapture.sessionId || activeSessionId

                if (validatedGenericCapture.ok) {
                    return {
                        playableUrl: validatedGenericCapture.playableUrl,
                        subtitles: genericCapture.subtitles || [],
                        streamType: validatedGenericCapture.streamType,
                        headers: genericCaptureHeaders,
                        sessionId: activeSessionId,
                    }
                }
            }
        } catch (genericCaptureError) {
            console.warn(`[animeAddons/${PROVIDER_ID}] generic external embed capture failed`, {
                serverUrl: normalizedServerUrl,
                iframeUrl: activeIframeUrl,
                error: genericCaptureError instanceof Error ? genericCaptureError.message : String(genericCaptureError),
            })
        }
    }

    // -----------------------------------------------------------------------
    // STREAM PLAYER PATH
    // Both megaplay.buzz and megacloud.bloggy.click use this platform.
    // Three escalating strategies, all of which SKIP DotStream results
    // (DotStream is Cloudflare-blocked and the warmup doesn't solve it).
    // -----------------------------------------------------------------------
    const isStreamPlayerDomain =
        iframeUrlType === 'stream-player' || iframeUrlType === 'stream-embed'

    if (isStreamPlayerDomain) {
        // ------------------------------------------------------------------
        // Strategy 0: Scan the raw iframe HTML for embedded non-DotStream
        // .m3u8 URLs. Many embed players include the stream URL directly
        // in the page JS config (sources array, file variable, etc.).
        // This completely bypasses getSources and DotStream.
        // ------------------------------------------------------------------
        const embeddedUrls = extractNonDotStreamUrlsFromHtml(iframeHtml)

        console.warn(`[animeAddons/${PROVIDER_ID}] html scan for embedded stream urls`, {
            iframeUrl: activeIframeUrl,
            count: embeddedUrls.length,
            found: embeddedUrls.slice(0, 5),
        })

        if (embeddedUrls.length > 0) {
            const playbackHeaders = buildPlaybackHeaders(activeIframeUrl)

            for (const playableUrl of embeddedUrls) {
                const validated = await validatePlayableUrl(
                    playableUrl,
                    playbackHeaders,
                    activeSessionId,
                    'hls',
                    { serverUrl, iframeUrl: activeIframeUrl, strategy: 'html-scan' }
                )
                activeSessionId = validated.sessionId || activeSessionId

                if (!validated.ok) continue

                console.warn(`[animeAddons/${PROVIDER_ID}] html scan found playable url`, {
                    iframeUrl: activeIframeUrl,
                    playableUrl: validated.playableUrl,
                })

                return {
                    playableUrl: validated.playableUrl,
                    subtitles: [],
                    streamType: validated.streamType,
                    headers: playbackHeaders,
                    sessionId: activeSessionId,
                }
            }
        }

        // ------------------------------------------------------------------
        // Strategy 1: getSources AJAX endpoint — but SKIP DotStream results.
        // If getSources returns mewcdn or another CDN, use it.
        // If it returns DotStream, treat as empty and fall through.
        // ------------------------------------------------------------------
        let playerDataId = extractMegaplayPlayerId(iframeHtml)
        if (!playerDataId) {
            playerDataId = extractEmbedVideoId(activeIframeUrl) || ''
        }

        if (!playerDataId) {
            console.warn(`[animeAddons/${PROVIDER_ID}] stream player id not found, skipping getSources`, {
                serverUrl,
                iframeUrl: activeIframeUrl,
            })
        } else {
            const preferredStreamOrigin = originFromUrl(activeIframeUrl) || 'https://megaplay.buzz'
            const preferredSourcesUrls = buildStreamPlayerSourcesUrls(activeIframeUrl, playerDataId)

            for (const preferredSourcesUrl of preferredSourcesUrls) {
                console.warn(`[animeAddons/${PROVIDER_ID}] preferred stream getSources attempt`, {
                    iframeUrl: activeIframeUrl,
                    sourcesUrl: preferredSourcesUrl,
                    playerDataId,
                })

                const preferredSourcesResult = await fetchTextWithSession(
                    preferredSourcesUrl,
                    {
                        Referer: activeIframeUrl,
                        'X-Requested-With': 'XMLHttpRequest',
                        Accept: 'application/json, text/javascript, */*; q=0.01',
                    },
                    activeSessionId
                )
                activeSessionId = preferredSourcesResult.sessionId || activeSessionId
                const preferredSourcesText = preferredSourcesResult.text

                let preferredSourcesJson = null
                try {
                    preferredSourcesJson = JSON.parse(preferredSourcesText)
                } catch (error) {
                    console.warn(`[animeAddons/${PROVIDER_ID}] preferred stream getSources JSON parse failed`, {
                        iframeUrl: activeIframeUrl,
                        sourcesUrl: preferredSourcesUrl,
                        detail: error instanceof Error ? error.message : String(error),
                        preview: String(preferredSourcesText || '').slice(0, 600),
                    })
                    continue
                }

                const preferredSubtitles = normalizeTrackList(preferredSourcesJson?.tracks || [])
                const preferredCandidates = extractPlayableUrlsFromSourcesJson(preferredSourcesJson)

                for (const preferredCandidate of preferredCandidates) {
                    const preferredHeaders = buildPlaybackHeaders(activeIframeUrl, preferredStreamOrigin)
                    const validated = await validatePlayableUrl(
                        preferredCandidate,
                        preferredHeaders,
                        activeSessionId,
                        'hls',
                        {
                            serverUrl,
                            iframeUrl: activeIframeUrl,
                            sourcesUrl: preferredSourcesUrl,
                            strategy: 'preferred-stream-getSources',
                        }
                    )
                    activeSessionId = validated.sessionId || activeSessionId

                    if (!validated.ok) continue

                    console.warn(`[animeAddons/${PROVIDER_ID}] preferred stream getSources resolved playable url`, {
                        iframeUrl: activeIframeUrl,
                        sourcesUrl: preferredSourcesUrl,
                        candidate: validated.playableUrl,
                    })

                    return {
                        playableUrl: validated.playableUrl,
                        subtitles: preferredSubtitles,
                        streamType: validated.streamType,
                        headers: preferredHeaders,
                        sessionId: activeSessionId,
                    }
                }
            }

            const streamOrigin = originFromUrl(activeIframeUrl) || 'https://megaplay.buzz'
            const sourcesUrl = `${streamOrigin}/stream/getSources?id=${encodeURIComponent(playerDataId)}&id=${encodeURIComponent(playerDataId)}`

            console.warn(`[animeAddons/${PROVIDER_ID}] stream getSources attempt`, {
                iframeUrl: activeIframeUrl,
                sourcesUrl,
                playerDataId,
            })

            const sourcesResult = await fetchTextWithSession(
                sourcesUrl,
                {
                    Referer: activeIframeUrl,
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/json, text/javascript, */*; q=0.01',
                },
                activeSessionId
            )
            activeSessionId = sourcesResult.sessionId || activeSessionId
            const sourcesText = sourcesResult.text

            let sourcesJson = null
            try {
                sourcesJson = JSON.parse(sourcesText)
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] stream getSources JSON parse failed`, {
                    iframeUrl: activeIframeUrl,
                    sourcesUrl,
                    detail: error instanceof Error ? error.message : String(error),
                    preview: String(sourcesText || '').slice(0, 600),
                })
            }

            if (sourcesJson) {
                // Handle both response formats:
                // 1. Megaplay format:   { sources: { file: "url" } }
                // 2. Megacloud format:  { sources: [{ url: "url", isM3U8: true }] }
                let rawUrl = ''

                if (typeof sourcesJson?.sources?.file === 'string' && sourcesJson.sources.file) {
                    rawUrl = sourcesJson.sources.file
                } else if (Array.isArray(sourcesJson?.sources) && sourcesJson.sources.length > 0) {
                    const src =
                        sourcesJson.sources.find(
                            (s) =>
                                s?.isM3U8 ||
                                String(s?.type || '').toLowerCase() === 'hls' ||
                                String(s?.url || s?.file || '').includes('.m3u8')
                        ) || sourcesJson.sources[0]
                    rawUrl = String(src?.url || src?.file || '')
                }

                const candidate = rawUrl.trim()

                // CRITICAL: Skip DotStream — it is Cloudflare-blocked.
                // Only return a URL if it's from a CDN we can actually reach.
                if (candidate && candidate.includes('dotstream')) {
                    console.warn(`[animeAddons/${PROVIDER_ID}] stream getSources returned DotStream URL — skipping (Cloudflare blocked)`, {
                        iframeUrl: activeIframeUrl,
                        sourcesUrl,
                        candidate,
                    })
                } else if (candidate) {
                    const subtitles = normalizeTrackList(sourcesJson?.tracks || [])
                    const validatedLegacyCandidate = await validatePlayableUrl(
                        candidate,
                        buildPlaybackHeaders(activeIframeUrl, streamOrigin),
                        activeSessionId,
                        'hls',
                        { serverUrl, iframeUrl: activeIframeUrl, sourcesUrl, strategy: 'legacy-stream-getSources' }
                    )
                    activeSessionId = validatedLegacyCandidate.sessionId || activeSessionId

                    if (!validatedLegacyCandidate.ok) {
                        console.warn(`[animeAddons/${PROVIDER_ID}] legacy stream getSources candidate failed validation`, {
                            iframeUrl: activeIframeUrl,
                            sourcesUrl,
                            candidate,
                        })
                    } else {
                        console.warn(`[animeAddons/${PROVIDER_ID}] stream getSources resolved non-DotStream url`, {
                            iframeUrl: activeIframeUrl,
                            sourcesUrl,
                            candidate: validatedLegacyCandidate.playableUrl,
                            rawPreview: JSON.stringify(sourcesJson).slice(0, 400),
                        })

                        return {
                            playableUrl: validatedLegacyCandidate.playableUrl,
                            subtitles,
                            streamType: validatedLegacyCandidate.streamType,
                            headers: {
                                Referer: activeIframeUrl,
                                Origin: streamOrigin,
                            },
                            sessionId: activeSessionId,
                        }
                    }
                } else {
                    console.warn(`[animeAddons/${PROVIDER_ID}] stream getSources returned empty sources`, {
                        iframeUrl: activeIframeUrl,
                        sourcesUrl,
                        rawPreview: JSON.stringify(sourcesJson).slice(0, 400),
                    })
                }
            }
        }

        // All stream player strategies exhausted — fall through to wrapper extraction
        console.warn(`[animeAddons/${PROVIDER_ID}] stream player strategies exhausted, falling through`, {
            iframeUrl: activeIframeUrl,
        })
    }

    // --- Megacloud / generic wrapper iframe extraction ---
    // Try to resolve a playable URL via the Megacloud getSources API.
    // The video ID lives in the iframe URL path (last segment).
    // We use epId from the runtime as a fallback if the URL extraction fails.
    const embedVideoId = extractEmbedVideoId(activeIframeUrl) || megacloudRuntime.epId

    console.warn(`[animeAddons/${PROVIDER_ID}] attempting megacloud wrapper extraction`, {
        serverUrl,
        iframeUrl: activeIframeUrl,
        embedVideoId: embedVideoId || '(none)',
        ...megacloudRuntime,
    })

    if (embedVideoId) {
        // Strategy B (first): Megacloud getSources AJAX endpoint.
        // This is authoritative — the server returns the actual CDN URL directly.
        // Must run BEFORE domain2Url+cid guessing to avoid wrong-path 500 errors.
        try {
            const megacloudResult = await tryMegacloudGetSources(
                activeIframeUrl,
                embedVideoId,
                activeSessionId
            )

            if (megacloudResult?.sessionId) {
                activeSessionId = megacloudResult.sessionId
            }

            const megacloudUrl = megacloudResult?.playableUrl || ''

            if (megacloudUrl && isDirectPlayableUrl(megacloudUrl)) {
                const validatedMegacloud = await validatePlayableUrl(
                    megacloudUrl,
                    buildPlaybackHeaders(activeIframeUrl),
                    activeSessionId,
                    'hls',
                    { serverUrl, iframeUrl: activeIframeUrl, strategy: 'megacloud-getSources' }
                )
                activeSessionId = validatedMegacloud.sessionId || activeSessionId

                if (!validatedMegacloud.ok) {
                    throw new Error('Megacloud getSources returned an invalid manifest')
                }

                console.warn(`[animeAddons/${PROVIDER_ID}] megacloud extraction succeeded (getSources)`, {
                    serverUrl,
                    iframeUrl: activeIframeUrl,
                    megacloudUrl: validatedMegacloud.playableUrl,
                    sessionId: activeSessionId,
                })

                return {
                    playableUrl: validatedMegacloud.playableUrl,
                    subtitles: megacloudResult?.subtitles || [],
                    streamType: validatedMegacloud.streamType,
                    headers: buildPlaybackHeaders(activeIframeUrl),
                    sessionId: activeSessionId,
                }
            }
        } catch (megacloudError) {
            console.warn(`[animeAddons/${PROVIDER_ID}] megacloud getSources threw`, {
                serverUrl,
                iframeUrl: activeIframeUrl,
                embedVideoId,
                error: megacloudError instanceof Error ? megacloudError.message : String(megacloudError),
            })
        }

        try {
            console.warn(`[animeAddons/${PROVIDER_ID}] attempting dynamic embed capture`, {
                serverUrl,
                iframeUrl: activeIframeUrl,
                strategy: 'dynamic-capture',
            })

            const dynamicCapture = await tryDynamicEmbedCapture(activeIframeUrl, activeSessionId)
            activeSessionId = dynamicCapture.sessionId || activeSessionId

            if (dynamicCapture.playableUrl) {
                const captureHeaders = {
                    ...buildPlaybackHeaders(
                        dynamicCapture.pageUrl || activeIframeUrl,
                        originFromUrl(dynamicCapture.pageUrl || activeIframeUrl)
                    ),
                    ...(dynamicCapture.headers || {}),
                }

                const validatedCapture = await validatePlayableUrl(
                    dynamicCapture.playableUrl,
                    captureHeaders,
                    activeSessionId,
                    dynamicCapture.streamType || 'hls',
                    { serverUrl, iframeUrl: activeIframeUrl, strategy: 'dynamic-capture' }
                )
                activeSessionId = validatedCapture.sessionId || activeSessionId

                if (validatedCapture.ok) {
                    console.warn(`[animeAddons/${PROVIDER_ID}] dynamic embed capture resolved playable url`, {
                        serverUrl,
                        iframeUrl: activeIframeUrl,
                        playableUrl: validatedCapture.playableUrl,
                        providerHost: dynamicCapture.providerHost,
                        subtitleCount: Array.isArray(dynamicCapture.subtitles) ? dynamicCapture.subtitles.length : 0,
                    })

                    return {
                        playableUrl: validatedCapture.playableUrl,
                        subtitles: dynamicCapture.subtitles || [],
                        streamType: validatedCapture.streamType,
                        headers: captureHeaders,
                        sessionId: activeSessionId,
                    }
                }
            }
        } catch (dynamicCaptureError) {
            console.warn(`[animeAddons/${PROVIDER_ID}] dynamic embed capture failed`, {
                serverUrl,
                iframeUrl: activeIframeUrl,
                error: dynamicCaptureError instanceof Error ? dynamicCaptureError.message : String(dynamicCaptureError),
            })
        }

        // Strategy A (fallback): domain2Url + cid direct HLS construction.
        // Only used if getSources fails or returns nothing.
        // NOTE: domain2_url + cid gives an approximate URL — it may need the correct
        // subfolder prefix (e.g. /hls/<cid>/) which we don't know without getSources.
        if (megacloudRuntime.domain2Url && megacloudRuntime.cid) {
            const base = String(megacloudRuntime.domain2Url).replace(/\/$/, '')
            const cid = String(megacloudRuntime.cid).replace(/^\//, '')

            const candidatePaths = [
                `${base}/hls/${cid}/master.m3u8`,
                `${base}/${cid}/master.m3u8`,
                `${base}/hls/${cid}/playlist.m3u8`,
                `${base}/${cid}/playlist.m3u8`,
            ]

            console.warn(`[animeAddons/${PROVIDER_ID}] trying domain2Url+cid fallback paths`, {
                domain2Url: megacloudRuntime.domain2Url,
                cid: megacloudRuntime.cid,
                candidates: candidatePaths,
            })

            for (const candidateUrl of candidatePaths) {
                if (isDirectPlayableUrl(candidateUrl)) {
                    const validatedFallback = await validatePlayableUrl(
                        candidateUrl,
                        buildPlaybackHeaders(activeIframeUrl),
                        activeSessionId,
                        'hls',
                        { serverUrl, iframeUrl: activeIframeUrl, strategy: 'domain2-cid-fallback' }
                    )
                    activeSessionId = validatedFallback.sessionId || activeSessionId

                    if (!validatedFallback.ok) {
                        continue
                    }

                    console.warn(`[animeAddons/${PROVIDER_ID}] domain2Url+cid fallback candidate`, {
                        candidateUrl: validatedFallback.playableUrl,
                    })
                    return {
                        playableUrl: validatedFallback.playableUrl,
                        subtitles: [],
                        streamType: validatedFallback.streamType,
                        headers: buildPlaybackHeaders(activeIframeUrl),
                        sessionId: activeSessionId,
                    }
                }
            }
        }
    }

    console.warn(`[animeAddons/${PROVIDER_ID}] wrapper iframe extraction exhausted all strategies`, {
        serverUrl,
        iframeUrl: activeIframeUrl,
        embedVideoId: embedVideoId || '(none)',
    })

    return {
        playableUrl: '',
        subtitles: [],
        streamType: '',
        headers: {},
        sessionId: activeSessionId,
    }
}

async function fetchProviderSearchResults(query) {
    const cacheKey = String(query || '').trim().toLowerCase()
    return getCachedPromise(searchResultCache, cacheKey, () => (
        gogoanimeSearch(query)
    ))
}

async function fetchProviderAnimeInfo(animeId) {
    const cacheKey = String(animeId || '').trim().toLowerCase()
    return getCachedPromise(animeInfoCache, cacheKey, () => (
        gogoanimeGetAnime(animeId)
    ))
}

async function fetchProviderStreamingLinks(animeId, episodeNumber) {
    const cacheKey = `${String(animeId || '').trim().toLowerCase()}::${Number(episodeNumber) || 0}`
    return getCachedPromise(streamingLinksCache, cacheKey, () => (
        gogoanimeGetStreamingLinks(animeId, Number(episodeNumber))
    ))
}

const gogoanimeProvider = {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,

    async searchAnime({ titles = [] } = {}) {
        const searchTitles = uniqueTitles(titles)
        const results = []

        for (const title of searchTitles) {
            try {
                console.warn(`[animeAddons/${PROVIDER_ID}] search start`, { title })

                const data = await fetchProviderSearchResults(title)
                const rawItems = Array.isArray(data) ? data : []

                for (const item of rawItems) {
                    const normalized = normalizeSearchItem(item)
                    if (normalized) {
                        results.push(normalized)
                    }
                }
            } catch (error) {
                console.warn(`[animeAddons/${PROVIDER_ID}] search failed for "${title}"`, error)
            }
        }

        const deduped = dedupeBy(results, (item) => item?.animeId)

        console.warn(`[animeAddons/${PROVIDER_ID}] search done`, {
            resultCount: deduped.length,
        })

        return deduped
    },

    async buildProviderState({ match } = {}) {
        if (!match?.animeId) return null

        const animeInfo = await fetchProviderAnimeInfo(match.animeId)
        const { canonicalAnimeId, episodes } = normalizeAnimeInfoPayload(animeInfo, match.animeId)

        if (canonicalAnimeId && canonicalAnimeId !== match.animeId) {
            console.warn(`[animeAddons/${PROVIDER_ID}] canonical anime id differs from search match`, {
                searchAnimeId: match.animeId,
                canonicalAnimeId,
            })
        }

        return {
            providerId: PROVIDER_ID,
            providerLabel: PROVIDER_LABEL,
            animeId: canonicalAnimeId || match.animeId,
            title: match.title || match.matchedTitle || '',
            image: match.image || '',
            matchedTitle: match.matchedTitle || match.title || '',
            episodes,
            streamCandidatesByEpisode: {},
            meta: {
                match,
                animeInfo,
            },
        }
    },

    async getEpisodes({ animeId } = {}) {
        if (!animeId) return []

        try {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes start`, { animeId })

            const data = await fetchProviderAnimeInfo(animeId)
            const { canonicalAnimeId, episodes } = normalizeAnimeInfoPayload(data, animeId)

            if (canonicalAnimeId && canonicalAnimeId !== animeId) {
                console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes canonical anime id differs`, {
                    requestedAnimeId: animeId,
                    canonicalAnimeId,
                })
            }

            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes done`, {
                animeId: canonicalAnimeId || animeId,
                episodeCount: episodes.length,
            })

            return episodes
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes failed`, error)
            return []
        }
    },

    async getStreams({ animeId = '', episodeId } = {}) {
        const episodeNumber = Number(episodeId || 0)
        if (!animeId || !episodeNumber) return []

        try {
            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams start`, {
                animeId,
                episodeId,
            })

            const data = await fetchProviderStreamingLinks(animeId, episodeNumber)
            const rawServers = Array.isArray(data?.servers) ? data.servers : []

            if (data?.anime_id && String(data.anime_id).trim() !== String(animeId).trim()) {
                console.warn(`[animeAddons/${PROVIDER_ID}] streaming-links anime id mismatch`, {
                    requestedAnimeId: animeId,
                    responseAnimeId: data?.anime_id,
                    episodeId,
                })
            }

            if (Number(data?.episode_no || 0) && Number(data.episode_no) !== episodeNumber) {
                console.warn(`[animeAddons/${PROVIDER_ID}] streaming-links episode mismatch`, {
                    requestedEpisodeNumber: episodeNumber,
                    responseEpisodeNumber: data?.episode_no,
                    animeId,
                })
            }

            const supportedServers = rawServers.filter((server) => !isRejectedServer(server))
            const rejectedServers = rawServers.filter((server) => isRejectedServer(server))

            if (rejectedServers.length > 0) {
                console.warn(`[animeAddons/${PROVIDER_ID}] rejecting unsupported/cam servers`, {
                    animeId,
                    episodeId,
                    rejectedServers: rejectedServers.map((server) => ({
                        serverLabel: server?.server_label || server?.server_class || '',
                        serverUrl: server?.url || '',
                    })),
                })
            }

            const preferredServerHost = getPreferredServerHost(animeId)
            const sortedServers = [...supportedServers].sort(
                (a, b) => scoreServer(b, preferredServerHost) - scoreServer(a, preferredServerHost)
            )
            const candidates = []
            let firstResolvedCandidate = null

            for (const server of sortedServers) {
                const serverUrl = String(server?.url || '').trim()
                if (!serverUrl) continue

                try {
                    console.warn(`[animeAddons/${PROVIDER_ID}] resolving server`, {
                        animeId,
                        episodeId,
                        serverLabel: server?.server_label || server?.server_class || '',
                        serverUrl,
                    })

                    const resolved = await resolveServerToPlayableUrl(serverUrl, null)
                    const playableUrl = resolved?.playableUrl || ''

                    if (!playableUrl || !isDirectPlayableUrl(playableUrl)) {
                        continue
                    }

                    const streamType = resolved?.streamType || detectAnimeStreamType(playableUrl, '')
                    const serverLabel = String(server?.server_label || server?.server_class || 'server').trim()
                    const candidate = createAnimeStreamCandidate({
                        id: buildAnimeStreamCandidateId({
                            providerId: PROVIDER_ID,
                            animeId,
                            episodeId: String(episodeNumber),
                            url: playableUrl,
                            quality: serverLabel,
                        }),
                        providerId: PROVIDER_ID,
                        providerLabel: PROVIDER_LABEL,
                        animeId,
                        episodeId: String(episodeNumber),
                        url: playableUrl,
                        streamType,
                        quality: serverLabel,
                        resolution: 0,
                        headers: resolved?.headers || {},
                        streamSessionId: resolved?.sessionId || null,
                        subtitles: resolved?.subtitles || [],
                        score: scoreServer(server, preferredServerHost),
                        flags: {
                            direct: streamType === 'mp4',
                            requiresHeaders: false,
                            // DotStream CDN is Cloudflare-protected at the manifest level.
                            // Mark as unstable so Megacloud candidates rank higher.
                            maybeUnstable: playableUrl.includes('cdn.dotstream.buzz'),
                        },
                        raw: {
                            server,
                            playableUrl,
                        },
                    })

                    console.warn(`[animeAddons/${PROVIDER_ID}] candidate session`, {
                        animeId,
                        episodeId,
                        serverLabel,
                        playableUrl,
                        streamSessionId: resolved?.sessionId || null,
                    })
                    rememberPreferredServerHost(
                        animeId,
                        resolved?.providerHost,
                        resolved?.pageUrl,
                        serverUrl,
                        playableUrl
                    )
                    candidates.push(candidate)
                    firstResolvedCandidate = candidate
                    console.warn(`[animeAddons/${PROVIDER_ID}] stopping after first validated candidate`, {
                        animeId,
                        episodeId,
                        serverLabel,
                        playableUrl,
                    })
                    break
                } catch (serverError) {
                    console.warn(`[animeAddons/${PROVIDER_ID}] server resolve failed`, {
                        animeId,
                        episodeId,
                        serverLabel: server?.server_label || server?.server_class || '',
                        serverUrl,
                        error: serverError instanceof Error ? serverError.message : String(serverError),
                    })
                }
            }

            const deduped = dedupeBy(candidates, (item) => item?.url)

            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams done`, {
                animeId,
                episodeId,
                serverCount: rawServers.length,
                supportedServerCount: supportedServers.length,
                candidateCount: deduped.length,
                firstCandidateUrl: firstResolvedCandidate?.url || '',
            })

            return deduped
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getStreams failed`, error)
            return []
        }
    },
}

export default gogoanimeProvider 
