import { load } from 'cheerio'
import { invoke } from '@tauri-apps/api/core'

const GOGO_BASE_URL = 'https://anitaku.to'

function absoluteUrl(value = '') {
    const rawValue = String(value || '').trim()
    if (!rawValue) return ''

    if (rawValue.startsWith('//')) {
        return `https:${rawValue}`
    }

    try {
        return new URL(rawValue, GOGO_BASE_URL).href
    } catch {
        return rawValue
    }
}

function stripCategoryPath(value = '') {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/category\//i, '')
        .replace(/^category\//i, '')
        .replace(/^\/+/i, '')
        .trim()
}

function stripEpisodePath(value = '') {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/+/i, '')
        .trim()
}

function extractEpisodeNumber(value = '') {
    const match = String(value || '').match(/-episode-(\d+(?:\.\d+)?)/i)
    const parsed = Number(match?.[1] || 0)
    return Number.isFinite(parsed) ? parsed : 0
}

function cleanServerLabel(text = '') {
    return String(text || '')
        .replace(/Choose this server/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
}

async function fetchProviderHtml(url, headers = {}) {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        const response = await invoke('fetch_anime_text', {
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                ...headers,
            },
        })

        if (typeof response === 'string') {
            return response
        }

        if (response && typeof response.text === 'string') {
            return response.text
        }

        throw new Error(`GogoAnime scraper fetch returned unexpected payload for ${url}`)
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...headers,
        },
    })

    if (!response.ok) {
        throw new Error(`GogoAnime scraper fetch failed with status ${response.status} for ${url}`)
    }

    return response.text()
}

function parseSearchResults(html = '') {
    const $ = load(String(html || ''))
    const results = []

    $('.last_episodes ul.items li').each((_, element) => {
        const link = $(element).find('p.name a').first()
        const href = String(link.attr('href') || '').trim()
        const animeId = stripCategoryPath(href)
        const name = String(link.attr('title') || link.text() || '').replace(/\s+/g, ' ').trim()
        const image = absoluteUrl($(element).find('.img img').first().attr('src') || '')

        if (!animeId || !name) return

        results.push({
            id: animeId,
            name,
            img: image,
        })
    })

    return results
}

function parseAnimeInfo(html = '', fallbackAnimeId = '') {
    const $ = load(String(html || ''))
    const alias = String($('#alias_anime').first().attr('value') || '').trim()
        || stripCategoryPath($('.anime-info a[href*="/category/"]').first().attr('href') || '')
        || String(fallbackAnimeId || '').trim()

    const title = $('.anime_info_body_bg h1').first().text().replace(/\s+/g, ' ').trim()
    const image = absoluteUrl($('.anime_info_body_bg img').first().attr('src') || '')

    let released = ''
    let status = ''

    $('.anime_info_body_bg p.type').each((_, element) => {
        const text = $(element).text().replace(/\s+/g, ' ').trim()
        if (/^Released:/i.test(text)) {
            released = text.replace(/^Released:\s*/i, '').trim()
        }
        if (/^Status:/i.test(text)) {
            status = text.replace(/^Status:\s*/i, '').trim()
        }
    })

    const episodeNumbers = []
    $('#episode_related a[href*="-episode-"]').each((_, element) => {
        const href = String($(element).attr('href') || '').trim()
        const episodeNumber = extractEpisodeNumber(href)
        if (episodeNumber > 0) {
            episodeNumbers.push(episodeNumber)
        }
    })

    const episodes = [...new Set(episodeNumbers)].sort((a, b) => a - b)

    return {
        id: alias || String(fallbackAnimeId || '').trim(),
        alias: alias || String(fallbackAnimeId || '').trim(),
        name: title,
        img: image,
        released,
        status,
        episodes,
    }
}

function parseStreamingLinks(html = '', animeId = '', episodeNo = 0) {
    const $ = load(String(html || ''))
    const resolvedAnimeId = String($('#alias_anime').first().attr('value') || '').trim()
        || stripCategoryPath($('.anime-info a[href*="/category/"]').first().attr('href') || '')
        || String(animeId || '').trim()

    const servers = []

    $('.anime_muti_link li a[data-video]').each((_, element) => {
        const anchor = $(element)
        const url = absoluteUrl(anchor.attr('data-video') || '')
        const serverLabel = cleanServerLabel(anchor.clone().children().remove().end().text())
        const iconClass = String(anchor.find('i').first().attr('class') || '').trim()

        if (!url) return

        servers.push({
            server_label: serverLabel || iconClass || 'server',
            server_class: iconClass,
            url,
        })
    })

    return {
        anime_id: resolvedAnimeId,
        episode_no: Number(episodeNo) || extractEpisodeNumber(stripEpisodePath($('link[rel="canonical"]').attr('href') || '')) || 0,
        servers,
    }
}

export function buildGogoSearchUrl(query = '') {
    const normalizedQuery = String(query || '').trim()
    return `${GOGO_BASE_URL}/search.html?keyword=${encodeURIComponent(normalizedQuery)}`
}

export function buildGogoAnimeUrl(animeId = '') {
    return `${GOGO_BASE_URL}/category/${encodeURIComponent(String(animeId || '').trim())}`
}

export function buildGogoEpisodeUrl(animeId = '', episodeNo = 0) {
    return `${GOGO_BASE_URL}/${encodeURIComponent(String(animeId || '').trim())}-episode-${Number(episodeNo) || 0}`
}

export async function gogoanimeSearch(query = '') {
    const html = await fetchProviderHtml(buildGogoSearchUrl(query))
    return parseSearchResults(html)
}

export async function gogoanimeGetAnime(animeId = '') {
    const html = await fetchProviderHtml(buildGogoAnimeUrl(animeId))
    return parseAnimeInfo(html, animeId)
}

export async function gogoanimeGetStreamingLinks(animeId = '', episodeNo = 0) {
    const html = await fetchProviderHtml(buildGogoEpisodeUrl(animeId, episodeNo))
    return parseStreamingLinks(html, animeId, episodeNo)
}
