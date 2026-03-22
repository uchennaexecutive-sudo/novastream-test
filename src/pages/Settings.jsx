import { motion } from 'framer-motion'
import useAppStore from '../store/useAppStore'
import { THEMES } from '../themes'
import ThemeCard from '../components/UI/ThemeCard'
import { APP_VERSION } from '../main'

function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        className="w-12 h-6 rounded-full relative transition-all duration-300"
        style={{
          background: value ? 'var(--accent)' : 'var(--bg-elevated)',
          boxShadow: value ? '0 0 16px var(--accent-glow)' : 'none',
        }}
      >
        <motion.div
          className="w-5 h-5 rounded-full absolute top-0.5"
          style={{ background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
          animate={{ left: value ? 26 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  )
}

function UpdateStatusSection() {
  const updateState = useAppStore(s => s.updateState)
  const updateVersion = useAppStore(s => s.updateVersion)
  const downloadProgress = useAppStore(s => s.downloadProgress)

  // For downloading state, use real progress from Rust stream; otherwise use fixed values
  const statusConfig = {
    'idle':        { label: 'Checking for updates...', icon: '🔄', color: 'var(--text-muted)', animate: true },
    'checking':    { label: 'Checking for updates...', icon: '🔍', color: 'var(--text-muted)', animate: true },
    'downloading': { label: `Downloading v${updateVersion || '?'}... ${downloadProgress}%`, icon: '⬇', color: 'var(--accent)', animate: false },
    'ready':       { label: `v${updateVersion} ready — restart to apply`, icon: '🚀', color: '#22c55e', animate: false },
    'up-to-date':  { label: "You're up to date", icon: '✓', color: '#22c55e', animate: false },
    'error':       { label: 'Update check failed — retrying...', icon: '⚠', color: '#f87171', animate: false },
  }

  const config = statusConfig[updateState] || statusConfig['idle']

  // Real progress value for the bar
  const barProgress = updateState === 'downloading' ? downloadProgress
    : updateState === 'ready' || updateState === 'up-to-date' ? 100
    : updateState === 'checking' || updateState === 'idle' ? 20
    : 0

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--bg-glass)',
        border: '1px solid var(--border)',
        backdropFilter: 'blur(20px)',
        boxShadow: 'var(--card-shadow), var(--inner-glow)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">{config.icon}</span>
          <div>
            <p className="text-sm font-semibold" style={{ color: config.color }}>
              {config.label}
            </p>
            <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              Current: v{APP_VERSION}
            </p>
          </div>
        </div>

        {updateState === 'up-to-date' && (
          <div
            className="px-3 py-1.5 rounded-xl text-xs font-bold"
            style={{
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#22c55e',
              border: '1px solid rgba(34, 197, 94, 0.3)',
            }}
          >
            Latest
          </div>
        )}

        {updateState === 'ready' && (
          <motion.div
            className="px-3 py-1.5 rounded-xl text-xs font-bold"
            style={{
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#22c55e',
              border: '1px solid rgba(34, 197, 94, 0.3)',
            }}
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            Restart Required
          </motion.div>
        )}
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            background: updateState === 'error'
              ? '#f87171'
              : updateState === 'up-to-date' || updateState === 'ready'
                ? '#22c55e'
                : 'var(--accent)',
            boxShadow: updateState === 'up-to-date' || updateState === 'ready'
              ? '0 0 8px rgba(34, 197, 94, 0.5)'
              : '0 0 8px var(--accent-glow)',
          }}
          initial={{ width: '0%' }}
          animate={{
            width: `${barProgress}%`,
            ...(config.animate ? { opacity: [0.7, 1, 0.7] } : {}),
          }}
          transition={{
            width: { duration: updateState === 'downloading' ? 0.3 : 1, ease: 'easeOut' },
            ...(config.animate ? { opacity: { repeat: Infinity, duration: 1.5 } } : {}),
          }}
        />
      </div>
    </div>
  )
}

export default function Settings() {
  const preferences = useAppStore(s => s.preferences)
  const setPreference = useAppStore(s => s.setPreference)

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
        ⚙ Settings
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Customize your experience</p>

      {/* Update Status */}
      <section className="mb-10">
        <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          🔄 Software Update
        </h2>
        <UpdateStatusSection />
      </section>

      {/* Theme Switcher */}
      <section className="mb-10">
        <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          🎨 Choose Your Theme
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {THEMES.map(theme => <ThemeCard key={theme.id} theme={theme} />)}
        </div>
      </section>

      {/* Playback */}
      <section className="mb-10">
        <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          ▶ Playback
        </h2>
        <div
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(20px)',
            boxShadow: 'var(--card-shadow), var(--inner-glow)',
          }}
        >
          <div className="flex items-center justify-between py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Default Stream Source</span>
            <div className="flex gap-2">
              {['vidsrc', 'embed.su'].map(s => (
                <button
                  key={s}
                  onClick={() => setPreference('defaultEmbed', s)}
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: preferences.defaultEmbed === s ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: preferences.defaultEmbed === s ? '#fff' : 'var(--text-secondary)',
                    boxShadow: preferences.defaultEmbed === s ? '0 0 16px var(--accent-glow)' : 'none',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="Autoplay Next Episode"
            value={preferences.autoplayNext}
            onChange={v => setPreference('autoplayNext', v)}
          />
          <Toggle
            label="Remember Watch Position"
            value={preferences.rememberPosition}
            onChange={v => setPreference('rememberPosition', v)}
          />
        </div>
      </section>

      {/* Accessibility */}
      <section className="mb-10">
        <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          ♿ Accessibility
        </h2>
        <div
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(20px)',
            boxShadow: 'var(--card-shadow), var(--inner-glow)',
          }}
        >
          <Toggle
            label="Reduce Animations"
            value={preferences.reduceAnimations}
            onChange={v => setPreference('reduceAnimations', v)}
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Disables background orbs, page transitions, and CSS animations. Overrides the system motion setting.
          </p>
        </div>
      </section>

      {/* About */}
      <section>
        <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          ℹ About
        </h2>
        <div
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(20px)',
            boxShadow: 'var(--card-shadow), var(--inner-glow)',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold"
              style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 16px var(--accent-glow)' }}
            >
              N
            </div>
            <div>
              <p className="font-display font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                NOVA STREAM
              </p>
              <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>v{APP_VERSION}</p>
            </div>
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Your Universe of Stories
          </p>
          <p className="text-xs mb-3 font-mono" style={{ color: 'var(--accent)' }}>
            v{APP_VERSION} — Changelog
          </p>
          <div className="text-xs space-y-1 mb-2" style={{ color: 'var(--text-muted)' }}>
            <p>v1.5.0 - Fix auto-update system: correct GitHub repo URL so update checks work, stream downloads directly to disk, remove unused Tauri updater plugin</p>
            <p>v1.4.8 - Add optional Supabase account system with sign up, sign in, DiceBear avatar picker, and full cross-device sync for watchlist, history, playback position, theme, and preferences</p>
            <p>v1.4.7 - Fix window controls with correct Tauri 2 capability grants, add custom overlay title bar, extend TopBar to full width so hero images show through the glass blur, and add in-memory session cache for instant page navigation</p>
            <p>v1.2.0 - Native movie, series, and animation playback via Nuvio-backed resolver streams, custom controls, and deduplicated continue watching for episodic titles</p>
            <p>v1.1.6 - Fix anime streaming - dynamic AniWatch headers and Rust manifest rewrite for protected HLS playback</p>
            <p>v1.1.5 - Fix anime streaming - Rust segment fetcher bypasses HiAnime header restrictions</p>
            <p>v1.1.4 - Fix release workflow so latest.json publishes after GitHub release creation without the broken asset wait step</p>
            <p>v1.1.3 - Hardened auto-update delivery, retries, and logging; improved anime proxy transport with source headers and diagnostics</p>
            <p>v1.1.2 - Local Rust HLS proxy server for anime streaming with playlist rewriting, segment passthrough, and subtitle proxying</p>
            <p>v1.1.1 - Restored Home row icons, fixed continue watching/resume progress, and stabilized anime proxy playback</p>
            <p>v1.1.0 - Watch Intelligence: continue watching, progress tracking, resume playback, recommendations, and anime proxy reliability</p>
            <p>v1.0.21 - HD-2 only smart retry, faster anime startup, control bar episode nav, fullscreen fixes, and loading progress</p>
            <p>v1.0.20 - Full anime player controls with auto server fallback, subtitles, seekbar, shortcuts, and episode navigation</p>
            <p>v1.0.19 - Anime streaming now uses aniwatch-api HiAnime sources in the premium popup player</p>
            <p>v1.0.18 - Anime streaming now uses Consumet API with native HLS.js playback in the premium popup</p>
            <p>v1.0.17 - Anime NativePlayer now uses the standard TV embed sources that capture reliably</p>
            <p>v1.0.15 - Phase 1 native player for anime via Tauri stream URL capture</p>
            <p>v1.0.14 - Fixed `release.ps1` to auto-bump version in all 4 files before release</p>
            <p>â€¢ v1.0.13 â€” Replaced anime sandboxed embeds with anime-safe sources and updated player server labels</p>
            <p>â€¢ v1.0.12 â€” Fixed version number baked into binary</p>
            <p>â€¢ v1.0.11 â€” Fixed anime player TMDB lookup and unavailable-stream handling</p>
            <p>â€¢ v1.0.10 â€” Fixed VidSrc sandbox errors via WebView2 browser args</p>
            <p>• v1.0.9 — Better update system (streaming progress, retries, timeouts), sidebar alignment</p>
            <p>• v1.0.8 — Fixed sidebar/TopBar alignment (removed bad Tauri offset)</p>
            <p>• v1.0.7 — Fixed sidebar/TopBar vertical alignment</p>
            <p>• v1.0.6 — Update progress in Settings, fixed top-left corner layout</p>
            <p>• v1.0.5 — Fixed watchlist & history, TopBar layout, version display</p>
            <p>• v1.0.4 — Fixed black screen on launch, hardcoded API keys for CI builds</p>
            <p>• v1.0.3 — Fixed white screen caused by render-blocking font loading</p>
            <p>• v1.0.2 — Portable exe auto-update with silent download + restart prompt</p>
            <p>• v1.0.1 — Initial release</p>
          </div>
          <div className="h-px my-3" style={{ background: 'var(--border)' }} />
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Anime data provided by AniList.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Built for personal use only.
          </p>
        </div>
      </section>
    </div>
  )
}
