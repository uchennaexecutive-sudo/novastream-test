import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import { isLikelyAnimeTmdbItem } from '../lib/animeClassification'

const HOME_ROWS_CACHE_KEY = 'home-rows'
const INITIAL_VISIBLE_ROW_COUNT = 4
const VISIBLE_ROW_BATCH_SIZE = 2

const INITIAL_HOME_DATA = {
  trending: [],
  popularMovies: [],
  topRated: [],
  popularSeries: [],
  nowPlaying: [],
  onAir: [],
  netflix: [],
  anime: [],
  animation: [],
}

const INITIAL_WATCH_ROWS = {
  continueWatching: [],
  recommendations: [],
  recommendationTitle: '',
  loading: true,
}

function scheduleIdleTask(task, delay = 200) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(() => task(), { timeout: 1200 })
    return () => window.cancelIdleCallback(handle)
  }

  const handle = window.setTimeout(task, delay)
  return () => window.clearTimeout(handle)
}

function normalizeHomeRowsPayload(payload = {}) {
  return {
    trending: Array.isArray(payload?.trending) ? payload.trending : [],
    popularMovies: Array.isArray(payload?.popularMovies) ? payload.popularMovies : [],
    topRated: Array.isArray(payload?.topRated) ? payload.topRated : [],
    popularSeries: Array.isArray(payload?.popularSeries) ? payload.popularSeries : [],
    nowPlaying: Array.isArray(payload?.nowPlaying) ? payload.nowPlaying : [],
    onAir: Array.isArray(payload?.onAir) ? payload.onAir : [],
    netflix: Array.isArray(payload?.netflix) ? payload.netflix : [],
    anime: Array.isArray(payload?.anime) ? payload.anime : [],
    animation: Array.isArray(payload?.animation)
      ? payload.animation.filter((item) => !isLikelyAnimeTmdbItem(item, 'movie'))
      : [],
  }
}

const ContentRow = memo(function ContentRow({
  title,
  icon,
  items,
  loading,
  type,
  renderItem,
  skeletonCount = 8,
}) {
  const scrollRef = useRef(null)
  const dragStateRef = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const onMouseDown = useCallback((event) => {
    if (!scrollRef.current) return

    dragStateRef.current = {
      active: true,
      startX: event.pageX - scrollRef.current.offsetLeft,
      scrollLeft: scrollRef.current.scrollLeft,
    }
    setIsDragging(true)
  }, [])

  const stopDragging = useCallback(() => {
    dragStateRef.current.active = false
    setIsDragging(false)
  }, [])

  const onMouseMove = useCallback((event) => {
    if (!dragStateRef.current.active || !scrollRef.current) return
    event.preventDefault()
    const x = event.pageX - scrollRef.current.offsetLeft
    scrollRef.current.scrollLeft = dragStateRef.current.scrollLeft - (x - dragStateRef.current.startX) * 1.5
  }, [])

  const scroll = useCallback((direction) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: direction * 600, behavior: 'smooth' })
  }, [])

  const rowItems = useMemo(() => {
    if (loading) {
      return Array.from({ length: skeletonCount }).map((_, index) => <SkeletonCard key={index} />)
    }

    return items?.map((item) => (
      renderItem
        ? renderItem(item)
        : <MediaCard key={item.id} item={item} type={type} />
    ))
  }, [items, loading, renderItem, skeletonCount, type])

  return (
    <div
      className="mb-10 group/row"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '360px',
        contain: 'layout paint style',
      }}
    >
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
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          contain: 'layout paint style',
          overscrollBehaviorX: 'contain',
          paddingTop: 10,
          paddingBottom: 10,
          marginTop: -10,
          marginBottom: -10,
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
      >
        {rowItems}
      </div>
    </div>
  )
})

export default function Home() {
  const [homeData, setHomeData] = useState(INITIAL_HOME_DATA)
  const [criticalRowsLoading, setCriticalRowsLoading] = useState(true)
  const [deferredRowsLoading, setDeferredRowsLoading] = useState(true)
  const [watchRows, setWatchRows] = useState(INITIAL_WATCH_ROWS)
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_VISIBLE_ROW_COUNT)
  const [heroIndex, setHeroIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    let cancelDeferredLoad = null

    const cachedHomeData = hasData(HOME_ROWS_CACHE_KEY)
      ? normalizeHomeRowsPayload(getData(HOME_ROWS_CACHE_KEY))
      : null

    if (cachedHomeData) {
      setHomeData(cachedHomeData)
      setCriticalRowsLoading(false)
      setDeferredRowsLoading(false)
      return undefined
    }

    async function loadHomeRows() {
      try {
        const [trendData, popMovies, popSeries, nowPlayData] = await Promise.all([
          getTrending(),
          getPopularMovies(),
          getPopularSeries(),
          getNowPlaying(),
        ])

        if (cancelled) return

        setHomeData((current) => ({
          ...current,
          trending: Array.isArray(trendData) ? trendData : [],
          popularMovies: Array.isArray(popMovies?.results) ? popMovies.results : [],
          popularSeries: Array.isArray(popSeries?.results) ? popSeries.results : [],
          nowPlaying: Array.isArray(nowPlayData) ? nowPlayData : [],
        }))
      } catch (error) {
        console.warn('[home] failed to load critical rows', error)
      } finally {
        if (!cancelled) {
          setCriticalRowsLoading(false)
        }
      }

      cancelDeferredLoad = scheduleIdleTask(async () => {
        try {
          const [topRatedData, onAirData, netflixData, animeData, animationData] = await Promise.all([
            getTopRatedMovies(),
            getOnAir(),
            getSeriesByNetwork(213),
            getAnimeSeries(),
            getAnimationMovies(),
          ])

          if (cancelled) return

          setHomeData((current) => {
            const mergedData = normalizeHomeRowsPayload({
              ...current,
              topRated: topRatedData?.results || [],
              onAir: Array.isArray(onAirData) ? onAirData : [],
              netflix: netflixData?.results || [],
              anime: animeData?.results || [],
              animation: animationData?.results || [],
            })

            saveData(HOME_ROWS_CACHE_KEY, mergedData)
            return mergedData
          })
        } catch (error) {
          console.warn('[home] failed to load deferred rows', error)
        } finally {
          if (!cancelled) {
            setDeferredRowsLoading(false)
          }
        }
      }, 250)
    }

    void loadHomeRows()

    return () => {
      cancelled = true
      if (cancelDeferredLoad) {
        cancelDeferredLoad()
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadWatchRows() {
      try {
        const continueItems = await getContinueWatching()
        if (cancelled) return

        if (!continueItems[0]?.content_id) {
          setWatchRows({
            continueWatching: continueItems,
            recommendations: [],
            recommendationTitle: '',
            loading: false,
          })
          return
        }

        const seedItem = continueItems[0]
        const recommendationType = seedItem.content_type === 'movie' ? 'movie' : 'tv'
        const nextRecommendations = await getRecommendations(recommendationType, seedItem.content_id)
        if (cancelled) return

        setWatchRows({
          continueWatching: continueItems,
          recommendations: Array.isArray(nextRecommendations) ? nextRecommendations.slice(0, 20) : [],
          recommendationTitle: seedItem.title || '',
          loading: false,
        })
      } catch {
        if (cancelled) return
        setWatchRows({
          continueWatching: [],
          recommendations: [],
          recommendationTitle: '',
          loading: false,
        })
      }
    }

    void loadWatchRows()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (homeData.trending.length <= 1) return undefined

    let timer = null

    const stopRotation = () => {
      if (timer) {
        window.clearInterval(timer)
        timer = null
      }
    }

    const startRotation = () => {
      if (document.hidden || timer) return
      timer = window.setInterval(() => {
        setHeroIndex((index) => (index + 1) % Math.min(homeData.trending.length, 5))
      }, 8000)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopRotation()
      } else {
        startRotation()
      }
    }

    startRotation()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopRotation()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [homeData.trending])

  const heroItems = useMemo(() => homeData.trending.slice(0, 5), [homeData.trending])

  const renderContinueItem = useCallback(
    (item) => <ContinueCard key={`${item.content_id}-${item.season || 0}-${item.episode || 0}`} item={item} />,
    []
  )

  const rowDefinitions = useMemo(() => {
    const rows = []

    if (watchRows.loading || watchRows.continueWatching.length > 0) {
      rows.push({
        id: 'continue-watching',
        title: 'Continue Watching',
        icon: '▶',
        items: watchRows.continueWatching,
        loading: watchRows.loading,
        renderItem: renderContinueItem,
        skeletonCount: 4,
      })
    }

    if (watchRows.recommendations.length > 0) {
      rows.push({
        id: 'recommendations',
        title: `Because you watched ${watchRows.recommendationTitle}`,
        icon: '✨',
        items: watchRows.recommendations,
        loading: false,
        type: watchRows.recommendations[0]?.title ? 'movie' : 'tv',
      })
    }

    rows.push(
      {
        id: 'trending',
        title: 'Trending This Week',
        icon: '🔥',
        items: homeData.trending,
        loading: criticalRowsLoading,
      },
      {
        id: 'popular-movies',
        title: 'Popular Movies',
        icon: '🎬',
        items: homeData.popularMovies,
        loading: criticalRowsLoading,
        type: 'movie',
      },
      {
        id: 'popular-series',
        title: 'Popular Series',
        icon: '📺',
        items: homeData.popularSeries,
        loading: criticalRowsLoading,
        type: 'tv',
      },
      {
        id: 'now-playing',
        title: 'Now Playing',
        icon: '🆕',
        items: homeData.nowPlaying,
        loading: criticalRowsLoading,
        type: 'movie',
      },
      {
        id: 'top-rated',
        title: 'Top Rated',
        icon: '⭐',
        items: homeData.topRated,
        loading: deferredRowsLoading,
        type: 'movie',
      },
      {
        id: 'on-air',
        title: 'On Air',
        icon: '📡',
        items: homeData.onAir,
        loading: deferredRowsLoading,
        type: 'tv',
      },
      {
        id: 'anime',
        title: 'Anime',
        icon: '🌸',
        items: homeData.anime,
        loading: deferredRowsLoading,
        type: 'tv',
      },
      {
        id: 'animation',
        title: 'Animation',
        icon: '🎨',
        items: homeData.animation,
        loading: deferredRowsLoading,
        type: 'movie',
      },
      {
        id: 'netflix',
        title: 'Netflix Originals',
        icon: '🔴',
        items: homeData.netflix,
        loading: deferredRowsLoading,
        type: 'tv',
      }
    )

    return rows.filter((row) => row.loading || row.items.length > 0)
  }, [
    criticalRowsLoading,
    deferredRowsLoading,
    homeData,
    renderContinueItem,
    watchRows,
  ])

  useEffect(() => {
    setVisibleRowCount((count) => Math.min(count, Math.max(INITIAL_VISIBLE_ROW_COUNT, rowDefinitions.length)))
  }, [rowDefinitions.length])

  useEffect(() => {
    if (visibleRowCount >= rowDefinitions.length) return undefined

    const cancelReveal = scheduleIdleTask(() => {
      setVisibleRowCount((count) => Math.min(count + VISIBLE_ROW_BATCH_SIZE, rowDefinitions.length))
    }, 180)

    return () => {
      cancelReveal()
    }
  }, [rowDefinitions.length, visibleRowCount])

  const visibleRows = useMemo(
    () => rowDefinitions.slice(0, visibleRowCount),
    [rowDefinitions, visibleRowCount]
  )

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
        {visibleRows.map((row) => (
          <ContentRow
            key={row.id}
            title={row.title}
            icon={row.icon}
            items={row.items}
            loading={row.loading}
            type={row.type}
            renderItem={row.renderItem}
            skeletonCount={row.skeletonCount}
          />
        ))}
      </div>
    </div>
  )
}
