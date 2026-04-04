const normalizeTitle = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\bseason\s+\d+\b/g, ' ')
        .replace(/\bpart\s+\d+\b/g, ' ')
        .replace(/\bcour\s+\d+\b/g, ' ')
        .replace(/\b\d+(st|nd|rd|th)\s+season\b/g, ' ')
        .replace(/\bmovie\b/g, ' ')
        .replace(/\bova\b/g, ' ')
        .replace(/\bona\b/g, ' ')
        .replace(/\bspecial\b/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

const getTitle = (item) =>
    item?.title?.english || item?.title?.romaji || item?.title?.native || 'Untitled'

const getYear = (item) =>
    item?.seasonYear || item?.startDate?.year || 0

const getEpisodeCount = (item) => {
    const explicitEpisodes = Number(item?.episodes || 0)
    const nextEpisodeNumber = Number(item?.nextAiringEpisode?.episode || 0)
    const airedEpisodes = nextEpisodeNumber > 1 ? nextEpisodeNumber - 1 : 0
    return Math.max(explicitEpisodes, airedEpisodes, 0)
}

const getKind = (item) => {
    const format = String(item?.format || '').toUpperCase()
    if (format === 'TV' || format === 'TV_SHORT') return 'season'
    if (format === 'MOVIE') return 'movie'
    if (format === 'OVA') return 'ova'
    if (format === 'ONA') return 'ona'
    if (format === 'SPECIAL') return 'special'
    return 'other'
}

const relationAllowed = (relationType) => {
    const rel = String(relationType || '').toUpperCase()
    return rel === 'PREQUEL' || rel === 'SEQUEL' || rel === 'SIDE_STORY' || rel === 'PARENT'
}

const looksRelated = (baseTitle, candidateTitle) => {
    const a = normalizeTitle(baseTitle)
    const b = normalizeTitle(candidateTitle)
    if (!a || !b) return false

    if (a === b || a.includes(b) || b.includes(a)) return true

    if (a === 'bleach' && b.includes('bleach')) return true
    if (a === 'one piece' && b.includes('one piece')) return true

    return false
}

const isLongRunner = (media) => {
    const title = normalizeTitle(getTitle(media))
    return (
        title === 'one piece' ||
        title === 'detective conan' ||
        title === 'pokemon'
    )
}

const hasSequelMarker = (item) => {
    const titles = [
        item?.title?.english,
        item?.title?.romaji,
        item?.title?.native,
        ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())

    return titles.some((title) => (
        /\bseason\s+[2-9]\d*\b/.test(title) ||
        /\b[2-9]\d*(st|nd|rd|th)\s+season\b/.test(title) ||
        /\bpart\s+[2-9]\d*\b/.test(title) ||
        /\bcour\s+[2-9]\d*\b/.test(title) ||
        /\bfinal\s+season\b/.test(title)
    ))
}

const hasPrequelRelation = (item) =>
    Array.isArray(item?.relations?.edges) &&
    item.relations.edges.some((edge) => {
        const relationType = String(edge?.relationType || '').toUpperCase()
        const nodeFormat = String(edge?.node?.format || '').toUpperCase()
        return relationType === 'PREQUEL' && (nodeFormat === 'TV' || nodeFormat === 'TV_SHORT' || nodeFormat === 'ONA')
    })

const hasMainlineSeasonRelation = (item) => {
    const relationType = String(item?._relationType || '').toUpperCase()
    return (
        relationType === 'PREQUEL'
        || relationType === 'SEQUEL'
        || hasPrequelRelation(item)
        || hasSequelMarker(item)
    )
}

const isSeasonLike = (item) =>
    getKind(item) === 'season'

const isMainlineSeasonEntry = (item, rootId) => {
    if (!item?.id) return false

    if (item.id === rootId) {
        return getKind(item) === 'season'
    }

    if (getKind(item) === 'season') {
        return hasMainlineSeasonRelation(item)
    }

    return false
}

const isTvShortExtra = (item, rootId) =>
    String(item?.format || '').toUpperCase() === 'TV_SHORT' && !isMainlineSeasonEntry(item, rootId)

function collectRelatedAnime(root) {
    const baseTitle = getTitle(root)
    const seen = new Set()
    const out = []

    const push = (node, relationType = 'ROOT', depth = 0) => {
        if (!node?.id || seen.has(node.id)) return
        if (String(node?.type || '').toUpperCase() !== 'ANIME') return

        const title = getTitle(node)
        const kind = getKind(node)
        const relatedByTitle = looksRelated(baseTitle, title)
        const relatedByRelation = relationAllowed(relationType)
        const isExtraKind = ['movie', 'ova', 'ona', 'special'].includes(kind)

        if (relationType !== 'ROOT') {
            if (kind === 'season') {
                if (!relatedByTitle && !relatedByRelation) return
            } else if (isExtraKind) {
                if (!relatedByTitle && !relatedByRelation) return
            } else {
                if (!relatedByTitle && !relatedByRelation) return
            }
        }

        seen.add(node.id)
        out.push({
            ...node,
            _relationType: relationType,
            _depth: depth,
        })
    }

    push(root, 'ROOT', 0)

    for (const edge of root?.relations?.edges || []) {
        push(edge?.node, edge?.relationType, 1)
    }

    for (const edge of root?.relations?.edges || []) {
        for (const nested of edge?.node?.relations?.edges || []) {
            const nestedTitle = getTitle(nested?.node)
            if (looksRelated(baseTitle, nestedTitle)) {
                push(nested?.node, nested?.relationType, 2)
            }
        }
    }

    return out
}

function sortSeasons(items, rootId) {
    return [...items].sort((a, b) => {
        if (a.id === rootId) return -1
        if (b.id === rootId) return 1

        const yearDiff = Number(getYear(a) || 0) - Number(getYear(b) || 0)
        if (yearDiff !== 0) return yearDiff

        return Number(a.id || 0) - Number(b.id || 0)
    })
}

export function resolveAnimeCanonicalRoot(media) {
    if (!media?.id) return null

    const related = collectRelatedAnime(media)
    const seasonCandidates = related.filter(isSeasonLike)

    if (!seasonCandidates.length) return media

    const best = [...seasonCandidates].sort((a, b) => {
        const aTitle = normalizeTitle(getTitle(a))
        const bTitle = normalizeTitle(getTitle(b))
        const aLongRunner = isLongRunner(a)
        const bLongRunner = isLongRunner(b)

        if (aLongRunner && !bLongRunner) return -1
        if (!aLongRunner && bLongRunner) return 1

        const aFormat = String(a?.format || '').toUpperCase()
        const bFormat = String(b?.format || '').toUpperCase()
        const aTvLike = aFormat === 'TV' || aFormat === 'TV_SHORT'
        const bTvLike = bFormat === 'TV' || bFormat === 'TV_SHORT'

        if (aTvLike && !bTvLike) return -1
        if (!aTvLike && bTvLike) return 1

        const aPrimary = !hasSequelMarker(a) && !hasPrequelRelation(a)
        const bPrimary = !hasSequelMarker(b) && !hasPrequelRelation(b)

        if (aPrimary && !bPrimary) return -1
        if (!aPrimary && bPrimary) return 1

        const aRoot = a.id === media.id
        const bRoot = b.id === media.id
        if (aRoot && !bRoot && aPrimary) return -1
        if (!aRoot && bRoot && bPrimary) return 1

        const yearDiff = Number(getYear(a) || 0) - Number(getYear(b) || 0)
        if (yearDiff !== 0) return yearDiff

        if (aTitle !== bTitle) return aTitle.localeCompare(bTitle)

        return Number(a.id || 0) - Number(b.id || 0)
    })[0]

    return best || media
}

function makeGroup(kind, label, items) {
    if (!items.length) return null

    const sorted = [...items].sort((a, b) => {
        const yearDiff = Number(getYear(a) || 0) - Number(getYear(b) || 0)
        if (yearDiff !== 0) return yearDiff
        return Number(a.id || 0) - Number(b.id || 0)
    })

    return {
        id: `${kind}-group`,
        kind: `${kind}_group`,
        label,
        title: label,
        seasonNumber: null,
        episodesCount: items.length,
        items: sorted.map((item) => ({
            id: item.id,
            title: getTitle(item),
            image: item?.bannerImage || item?.coverImage?.extraLarge || item?.coverImage?.large || '',
            year: getYear(item),
            kind: getKind(item),
        })),
        image:
            sorted[0]?.bannerImage ||
            sorted[0]?.coverImage?.extraLarge ||
            sorted[0]?.coverImage?.large ||
            '',
        bannerImage: sorted[0]?.bannerImage || '',
    }
}

export function buildAnimeCanonicalFromAniList(media) {
    if (!media?.id) return null

    const related = collectRelatedAnime(media)
    const longRunner = isLongRunner(media)

    const seasonsRaw = related.filter((item) => isMainlineSeasonEntry(item, media.id))
    const moviesRaw = related.filter((item) => getKind(item) === 'movie')
    const ovaRaw = related.filter((item) => getKind(item) === 'ova')
    const onaRaw = related.filter((item) => getKind(item) === 'ona')
    const specialsRaw = related.filter(
        (item) => getKind(item) === 'special' || isTvShortExtra(item, media.id)
    )

    const baseTitle = normalizeTitle(getTitle(media))

    const seasons = baseTitle === 'one piece'
        ? [
            {
                id: media.id,
                kind: 'season',
                title: getTitle(media),
                label: 'Season 1',
                seasonNumber: 1,
                episodesCount: Math.max(1, getEpisodeCount(media)),
                image: media?.coverImage?.extraLarge || media?.coverImage?.large || '',
                bannerImage: media?.bannerImage || '',
                year: getYear(media),
                isLongRunner: true,
            },
        ]
        : longRunner
            ? [
                {
                    id: media.id,
                    kind: 'season',
                    title: getTitle(media),
                    label: 'Season 1',
                    seasonNumber: 1,
                    episodesCount: Math.max(1, getEpisodeCount(media)),
                    image: media?.coverImage?.extraLarge || media?.coverImage?.large || '',
                    bannerImage: media?.bannerImage || '',
                    year: getYear(media),
                    isLongRunner: true,
                },
            ]
            : sortSeasons(seasonsRaw, media.id).map((item, index) => ({
                id: item.id,
                kind: 'season',
                title: getTitle(item),
                label: `Season ${index + 1}`,
                seasonNumber: index + 1,
                episodesCount: Math.max(1, getEpisodeCount(item)),
                image: item?.coverImage?.extraLarge || item?.coverImage?.large || '',
                bannerImage: item?.bannerImage || '',
                year: getYear(item),
                isLongRunner: false,
            }))

    const extras = [
        makeGroup('movie', 'Movies', moviesRaw),
        makeGroup('ova', 'OVA', ovaRaw),
        makeGroup('ona', 'ONA', onaRaw),
        makeGroup('special', 'Specials', specialsRaw),
    ].filter(Boolean)

    return {
        id: media.id,
        title: getTitle(media),
        isLongRunner: longRunner,
        entries: [...seasons, ...extras],
    }
}

export function buildAnimeEpisodesFromAniListEntry(entry) {
    if (!entry) return []

    if (
        entry.kind === 'movie_group' ||
        entry.kind === 'ova_group' ||
        entry.kind === 'ona_group' ||
        entry.kind === 'special_group'
    ) {
        return (entry.items || []).map((item, index) => ({
            number: index + 1,
            title: item.title,
            image: item.image || '',
            itemKind: item.kind,
        }))
    }

    if (entry.kind === 'movie') {
        return [
            {
                number: 1,
                title: entry.title || entry.label || 'Movie',
                image: entry.bannerImage || entry.image || '',
            },
        ]
    }

    if (entry.isLongRunner) {
        const total = Math.max(1, Number(entry?.episodesCount || 1))
        return Array.from({ length: total }, (_, index) => ({
            number: index + 1,
            title: `Episode ${index + 1}`,
            image: entry.bannerImage || entry.image || '',
            isMainSeriesLauncher: false,
        }))
    }

    const total = Math.max(0, Number(entry?.episodesCount || 0))
    return Array.from({ length: total }, (_, index) => ({
        number: index + 1,
        title: `Episode ${index + 1}`,
        image: entry?.bannerImage || entry?.image || '',
    }))
}
