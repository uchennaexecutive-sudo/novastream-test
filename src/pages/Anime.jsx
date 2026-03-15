import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { getTrendingAnime, getPopularAnime, getTopRatedAnime } from '../lib/anilist'
import { searchAnimeOnTMDB } from '../lib/tmdb'

const TABS = ['Trending', 'Popular', 'Top Rated']
const GENRES = ['Action', 'Romance', 'Comedy', 'Horror', 'Fantasy', 'Sci-Fi', 'Slice of Life', 'Sports']
const PER_PAGE = 28

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 filter-chip"
      style={{
        background: active ? 'var(--accent)' : 'var(--bg-surface)',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: active ? '0 0 16px var(--accent-glow)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

const normalizeTitle = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\bseason\s+\d+\b.*$/i, '')
    .replace(/\bpart\s+\d+\b.*$/i, '')
    .replace(/\bcour\s+\d+\b.*$/i, '')
    .replace(/\b2nd\s+season\b.*$/i, '')
    .replace(/\b3rd\s+season\b.*$/i, '')
    .replace(/\b4th\s+season\b.*$/i, '')
    .replace(/\bfinal\s+season\b.*$/i, '')
    .replace(/\bthe\s+culling\s+game\b/gi, 'jujutsu kaisen')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getPrimaryTitle = (item) =>
  item?.title?.english ||
  item?.title?.romaji ||
  item?.title?.native ||
  'Untitled'

const getAnimeYear = (item) =>
  item?.seasonYear ||
  item?.startDate?.year ||
  null

const scoreItem = (item) => {
  const episodes = Number(item?.episodes || 0)
  const score = Number(item?.averageScore || 0)
  const popularity = Number(item?.popularity || 0)
  return episodes * 100000 + score * 100 + popularity
}

const getAllTitles = (item) =>
  [
    item?.title?.english,
    item?.title?.romaji,
    item?.title?.native,
    ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
  ]
    .filter(Boolean)
    .map(normalizeTitle)
    .filter(Boolean)

const hasExplicitSequelMarker = (item) => {
  const joined = getAllTitles(item).join(' ')
  return (
    /\bseason\s+\d+\b/i.test(joined) ||
    /\bpart\s+\d+\b/i.test(joined) ||
    /\bcour\s+\d+\b/i.test(joined) ||
    /\b2nd\s+season\b/i.test(joined) ||
    /\b3rd\s+season\b/i.test(joined) ||
    /\b4th\s+season\b/i.test(joined) ||
    /\b5th\s+season\b/i.test(joined) ||
    /\b6th\s+season\b/i.test(joined) ||
    /\bfinal\s+season\b/i.test(joined)
  )
}

const hasPrequelRelation = (item) =>
  Array.isArray(item?.relations?.edges) &&
  item.relations.edges.some((edge) => {
    const relationType = String(edge?.relationType || '').toUpperCase()
    const nodeFormat = String(edge?.node?.format || '').toUpperCase()
    return (
      relationType === 'PREQUEL' &&
      (nodeFormat === 'TV' || nodeFormat === 'TV_SHORT')
    )
  })

const isLikelyStandaloneSeason1 = (item) => {
  if (hasExplicitSequelMarker(item)) return false
  if (hasPrequelRelation(item)) return false
  return true
}
const titleHasHardSequelMarker = (item) => {
  const rawTitles = [
    item?.title?.english,
    item?.title?.romaji,
    item?.title?.native,
    ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
  ].filter(Boolean)

  return rawTitles.some((title) => {
    const t = String(title).toLowerCase()
    return (
      /\bseason\s+[2-9]\d*\b/.test(t) ||
      /\b[2-9]\d*(st|nd|rd|th)\s+season\b/.test(t) ||
      /\bpart\s+[2-9]\d*\b/.test(t) ||
      /\bcour\s+[2-9]\d*\b/.test(t) ||
      /\bfinal\s+season\b/.test(t)
    )
  })
}

const shouldHideAsSequelCard = (item) => {
  if (titleHasHardSequelMarker(item)) return true
  if (hasPrequelRelation(item)) return true
  return false
}
export default function Anime() {
  const [tab, setTab] = useState('Trending')
  const [allAnime, setAllAnime] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [genre, setGenre] = useState(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [notAvailable, setNotAvailable] = useState(null)
  const [searching, setSearching] = useState(false)

  const navigate = useNavigate()
  const observer = useRef(null)
  const tmdbCache = useRef(new Map())
  const fetchIdRef = useRef(0)

  const getFetcher = useCallback(() => {
    if (tab === 'Trending') return getTrendingAnime
    if (tab === 'Popular') return getPopularAnime
    return getTopRatedAnime
  }, [tab])

  const resolveTmdbMatch = useCallback(async (item) => {
    const englishTitle = item?.title?.english || ''
    const romajiTitle = item?.title?.romaji || ''
    const seasonYear = getAnimeYear(item) || ''
    const cacheKey = `${item?.id}:${englishTitle}:${romajiTitle}:${seasonYear}`

    if (tmdbCache.current.has(cacheKey)) {
      return tmdbCache.current.get(cacheKey)
    }

    const match = await searchAnimeOnTMDB(
      englishTitle,
      romajiTitle,
      item?.seasonYear || item?.startDate?.year || null
    )
    tmdbCache.current.set(cacheKey, match || null)
    return match || null
  }, [])

  const getGroupKey = useCallback((item) => {
    const relationRoot = Array.isArray(item?.relations?.edges)
      ? item.relations.edges.find((edge) => {
        const relationType = String(edge?.relationType || '').toUpperCase()
        const nodeFormat = String(edge?.node?.format || '').toUpperCase()
        return (
          relationType === 'PREQUEL' &&
          (nodeFormat === 'TV' || nodeFormat === 'TV_SHORT')
        )
      })
      : null

    const relationTitle =
      relationRoot?.node?.title?.english ||
      relationRoot?.node?.title?.romaji ||
      relationRoot?.node?.title?.native

    if (relationTitle) {
      return normalizeTitle(relationTitle)
    }

    return normalizeTitle(getPrimaryTitle(item))
  }, [])

  const fetchPage = useCallback(async (pageNum, append = false) => {
    const fetchId = ++fetchIdRef.current
    const isFirst = pageNum === 1
    if (isFirst) setLoading(true)
    else setLoadingMore(true)

    try {
      const fetcher = getFetcher()
      const results = await fetcher(pageNum, PER_PAGE)
      console.log(`[Anime] ${tab} page ${pageNum}:`, results.length, 'results')

      const resolved = await Promise.all(
        results.map(async (item) => {
          const match = await resolveTmdbMatch(item)
          return {
            ...item,
            _tmdbMatch: match,
          }
        })
      )
      if (fetchId !== fetchIdRef.current) return

      setAllAnime((prev) => (append ? [...prev, ...resolved] : resolved))
      setHasMore(results.length >= PER_PAGE)
    } catch (err) {
      console.error('[Anime] Fetch error:', err)
      if (!append) setAllAnime([])
      setHasMore(false)
    } finally {
      if (isFirst) setLoading(false)
      else setLoadingMore(false)
    }
  }, [tab, getFetcher, resolveTmdbMatch])

  useEffect(() => {
    setPage(1)
    setGenre(null)
    setHasMore(true)
    fetchPage(1, false)
  }, [tab, fetchPage])

  const lastCardRef = useCallback(node => {
    if (loading || loadingMore) return
    if (observer.current) observer.current.disconnect()

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        const nextPage = page + 1
        setPage(nextPage)
        fetchPage(nextPage, true)
      }
    })

    if (node) observer.current.observe(node)
  }, [loading, loadingMore, hasMore, page, fetchPage])

  const displayAnime = useMemo(() => {
    const filteredAnime = genre
      ? allAnime.filter(item => item.genres?.includes(genre))
      : allAnime

    const grouped = new Map()

    for (const item of filteredAnime) {
      const key = getGroupKey(item)
      if (!key) continue

      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(item)
    }

    const picked = []

    for (const entries of grouped.values()) {
      const season1Candidates = entries.filter((item) => !shouldHideAsSequelCard(item))

      const pool = season1Candidates.length > 0 ? season1Candidates : entries

      let best = null
      for (const item of pool) {
        const currentEpisodes = Number(best?.episodes || 0)
        const nextEpisodes = Number(item?.episodes || 0)
        const currentScore = Number(best?.averageScore || 0)
        const nextScore = Number(item?.averageScore || 0)

        if (
          !best ||
          nextEpisodes > currentEpisodes ||
          (nextEpisodes === currentEpisodes && nextScore > currentScore)
        ) {
          best = item
        }
      }

      if (best) picked.push(best)
    }

    return picked.filter((item) => !shouldHideAsSequelCard(item))
  }, [allAnime, genre, getGroupKey])

  const handlePlay = async (item) => {
    const englishTitle = item.title?.english || ''
    const romajiTitle = item.title?.romaji || ''
    const displayTitle = englishTitle || romajiTitle

    setSearching(true)
    setNotAvailable(null)

    try {
      const match = item._tmdbMatch || await resolveTmdbMatch(item)

      if (match) {
        navigate(`/detail/${match.mediaType}/${match.tmdbId}`, {
          state: {
            isAnime: true,
            animeTitle: englishTitle || romajiTitle,
            animeAltTitle: romajiTitle || englishTitle,
            animeYear: getAnimeYear(item),
            anilistId: item.id,
          },
        })
      } else {
        console.warn('[Anime] No TMDB match for:', displayTitle)
        setNotAvailable(displayTitle)
        setTimeout(() => setNotAvailable(null), 4000)
      }
    } catch (err) {
      console.error('[Anime] Search error:', err)
      setNotAvailable(displayTitle)
      setTimeout(() => setNotAvailable(null), 4000)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="p-6">
      <AnimatePresence>
        {notAvailable && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            style={{
              position: 'fixed',
              bottom: 32,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9998,
              background: 'rgba(20,20,30,0.95)',
              border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(16px)',
              borderRadius: 14,
              padding: '14px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              maxWidth: 480,
            }}
          >
            <span style={{ fontSize: 20 }}>🚫</span>
            <div>
              <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, margin: 0 }}>
                Stream not available for this title
              </p>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: '2px 0 0' }}>
                "{notAvailable}" could not be found on the streaming catalog.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searching && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9997,
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div
                className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'monospace' }}>
                Finding stream.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        ⚔ Anime
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Grouped by TMDB match
      </p>

      <div className="flex gap-2 mb-4">
        {TABS.map(t => (
          <FilterChip key={t} active={tab === t} onClick={() => setTab(t)}>
            {t}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {GENRES.map(g => (
          <FilterChip key={g} active={genre === g} onClick={() => setGenre(genre === g ? null : g)}>
            {g}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5">
        {loading
          ? Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="w-full h-[264px] rounded-2xl shimmer"
              style={{ border: '1px solid var(--border)' }}
            />
          ))
          : displayAnime.map((item, i) => (
            <div
              key={`${getGroupKey(item)}-${i}`}
              ref={i === displayAnime.length - 1 && !genre ? lastCardRef : null}
            >
              <motion.div
                className="rounded-2xl overflow-hidden cursor-pointer group relative"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  height: 264,
                  boxShadow: 'var(--card-shadow)',
                }}
                whileHover={{
                  y: -8,
                  boxShadow: '0 0 30px var(--accent-glow), 0 20px 60px rgba(0,0,0,0.4)',
                  borderColor: 'var(--border-hover)',
                }}
                onClick={() => handlePlay(item)}
              >
                <img
                  src={item.coverImage?.extraLarge || item.coverImage?.large}
                  alt={getPrimaryTitle(item)}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />

                <div
                  className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out p-3 pt-10"
                  style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)' }}
                >
                  <p className="font-display font-semibold text-sm text-white truncate">
                    {getPrimaryTitle(item)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {item.averageScore && (
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-yellow-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 glow-dot" />
                        {(item.averageScore / 10).toFixed(1)}
                      </span>
                    )}
                    {item.episodes && (
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {item.episodes} eps
                      </span>
                    )}
                  </div>
                </div>

                {item.averageScore && (
                  <div
                    className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold"
                    style={{
                      background: 'rgba(0,0,0,0.7)',
                      color: item.averageScore >= 70 ? '#4ade80' : item.averageScore >= 50 ? '#fbbf24' : '#f87171',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {(item.averageScore / 10).toFixed(1)}
                  </div>
                )}
              </motion.div>
            </div>
          ))
        }

        {loadingMore && Array.from({ length: 7 }).map((_, i) => (
          <div
            key={`more-${i}`}
            className="w-full h-[264px] rounded-2xl shimmer"
            style={{ border: '1px solid var(--border)' }}
          />
        ))}
      </div>

      {!loading && displayAnime.length === 0 && (
        <div className="text-center py-16">
          <p className="text-lg" style={{ color: 'var(--text-muted)' }}>No anime found</p>
        </div>
      )}

      {loadingMore && (
        <div className="flex justify-center py-8">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        </div>
      )}
    </div>
  )
}