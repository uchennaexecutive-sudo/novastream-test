import { getEnabledAnimeAddonProviders } from './index'

const providerStateCache = new Map()

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
}

function logAnimeTiming(stage, details = {}) {
    console.info('[animeAddons/timing]', {
        stage,
        ...details,
    })
}

function normalizeText(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function tokenizeText(value = '') {
    return normalizeText(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
}

function extractDescriptorTokens(titles = []) {
    const tokens = new Set()

    for (const rawTitle of titles) {
        const title = String(rawTitle || '').trim()
        if (!title) continue

        // Extract season number as a token before stripping it — "Season 3" → "3"
        const seasonNumMatch = title.match(/\bSeason\s+(\d+)\b/i) || title.match(/\b(\d+)(?:st|nd|rd|th)\s+Season\b/i)
        if (seasonNumMatch?.[1]) {
            tokens.add(seasonNumMatch[1])
        }

        const seasonless = title
            .replace(/\bSeason\s+\d+\b/gi, ' ')
            .replace(/\bCour\s+\d+\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        const descriptorParts = []
        const colonIndex = seasonless.indexOf(':')
        if (colonIndex >= 0) {
            descriptorParts.push(seasonless.slice(colonIndex + 1))
        }

        const dashMatch = seasonless.match(/\s-\s(.+)$/)
        if (dashMatch?.[1]) {
            descriptorParts.push(dashMatch[1])
        }

        for (const part of descriptorParts) {
            for (const token of tokenizeText(part)) {
                if (token.length >= 4 || /^\d+$/.test(token)) {
                    tokens.add(token)
                }
            }
        }
    }

    return Array.from(tokens)
}

function countTokenOverlap(baseTitle = '', tokens = []) {
    if (!tokens.length) return 0

    const titleTokens = new Set(tokenizeText(baseTitle))
    let overlap = 0

    for (const token of tokens) {
        if (titleTokens.has(token)) {
            overlap += 1
        }
    }

    return overlap
}

function uniqueTitles(titles = []) {
    const seen = new Set()
    const output = []

    for (const value of titles.flat()) {
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

function scoreMatch(match, titles = []) {
    const baseTitle = normalizeText(match?.title || match?.matchedTitle || '')
    if (!baseTitle) return -1

    const slugNormalized = normalizeText(match?.animeId || '')
    const descriptorTokens = extractDescriptorTokens(titles)
    const descriptorOverlap = Math.max(
        countTokenOverlap(baseTitle, descriptorTokens),
        countTokenOverlap(slugNormalized, descriptorTokens)
    )
    const requestsDub = titles.some((rawTitle) => /\bdub\b/i.test(String(rawTitle || '')))
    const requestsSub = titles.some((rawTitle) => /\bsub\b/i.test(String(rawTitle || '')))
    const isDubMatch =
        /\bdub\b/i.test(String(match?.title || '')) ||
        /\bdub\b/i.test(String(match?.matchedTitle || '')) ||
        /-dub$/i.test(String(match?.animeId || ''))
    const isSubMatch =
        /\bsub\b/i.test(String(match?.title || '')) ||
        /\bsub\b/i.test(String(match?.matchedTitle || '')) ||
        /-sub$/i.test(String(match?.animeId || ''))

    let best = -1

    for (const rawTitle of titles) {
        const title = normalizeText(rawTitle)
        if (!title) continue

        let score = 0

        if (baseTitle === title) score += 200
        else if (baseTitle.startsWith(title)) score += 120
        else if (baseTitle.includes(title)) score += 80
        else if (title.includes(baseTitle)) score += 50

        if (descriptorTokens.length) {
            score += descriptorOverlap * 50

            if (descriptorOverlap === 0) {
                score -= 35
            }
        }

        if (requestsDub) {
            if (isDubMatch) score += 40
            else score -= 40
        } else {
            if (isDubMatch) score -= 60
        }

        if (requestsSub && isSubMatch) score += 20

        if (score > best) best = score
    }

    return best
}

function findEpisodeForNumber(episodes = [], targetEpisode) {
    const episodeNumber = Number(targetEpisode || 0)
    if (!episodeNumber) return null

    return (
        episodes.find((item) => Number(item?.number) === episodeNumber) || null
    )
}

function dedupeCandidates(candidates = []) {
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

function getProviderPriorityScore(providerId = '') {
    if (providerId === 'gogoanime') return 120
    if (providerId === 'animekai') return 60
    return 0
}

function scoreCandidate(candidate, preferredProviderId = '', failedUrls = new Set()) {
    let score = Number(candidate?.score || 0)

    score += getProviderPriorityScore(candidate?.providerId || '')

    if (candidate?.providerId && candidate.providerId === preferredProviderId) {
        score += 40
    }

    if (candidate?.streamType === 'hls') score += 25
    if (candidate?.streamType === 'mp4') score -= 10

    if (Number(candidate?.resolution || 0) >= 1080) score += 15
    else if (Number(candidate?.resolution || 0) >= 720) score += 10

    if (candidate?.flags?.requiresHeaders) score -= 5
    if (candidate?.flags?.maybeUnstable) score -= 10

    if (failedUrls.has(candidate?.url)) score -= 1000

    return score
}

function withTimeout(promise, ms, label = 'operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            window.setTimeout(() => {
                reject(new Error(`${label} timed out after ${ms}ms`))
            }, ms)
        }),
    ])
}

function getProviderMaxSearchTitles(providerId = '') {
    if (providerId === 'gogoanime') return 6
    if (providerId === 'animepahe') return 5
    if (providerId === 'animekai') return 5
    return 3
}

function getProviderSearchTimeoutMs(providerId = '') {
    if (providerId === 'gogoanime') return 45000
    if (providerId === 'animepahe') return 40000
    if (providerId === 'animekai') return 20000
    return 12000
}

function getProviderStateTimeoutMs(providerId = '') {
    if (providerId === 'gogoanime') return 90000
    if (providerId === 'animepahe') return 90000
    if (providerId === 'animekai') return 30000
    return 15000
}

function getProviderStreamsTimeoutMs(providerId = '') {
    if (providerId === 'gogoanime') return 45000
    if (providerId === 'animepahe') return 35000
    if (providerId === 'animekai') return 25000
    return 8000
}

function buildProviderStateCacheKey(providerId = '', searchTitles = []) {
    return `${providerId}::${searchTitles.join('::').toLowerCase()}`
}

async function resolveProviderState(provider, titles = [], { forceFresh = false } = {}) {
    const providerId = provider?.id || ''
    const maxSearchTitles = getProviderMaxSearchTitles(providerId)
    const searchTitles = uniqueTitles(titles).slice(0, maxSearchTitles)
    const cacheKey = buildProviderStateCacheKey(providerId, searchTitles)

    if (!providerId || !searchTitles.length) return null

    if (forceFresh) {
        providerStateCache.delete(cacheKey)
    } else if (providerStateCache.has(cacheKey)) {
        logAnimeTiming('providerState.cacheHit', {
            providerId,
            titleCount: searchTitles.length,
        })
        return providerStateCache.get(cacheKey)
    }

    const promise = (async () => {
        const totalStart = nowMs()

        try {
            console.warn(`[animeAddons] search titles`, {
                providerId,
                searchTitles,
            })

            const searchStart = nowMs()
            const matches = await withTimeout(
                provider.searchAnime({ titles: searchTitles }),
                getProviderSearchTimeoutMs(providerId),
                `${providerId || 'anime-provider'} searchAnime`
            )
            logAnimeTiming('searchAnime', {
                providerId,
                elapsedMs: Math.round(nowMs() - searchStart),
                titleCount: searchTitles.length,
                matchCount: Array.isArray(matches) ? matches.length : 0,
            })

            if (!matches.length) return null

            const scored = matches
                .map((match) => ({
                    ...match,
                    score: scoreMatch(match, searchTitles),
                }))
                .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))

            const bestMatch = scored[0]
            if (!bestMatch?.animeId) return null

            const stateStart = nowMs()
            const state = await withTimeout(
                provider.buildProviderState({ match: bestMatch }),
                getProviderStateTimeoutMs(providerId),
                `${providerId || 'anime-provider'} buildProviderState`
            )
            logAnimeTiming('buildProviderState', {
                providerId,
                elapsedMs: Math.round(nowMs() - stateStart),
                animeId: state?.animeId || bestMatch?.animeId || '',
                episodeCount: Array.isArray(state?.episodes) ? state.episodes.length : 0,
            })

            logAnimeTiming('providerState.total', {
                providerId,
                elapsedMs: Math.round(nowMs() - totalStart),
                animeId: state?.animeId || '',
                found: Boolean(state?.animeId),
            })

            return state?.animeId ? state : null
        } catch (error) {
            logAnimeTiming('providerState.error', {
                providerId,
                elapsedMs: Math.round(nowMs() - totalStart),
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    })()
        .catch((error) => {
            providerStateCache.delete(cacheKey)
            throw error
        })

    providerStateCache.set(cacheKey, promise)
    return promise
}

export async function resolveAnimeProviderStates({
    titles = [],
    providers = null,
    forceFresh = false,
} = {}) {
    const activeProviders = Array.isArray(providers) && providers.length
        ? providers
        : getEnabledAnimeAddonProviders()

    const states = []

    for (const provider of activeProviders) {
        try {
            const state = await resolveProviderState(provider, titles, { forceFresh })
            if (state?.animeId) {
                states.push(state)
            }
        } catch (error) {
            console.warn(`[animeAddons] provider state resolve failed for ${provider?.id}`, error)
        }
    }

    return states
}

export async function resolveEpisodeStreamCandidates({
    providerStates = [],
    episodeNumber,
    preferredProviderId = '',
    failedUrls = [],
    providers = null,
} = {}) {
    const failedUrlSet = new Set((failedUrls || []).filter(Boolean))
    const candidates = []
    const activeProviders = Array.isArray(providers) && providers.length
        ? providers
        : getEnabledAnimeAddonProviders()
    const providerMap = new Map(activeProviders.map((provider) => [provider.id, provider]))

    for (const state of providerStates) {
        try {
            const providerEpisode = findEpisodeForNumber(state?.episodes || [], episodeNumber)
            if (!providerEpisode?.episodeId) continue

            const cacheKey = String(providerEpisode.episodeId)

            if (!state.streamCandidatesByEpisode[cacheKey]) {
                const provider = providerMap.get(state.providerId)
                if (!provider) continue

                const streamStart = nowMs()
                const streams = await withTimeout(
                    provider.getStreams({
                        animeId: state.animeId,
                        episodeId: providerEpisode.episodeId,
                    }),
                    getProviderStreamsTimeoutMs(state.providerId),
                    `${state.providerId} getStreams`
                )
                logAnimeTiming('getStreams', {
                    providerId: state.providerId,
                    animeId: state.animeId,
                    episodeNumber,
                    elapsedMs: Math.round(nowMs() - streamStart),
                    streamCount: Array.isArray(streams) ? streams.length : 0,
                })

                state.streamCandidatesByEpisode[cacheKey] = Array.isArray(streams) ? streams : []
            } else {
                logAnimeTiming('getStreams.cacheHit', {
                    providerId: state.providerId,
                    animeId: state.animeId,
                    episodeNumber,
                    streamCount: state.streamCandidatesByEpisode[cacheKey].length,
                })
            }

            for (const stream of state.streamCandidatesByEpisode[cacheKey]) {
                candidates.push({
                    ...stream,
                    score: scoreCandidate(stream, preferredProviderId, failedUrlSet),
                })
            }
        } catch (error) {
            console.warn(`[animeAddons] episode stream resolve failed for ${state?.providerId}`, error)
        }
    }

    return dedupeCandidates(candidates).sort(
        (a, b) => Number(b.score || 0) - Number(a.score || 0)
    )
}

export function clearAnimeProviderStateCache() {
    providerStateCache.clear()
}
