import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import BackgroundOrbs from './BackgroundOrbs'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import TopBar from './TopBar'
import useAppStore from '../../store/useAppStore'
import { saveScroll, getScroll, hasScroll } from '../../lib/sessionCache'

const TOPBAR_HEIGHT = 56

export default function Layout() {
  const setSearchOpen = useAppStore(s => s.setSearchOpen)
  const appReducedMotion = useAppStore(s => s.preferences.reduceAnimations)
  const location = useLocation()
  const sysReducedMotion = useReducedMotion()
  const mainRef = useRef(null)
  const prevPathRef = useRef(location.pathname)

  // Save/restore scroll positions across navigation (in-memory, cleared on restart)
  useEffect(() => {
    const prev = prevPathRef.current
    const curr = location.pathname
    if (prev === curr) return

    if (mainRef.current) {
      saveScroll(prev, mainRef.current.scrollTop)
    }

    prevPathRef.current = curr

    const restoreOrResetScroll = () => {
      if (!mainRef.current) return

      if (hasScroll(curr)) {
        mainRef.current.scrollTop = getScroll(curr)
      } else {
        // New routes should open at the top instead of inheriting the previous page's deep scroll.
        mainRef.current.scrollTop = 0
      }
    }

    // First attempt: immediate (works when page data is cached / renders instantly)
    requestAnimationFrame(() => {
      restoreOrResetScroll()
    })
    // Second attempt: fallback after content has had time to render
    const timer = setTimeout(() => {
      restoreOrResetScroll()
    }, 120)
    return () => clearTimeout(timer)
  }, [location.pathname])

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
        ref={mainRef}
        className="relative ml-[72px] overflow-y-auto overflow-x-hidden"
        style={{
          zIndex: 1,
          height: '100vh',
        }}
      >
        <div
          key={location.pathname}
          style={{
            paddingTop: TOPBAR_HEIGHT,
            opacity: sysReducedMotion || appReducedMotion ? 1 : 1,
          }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  )
}
