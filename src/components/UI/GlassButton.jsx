import { motion } from 'framer-motion'
import useAppStore, { getReducedEffectsMode } from '../../store/useAppStore'

export default function GlassButton({ children, onClick, variant = 'glass', className = '', ...props }) {
  const reducedEffectsMode = useAppStore(getReducedEffectsMode)
  const base = 'px-5 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 cursor-pointer'

  const styles = variant === 'filled'
    ? {
        background: 'var(--accent)',
        color: '#fff',
        border: 'none',
        boxShadow: reducedEffectsMode ? '0 0 12px var(--accent-glow)' : '0 0 20px var(--accent-glow)',
      }
    : {
        background: reducedEffectsMode ? 'var(--bg-surface)' : 'var(--bg-glass)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        backdropFilter: reducedEffectsMode ? 'blur(8px)' : 'blur(20px)',
        WebkitBackdropFilter: reducedEffectsMode ? 'blur(8px)' : 'blur(20px)',
      }

  return (
    <motion.button
      className={`${base} ${className}`}
      style={styles}
      onClick={onClick}
      whileHover={{
        scale: reducedEffectsMode ? 1.01 : 1.04,
        boxShadow: variant === 'filled'
          ? reducedEffectsMode
            ? '0 0 20px var(--accent-glow)'
            : '0 0 40px var(--accent-glow-strong), 0 8px 32px var(--accent-glow)'
          : reducedEffectsMode
            ? '0 0 12px var(--accent-glow)'
            : '0 0 24px var(--accent-glow)',
        borderColor: 'var(--border-hover)',
      }}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: reducedEffectsMode ? 0.14 : 0.2 }}
      {...props}
    >
      {children}
    </motion.button>
  )
}
