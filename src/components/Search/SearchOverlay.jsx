import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { searchMulti, imgW500 } from '../../lib/tmdb'
import useAppStore from '../../store/useAppStore'

export default function SearchOverlay() {
  const setSearchOpen = useAppStore(s => s.setSearchOpen)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const timerRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e) => { if (e.key === 'Escape') setSearchOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const doSearch = useCallback((q) => {
    if (!q.trim()) { setResults([]); return }
    searchMulti(q).then(r => setResults(r?.filter(i => i.media_type !== 'person').slice(0, 12) || []))
  }, [])

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selected]) {
      const item = results[selected]
      const type = item.media_type || (item.title ? 'movie' : 'tv')
      navigate(`/detail/${type}/${item.id}`)
      setSearchOpen(false)
    }
  }

  const movies = results.filter(r => r.media_type === 'movie')
  const shows = results.filter(r => r.media_type === 'tv')

  return (
    <motion.div
      className="fixed inset-0 flex items-start justify-center pt-24"
      style={{ zIndex: 9998, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(16px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) setSearchOpen(false) }}
    >
      <motion.div
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{
          background: 'var(--bg-glass)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), var(--inner-glow)',
        }}
        initial={{ y: -30, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="p-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKey}
            placeholder="Search movies, series, anime..."
            className="flex-1 bg-transparent outline-none text-lg"
            style={{ color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif" }}
          />
          <kbd
            className="text-xs font-mono px-2 py-0.5 rounded-md"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          >
            ESC
          </kbd>
        </div>

        {results.length > 0 && (
          <div className="max-h-96 overflow-y-auto p-2">
            {movies.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  🎬 Movies
                </p>
                {movies.map((item) => (
                  <ResultItem key={item.id} item={item} onClick={() => { navigate(`/detail/movie/${item.id}`); setSearchOpen(false) }} />
                ))}
              </div>
            )}
            {shows.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  📺 Series
                </p>
                {shows.map((item) => (
                  <ResultItem
                    key={item.id}
                    item={item}
                    onClick={() => {
                      navigate(`/detail/tv/${item.id}`);
                      setSearchOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {query && results.length === 0 && (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            <span className="text-3xl block mb-3 opacity-40">🔍</span>
            No results found
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function ResultItem({ item, onClick }) {
  const title = item.title || item.name
  const year = (item.release_date || item.first_air_date || '').slice(0, 4)
  return (
    <motion.button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left group"
      style={{ transition: 'background 0.15s' }}
      whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div
        className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--card-shadow)' }}
      >
        {item.poster_path ? (
          <img src={imgW500(item.poster_path)} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-lg opacity-40">🎬</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-[var(--accent)] transition-colors" style={{ color: 'var(--text-primary)' }}>{title}</p>
        <div className="flex items-center gap-2">
          {year && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{year}</span>}
          {item.vote_average > 0 && (
            <span className="text-xs font-mono flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              <span className="w-1 h-1 rounded-full" style={{ background: 'var(--accent)' }} />
              {item.vote_average.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
