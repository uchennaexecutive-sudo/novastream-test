import {
    getAnimeEpisodesFromJikan,
    getAnimeFullFromJikan,
    normalizeAnimeTitle,
    searchAnimeOnJikan,
} from './jikan'

const TV_TYPES = new Set(['TV'])
const MOVIE_TYPES = new Set(['MOVIE'])
const OTHER_TYPES = new Set(['OVA', 'ONA', 'SPECIAL'])

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

function titleVariants(item) {
    return [
        item?.title,
        item?.title_english,
        item?.title_japanese,
        ...(item?.titles || []).map((entry) => entry?.title),
    ]
        .map(clean)
        .filter(Boolean)
}

function rootKeyFromItem(item) {
    return normalizeAnimeTitle(titleVariants(item)[0] || '')
}

function relationEntries(full) {
    const output = []

    for (const relation of full?.relations || []) {
        for (const entry of relation?.entry || []) {
            if (String(entry?.type || '').toLowerCase() !== 'anime') continue
            output.push({
                ...entry,
                relationType: relation?.relation || '',
            })
        }
    }

    return output
}

function shouldIncludeRelation(rootKey, entry) {
    const variants = titleVariants(entry).map(normalizeAnimeTitle)
    if (variants.some((variant) => variant && (variant.includes(rootKey) || rootKey.includes(variant)))) {
        return true
    }

    return ['Sequel', 'Prequel', 'Side story', 'Parent story'].includes(entry?.relationType)
}

function classifyEntryType(item) {
    const type = String(item?.type || '').toUpperCase()
    if (TV_TYPES.has(type)) return 'season'
    if (MOVIE_TYPES.has(type)) return 'movie'
    if (OTHER_TYPES.has(type)) return type.toLowerCase()
    return 'other'
}

function sortRankForKind(kind) {
    if (kind === 'season') return 1
    if (kind === 'movie') return 2
    if (kind === 'ova') return 3
    if (kind === 'ona') return 4
    if (kind === 'special') return 5
    return 9
}

function labelForEntry(entry, seasonNumber) {
    const kind = classifyEntryType(entry)
    if (kind === 'season') return `Season ${seasonNumber}`
    if (kind === 'movie') return entry.title_english || entry.title || 'Movie'
    if (kind === 'ova') return entry.title_english || entry.title || 'OVA'
    if (kind === 'ona') return entry.title_english || entry.title || 'ONA'
    if (kind === 'special') return entry.title_english || entry.title || 'Special'
    return entry.title_english || entry.title || `Entry ${entry.mal_id}`
}

function fallbackEpisodes(count = 0) {
    const total = Math.max(0, Number(count) || 0)
    return Array.from({ length: total }, (_, index) => ({
        malId: index + 1,
        number: index + 1,
        title: `Episode ${index + 1}`,
        aired: null,
    }))
}

async function enrichEntry(entry) {
    const full = await getAnimeFullFromJikan(entry.mal_id)
    return {
        malId: full.mal_id,
        title: full.title || entry.title || '',
        titleEnglish: full.title_english || entry.title_english || full.title || entry.title || '',
        type: full.type || entry.type || '',
        year: full.year || null,
        episodesCount: full.episodes || 0,
        status: full.status || '',
        images: full.images || {},
        synopsis: full.synopsis || '',
    }
}

export async function buildCanonicalAnime(titles, year = null) {
    const root = await searchAnimeOnJikan(titles, year)
    if (!root?.mal_id) return null

    const rootFull = await getAnimeFullFromJikan(root.mal_id)
    const rootKey = rootKeyFromItem(rootFull)

    const rawRelated = [
        {
            mal_id: rootFull.mal_id,
            title: rootFull.title,
            title_english: rootFull.title_english,
            type: rootFull.type,
            year: rootFull.year,
        },
        ...relationEntries(rootFull).filter((entry) => shouldIncludeRelation(rootKey, entry)),
    ]

    const unique = new Map()
    for (const entry of rawRelated) {
        if (!entry?.mal_id) continue
        unique.set(entry.mal_id, entry)
    }

    const enriched = await Promise.all(
        Array.from(unique.values()).map((entry) => enrichEntry(entry).catch(() => null))
    )

    const filtered = enriched.filter(Boolean).sort((a, b) => {
        const yearA = Number(a.year || 0)
        const yearB = Number(b.year || 0)
        if (yearA !== yearB) return yearA - yearB
        return Number(a.malId || 0) - Number(b.malId || 0)
    })

    let seasonCounter = 0
    const entries = []

    for (const entry of filtered) {
        const kind = classifyEntryType(entry)
        if (kind === 'other') continue

        if (kind === 'season') {
            seasonCounter += 1
        }

        entries.push({
            kind,
            malId: entry.malId,
            seasonNumber: kind === 'season' ? seasonCounter : null,
            label: labelForEntry(entry, seasonCounter),
            title: entry.titleEnglish || entry.title,
            year: entry.year || null,
            episodesCount: entry.episodesCount || 0,
            synopsis: entry.synopsis || '',
            images: entry.images || {},
        })
    }

    return {
        malId: rootFull.mal_id,
        title: rootFull.title_english || rootFull.title,
        entries,
    }
}

export async function getCanonicalEntryEpisodes(entry) {
    if (!entry?.malId) return []

    if (entry.kind === 'movie') {
        return [{
            malId: entry.malId,
            number: 1,
            title: entry.title || entry.label || 'Movie',
            aired: null,
        }]
    }

    try {
        const episodes = await getAnimeEpisodesFromJikan(entry.malId)
        if (episodes?.length) return episodes
    } catch {
        // fall back below
    }

    return fallbackEpisodes(entry.episodesCount)
}
