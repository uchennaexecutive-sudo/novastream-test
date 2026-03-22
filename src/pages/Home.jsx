import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getTrending,
  getPopularMovies,
  getTopRatedMovies,
  getPopularSeries,
  getNowPlaying,
  getOnAir,
  getSeriesByNetwork,
  getAnimeSeries,
  getAnimationMovies,
  getRecommendations,
} from '../lib/tmdb'
import { getContinueWatching } from '../lib/progress'
import HeroSlide from '../components/Cards/HeroSlide'
import MediaCard from '../components/Cards/MediaCard'
import ContinueCard from '../components/Cards/ContinueCard'
import SkeletonCard from '../components/UI/SkeletonCard'
import { saveData, getData, hasData } from '../lib/sessionCache'

function ContentRow({ title, icon, items, loading, type, renderItem, skeletonCount = 8 }) {
  const scrollRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const onMouseDown = (event) => {
    setIsDragging(true)
    setStartX(event.pageX - scrollRef.current.offsetLeft)
    setScrollLeft(scrollRef.current.scrollLeft)
  }

  const onMouseMove = (event) => {
    if (!isDragging) return
    event.preventDefault()
    const x = event.pageX - scrollRef.current.offsetLeft
    scrollRef.current.scrollLeft = scrollLeft - (x - startX) * 1.5
  }

  const onMouseUp = () => setIsDragging(false)

  const scroll = useCallback((direction) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: direction * 600, behavior: 'smooth' })
  }, [])

  return (
    <div className="mb-10 group/row">
      <div className="flex items-center justify-between px-6 mb-4">
        <h2 className="font-display font-semibold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          {icon && <span className="text-xl">{icon}</span>}
          {title}
        </h2>
        <div className="flex gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            onClick={() => scroll(-1)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {'<'}
          </button>
          <button
            onClick={() => scroll(1)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {'>'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 px-6 overflow-x-auto hide-scrollbar scroll-smooth"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {loading
          ? Array.from({ length: skeletonCount }).map((_, index) => <SkeletonCard key={index} />)
          : items?.map((item) => (
              renderItem
                ? renderItem(item)
                : <MediaCard key={item.id} item={item} type={type} />
            ))
        }
      </div>
    </div>
  )
}

export default function Home() {
  const [trending, setTrending] = useState([])
  const [heroIndex, setHeroIndex] = useState(0)
  const [popularMovies, setPopularMovies] = useState([])
  const [topRated, setTopRated] = useState([])
  const [popularSeries, setPopularSeries] = useState([])
  const [nowPlaying, setNowPlaying] = useState([])
  const [onAir, setOnAir] = useState([])
  const [netflix, setNetflix] = useState([])
  const [anime, setAnime] = useState([])
  const [animation, setAnimation] = useState([])
  const [continueWatching, setContinueWatching] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [recommendationTitle, setRecommendationTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [watchRowsLoading, setWatchRowsLoading] = useState(true)

  useEffect(() => {
    const CACHE_KEY = 'home-rows'
    if (hasData(CACHE_KEY)) {
      const c = getData(CACHE_KEY)
      setTrending(c.trending)
      setPopularMovies(c.popularMovies)
      setTopRated(c.topRated)
      setPopularSeries(c.popularSeries)
      setNowPlaying(c.nowPlaying)
      setOnAir(c.onAir)
      setNetflix(c.netflix)
      setAnime(c.anime)
      setAnimation(c.animation)
      setLoading(false)
      return
    }
    Promise.all([
      getTrending(),
      getPopularMovies(),
      getTopRatedMovies(),
      getPopularSeries(),
      getNowPlaying(),
      getOnAir(),
      getSeriesByNetwork(213),
      getAnimeSeries(),
      getAnimationMovies(),
    ]).then(([trendData, popMovies, topRatedData, popSeries, nowPlayData, onAirData, netflixData, animeData, animData]) => {
      setTrending(trendData)
      setPopularMovies(popMovies.results)
      setTopRated(topRatedData.results)
      setPopularSeries(popSeries.results)
      setNowPlaying(nowPlayData)
      setOnAir(onAirData)
      setNetflix(netflixData.results)
      setAnime(animeData.results)
      setAnimation(animData.results)
      saveData(CACHE_KEY, {
        trending: trendData,
        popularMovies: popMovies.results,
        topRated: topRatedData.results,
        popularSeries: popSeries.results,
        nowPlaying: nowPlayData,
        onAir: onAirData,
        netflix: netflixData.results,
        anime: animeData.results,
        animation: animData.results,
      })
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadWatchRows() {
      try {
        const continueItems = await getContinueWatching()
        if (cancelled) return

        setContinueWatching(continueItems)

        const seedItem = continueItems[0]
        if (!seedItem?.content_id) {
          setRecommendations([])
          setRecommendationTitle('')
          return
        }

        const recommendationType = seedItem.content_type === 'movie' ? 'movie' : 'tv'
        const nextRecommendations = await getRecommendations(recommendationType, seedItem.content_id)
        if (cancelled) return

        setRecommendationTitle(seedItem.title || '')
        setRecommendations(nextRecommendations.slice(0, 20))
      } catch {
        if (cancelled) return
        setContinueWatching([])
        setRecommendations([])
        setRecommendationTitle('')
      } finally {
        if (!cancelled) setWatchRowsLoading(false)
      }
    }

    loadWatchRows()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (trending.length === 0) return undefined

    const timer = setInterval(() => {
      setHeroIndex(index => (index + 1) % Math.min(trending.length, 5))
    }, 8000)

    return () => clearInterval(timer)
  }, [trending])

  const heroItems = trending.slice(0, 5)

  return (
    <div>
      <div className="relative -mt-14">
        <AnimatePresence mode="wait">
          {heroItems[heroIndex] && (
            <motion.div
              key={heroItems[heroIndex].id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
            >
              <HeroSlide item={heroItems[heroIndex]} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
          {heroItems.map((_, index) => (
            <button
              key={index}
              onClick={() => setHeroIndex(index)}
              className="relative h-2 rounded-full transition-all duration-300"
              style={{
                width: index === heroIndex ? 28 : 8,
                background: index === heroIndex ? 'var(--accent)' : 'rgba(255,255,255,0.25)',
                boxShadow: index === heroIndex ? '0 0 12px var(--accent-glow-strong)' : 'none',
              }}
            />
          ))}
        </div>
      </div>

      <div className="py-8">
        {(watchRowsLoading || continueWatching.length > 0) && (
          <ContentRow
            title="Continue Watching"
            icon="▶"
            items={continueWatching}
            loading={watchRowsLoading}
            renderItem={(item) => <ContinueCard key={`${item.content_id}-${item.season || 0}-${item.episode || 0}`} item={item} />}
            skeletonCount={4}
          />
        )}

        {recommendations.length > 0 && (
          <ContentRow
            title={`Because you watched ${recommendationTitle}`}
            icon="✨"
            items={recommendations}
            loading={false}
            type={recommendations[0]?.title ? 'movie' : 'tv'}
          />
        )}

        <ContentRow title="Trending This Week" icon="🔥" items={trending} loading={loading} />
        <ContentRow title="Popular Movies" icon="🎬" items={popularMovies} loading={loading} type="movie" />
        <ContentRow title="Top Rated" icon="⭐" items={topRated} loading={loading} type="movie" />
        <ContentRow title="Popular Series" icon="📺" items={popularSeries} loading={loading} type="tv" />
        <ContentRow title="Now Playing" icon="🆕" items={nowPlaying} loading={loading} type="movie" />
        <ContentRow title="On Air" icon="📡" items={onAir} loading={loading} type="tv" />
        <ContentRow title="Anime" icon="🌸" items={anime} loading={loading} type="tv" />
        <ContentRow title="Animation" icon="🎨" items={animation} loading={loading} type="movie" />
        <ContentRow title="Netflix Originals" icon="🔴" items={netflix} loading={loading} type="tv" />
      </div>
    </div>
  )
}
