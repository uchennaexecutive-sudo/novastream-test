import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

async function getWin() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let active = true
    let unlisten = null

    const syncMaximizedState = async (win) => {
      try {
        const nextValue = await win.isMaximized()
        if (active) {
          setIsMaximized(prev => (prev === nextValue ? prev : nextValue))
        }
      } catch {}
    }

    getWin().then(async (win) => {
      if (!active) return

      await syncMaximizedState(win)

      const removeListener = await win.listen('tauri://resize', () => {
        void syncMaximizedState(win)
      })

      if (active) {
        unlisten = removeListener
      } else {
        removeListener()
      }
    }).catch(() => {})

    return () => {
      active = false
      if (unlisten) unlisten()
    }
  }, [])

  const handleMinimize = async () => {
    try { const win = await getWin(); await win.minimize() } catch {}
  }

  const handleMaximize = async () => {
    try {
      const win = await getWin()
      await win.toggleMaximize()
      setIsMaximized(await win.isMaximized())
    } catch {}
  }

  const handleClose = async () => {
    try { const win = await getWin(); await win.close() } catch {}
  }

  return (
    // Pointer-events none on container — only controls capture events
    <div
      className="fixed top-0 right-0"
      style={{ height: 56, width: 138, zIndex: 60, pointerEvents: 'none' }}
    >
      <div
        className="h-full flex items-center justify-end gap-0.5 pr-3"
        style={{ pointerEvents: 'auto' }}
      >
        <WinBtn onClick={handleMinimize} title="Minimize">
          <svg width="9" height="1.5" viewBox="0 0 9 1.5" fill="currentColor">
            <rect width="9" height="1.5" rx="0.75" />
          </svg>
        </WinBtn>

        <WinBtn onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2.5" y="0.5" width="7" height="7" rx="1" />
              <path d="M0.5 2.5v7a1 1 0 001 1h7" />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
            </svg>
          )}
        </WinBtn>

        <WinBtn onClick={handleClose} title="Close" closeBtn>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </WinBtn>
      </div>
    </div>
  )
}

function WinBtn({ onClick, children, title, closeBtn }) {
  return (
    <motion.button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md flex items-center justify-center cursor-pointer"
      style={{ color: 'rgba(255,255,255,0.3)', background: 'transparent' }}
      whileHover={closeBtn ? {
        color: '#ef4444',
        background: 'rgba(239,68,68,0.15)',
      } : {
        color: 'rgba(255,255,255,0.75)',
        background: 'rgba(255,255,255,0.08)',
      }}
      transition={{ duration: 0.12 }}
    >
      {children}
    </motion.button>
  )
}
