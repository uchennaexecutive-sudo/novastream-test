/**
 * SeasonDownloadSheet
 *
 * Shown when the user clicks "Download Season" in the episode selector.
 * Lets the user choose All vs Unwatched episodes + quality.
 *
 * Backend wiring points (Phase B/C):
 *   onConfirm({ mode, quality }) → enqueue N download jobs in useDownloadStore
 */
import { motion, AnimatePresence } from 'framer-motion'
import { X, Download, HardDrive } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const QUALITIES = [
  { id: 'standard', label: 'Standard', sizePerEp: 360 },  // MB
  { id: 'high',     label: 'High',     sizePerEp: 900 },
  { id: 'highest',  label: 'Highest',  sizePerEp: 2400 },
]

function formatMB(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export default function SeasonDownloadSheet({
  isOpen,
  onClose,
  onConfirm,          // ({ mode: 'all'|'unwatched', quality: string }) => void
  seasonNumber = 1,
  totalEpisodes = 0,
  unwatchedEpisodes = null,  // null = unknown (show All only)
  defaultQuality = 'high',
}) {
  const [mode, setMode] = useState('all')
  const [quality, setQuality] = useState(defaultQuality)

  useEffect(() => {
    if (isOpen) {
      setMode('all')
      setQuality(defaultQuality)
    }
  }, [defaultQuality, isOpen])

  const episodeCount = mode === 'unwatched' && unwatchedEpisodes != null
    ? unwatchedEpisodes
    : totalEpisodes

  const qualityCfg = QUALITIES.find(q => q.id === quality) || QUALITIES[1]
  const estimatedMB = episodeCount * qualityCfg.sizePerEp

  function handleConfirm() {
    onConfirm?.({ mode, quality })
    onClose?.()
  }

  if (typeof document === 'undefined') return null

  return createPortal((
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[200]"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed z-[201] left-1/2 top-1/2"
            style={{ translateX: '-50%', translateY: '-50%', width: '100%', maxWidth: 400, padding: '0 16px' }}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-6 pt-6 pb-4"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <div>
                  <h2 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                    Download Season {seasonNumber}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {totalEpisodes} episode{totalEpisodes !== 1 ? 's' : ''}
                  </p>
                </div>
                <motion.button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}
                  whileHover={{ color: 'var(--text-primary)' }}
                  whileTap={{ scale: 0.94 }}
                >
                  <X size={15} />
                </motion.button>
              </div>

              <div className="px-5 py-4 flex flex-col gap-4">
                {/* Mode selector */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                    EPISODES TO DOWNLOAD
                  </p>
                  <div className="flex flex-col gap-2">
                    {[
                      { id: 'all', label: `All episodes (${totalEpisodes})` },
                      ...(unwatchedEpisodes != null ? [{ id: 'unwatched', label: `Unwatched only (${unwatchedEpisodes})` }] : []),
                    ].map((opt) => {
                      const isActive = mode === opt.id
                      return (
                        <motion.button
                          key={opt.id}
                          onClick={() => setMode(opt.id)}
                          className="w-full text-left px-4 py-3 rounded-xl flex items-center gap-3"
                          style={{
                            background: isActive ? 'rgba(var(--accent-rgb, 108,99,255),0.10)' : 'var(--bg-surface)',
                            border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                          }}
                          whileTap={{ scale: 0.99 }}
                        >
                          <div
                            className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center"
                            style={{
                              border: isActive ? '2px solid var(--accent)' : '2px solid var(--border)',
                            }}
                          >
                            {isActive && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
                          </div>
                          <span className="text-sm" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {opt.label}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                {/* Quality selector */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                    QUALITY
                  </p>
                  <div className="flex gap-2">
                    {QUALITIES.map(q => {
                      const isActive = quality === q.id
                      return (
                        <motion.button
                          key={q.id}
                          onClick={() => setQuality(q.id)}
                          className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                          style={{
                            background: isActive ? 'var(--accent)' : 'var(--bg-surface)',
                            color: isActive ? '#fff' : 'var(--text-secondary)',
                            border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                            boxShadow: isActive ? '0 0 12px var(--accent-glow)' : 'none',
                          }}
                          whileTap={{ scale: 0.97 }}
                        >
                          {q.label}
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                {/* Estimate */}
                <div
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                >
                  <HardDrive size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Estimated storage needed:&nbsp;
                    <span className="font-semibold font-mono" style={{ color: 'var(--text-secondary)' }}>
                      ~{formatMB(estimatedMB)}
                    </span>
                    &nbsp;for {episodeCount} episode{episodeCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div
                className="flex gap-3 px-5 py-4"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <motion.button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                  whileHover={{ color: 'var(--text-primary)' }}
                  whileTap={{ scale: 0.98 }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  onClick={handleConfirm}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    boxShadow: '0 0 24px var(--accent-glow)',
                  }}
                  whileHover={{ boxShadow: '0 0 32px var(--accent-glow)' }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Download size={14} />
                  Download {episodeCount} ep{episodeCount !== 1 ? 's' : ''}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  ), document.body)
}
