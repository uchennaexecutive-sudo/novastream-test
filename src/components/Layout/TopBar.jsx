import { motion } from 'framer-motion'
import useAppStore from '../../store/useAppStore'

export default function TopBar() {
  const setSearchOpen = useAppStore(s => s.setSearchOpen)

  return (
    <div
      className="fixed right-0 flex items-center justify-end px-6"
      style={{
        top: 0,
        left: 72,
        height: 56,
        paddingRight: 24,
        background: 'linear-gradient(180deg, rgba(15,15,21,0.68) 0%, rgba(15,15,21,0.46) 58%, rgba(15,15,21,0.18) 100%)',
        backdropFilter: 'blur(34px) saturate(145%)',
        WebkitBackdropFilter: 'blur(34px) saturate(145%)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.06), var(--inner-glow)',
        zIndex: 40,
      }}
    >
      <motion.button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-3 px-4 py-2 rounded-xl text-sm"
        style={{
          background: 'rgba(14, 14, 20, 0.55)',
          color: 'var(--text-muted)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
        }}
        whileHover={{
          borderColor: 'rgba(255,255,255,0.18)',
          boxShadow: '0 0 20px var(--accent-glow), 0 10px 28px rgba(0,0,0,0.18)',
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
