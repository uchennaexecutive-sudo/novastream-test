import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { imgW500 } from '../../lib/tmdb'
import { getProgressPercent } from '../../lib/progress'
import { buildDetailNavigationForTmdbItem } from '../../lib/animeClassification'

function ContinueCard({ item, onRemove }) {
  const navigate = useNavigate()
  const contentType = item.content_type || item.media_type || 'movie'
  const contentId = item.content_id || item.tmdb_id || item.id
  const title = item.title || item.name || 'Untitled'
  const backdrop = item.backdrop || imgW500(item.backdrop_path || item.poster_path)
  const progress = Math.round(getProgressPercent(item) * 100)
  const isEpisode = Number(item.season) > 0 && Number(item.episode) > 0
  const detailType = contentType === 'movie' ? 'movie' : 'tv'
  const resumeAt = Math.max(0, Math.floor(Number(item.progress_seconds) || 0))

  const handleOpen = async () => {
    if (contentType !== 'anime') {
      navigate(`/detail/${detailType}/${contentId}`, {
        state: {
          isAnime: false,
          resumeAt,
          resumeSeason: item.season,
          resumeEpisode: item.episode,
          resumeProgress: item,
        },
      })
      return
    }

    const target = await buildDetailNavigationForTmdbItem(
      {
        id: contentId,
        title: item.title || item.name || '',
        name: item.name || item.title || '',
        original_title: item.original_title || item.title || item.name || '',
        original_name: item.original_name || item.name || item.title || '',
        media_type: 'tv',
        genre_ids: [16],
        original_language: 'ja',
      },
      'tv'
    )

    navigate(target.path, {
      state: {
        ...(target.state || {}),
        isAnime: true,
        animeTitle: target.state?.animeTitle || title,
        animeAltTitle: target.state?.animeAltTitle || title,
        resumeAt,
        resumeSeason: item.season,
        resumeEpisode: item.episode,
        resumeProgress: item,
      },
    })
  }

  return (
    <div
      className="continue-card-shell relative w-72 h-40 cursor-pointer flex-shrink-0 group"
      onClick={handleOpen}
    >
      <div
        className="continue-card rounded-2xl overflow-hidden relative w-full h-full"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--card-shadow)',
          contain: 'layout paint style',
          contentVisibility: 'auto',
          containIntrinsicSize: '160px',
        }}
      >
        {backdrop && (
          <img
            src={backdrop}
            alt={title}
            className="continue-card__image w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
        <div
          className="continue-card__content absolute inset-0 flex flex-col justify-end p-3"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.38) 52%, transparent 76%)' }}
        >
          <p className="font-display font-semibold text-sm text-white truncate">{title}</p>
          {isEpisode && (
            <div
              className="mt-2 inline-flex items-center rounded-full px-2 py-1 text-[10px] font-mono text-white"
              style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.18)' }}
            >
              S{item.season} E{item.episode}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-white/75">
            <span>Resume</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
            <div
              className="continue-card__progress h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: 'var(--accent)',
                boxShadow: '0 0 8px var(--accent-glow)',
              }}
            />
          </div>
        </div>

        {onRemove && (
          <button
            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}
            onClick={(e) => { e.stopPropagation(); onRemove(item) }}
            title="Remove from history"
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>✕</span>
          </button>
        )}

        <div className="continue-card__cta absolute inset-0 flex items-center justify-center">
          <div
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{
              background: 'rgba(15,15,20,0.88)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 0 24px rgba(0,0,0,0.35)',
            }}
          >
            Resume
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(ContinueCard)
