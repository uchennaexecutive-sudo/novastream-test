import {
    getAnimeEpisodesFromJikan,
    getAnimeFullFromJikan,
    normalizeAnimeTitle,
    searchAnimeOnJikan,
} from './jikan'

const TV_TYPES = new Set(['TV'])
const MOVIE_TYPES = new Set(['MOVIE'])
const OTHER_TYPES = new Set(['OVA', 'ONA', 'SPECIAL'])
const INCLUDED_RELATIONS = new Set(['Sequel', 'Prequel', 'Side story', 'Parent story'])

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

    return INCLUDED_RELATIONS.has(entry?.relationType)
}

function classifyEntryType(item) {
    const type = String(item?.type || '').toUpperCase()
    if (TV_TYPES.has(type)) return 'season'
    if (MOVIE_TYPES.has(type)) return 'movie'
    if (OTHER_TYPES.has(type)) return type.toLowerCase()
    return 'other'
}

function relationPriority(relationType) {
    if (relationType === 'Root') return 0
    if (relationType === 'Parent story') return 1
    if (relationType === 'Prequel') return 2
    if (relationType === 'Sequel') return 3
    if (relationType === 'Side story') return 4
    return 9
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
    if (kind === 'movie') return entry.titleEnglish || entry.title || 'Movie'
    if (kind === 'ova') return entry.titleEnglish || entry.title || 'OVA'
    if (kind === 'ona') return entry.titleEnglish || entry.title || 'ONA'
    if (kind === 'special') return entry.titleEnglish || entry.title || 'Special'
    return entry.titleEnglish || entry.title || `Entry ${entry.malId}`
}

function fallbackEpisodes(count = 0) {
    const total = Math.max(0, Number(count) || 0)
    return Array.from({ length: total }, (_, index) => ({
        malId: null,
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
        airedFrom: full?.aired?.from || null,
        episodesCount: Number(full.episodes || 0),
        status: full.status || '',
        images: full.images || {},
        synopsis: full.synopsis || '',
        relationType: entry.relationType || '',
    }
}

function sortEntries(entries) {
    return [...entries].sort((a, b) => {
        const kindDiff = sortRankForKind(classifyEntryType(a)) - sortRankForKind(classifyEntryType(b))
        if (kindDiff !== 0) return kindDiff

        if (classifyEntryType(a) === 'season' && classifyEntryType(b) === 'season') {
            const relationDiff = relationPriority(a.relationType) - relationPriority(b.relationType)
            if (relationDiff !== 0) return relationDiff
        }

        const airedA = a.airedFrom ? new Date(a.airedFrom).getTime() : 0
        const airedB = b.airedFrom ? new Date(b.airedFrom).getTime() : 0
        if (airedA !== airedB) return airedA - airedB

        const yearA = Number(a.year || 0)
        const yearB = Number(b.year || 0)
        if (yearA !== yearB) return yearA - yearB

        return Number(a.malId || 0) - Number(b.malId || 0)
    })
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
            relationType: 'Root',
        },
        ...relationEntries(rootFull).filter((entry) => shouldIncludeRelation(rootKey, entry)),
    ]

    const unique = new Map()
    for (const entry of rawRelated) {
        if (!entry?.mal_id) continue
        if (!unique.has(entry.mal_id)) unique.set(entry.mal_id, entry)
    }

    const enriched = await Promise.all(
        Array.from(unique.values()).map((entry) => enrichEntry(entry).catch(() => null))
    )

    const filtered = sortEntries(
        enriched.filter((entry) => entry && classifyEntryType(entry) !== 'other')
    )

    let seasonCounter = 0
    const entries = []

    for (const entry of filtered) {
        const kind = classifyEntryType(entry)
        let seasonNumber = null

        if (kind === 'season') {
            seasonCounter += 1
            seasonNumber = seasonCounter
        }

        entries.push({
            kind,
            malId: entry.malId,
            seasonNumber,
            label: labelForEntry(entry, seasonNumber),
            title: entry.titleEnglish || entry.title,
            year: entry.year || null,
            episodesCount: entry.episodesCount || 0,
            synopsis: entry.synopsis || '',
            images: entry.images || {},
            relationType: entry.relationType || '',
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
        //
    }

    return fallbackEpisodes(entry.episodesCount)
}