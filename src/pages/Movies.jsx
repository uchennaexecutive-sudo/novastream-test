import { useState, useEffect, useRef, useCallback } from 'react'
import { discoverMovies } from '../lib/tmdb'
import MediaCard from '../components/Cards/MediaCard'
import SkeletonCard from '../components/UI/SkeletonCard'
import { saveData, getData, hasData } from '../lib/sessionCache'
import { isLikelyAnimeTmdbItem } from '../lib/animeClassification'

const GENRES = [
  { id: 0, name: 'All' }, { id: 28, name: 'Action' }, { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' }, { id: 27, name: 'Horror' }, { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' }, { id: 16, name: 'Animation' }, { id: 99, name: 'Documentary' },
]
const SORTS = [
  { id: 'popularity.desc', name: 'Popular' },
  { id: 'vote_average.desc', name: 'Top Rated' },
  { id: 'primary_release_date.desc', name: 'Newest' },
  { id: 'release_date.asc', name: 'Upcoming' },
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

export default function Movies() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [genre, setGenre] = useState(0)
  const [sort, setSort] = useState('popularity.desc')
  const [hasMore, setHasMore] = useState(true)
  const observer = useRef(null)

  const filterMovies = useCallback((items) => (
    Array.isArray(items) ? items.filter(item => !isLikelyAnimeTmdbItem(item, 'movie')) : []
  ), [])

  const fetchMovies = useCallback((p, g, s, append = false) => {
    const cacheKey = `movies-p${p}-g${g || 0}-s${s}`
    if (!append && hasData(cacheKey)) {
      const { results, hasMore: cachedHasMore } = getData(cacheKey)
      setMovies(results)
      setHasMore(cachedHasMore)
      setLoading(false)
      return
    }
    const params = { page: p, sort_by: s, 'vote_count.gte': s === 'vote_average.desc' ? 200 : 0 }
    if (g) params.with_genres = g
    setLoading(true)
    discoverMovies(params).then(data => {
      const filteredResults = filterMovies(data.results)
      setMovies(prev => append ? [...prev, ...filteredResults] : filteredResults)
      const more = data.page < data.total_pages
      setHasMore(more)
      setLoading(false)
      if (!append) saveData(cacheKey, { results: filteredResults, hasMore: more })
    })
  }, [filterMovies])

  useEffect(() => {
    setPage(1)
    fetchMovies(1, genre || undefined, sort)
  }, [genre, sort])

  const lastCardRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        const nextPage = page + 1
        setPage(nextPage)
        fetchMovies(nextPage, genre || undefined, sort, true)
      }
    })
    if (node) observer.current.observe(node)
  }, [loading, hasMore, page, genre, sort])

  return (
    <div className="p-6">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        🎬 Movies
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Browse thousands of movies
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {GENRES.map(g => (
          <FilterChip key={g.id} active={genre === g.id} onClick={() => setGenre(g.id)}>
            {g.name}
          </FilterChip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-8">
        {SORTS.map(s => (
          <FilterChip key={s.id} active={sort === s.id} onClick={() => setSort(s.id)}>
            {s.name}
          </FilterChip>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5">
        {movies.map((movie, i) => (
          <div key={`${movie.id}-${i}`} ref={i === movies.length - 1 ? lastCardRef : null}>
            <MediaCard item={movie} type="movie" aspectRatio="square" />
          </div>
        ))}
        {loading && Array.from({ length: 14 }).map((_, i) => (
          <div key={`sk-${i}`} className="w-full h-[264px] rounded-2xl shimmer" style={{ border: '1px solid var(--border)' }} />
        ))}
      </div>
    </div>
  )
}
