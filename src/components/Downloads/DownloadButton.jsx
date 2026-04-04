/**
 * DownloadButton
 *
 * Polymorphic download control used in two contexts:
 *   size="sm"  — circular icon button for episode card overlays
 *   size="md"  — labelled rectangular button for the detail page action row
 *
 * Status cycle: default → queued → downloading → paused → completed | failed
 *
 * Backend wiring points (Phase C):
 *   onDownload()  → invoke("start_video_download", { contentId, ... })
 *   onPause()     → invoke("pause_video_download", { id })
 *   onCancel()    → invoke("cancel_video_download", { id })
 */
import { motion, AnimatePresence } from 'framer-motion'
import {
  Download,
  Clock,
  Pause,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react'
import DownloadProgressRing from './DownloadProgressRing'

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  default: {
    icon: Download,
    label: 'Download',
    color: 'var(--text-secondary)',
    bgActive: 'var(--bg-surface)',
    animate: false,
  },
  queued: {
    icon: Clock,
    label: 'Queued',
    color: 'var(--text-muted)',
    bgActive: 'var(--bg-surface)',
    animate: true,
  },
  downloading: {
    icon: Pause,
    label: null, // replaced by progress %
    color: 'var(--accent)',
    bgActive: 'var(--bg-elevated)',
    animate: false,
  },
  paused: {
    icon: Play,
    label: 'Paused',
    color: 'var(--accent-secondary, var(--accent))',
    bgActive: 'var(--bg-elevated)',
    animate: false,
  },
  completed: {
    icon: CheckCircle,
    label: 'Downloaded',
    color: '#4ade80',
    bgActive: 'rgba(74,222,128,0.08)',
    animate: false,
  },
  failed: {
    icon: XCircle,
    label: 'Failed — retry',
    color: '#f87171',
    bgActive: 'rgba(248,113,113,0.08)',
    animate: false,
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DownloadButton({
  // Identity (passed through to callbacks for backend wiring)
  contentId,
  contentType,
  title,
  poster,
  season,
  episode,
  quality = 'high',

  // UI state
  status = 'default',  // 'default'|'queued'|'downloading'|'paused'|'completed'|'failed'
  progress = 0,        // 0-100, used when status === 'downloading'

  // Display
  size = 'md',         // 'sm' (icon-only circle) | 'md' (icon + label rectangle)

  // Callbacks — left unwired until Phase C backend pass
  onDownload,          // () => void — triggers quality sheet or starts download
  onPause,             // () => void
  onCancel,            // () => void — used by sm size on long-press (future)
}) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.default
  const Icon = cfg.icon

  function handleClick(e) {
    e.stopPropagation()
    if (status === 'default' || status === 'failed') {
      onDownload?.()
    } else if (status === 'downloading') {
      onPause?.()
    } else if (status === 'paused') {
      onDownload?.() // resume = re-enqueue
    }
    // queued / completed → no-op click
  }

  // ── sm: circular icon button (episode card overlay) ──────────────────────
  if (size === 'sm') {
    return (
      <motion.button
        onClick={handleClick}
        title={cfg.label || status}
        className="relative flex items-center justify-center rounded-full flex-shrink-0"
        style={{
          width: 30,
          height: 30,
          background: 'rgba(8,8,14,0.72)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: status === 'completed'
            ? '1px solid rgba(74,222,128,0.35)'
            : '1px solid rgba(255,255,255,0.10)',
          color: cfg.color,
        }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.92 }}
        animate={cfg.animate ? { opacity: [1, 0.5, 1] } : {}}
        transition={cfg.animate ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}}
      >
        {status === 'downloading' ? (
          <>
            {/* Progress ring behind icon */}
            <span className="absolute inset-0 flex items-center justify-center">
              <DownloadProgressRing progress={progress} size={30} strokeWidth={2.5} />
            </span>
            <Pause size={10} fill={cfg.color} strokeWidth={0} style={{ color: cfg.color, position: 'relative', zIndex: 1 }} />
          </>
        ) : (
          <Icon size={13} strokeWidth={status === 'completed' ? 2.5 : 1.75} />
        )}
      </motion.button>
    )
  }

  // ── md: labelled button (detail page action row) ──────────────────────────
  const isDownloading = status === 'downloading'
  const isCompleted = status === 'completed'

  return (
    <motion.button
      onClick={handleClick}
      className="flex items-center gap-2.5 font-semibold rounded-xl relative overflow-hidden"
      style={{
        background: isCompleted ? 'rgba(74,222,128,0.08)' : 'transparent',
        color: cfg.color,
        padding: '14px 28px',
        fontSize: 16,
        border: isCompleted
          ? '1px solid rgba(74,222,128,0.30)'
          : '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        whiteSpace: 'nowrap',
      }}
      whileHover={{
        scale: 1.02,
        borderColor: isCompleted ? 'rgba(74,222,128,0.55)' : 'var(--accent)',
        boxShadow: isCompleted
          ? '0 0 20px rgba(74,222,128,0.18)'
          : '0 0 20px var(--accent-glow)',
      }}
      whileTap={{ scale: 0.98 }}
      animate={cfg.animate ? { opacity: [1, 0.65, 1] } : {}}
      transition={cfg.animate ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}}
    >
      {isDownloading ? (
        <>
          <DownloadProgressRing progress={progress} size={18} strokeWidth={2} />
          <span>{progress}%</span>
        </>
      ) : (
        <>
          <Icon size={17} strokeWidth={isCompleted ? 2.5 : 1.75} />
          <span>{cfg.label}</span>
        </>
      )}
    </motion.button>
  )
}
