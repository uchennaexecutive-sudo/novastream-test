import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { Home, Film, Tv2, Swords, Palette, Bookmark, History, Settings, LogIn } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { dicebearUrl } from '../../lib/supabaseClient'

const TOPBAR_HEIGHT = 56 // must match TopBar.jsx height

const navItems = [
  { path: '/', label: 'Home', Icon: Home },
  { path: '/movies', label: 'Movies', Icon: Film },
  { path: '/series', label: 'Series', Icon: Tv2 },
  { path: '/anime', label: 'Anime', Icon: Swords },
  { path: '/animation', label: 'Animation', Icon: Palette },
]

const bottomItems = [
  { path: '/watchlist', label: 'Watchlist', Icon: Bookmark },
  { path: '/history', label: 'History', Icon: History },
  { path: '/settings', label: 'Settings', Icon: Settings },
]

export default function Sidebar() {
  const [hovered, setHovered] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile, setAuthModalOpen } = useAuthStore()

  const avatarStyle = profile?.avatar_style || 'bottts'
  const avatarSeed = profile?.avatar_seed || (user?.id || 'nova')
  const displayName = profile?.username || user?.email?.split('@')[0] || 'Account'

  return (
    <motion.nav
      className="fixed left-0 bottom-0 flex flex-col"
      style={{
        top: 0,
        background: 'linear-gradient(180deg, rgba(8,8,14,0.20) 0%, rgba(8,8,14,0.10) 60%, rgba(8,8,14,0.04) 100%)',
        backdropFilter: 'blur(48px) saturate(200%)',
        WebkitBackdropFilter: 'blur(48px) saturate(200%)',
        boxShadow: 'var(--inner-glow)',
        zIndex: 50,
        overflow: 'hidden',
      }}
      animate={{ width: hovered ? 240 : 72 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* Logo — exact same height as TopBar, starts at top:0, no extra padding above */}
      <div
        className="flex items-center gap-2.5 overflow-hidden whitespace-nowrap flex-shrink-0"
        style={{
          height: TOPBAR_HEIGHT,
          paddingLeft: 16,
        }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-display font-bold text-lg"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            boxShadow: '0 0 20px var(--accent-glow)',
          }}
        >
          N
        </div>
        <motion.div
          className="overflow-hidden min-w-0 whitespace-nowrap"
          animate={{
            width: hovered ? 'auto' : 0,
            opacity: hovered ? 1 : 0,
            x: hovered ? 0 : -8,
          }}
          transition={{ duration: 0.2 }}
          style={{ pointerEvents: 'none' }}
        >
          <span
            className="font-display font-bold text-base tracking-wide inline-block"
            style={{ color: 'var(--text-primary)' }}
          >
            <span style={{ color: 'var(--accent)' }}>NOVA</span> STREAM
          </span>
        </motion.div>
      </div>

      {/* Main Nav */}
      <div className="flex flex-col gap-0.5 flex-1 w-full px-2.5 pt-4">
        {navItems.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path)
          return (
            <SidebarLink key={item.path} item={item} isActive={isActive} hovered={hovered} />
          )
        })}
      </div>

      {/* Divider */}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />

      {/* Bottom Nav */}
      <div className="flex flex-col gap-0.5 w-full px-2.5 pb-3">
        {bottomItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path)
          return (
            <SidebarLink key={item.path} item={item} isActive={isActive} hovered={hovered} />
          )
        })}
      </div>

      {/* Divider */}
      <div className="mx-4 mb-2 h-px" style={{ background: 'var(--border)' }} />

      {/* Profile / Sign In widget */}
      <div className="px-2.5 pb-4">
        {user ? (
          <motion.button
            onClick={() => navigate('/profile')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl overflow-hidden whitespace-nowrap cursor-pointer group relative"
            style={{
              background: location.pathname === '/profile' ? 'var(--bg-elevated)' : 'transparent',
              color: location.pathname === '/profile' ? 'var(--accent)' : 'var(--text-secondary)',
            }}
            whileHover={{ color: 'var(--text-primary)' }}
          >
            {/* Avatar */}
            <div className="w-6 h-6 rounded-lg overflow-hidden flex-shrink-0" style={{ border: '1.5px solid rgba(255,255,255,0.12)' }}>
              <img src={dicebearUrl(avatarStyle, avatarSeed)} alt="Avatar" className="w-full h-full" />
            </div>

            <motion.div
              className="overflow-hidden min-w-0 whitespace-nowrap"
              animate={{
                width: hovered ? 'auto' : 0,
                opacity: hovered ? 1 : 0,
                x: hovered ? 0 : -4,
              }}
              transition={{ duration: 0.15 }}
              style={{ pointerEvents: 'none' }}
            >
              <span className="text-sm font-medium truncate min-w-0 inline-block">
                {displayName}
              </span>
            </motion.div>

            {/* Hover highlight */}
            {location.pathname !== '/profile' && (
              <div
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-10"
                style={{ background: 'var(--bg-surface)' }}
              />
            )}
          </motion.button>
        ) : (
          <motion.button
            onClick={() => setAuthModalOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl overflow-hidden whitespace-nowrap cursor-pointer group relative"
            style={{ color: 'var(--text-muted)' }}
            whileHover={{ color: 'var(--text-secondary)' }}
          >
            <span className="w-6 flex items-center justify-center flex-shrink-0">
              <LogIn size={18} strokeWidth={1.75} />
            </span>
            <motion.div
              className="overflow-hidden min-w-0 whitespace-nowrap"
              animate={{
                width: hovered ? 'auto' : 0,
                opacity: hovered ? 1 : 0,
                x: hovered ? 0 : -4,
              }}
              transition={{ duration: 0.15 }}
              style={{ pointerEvents: 'none' }}
            >
              <span className="text-sm font-medium inline-block">
                Sign in
              </span>
            </motion.div>
            <div
              className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-10"
              style={{ background: 'var(--bg-surface)' }}
            />
          </motion.button>
        )}
      </div>
    </motion.nav>
  )
}

function SidebarLink({ item, isActive, hovered }) {
  const Icon = item.Icon
  return (
    <NavLink
      to={item.path}
      className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl overflow-hidden whitespace-nowrap group"
      style={{
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      {/* Glowing active indicator */}
      {isActive && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full"
          style={{
            background: 'var(--accent)',
            boxShadow: '0 0 12px var(--accent-glow-strong), 2px 0 20px var(--accent-glow)',
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}

      <span className="w-6 flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
        <Icon size={18} strokeWidth={isActive ? 2.5 : 1.75} />
      </span>

      <motion.div
        className="overflow-hidden min-w-0 whitespace-nowrap"
        animate={{
          width: hovered ? 'auto' : 0,
          opacity: hovered ? 1 : 0,
          x: hovered ? 0 : -4,
        }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: 'none' }}
      >
        <span className="text-sm font-medium inline-block">
          {item.label}
        </span>
      </motion.div>

      {/* Hover highlight */}
      {!isActive && (
        <div
          className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-10"
          style={{ background: 'var(--bg-surface)' }}
        />
      )}
    </NavLink>
  )
}
