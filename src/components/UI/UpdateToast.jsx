import { motion, AnimatePresence } from 'framer-motion'

export default function UpdateToast({ version, notes, applyMode = 'restart', onAction }) {
  const isInstallerFlow = applyMode === 'installer'
  const title = isInstallerFlow ? 'Installer Ready' : 'Update Ready'
  const description = isInstallerFlow
    ? `NOVA STREAM v${version} is ready to install.`
    : `NOVA STREAM v${version} has been downloaded.`
  const helperNote = isInstallerFlow
    ? 'Open the disk image, then launch NOVA STREAM Installer.app to finish updating.'
    : null
  const buttonLabel = isInstallerFlow ? 'Open Installer' : 'Restart to Apply'

  return (
    <AnimatePresence>
      <motion.div
        className="fixed bottom-6 right-6"
        style={{
          zIndex: 99998,
          width: 340,
          background: 'var(--bg-surface)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        initial={{ x: 100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 100, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: '#22c55e', boxShadow: '0 0 8px #22c55e80' }}
          />
          <h3
            className="font-display font-bold text-base"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </h3>
        </div>

        <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
        {helperNote && (
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            {helperNote}
          </p>
        )}
        {notes && (
          <p className="text-xs mb-4 font-mono" style={{ color: 'var(--text-muted)' }}>
            {notes}
          </p>
        )}
        {!notes && <div className="mb-4" />}

        <button
          onClick={onAction}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            boxShadow: '0 0 20px var(--accent-glow)',
          }}
        >
          {buttonLabel}
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
