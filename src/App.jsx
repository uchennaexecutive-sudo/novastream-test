import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import Movies from './pages/Movies'
import Series from './pages/Series'
import Anime from './pages/Anime'
import Animation from './pages/Animation'
import Detail from './pages/Detail'
import IframePlayerWindow from './pages/IframePlayerWindow'
import BrowserFetchBridge from './pages/BrowserFetchBridge'
import Watchlist from './pages/Watchlist'
import History from './pages/History'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Auth from './pages/Auth'
import SearchOverlay from './components/Search/SearchOverlay'
import GalaxyIntro from './components/Intro/GalaxyIntro'
import useAppStore from './store/useAppStore'
import useAuthStore from './store/useAuthStore'

export default function App() {
  const searchOpen = useAppStore(s => s.searchOpen)
  const { init, user, authLoading, authModalOpen, setAuthModalOpen } = useAuthStore()
  const isSpecialWindow = typeof window !== 'undefined'
    && (
      window.location.pathname.startsWith('/player-window')
      || window.location.pathname.startsWith('/fetch-bridge')
    )
  const [showIntro, setShowIntro] = useState(
    !isSpecialWindow && !sessionStorage.getItem('nova-intro-shown')
  )
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Bootstrap Supabase auth session on mount
  useEffect(() => {
    if (!isSpecialWindow) init()
  }, [isSpecialWindow, init])

  // If user signs in while onboarding overlay is open, close it
  useEffect(() => {
    if (user && showOnboarding) setShowOnboarding(false)
  }, [user, showOnboarding])

  const handleIntroComplete = () => {
    sessionStorage.setItem('nova-intro-shown', 'true')
    setShowIntro(false)
    // Show onboarding only the first time (no account, never skipped)
    if (!localStorage.getItem('nova-onboarding-shown') && !authLoading && !user) {
      setShowOnboarding(true)
    }
  }

  const handleOnboardingComplete = () => {
    localStorage.setItem('nova-onboarding-shown', 'true')
    setShowOnboarding(false)
  }

  if (showIntro) {
    return <GalaxyIntro onComplete={handleIntroComplete} />
  }

  // First-time onboarding (full-screen, no close button — only skip link)
  if (showOnboarding) {
    return <Auth onComplete={handleOnboardingComplete} closeable={false} />
  }

  return (
    <>
      <BrowserRouter>
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
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Routes>
        {!isSpecialWindow && searchOpen && <SearchOverlay />}
      </BrowserRouter>

      {/* Sign-in overlay — triggered from sidebar Sign In button after onboarding was skipped */}
      {authModalOpen && (
        <Auth
          onComplete={() => setAuthModalOpen(false)}
          closeable
          onClose={() => setAuthModalOpen(false)}
        />
      )}
    </>
  )
}
