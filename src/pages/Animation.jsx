import { useState, useEffect, useRef, useCallback } from 'react'
import { discoverMovies, discoverTV } from '../lib/tmdb'
import MediaCard from '../components/Cards/MediaCard'
import SkeletonCard from '../components/UI/SkeletonCard'
import { isLikelyAnimeTmdbItem } from '../lib/animeClassification'

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

export default function Animation() {
  const [tab, setTab] = useState('movies')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const observer = useRef(null)

  const fetchData = useCallback((p, t, append = false) => {
    setLoading(true)
    const fn = t === 'movies'
      ? discoverMovies({ with_genres: 16, page: p, sort_by: 'popularity.desc' })
      : discoverTV({ with_genres: 16, page: p, sort_by: 'popularity.desc' })
    fn.then(data => {
      const mediaType = t === 'movies' ? 'movie' : 'tv'
      const filteredResults = (data.results || []).filter((item) => !isLikelyAnimeTmdbItem(item, mediaType))
      setItems(prev => append ? [...prev, ...filteredResults] : filteredResults)
      setHasMore(data.page < data.total_pages)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    setPage(1)
    fetchData(1, tab)
  }, [tab])

  const lastRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        const next = page + 1
        setPage(next)
        fetchData(next, tab, true)
      }
    })
    if (node) observer.current.observe(node)
  }, [loading, hasMore, page, tab])

  return (
    <div className="p-6">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        🎨 Animation
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Animated movies and series</p>

      <div className="flex gap-2 mb-8">
        {['movies', 'series'].map(t => (
          <FilterChip key={t} active={tab === t} onClick={() => setTab(t)}>
            {t === 'movies' ? 'Movies' : 'Series'}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5">
        {items.map((item, i) => (
          <div key={`${item.id}-${i}`} ref={i === items.length - 1 ? lastRef : null}>
            <MediaCard item={item} type={tab === 'movies' ? 'movie' : 'tv'} aspectRatio="square" />
          </div>
        ))}
        {loading && Array.from({ length: 14 }).map((_, i) => (
          <div key={`sk-${i}`} className="w-full h-[264px] rounded-2xl shimmer" style={{ border: '1px solid var(--border)' }} />
        ))}
      </div>
    </div>
  )
}
