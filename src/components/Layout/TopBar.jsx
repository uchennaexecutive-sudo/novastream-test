import { motion } from 'framer-motion'
import useAppStore, { getReducedEffectsMode } from '../../store/useAppStore'
import useMainScrollActivity from '../../hooks/useMainScrollActivity'

export default function TopBar() {
  const setSearchOpen = useAppStore(s => s.setSearchOpen)
  const reducedEffectsMode = useAppStore(getReducedEffectsMode)
  const isMainScrolling = useMainScrollActivity()
  const scrollOptimizedEffects = reducedEffectsMode || isMainScrolling

  return (
    <div
      className="fixed flex items-center justify-end"
      style={{
        top: 0,
        left: 72,
        right: 0,
        height: 56,
        paddingRight: 145,
        background: scrollOptimizedEffects
          ? 'linear-gradient(180deg, rgba(8,8,14,0.90) 0%, rgba(8,8,14,0.76) 65%, rgba(8,8,14,0.28) 100%)'
          : 'linear-gradient(180deg, rgba(8,8,14,0.22) 0%, rgba(8,8,14,0.12) 60%, transparent 100%)',
        backdropFilter: scrollOptimizedEffects ? 'blur(10px)' : 'blur(24px) saturate(150%)',
        WebkitBackdropFilter: scrollOptimizedEffects ? 'blur(10px)' : 'blur(24px) saturate(150%)',
        boxShadow: scrollOptimizedEffects ? '0 1px 0 var(--border)' : '0 1px 0 rgba(255,255,255,0.05)',
        zIndex: 40,
        position: 'fixed',
        contain: 'paint',
        transform: 'translateZ(0)',
      }}
    >
      {/* Drag region — covers left empty portion, stops before search button */}
      <div
        data-tauri-drag-region
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 310, pointerEvents: 'auto' }}
      />

      <motion.button
        onClick={() => setSearchOpen(true)}
        className="relative flex items-center gap-3 px-4 py-2 rounded-xl text-sm cursor-pointer"
        style={{
          background: scrollOptimizedEffects ? 'rgba(14,14,20,0.86)' : 'rgba(14, 14, 20, 0.5)',
          color: 'var(--text-muted)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: scrollOptimizedEffects ? 'blur(5px)' : 'blur(12px)',
          WebkitBackdropFilter: scrollOptimizedEffects ? 'blur(5px)' : 'blur(12px)',
          boxShadow: scrollOptimizedEffects ? '0 2px 10px rgba(0,0,0,0.18)' : '0 4px 16px rgba(0,0,0,0.16)',
          zIndex: 1,
        }}
        whileHover={scrollOptimizedEffects ? {
          borderColor: 'rgba(255,255,255,0.14)',
        } : {
          borderColor: 'rgba(255,255,255,0.18)',
          boxShadow: '0 0 20px var(--accent-glow), 0 4px 16px rgba(0,0,0,0.16)',
        }}
        whileTap={{ scale: 0.97 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Search movies, series...</span>
        <kbd
          className="font-mono text-[10px] px-1.5 py-0.5 rounded-md ml-4"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
        >
          Ctrl+K
        </kbd>
      </motion.button>
    </div>
  )
}
