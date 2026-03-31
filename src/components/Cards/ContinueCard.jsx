import { memo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { imgW500 } from '../../lib/tmdb'
import { getProgressPercent } from '../../lib/progress'
import { buildDetailNavigationForTmdbItem } from '../../lib/animeClassification'

function ContinueCard({ item }) {
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
    <motion.div
      className="w-72 h-40 rounded-2xl overflow-hidden relative cursor-pointer flex-shrink-0 group"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
      whileHover={{
        y: -4,
        boxShadow: '0 0 24px var(--accent-glow), 0 16px 48px rgba(0,0,0,0.3)',
        borderColor: 'var(--border-hover)',
      }}
      onClick={handleOpen}
    >
      {backdrop && (
        <img
          src={backdrop}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      )}
      <div
        className="absolute inset-0 flex flex-col justify-end p-3"
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
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
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
    </motion.div>
  )
}

export default memo(ContinueCard)
