import { memo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { imgW342 } from '../../lib/tmdb'
import useAppStore, { getReducedEffectsMode } from '../../store/useAppStore'
import { buildDetailNavigationForTmdbItem } from '../../lib/animeClassification'

// Stable no-op selector — used when reducedEffectsMode is supplied as a prop
// so MediaCard skips its own store subscription in high-card-count contexts.
const NOOP_SELECTOR = () => false

function MediaCard({ item, type, aspectRatio = 'portrait', reducedEffectsMode: reducedEffectsModeProp }) {
  const navigate = useNavigate()
  const hasProp = reducedEffectsModeProp !== undefined
  const storeValue = useAppStore(hasProp ? NOOP_SELECTOR : getReducedEffectsMode)
  const reducedEffectsMode = hasProp ? reducedEffectsModeProp : storeValue
  const title = item.title || item.name || item.original_title || ''
  const poster = imgW342(item.poster_path || item.backdrop_path)
  const rating = item.vote_average

  const isSquare = aspectRatio === 'square'

  // Prefetch the navigation target on hover so clicks feel instant.
  const cachedNavRef = useRef(null)

  const handleMouseEnter = useCallback(() => {
    if (cachedNavRef.current) return
    buildDetailNavigationForTmdbItem(item, type)
      .then((result) => { cachedNavRef.current = result })
      .catch(() => {})
  }, [item, type])

  const handleOpen = useCallback(() => {
    if (cachedNavRef.current) {
      const { path, state } = cachedNavRef.current
      navigate(path, state ? { state } : undefined)
      return
    }
    buildDetailNavigationForTmdbItem(item, type).then((target) => {
      navigate(target.path, target.state ? { state: target.state } : undefined)
    })
  }, [item, type, navigate])

  return (
    <div
      className={`media-card-shell relative cursor-pointer group ${isSquare ? 'w-full' : 'w-44 flex-shrink-0'}`}
      onClick={handleOpen}
      onMouseEnter={handleMouseEnter}
    >
      <div
        className="media-card rounded-2xl overflow-hidden relative"
        data-reduced-effects={reducedEffectsMode ? 'true' : 'false'}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--card-shadow)',
          height: 264,
          contain: 'layout paint style',
          contentVisibility: 'auto',
          containIntrinsicSize: '264px',
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt={title}
            className="media-card__image w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <span className="text-4xl opacity-40">🎬</span>
          </div>
        )}

        <div
          className="media-card__overlay absolute inset-x-0 bottom-0 p-3 pt-10"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)',
          }}
        >
          <p className="font-display font-semibold text-sm text-white truncate">{title}</p>

          <div className="flex items-center gap-2 mt-1.5">
            {rating > 0 && (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-yellow-400">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 glow-dot" />
                {rating.toFixed(1)}
              </span>
            )}
          </div>

          <div
            className="mt-2.5 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200"
            style={{
              background: 'var(--accent)',
              boxShadow: reducedEffectsMode ? '0 0 10px var(--accent-glow)' : '0 0 16px var(--accent-glow)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          </div>
        </div>

        {rating > 0 && (
          <div
            className="media-card__rating absolute top-2 right-2 px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold"
            style={{
              background: 'rgba(0,0,0,0.7)',
              color: rating >= 7 ? '#4ade80' : rating >= 5 ? '#fbbf24' : '#f87171',
              backdropFilter: reducedEffectsMode ? 'none' : 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {rating.toFixed(1)}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MediaCard)
