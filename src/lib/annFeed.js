import { invoke } from '@tauri-apps/api/core'

const CACHE_KEY = 'ann_feed_cache_v3'
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

const IMAGE_CACHE_KEY = 'ann_image_cache_v1'
const IMAGE_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 hours

export function getCachedImages() {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY)
    if (!raw) return {}
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > IMAGE_CACHE_TTL) return {}
    return data || {}
  } catch { return {} }
}

export function saveCachedImages(images) {
  try {
    const existing = getCachedImages()
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify({ data: { ...existing, ...images }, ts: Date.now() }))
  } catch {}
}

function parseRelativeTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date)) return ''
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const items = [...doc.querySelectorAll('item')]
  return items.slice(0, 14).map(item => {
    const title = item.querySelector('title')?.textContent?.trim() ?? ''
    const linkEl = item.querySelector('link')
    const link = linkEl?.nextSibling?.textContent?.trim()
              || linkEl?.textContent?.trim()
              || ''
    const pubDate = item.querySelector('pubDate')?.textContent?.trim() ?? ''
    const category = item.querySelector('category')?.textContent?.trim() ?? ''
    const desc = (item.querySelector('description')?.textContent ?? '')
      .replace(/<[^>]+>/g, '').trim().slice(0, 130)
    return { title, link, pubDate, category, desc, image: null, time: parseRelativeTime(pubDate) }
  }).filter(i => i.title && i.link)
}

export async function getAnnFeed() {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      const { data, ts } = JSON.parse(cached)
      if (Date.now() - ts < CACHE_TTL) return data
    }
    const xml = await invoke('fetch_ann_feed')
    const data = parseXml(xml)
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
    return data
  } catch {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) return JSON.parse(cached).data
    } catch {}
    return []
  }
}

// Fetch OG images for a subset of articles, returns { link -> imageUrl } map
export async function fetchOgImages(articles) {
  const results = {}
  await Promise.all(
    articles.map(async item => {
      try {
        const img = await invoke('fetch_og_image', { url: item.link })
        if (img) results[item.link] = img
      } catch {}
    })
  )
  return results
}
