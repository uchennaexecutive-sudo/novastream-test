export const ANIME_STREAM_TYPES = {
    HLS: 'hls',
    MP4: 'mp4',
}

export const ANIME_PROVIDER_IDS = {
    ANIMEKAI: 'animekai',
    ANIMESATURN: 'animesaturn',
    ANIMEPAHE: 'animepahe',
    ALLANIME: 'allanime',
    GOGOANIME: 'gogoanime',
}

export const ANIME_PROVIDER_LABELS = {
    [ANIME_PROVIDER_IDS.ANIMEKAI]: 'AnimeKai',
    [ANIME_PROVIDER_IDS.ANIMESATURN]: 'AnimeSaturn',
    [ANIME_PROVIDER_IDS.ANIMEPAHE]: 'AnimePahe',
    [ANIME_PROVIDER_IDS.ALLANIME]: 'AllAnime',
    [ANIME_PROVIDER_IDS.GOGOANIME]: 'Gogoanime',
}

export function createAnimeSearchMatch({
    providerId,
    animeId,
    title = '',
    matchedTitle = '',
    score = 0,
    raw = null,
}) {
    return {
        providerId: String(providerId || ''),
        animeId: String(animeId || ''),
        title: String(title || ''),
        matchedTitle: String(matchedTitle || ''),
        score: Number(score || 0),
        raw,
    }
}

export function createAnimeEpisode({
    providerId,
    animeId,
    episodeId,
    number,
    title = '',
    raw = null,
}) {
    return {
        providerId: String(providerId || ''),
        animeId: String(animeId || ''),
        episodeId: String(episodeId || ''),
        number: Number(number || 0),
        title: String(title || ''),
        raw,
    }
}

export function createAnimeSubtitleTrack({
    lang = 'Unknown',
    url = '',
    kind = 'captions',
    label = '',
    raw = null,
}) {
    return {
        lang: String(lang || 'Unknown'),
        url: String(url || ''),
        kind: String(kind || 'captions'),
        label: String(label || lang || 'Unknown'),
        raw,
    }
}

export function createAnimeStreamCandidate({
    id,
    providerId,
    providerLabel = '',
    animeId = '',
    episodeId = '',
    url = '',
    streamType = ANIME_STREAM_TYPES.HLS,
    quality = '',
    resolution = 0,
    headers = {},
    subtitles = [],
    score = 0,
    flags = {},
    streamSessionId = null,
    raw = null,
}) {
    return {
        id: String(id || ''),
        providerId: String(providerId || ''),
        providerLabel: String(providerLabel || ''),
        animeId: String(animeId || ''),
        episodeId: String(episodeId || ''),
        url: String(url || ''),
        streamType:
            streamType === ANIME_STREAM_TYPES.MP4
                ? ANIME_STREAM_TYPES.MP4
                : ANIME_STREAM_TYPES.HLS,
        quality: String(quality || ''),
        resolution: Number(resolution || 0),
        headers: isPlainObject(headers) ? headers : {},
        streamSessionId: streamSessionId ? String(streamSessionId) : null,
        subtitles: Array.isArray(subtitles) ? subtitles : [],
        score: Number(score || 0),
        flags: {
            direct: Boolean(flags?.direct),
            requiresHeaders: Boolean(flags?.requiresHeaders),
            maybeUnstable: Boolean(flags?.maybeUnstable),
        },
        raw,
    }
}

export function createAnimeProviderState({
    providerId,
    animeId,
    matchedTitle = '',
    anime = null,
    episodes = [],
    streamCandidatesByEpisode = {},
}) {
    return {
        providerId: String(providerId || ''),
        animeId: String(animeId || ''),
        matchedTitle: String(matchedTitle || ''),
        anime,
        episodes: Array.isArray(episodes) ? episodes : [],
        streamCandidatesByEpisode: isPlainObject(streamCandidatesByEpisode)
            ? streamCandidatesByEpisode
            : {},
    }
}

export function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function detectAnimeStreamType(url = '', explicitType = '') {
    const type = String(explicitType || '').toLowerCase()
    const normalizedUrl = String(url || '').toLowerCase()

    if (type === 'mp4') return ANIME_STREAM_TYPES.MP4
    if (type === 'hls') return ANIME_STREAM_TYPES.HLS
    if (normalizedUrl.includes('.m3u8')) return ANIME_STREAM_TYPES.HLS
    return ANIME_STREAM_TYPES.MP4
}

export function buildAnimeStreamCandidateId({
    providerId,
    animeId = '',
    episodeId = '',
    url = '',
    quality = '',
}) {
    return [
        String(providerId || ''),
        String(animeId || ''),
        String(episodeId || ''),
        String(quality || ''),
        String(url || ''),
    ].join('::')
}