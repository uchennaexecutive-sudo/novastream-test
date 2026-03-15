import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import BackgroundOrbs from './BackgroundOrbs'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import TopBar from './TopBar'
import useAppStore from '../../store/useAppStore'

const pageVariants = {
  initial: { opacity: 0, y: 20, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(4px)' },
}

const pageTransition = {
  duration: 0.4,
  ease: [0.4, 0, 0.2, 1],
}
const TOPBAR_HEIGHT = 56

export default function Layout() {
  const setSearchOpen = useAppStore(s => s.setSearchOpen)
  const location = useLocation()

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearchOpen])

  return (
    <div
      className="relative h-screen overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      <BackgroundOrbs />
      <TitleBar />
      <TopBar />
      <Sidebar />
      <main
        className="relative ml-[72px] overflow-y-auto overflow-x-hidden"
        style={{
          zIndex: 1,
          marginTop: TOPBAR_HEIGHT,
          height: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
