import { invoke } from '@tauri-apps/api/core'
import { load } from 'cheerio'

import {
    ANIME_PROVIDER_IDS,
    ANIME_PROVIDER_LABELS,
    createAnimeEpisode,
} from '../types'

const PROVIDER_ID = ANIME_PROVIDER_IDS.ANIMEPAHE
const PROVIDER_LABEL = ANIME_PROVIDER_LABELS[PROVIDER_ID]
const BASE_URL = 'https://animepahe.si'

function dedupeBy(items, getKey) {
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

async function fetchProviderText(url, headers = {}, method = 'GET', body = null) {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        return invoke('fetch_anime_text', {
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                ...headers,
            },
            method,
            body,
        })
    }

    const response = await fetch(url, {
        method,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
        body: body ?? undefined,
    })

    if (!response.ok) {
        throw new Error(`AnimePahe fetch failed with status ${response.status}`)
    }

    return response.text()
}

async function fetchProviderJson(url, headers = {}) {
    const text = await fetchProviderText(url, headers, 'GET', null)
    return JSON.parse(text)
}

function buildSearchUrl(query) {
    return `${BASE_URL}/api?m=search&q=${encodeURIComponent(String(query || '').trim())}`
}

function buildAnimePageUrl(animeId) {
    return `${BASE_URL}/anime/${animeId}`
}

function buildEpisodesApiUrl(animeId, page = 1) {
    return `${BASE_URL}/api?m=release&id=${encodeURIComponent(animeId)}&sort=episode_asc&page=${page}`
}

function normalizeSearchItem(item) {
    const animeId = String(item?.session || '').trim()
    if (!animeId) return null

    return {
        providerId: PROVIDER_ID,
        animeId,
        title: String(item?.title || '').trim(),
        image: String(item?.poster || '').trim(),
        year: Number(item?.year || 0) || 0,
        format: String(item?.type || '').trim(),
        score: 0,
        raw: item,
    }
}

function parseAnimeInfoHtml(html, animeId) {
    const $ = load(html)

    return {
        animeId,
        title:
            $('div.title-wrapper > h1 > span').first().text().trim() ||
            $('title').text().trim() ||
            animeId,
    }
}

function normalizeEpisodeItem(item, animeId) {
    const session = String(item?.session || '').trim()
    const number = Number(item?.episode || 0)

    if (!session || !Number.isFinite(number) || number <= 0) return null

    return createAnimeEpisode({
        providerId: PROVIDER_ID,
        animeId,
        episodeId: `${animeId}/${session}`,
        number,
        title: String(item?.title || `Episode ${number}`).trim(),
        image: String(item?.snapshot || '').trim(),
        raw: item,
    })
}

async function fetchAllEpisodes(animeId) {
    const firstPage = await fetchProviderJson(buildEpisodesApiUrl(animeId, 1), {
        Referer: buildAnimePageUrl(animeId),
        'X-Requested-With': 'XMLHttpRequest',
    })

    const lastPage = Number(firstPage?.last_page || 1) || 1
    const output = []

    const firstItems = Array.isArray(firstPage?.data) ? firstPage.data : []
    output.push(...firstItems)

    for (let page = 2; page <= lastPage; page += 1) {
        const nextPage = await fetchProviderJson(buildEpisodesApiUrl(animeId, page), {
            Referer: buildAnimePageUrl(animeId),
            'X-Requested-With': 'XMLHttpRequest',
        })

        const pageItems = Array.isArray(nextPage?.data) ? nextPage.data : []
        output.push(...pageItems)
    }

    return output
}

const animepaheProvider = {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,

    async searchAnime({ titles = [] } = {}) {
        const uniqueTitles = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))]
        const results = []

        for (const title of uniqueTitles) {
            try {
                const payload = await fetchProviderJson(buildSearchUrl(title), {
                    Referer: BASE_URL,
                    'X-Requested-With': 'XMLHttpRequest',
                })

                const items = Array.isArray(payload?.data) ? payload.data : []
                for (const item of items) {
                    const normalized = normalizeSearchItem(item)
                    if (normalized?.animeId) {
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
            await fetchProviderText(buildAnimePageUrl(animeId), {
                Referer: BASE_URL,
            })

            const rawEpisodes = await fetchAllEpisodes(animeId)

            return rawEpisodes
                .map((item) => normalizeEpisodeItem(item, animeId))
                .filter(Boolean)
                .sort((a, b) => a.number - b.number)
        } catch (error) {
            console.warn(`[animeAddons/${PROVIDER_ID}] getEpisodes failed`, error)
            return []
        }
    },

    async getStreams() {
        return []
    },

    async buildProviderState({ match } = {}) {
        if (!match?.animeId) return null

        const episodes = await this.getEpisodes({ animeId: match.animeId })

        return {
            providerId: PROVIDER_ID,
            providerLabel: PROVIDER_LABEL,
            animeId: match.animeId,
            title: match.title || '',
            episodes,
            streamCandidatesByEpisode: {},
            raw: {
                match,
            },
        }
    },
}

export default animepaheProvider