import { getEnabledAnimeAddonProviders } from './index'

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
            title.replace(/\s*:\s*.+$/, ''),
            title.replace(/\s+-\s+.+$/, ''),
            title.replace(/\bPart\s+\d+\b/gi, ''),
            title.replace(/\bCour\s+\d+\b/gi, ''),
            title.replace(/\bSeason\s+\d+\b.*$/gi, ''),
            title.replace(/\([^)]*\)/g, ''),
        ]

        for (const variant of variants) {
            const clean = String(variant || '').replace(/\s+/g, ' ').trim()
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

    const descriptorTokens = extractDescriptorTokens(titles)
    const descriptorOverlap = countTokenOverlap(baseTitle, descriptorTokens)
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
                score -= 120
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

function scoreCandidate(candidate, preferredProviderId = '', failedUrls = new Set()) {
    let score = Number(candidate?.score || 0)

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

export async function resolveAnimeProviderStates({
    titles = [],
    providers = null,
} = {}) {
    const activeProviders = Array.isArray(providers) && providers.length
        ? providers
        : getEnabledAnimeAddonProviders()

    const states = []

    for (const provider of activeProviders) {
        try {
            const maxSearchTitles =
                provider?.id === 'gogoanime'
                    ? 6
                    : 2
            const searchTitles = uniqueTitles(titles).slice(0, maxSearchTitles)
            console.warn(`[animeAddons] search titles`, {
                providerId: provider?.id || '',
                searchTitles,
            })

            const searchAnimeTimeoutMs =
                provider?.id === 'gogoanime'
                    ? 45000
                    : provider?.id === 'animepahe'
                        ? 40000
                    : 12000

            const matches = await withTimeout(
                provider.searchAnime({ titles: searchTitles }),
                searchAnimeTimeoutMs,
                `${provider?.id || 'anime-provider'} searchAnime`
            )
            if (!matches.length) continue

            const scored = matches
                .map((match) => ({
                    ...match,
                    score: scoreMatch(match, searchTitles),
                }))
                .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))

            const bestMatch = scored[0]
            if (!bestMatch?.animeId) continue

            const buildProviderStateTimeoutMs =
                provider?.id === 'gogoanime'
                    ? 90000
                    : provider?.id === 'animepahe'
                        ? 90000
                    : 15000

            const state = await withTimeout(
                provider.buildProviderState({ match: bestMatch }),
                buildProviderStateTimeoutMs,
                `${provider?.id || 'anime-provider'} buildProviderState`
            )

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
} = {}) {
    const failedUrlSet = new Set((failedUrls || []).filter(Boolean))
    const candidates = []
    const enabledProviders = getEnabledAnimeAddonProviders()
    const providerMap = new Map(enabledProviders.map((provider) => [provider.id, provider]))

    for (const state of providerStates) {
        try {
            const providerEpisode = findEpisodeForNumber(state?.episodes || [], episodeNumber)
            if (!providerEpisode?.episodeId) continue

            const cacheKey = String(providerEpisode.episodeId)

            if (!state.streamCandidatesByEpisode[cacheKey]) {
                const provider = providerMap.get(state.providerId)
                if (!provider) continue

                const getStreamsTimeoutMs =
                    state.providerId === 'gogoanime'
                        ? 45000
                        : state.providerId === 'animepahe'
                            ? 35000
                        : state.providerId === 'animesaturn'
                            ? 12000
                            : 8000

                const streams = await withTimeout(
                    provider.getStreams({
                        animeId: state.animeId,
                        episodeId: providerEpisode.episodeId,
                    }),
                    getStreamsTimeoutMs,
                    `${state.providerId} getStreams`
                )

                state.streamCandidatesByEpisode[cacheKey] = Array.isArray(streams) ? streams : []
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
