const JIKAN_BASE_URL = 'https://api.jikan.moe/v4'
const memoryCache = new Map()

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

export const normalizeAnimeTitle = (value) =>
    clean(value)
        .toLowerCase()
        .replace(/\bseason\s+\d+\b/gi, '')
        .replace(/\bpart\s+\d+\b/gi, '')
        .replace(/\bcour\s+\d+\b/gi, '')
        .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
        .replace(/\bfinal\s+season\b/gi, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJsonWithRetry(url, retries = 1) {
    let lastError

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`Jikan request failed: ${res.status}`)
            return await res.json()
        } catch (error) {
            lastError = error
            if (attempt < retries) {
                await sleep(500 * (attempt + 1))
            }
        }
    }

    throw lastError
}

async function jikanGet(path, params = {}) {
    const url = new URL(`${JIKAN_BASE_URL}${path}`)

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value))
        }
    })

    const cacheKey = url.toString()
    if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey)

    const json = await fetchJsonWithRetry(cacheKey, 1)
    const data = json.data
    memoryCache.set(cacheKey, data)
    return data
}

function titleVariants(item) {
    return [
        item?.title,
        item?.title_english,
        item?.title_japanese,
        ...(Array.isArray(item?.titles) ? item.titles.map((entry) => entry?.title) : []),
    ]
        .map(normalizeAnimeTitle)
        .filter(Boolean)
}

function scoreCandidate(item, titles = [], year = null) {
    const queries = Array.from(new Set([].concat(titles || []).map(normalizeAnimeTitle).filter(Boolean)))
    const variants = titleVariants(item)

    let score = 0

    for (const query of queries) {
        for (const variant of variants) {
            if (variant === query) score += 120
            else if (variant.includes(query)) score += 60
            else if (query.includes(variant)) score += 35
        }
    }

    const type = String(item?.type || '').toUpperCase()
    if (type === 'TV') score += 15
    if (type === 'MOVIE') score += 6
    if (type === 'OVA' || type === 'ONA' || type === 'SPECIAL') score += 2

    if (year && item?.year) {
        const diff = Math.abs(Number(year) - Number(item.year))
        if (diff === 0) score += 30
        else if (diff === 1) score += 18
        else if (diff === 2) score += 8
    }

    score += Math.min(Number(item?.popularity || 0) / 5000, 20)
    return score
}

export async function searchAnimeOnJikan(titles, year = null) {
    const queries = Array.from(new Set([].concat(titles || []).map(clean).filter(Boolean)))

    let best = null
    let bestScore = -1

    for (const query of queries) {
        const results = await jikanGet('/anime', {
            q: query,
            limit: 10,
            order_by: 'score',
            sort: 'desc',
        })

        for (const item of results || []) {
            const score = scoreCandidate(item, queries, year)
            if (score > bestScore) {
                best = item
                bestScore = score
            }
        }
    }

    return best
}

export async function getAnimeFullFromJikan(malId) {
    return jikanGet(`/anime/${malId}/full`)
}

export async function getAnimeEpisodesFromJikan(malId) {
    const cacheKey = `episodes:${malId}`
    if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey)

    const episodes = []
    let page = 1
    let hasNextPage = true
    let runningNumber = 1

    while (hasNextPage) {
        const url = new URL(`${JIKAN_BASE_URL}/anime/${malId}/episodes`)
        url.searchParams.set('page', String(page))

        const json = await fetchJsonWithRetry(url.toString(), 1)
        const data = Array.isArray(json.data) ? json.data : []
        const pagination = json.pagination || {}

        for (const episode of data) {
            const explicitNumber = Number(episode?.number)
            const number = Number.isFinite(explicitNumber) && explicitNumber > 0
                ? explicitNumber
                : runningNumber

            episodes.push({
                malId: episode?.mal_id || null,
                number,
                title: clean(episode?.title) || `Episode ${number}`,
                aired: episode?.aired || null,
            })

            runningNumber += 1
        }

        hasNextPage = Boolean(pagination?.has_next_page)
        page += 1
    }

    const sorted = episodes.sort((a, b) => Number(a.number || 0) - Number(b.number || 0))
    memoryCache.set(cacheKey, sorted)
    return sorted
}