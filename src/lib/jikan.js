const JIKAN_BASE_URL = 'https://api.jikan.moe/v4'

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

export const normalizeAnimeTitle = (value) =>
    clean(value)
        .toLowerCase()
        .replace(/\bseason\s+\d+\b/gi, '')
        .replace(/\bpart\s+\d+\b/gi, '')
        .replace(/\bcour\s+\d+\b/gi, '')
        .replace(/\b2nd\s+season\b/gi, '')
        .replace(/\b3rd\s+season\b/gi, '')
        .replace(/\b4th\s+season\b/gi, '')
        .replace(/\bfinal\s+season\b/gi, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

async function jikanGet(path, params = {}) {
    const url = new URL(`${JIKAN_BASE_URL}${path}`)
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value))
        }
    })

    const res = await fetch(url.toString())
    if (!res.ok) {
        throw new Error(`Jikan request failed: ${res.status}`)
    }

    const json = await res.json()
    return json.data
}

function titleVariants(item) {
    return [
        item?.title,
        item?.title_english,
        item?.title_japanese,
        ...(item?.titles || []).map((entry) => entry?.title),
    ]
        .map(normalizeAnimeTitle)
        .filter(Boolean)
}

function scoreCandidate(item, titles = [], year = null) {
    const queries = titles.map(normalizeAnimeTitle).filter(Boolean)
    const variants = titleVariants(item)
    let score = 0

    for (const query of queries) {
        for (const variant of variants) {
            if (variant === query) score += 100
            else if (variant.includes(query)) score += 50
            else if (query.includes(variant)) score += 30
        }
    }

    if (item?.type === 'TV') score += 12
    if (item?.type === 'MOVIE') score += 6

    if (year && item?.year) {
        const diff = Math.abs(Number(year) - Number(item.year))
        if (diff === 0) score += 25
        else if (diff === 1) score += 15
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
    const episodes = []
    let page = 1
    let hasNextPage = true

    while (hasNextPage) {
        const url = new URL(`${JIKAN_BASE_URL}/anime/${malId}/episodes`)
        url.searchParams.set('page', String(page))

        const res = await fetch(url.toString())
        if (!res.ok) {
            throw new Error(`Jikan episodes failed: ${res.status}`)
        }

        const json = await res.json()
        const data = json.data || []
        const pagination = json.pagination || {}

        episodes.push(
            ...data.map((episode, index) => ({
                malId: episode.mal_id,
                number: Number(episode.mal_id || episode.number || index + 1),
                title: clean(episode.title) || `Episode ${episode.mal_id || episode.number || index + 1}`,
                aired: episode.aired || null,
            }))
        )

        hasNextPage = Boolean(pagination?.has_next_page)
        page += 1
    }

    return episodes
}
