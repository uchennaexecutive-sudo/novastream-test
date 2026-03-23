import { useState, useEffect, useRef, useCallback } from 'react'
import { discoverTV } from '../lib/tmdb'
import MediaCard from '../components/Cards/MediaCard'
import SkeletonCard from '../components/UI/SkeletonCard'
import { saveData, getData, hasData } from '../lib/sessionCache'
import { isLikelyAnimeTmdbItem } from '../lib/animeClassification'

const GENRES = [
  { id: 0, name: 'All' }, { id: 10759, name: 'Action' }, { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' }, { id: 9648, name: 'Mystery' }, { id: 10765, name: 'Sci-Fi' },
  { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
]
const NETWORKS = [
  { id: 0, name: 'All Networks' },
  { id: 213, name: 'Netflix' }, { id: 49, name: 'HBO' },
  { id: 2552, name: 'Apple TV+' }, { id: 1024, name: 'Prime' },
  { id: 2739, name: 'Disney+' }, { id: 453, name: 'Hulu' },
]

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

export default function Series() {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [genre, setGenre] = useState(0)
  const [network, setNetwork] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const observer = useRef(null)

  const fetchSeries = useCallback((p, g, n, append = false) => {
    const cacheKey = `series-p${p}-g${g || 0}-n${n || 0}`
    if (!append && hasData(cacheKey)) {
      const { results, hasMore: cachedHasMore } = getData(cacheKey)
      setSeries((results || []).filter((item) => !isLikelyAnimeTmdbItem(item, 'tv')))
      setHasMore(cachedHasMore)
      setLoading(false)
      return
    }
    const params = { page: p, sort_by: 'popularity.desc' }
    if (g) params.with_genres = g
    if (n) params.with_networks = n
    setLoading(true)
    discoverTV(params).then(data => {
      const filteredResults = (data.results || []).filter((item) => !isLikelyAnimeTmdbItem(item, 'tv'))
      setSeries(prev => append ? [...prev, ...filteredResults] : filteredResults)
      const more = data.page < data.total_pages
      setHasMore(more)
      setLoading(false)
      if (!append) saveData(cacheKey, { results: filteredResults, hasMore: more })
    })
  }, [])

  useEffect(() => {
    setPage(1)
    fetchSeries(1, genre || undefined, network || undefined)
  }, [genre, network])

  const lastCardRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        const nextPage = page + 1
        setPage(nextPage)
        fetchSeries(nextPage, genre || undefined, network || undefined, true)
      }
    })
    if (node) observer.current.observe(node)
  }, [loading, hasMore, page, genre, network])

  return (
    <div className="p-6">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        📺 Series
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Browse TV series from all networks
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {GENRES.map(g => (
          <FilterChip key={g.id} active={genre === g.id} onClick={() => setGenre(g.id)}>
            {g.name}
          </FilterChip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-8">
        {NETWORKS.map(n => (
          <FilterChip key={n.id} active={network === n.id} onClick={() => setNetwork(n.id)}>
            {n.name}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5">
        {series.map((show, i) => (
          <div key={`${show.id}-${i}`} ref={i === series.length - 1 ? lastCardRef : null}>
            <MediaCard item={show} type="tv" aspectRatio="square" />
          </div>
        ))}
        {loading && Array.from({ length: 14 }).map((_, i) => (
          <div key={`sk-${i}`} className="w-full h-[264px] rounded-2xl shimmer" style={{ border: '1px solid var(--border)' }} />
        ))}
      </div>
    </div>
  )
}
