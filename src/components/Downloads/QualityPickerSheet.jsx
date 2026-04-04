/**
 * QualityPickerSheet
 *
 * One-time quality selection modal shown before the first download.
 * After this, the stored preference is applied silently.
 *
 * Backend wiring points (Phase B/C):
 *   onConfirm(quality) → save to useDownloadStore preference + enqueue download
 */
import { motion, AnimatePresence } from 'framer-motion'
import { X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const QUALITIES = [
  {
    id: 'standard',
    label: 'Standard',
    description: 'Smaller file, good for most connections',
    sizeHint: '~900 MB / 2hr film',
    bitrate: '~1 Mbps',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Recommended — best balance of quality and size',
    sizeHint: '~2.7 GB / 2hr film',
    bitrate: '~3 Mbps',
  },
  {
    id: 'highest',
    label: 'Highest',
    description: 'Maximum quality, large file size',
    sizeHint: '~7.2 GB / 2hr film',
    bitrate: '~8 Mbps',
  },
]

export default function QualityPickerSheet({
  isOpen,
  onClose,
  onConfirm,        // (quality: string) => void — wired by Phase B/C
  title = '',
  defaultQuality = 'high',
}) {
  const [selected, setSelected] = useState(defaultQuality)

  useEffect(() => {
    if (isOpen) {
      setSelected(defaultQuality)
    }
  }, [defaultQuality, isOpen])

  function handleConfirm() {
    onConfirm?.(selected)
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
            style={{ translateX: '-50%', translateY: '-50%', width: '100%', maxWidth: 420, padding: '0 16px' }}
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
                    Download Quality
                  </h2>
                  {title && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)', maxWidth: 280 }}>
                      {title}
                    </p>
                  )}
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

              {/* Options */}
              <div className="px-5 py-4 flex flex-col gap-2.5">
                {QUALITIES.map((q) => {
                  const isSelected = selected === q.id
                  return (
                    <motion.button
                      key={q.id}
                      onClick={() => setSelected(q.id)}
                      className="w-full text-left rounded-xl px-4 py-3.5 flex items-center gap-3"
                      style={{
                        background: isSelected ? 'rgba(var(--accent-rgb, 108,99,255),0.12)' : 'var(--bg-surface)',
                        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                        boxShadow: isSelected ? '0 0 16px var(--accent-glow)' : 'none',
                      }}
                      whileHover={{ borderColor: isSelected ? 'var(--accent)' : 'var(--border-hover)' }}
                      whileTap={{ scale: 0.99 }}
                    >
                      {/* Radio dot */}
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center"
                        style={{
                          border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
                          background: 'transparent',
                        }}
                      >
                        {isSelected && (
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ background: 'var(--accent)' }}
                          />
                        )}
                      </div>

                      {/* Label */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-sm font-semibold"
                            style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                          >
                            {q.label}
                          </span>
                          {q.id === 'high' && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                              style={{ background: 'var(--accent)', color: '#fff' }}
                            >
                              REC
                            </span>
                          )}
                        </div>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {q.description}
                        </span>
                      </div>

                      {/* Size hint */}
                      <span className="font-mono text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {q.sizeHint}
                      </span>
                    </motion.button>
                  )
                })}
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
                  <Zap size={14} />
                  Download
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  ), document.body)
}
