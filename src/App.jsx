import React, { lazy, Suspense, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import useAppStore from './store/useAppStore'
import useAuthStore from './store/useAuthStore'

const Auth = lazy(() => import('./pages/Auth'))
const SearchOverlay = lazy(() => import('./components/Search/SearchOverlay'))
const GalaxyIntro = lazy(() => import('./components/Intro/GalaxyIntro'))
const Movies = lazy(() => import('./pages/Movies'))
const Series = lazy(() => import('./pages/Series'))
const Anime = lazy(() => import('./pages/Anime'))
const Animation = lazy(() => import('./pages/Animation'))
const Detail = lazy(() => import('./pages/Detail'))
const IframePlayerWindow = lazy(() => import('./pages/IframePlayerWindow'))
const BrowserFetchBridge = lazy(() => import('./pages/BrowserFetchBridge'))
const Downloads = lazy(() => import('./pages/Downloads'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const History = lazy(() => import('./pages/History'))
const Settings = lazy(() => import('./pages/Settings'))
const Profile = lazy(() => import('./pages/Profile'))
const WatchParty = lazy(() => import('./pages/WatchParty'))

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || 'A page error occurred.',
    }
  }

  componentDidCatch(error) {
    console.error('[RouteErrorBoundary]', error)
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div
            className="max-w-md w-full rounded-2xl p-6 text-center"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <h2
              className="font-display font-semibold text-xl mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Could not open this page
            </h2>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                boxShadow: '0 0 18px var(--accent-glow)',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function RouteLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div
        className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

function OverlayLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div
        className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

export default function App() {
  const searchOpen = useAppStore(s => s.searchOpen)
  const { init, cleanupAuthListener, user, authLoading, authModalOpen, setAuthModalOpen } = useAuthStore()
  const isSpecialWindow = typeof window !== 'undefined'
    && (
      window.location.pathname.startsWith('/player-window')
      || window.location.pathname.startsWith('/fetch-bridge')
    )
  const [showIntro, setShowIntro] = useState(
    !isSpecialWindow && !sessionStorage.getItem('nova-intro-shown')
  )
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (isSpecialWindow) return undefined
    void init()
    return () => {
      cleanupAuthListener()
    }
  }, [cleanupAuthListener, init, isSpecialWindow])

  useEffect(() => {
    if (user && showOnboarding) setShowOnboarding(false)
  }, [user, showOnboarding])

  const handleIntroComplete = () => {
    sessionStorage.setItem('nova-intro-shown', 'true')
    setShowIntro(false)
    if (!localStorage.getItem('nova-onboarding-shown') && !authLoading && !user) {
      setShowOnboarding(true)
    }
  }

  const handleOnboardingComplete = () => {
    localStorage.setItem('nova-onboarding-shown', 'true')
    setShowOnboarding(false)
  }

  if (showIntro) {
    return (
      <Suspense fallback={<OverlayLoader />}>
        <GalaxyIntro onComplete={handleIntroComplete} />
      </Suspense>
    )
  }

  if (showOnboarding) {
    return (
      <Suspense fallback={<OverlayLoader />}>
        <Auth onComplete={handleOnboardingComplete} closeable={false} />
      </Suspense>
    )
  }

  return (
    <>
      <BrowserRouter>
        <AppRoutes isSpecialWindow={isSpecialWindow} searchOpen={searchOpen} />
      </BrowserRouter>

      {authModalOpen && (
        <Suspense fallback={null}>
          <Auth
            onComplete={() => setAuthModalOpen(false)}
            closeable
            onClose={() => setAuthModalOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}

function AppRoutes({ isSpecialWindow, searchOpen }) {
  const location = useLocation()

  return (
    <>
      <RouteErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/player-window" element={<IframePlayerWindow />} />
            <Route path="/fetch-bridge" element={<BrowserFetchBridge />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/movies" element={<Movies />} />
              <Route path="/series" element={<Series />} />
              <Route path="/anime" element={<Anime />} />
              <Route path="/animation" element={<Animation />} />
              <Route path="/detail/:type/:id" element={<Detail />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/watch-party" element={<WatchParty />} />
            </Route>
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
      {!isSpecialWindow && searchOpen && (
        <Suspense fallback={null}>
          <SearchOverlay />
        </Suspense>
      )}
    </>
  )
}
