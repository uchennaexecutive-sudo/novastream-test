# NOVA STREAM — Deep Project Analysis
> Current version: **v1.5.3** · Last updated: March 2026

## What It Is

**NOVA STREAM** is a premium desktop streaming application built with **Tauri 2 (Rust) + React 18 + Vite 6**. It functions as a unified media hub that aggregates movies, TV series, anime, and animation content from multiple upstream providers into a single polished native desktop experience — essentially a self-contained streaming client comparable to commercial platforms like Netflix or Crunchyroll, powered by open provider backends and a completely self-embedded runtime.

---

## Architecture Overview

The app is a **hybrid desktop application** with three interconnected layers:

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | React 18 + TailwindCSS + Framer Motion + Zustand | UI, routing, search, theming, player controls, auth |
| **Backend** | Rust (Tauri 2) + Reqwest + Tokio | Window management, HLS proxying, session-aware fetching, stream validation, subtitle resolution, auto-updates, sidecar management, OG image extraction |
| **Sidecar** | Node.js (Nuvio addon) + Puppeteer + Express | Movie/series/animation stream provider resolution via 15+ upstream scrapers |

**Language breakdown:** ~75% JavaScript, ~23% Rust, ~1.5% CSS, ~0.3% PowerShell

---

## All Pages (13)

| Page | Route | Purpose |
|------|-------|---------|
| **Home.jsx** | `/` | Hero carousel (5 trending, 8s auto-advance) + 9 content rows (trending, popular movies, top rated, popular series, now playing, on air, anime, animation, Netflix originals) + Continue Watching + recommendations. Session-cached for instant return visits. |
| **Movies.jsx** | `/movies` | Genre filters (Action, Comedy, Drama, Horror, Sci-Fi, Thriller, Animation, Documentary), sort options (Popular, Top Rated, Newest, Upcoming), paginated infinite scroll |
| **Series.jsx** | `/series` | Genre filters, network filters (Netflix, HBO, Apple TV+, Prime, Disney+, Hulu), infinite scroll |
| **Anime.jsx** | `/anime` | AniList-powered — Trending/Popular/Top Rated tabs, 8 genre filters, infinite scroll, anime grouping logic (season 1 selection, sequel filtering, long-runner treatment), **ANN news carousel** |
| **Animation.jsx** | `/animation` | Movies/Series toggle tabs, infinite scroll, animation-specific provider ordering |
| **Detail.jsx** | `/detail/:type/:id` | Backdrop, poster, metadata, cast, trailer, episode selector, similar titles, watchlist button, resume progress, anime-specific AniList identity routing |
| **Auth.jsx** | `/auth` | Supabase sign up / sign in / forgot password, immersive cinematic background, glass card, AnimatePresence view transitions, first-time onboarding flow (splash → auth → avatar picker → home) |
| **Profile.jsx** | `/profile` | Avatar display & inline picker sheet, username edit, watch stats (titles counted, hours watched), change password modal, sign out, delete account with confirmation |
| **Settings.jsx** | `/settings` | Theme picker (6 themes), playback preferences (autoplay next, remember position, reduce animations), live update status with real download % progress bar, full version changelog |
| **Watchlist.jsx** | `/watchlist` | Saved titles grid, add/remove, localStorage + Supabase sync |
| **History.jsx** | `/history` | Watched titles, deduplicated episodic entries, linked to progress tracking |
| **IframePlayerWindow.jsx** | `/_iframe` | Sandboxed embed player window for legacy/fallback embed sources |
| **BrowserFetchBridge.jsx** | `/_bridge` | Hidden bridge window for Rust-side browser eval / dynamic stream capture |

---

## All Components

### Layout (5)
| Component | Purpose |
|-----------|---------|
| **Layout.jsx** | App wrapper — sidebar + TopBar + TitleBar + outlet, scroll position caching, Ctrl+K search trigger, page transitions via AnimatePresence |
| **Sidebar.jsx** | Collapsible navigation (72px collapsed → 240px expanded on hover). Logo section, nav items (Home, Movies, Series, Anime, Animation), bottom items (Watchlist, History, Settings), signed-in user avatar+name or "Sign in" button. Uses `onPointerEnter`/`onPointerLeave` for reliable collapse. Labels animated via `motion.div` width/opacity (never unmounted). |
| **TopBar.jsx** | Fixed header at `top:0, left:72px, right:0, height:56px`, extends full viewport width, drag region inside, Ctrl+K search trigger |
| **TitleBar.jsx** | Custom window controls (minimize / maximize-restore / close) for `decorations: false` mode. Top-right, z:60, 138px wide. Tauri `core:window:*` capability integration, listens for resize to track maximize state. |
| **BackgroundOrbs.jsx** | Animated ambient gradient orbs, theme-aware colors |

### Players (4)
| Component | Purpose |
|-----------|---------|
| **MoviePlayer.jsx** | Native HLS/MP4 player for movies/series/animation. Play/pause, seekbar, volume, speed (0.5–2×), fullscreen, quality selector, English subtitle toggle (Wyzie), provider/quality badge, auto-fallback to next stream on failure, previous/next episode navigation for series, progress persistence |
| **AnimePlayer.jsx** | Anime-specific player. Gogoanime primary + AnimePahe fallback. Provider stickiness reset per episode. Subtitle parsing (VTT). Quality candidates with metadata. Stream retry logic. |
| **SharedNativePlayer.jsx** | Reusable player core: HLS.js loader with custom Rust-backed manifest/segment/key fetching, error handling, subtitle parsing (SRT/VTT), session caching |
| **EpisodeSelector.jsx** | Season selector + episode grid with individual progress bars, resume functionality |

### Cards (3)
| Component | Purpose |
|-----------|---------|
| **HeroSlide.jsx** | Full-bleed banner: backdrop, overlay, title, metadata, play button |
| **MediaCard.jsx** | Thumbnail card: poster, rating badge, play button on hover, lazy loading |
| **ContinueCard.jsx** | Continue watching card: episode info, progress bar, resume state |

### Search (1)
| Component | Purpose |
|-----------|---------|
| **SearchOverlay.jsx** | Overlay search modal — debounced 300ms, simultaneous TMDB + AniList queries, keyboard navigation (arrow keys), results grouped as Anime / Movies / Series, anime results matched to TMDB before routing |

---

## All Lib Files

### Core APIs
| File | Exports / Purpose |
|------|------------------|
| **tmdb.js** | TMDB API — trending, popular, top-rated, now-playing, search multi, detail fetch, season details, anime-specific lookup with title fallback (English/Romaji + year matching) |
| **anilist.js** | AniList GraphQL — trending/popular/top-rated, search, anime detail with relations/episodes, genre filter, pagination |
| **supabaseClient.js** | `supabase` client instance, `dicebearUrl(style, seed)` helper |
| **supabase.js** | Watchlist CRUD, history CRUD, watch progress (save/get/latest), `syncFromCloud()`, `syncProfileSetting()`, localStorage-first with Supabase write-through when signed in |

### Streaming
| File | Exports / Purpose |
|------|------------------|
| **movieStreams.js** | `getMovieStreams()`, `getSeriesStreams()`, `getAnimationStreams()` — calls Rust `fetch_movie_resolver_streams` |
| **movieResolvers.js** | Stream validation & sorting: playable detection, quality scoring, provider preference tuning, base64 token rejection |
| **movieSubtitles.js** | Wyzie subtitle fetch, rank by WEB-aligned English tracks, download via Rust, normalize for player |
| **progress.js** | Watch progress: localStorage + Supabase sync, continue watching deduplication, episode key generation, user_id (signed in) or guest localStorage |
| **sessionCache.js** | In-memory session cache: home row data, search results, scroll positions — cleared on app restart, never persisted |

### Anime
| File | Exports / Purpose |
|------|------------------|
| **animeAddons/resolveAnimeStreams.js** | Stream orchestration: provider state, episode candidate resolution, quality scoring, retry logic, provider stickiness reset per episode |
| **animeAddons/providers/gogoanime.js** | Gogoanime stream resolver: search → detail → servers → stream capture (**primary, active**) |
| **animeAddons/providers/gogoanimeScraper.js** | In-project Gogoanime scraper (no localhost bridge): search, detail, episode server URLs (**primary, active**) |
| **animeAddons/providers/animepahe.js** | AnimePahe fallback: search, episode lists, Kwik stream resolution, direct MP4 handoff preferred (**fallback, active**) |
| **animeAddons/providers/allanime.js** | AllAnime provider (inactive) |
| **animeAddons/providers/animesaturn.js** | AnimeSaturn provider (inactive) |
| **animeAddons/providers/animekai.js** | AnimeKai (inactive, isolated from working stack) |
| **animeMapper.js** | Franchise/season mapping: long-runner detection (One Piece, Detective Conan, Pokémon), sequel filtering, extra content grouping (Movie/OVA/ONA/Special), Bleach sequel fix |
| **animeClassification.js** | Anime detection & TMDB routing: Japanese animation identification, TMDB matching, AniList candidate scoring |
| **anilist.js** | AniList GraphQL client (shared with browse pages) |

### Other
| File | Exports / Purpose |
|------|------------------|
| **annFeed.js** | ANN RSS fetch via Rust → XML parse → category styling. `getAnnFeed()`, `fetchOgImages()` (base64 data URLs via Rust), `getCachedImages()` / `saveCachedImages()` (localStorage, 2h TTL) |

---

## All Store Files

### useAppStore.js (Zustand — persisted via localStorage)
| State | Default | Purpose |
|-------|---------|---------|
| `theme` | `'nova-dark'` | Active theme name |
| `preferences` | `{ autoplayNext, rememberPosition, reduceAnimations }` | Playback preferences |
| `searchOpen` | `false` | Search overlay visibility |
| `updateState` | `'idle'` | Update status (idle/checking/available/downloading/ready/error) |
| `updateVersion` | `null` | Available update version string |
| `downloadProgress` | `0` | Download progress 0–100 |

Methods: `setTheme()`, `setPreference()`, `setSearchOpen()`, `setUpdateState()`, `setUpdateInfo()`, `setDownloadProgress()`

### useAuthStore.js (Zustand — session-driven)
| State | Purpose |
|-------|---------|
| `user` | Supabase auth user object |
| `session` | Active Supabase session |
| `profile` | Profile row (avatar_style, avatar_seed, username, theme, preferences) |
| `authLoading` | Auth init/operation loading state |
| `authModalOpen` | Auth overlay open state |

Methods: `init()`, `signUp()`, `signIn()`, `signOut()`, `resetPassword()`, `updateProfile()`, `deleteAccount()`, `setAuthModalOpen()`

---

## Tauri Commands (main.rs) — ~30 commands

### Window Management
| Command | Description |
|---------|-------------|
| `minimize_window` | Minimize app window |
| `toggle_maximize` | Toggle maximize/restore |
| `close_window` | Close app |

### Anime Streaming
| Command | Description |
|---------|-------------|
| `fetch_anime_text_with_session` | Session-aware fetch for anime content (HLS manifests, embeds) |
| `resolver_session_eval` | Evaluate JS in a persistent resolver browser session for dynamic stream capture |

### Movie / Series / Animation Streaming
| Command | Description |
|---------|-------------|
| `fetch_movie_resolver_streams` | Nuvio staged provider fetch: primary → fast providers → full fallback. Returns validated stream list. |
| `fetch_movie_manifest` | HLS manifest fetch with URL rewriting for proxied segment paths |
| `fetch_movie_segment` | HLS segment proxy with headers forwarding |
| `fetch_movie_subtitles` | Wyzie subtitle resolution: fetch English candidates, rank by WEB alignment |
| `fetch_movie_text` | Download subtitle file text via Rust (bypasses CORS) |

### Stream Validation & Capture
| Command | Description |
|---------|-------------|
| `probe_movie_stream` | Validate a stream URL — detects HLS vs MP4, reachability, non-HTML content |
| `capture_stream` | Open a sandboxed capture window to intercept dynamic streams from embed pages |
| `resolve_embed_stream` | Resolve an embed URL to a direct stream candidate |

### Media Proxy
| Command | Description |
|---------|-------------|
| `register_media_proxy_stream` | Register a stream URL for local proxy, returns `http://127.0.0.1:PORT/...` proxy URL |
| `open_iframe_player_window` | Open isolated iframe player window for sandboxed embed playback |

### Browser Fetch Bridge
| Command | Description |
|---------|-------------|
| `browser_fetch_bridge_ready` | Handshake — marks bridge window as ready for Rust eval tasks |
| `complete_browser_fetch` | Bridge window callback with fetched result |
| `complete_resolver_eval` | Callback with JS eval result from resolver session |

### Update System
| Command | Description |
|---------|-------------|
| `download_update` | Stream download to `.part` temp file, emit `download-progress` events (0–100), verify size, rename to `_update/nova-stream.exe` |
| `apply_update` | Launch `_update.bat`, append to `%TEMP%\nova-stream-updater.log`, restart app |

### News Feed
| Command | Description |
|---------|-------------|
| `fetch_ann_feed` | Fetch ANN RSS XML (`animenewsnetwork.com/news/rss.xml`) with user-agent, return raw XML |
| `fetch_og_image` | Fetch article HTML, extract `og:image` URL, fetch image bytes with Referer header, return as `data:{mime};base64,...` |

---

## Streaming Pipelines

### Anime Pipeline
```
AniList identity (title + year + anilistId)
    ↓
AnimePlayer.jsx — resolveAnimeStreams.js
    ↓ PRIMARY
    gogoanimeScraper.js  →  search match → anime detail → episode server URLs
    gogoanime.js         →  wrapper pages → embed pages → dynamic stream capture
    Rust (session-aware HLS fetch, manifest/segment proxy)
    SharedNativePlayer (HLS.js + custom Rust loader)
    ↓ FALLBACK (per episode, if Gogo fails)
    animepahe.js  →  search → episode list → Kwik MP4 resolution
    Rust (session fetch, embed capture)
    SharedNativePlayer
```

Key behaviors:
- Provider stickiness **resets per episode** — each episode starts fresh with Gogoanime
- Source-quality guardrails reject CAM/wrapper streams
- Dynamic subtitles captured from live embeds

### Movie / Series / Animation Pipeline
```
TMDB ID → IMDb ID (via TMDB external_ids)
    ↓
Rust: health-check / start Nuvio sidecar (port 7779)
    ↓
Staged provider fetch:
    Stage 1: primary-provider (Vixsrc, 18s timeout)
    Stage 2: fast-providers (MoviesMod, MoviesDrive, UHDMovies, 18s timeout)
    Stage 3: full-fallback (4KHDHub, HDRezkas, Showbox, SoaperTV, ..., 30s timeout)
    ↓
Stream validation (reject: opaque tokens, junk URLs, HTML pages, dead hosts)
    ↓
Rust: HLS manifest rewrite → segment/key proxy
MoviePlayer.jsx (HLS.js + custom Rust loader, auto-fallback to next stream)
```

Animation uses its own provider preference set (separate from movies/series).

### Subtitle Pipeline
```
Wyzie API (sub.wyzie.io) → Rust: fetch_movie_subtitles
    ↓
Rank: WEB-aligned English tracks preferred, HDTS/CAM penalized
    ↓
Rust: fetch_movie_text (download selected .srt/.vtt)
movieSubtitles.js → normalize candidates
MoviePlayer.jsx → parse cues → SUB ON/OFF toggle
```

---

## Nuvio Sidecar (vendor/nuvio-streams-addon)

15 provider scrapers organized by tier:

| Tier | Providers |
|------|-----------|
| **Primary** | Vixsrc |
| **Fast** | MoviesMod, MoviesDrive, UHDMovies |
| **Full Fallback** | 4KHDHub, HDRezkas, Showbox, SoaperTV, MovieBox, MP4Hydra, VidZee, DramaDrip, TopMovies, HiAnime, HDHub4u |

Entry point: **addon.js** — Stremio addon SDK implementation, provider orchestration, optional Redis caching, stream ranking, manifest generation.

Embedded into binary at build time (`build.rs` bundles into ZIP → extracted to `%LOCALAPPDATA%/NOVA STREAM/runtime/` on first launch, auto-recreated if deleted). No visible terminal window — logs to `%TEMP%\nova-stream-nuvio-sidecar.log`.

---

## Auth & Account System (v1.4.8+)

**Onboarding flow** (first launch only):
`Splash → Auth page (sign up / sign in / skip) → Avatar picker → Home`

**Supabase auth features:**
- Sign up / sign in / forgot password
- No email verification required (frictionless)
- DiceBear avatar picker: 6 styles (bottts, pixel-art, adventurer, lorelei, thumbs, micah) × 10 seeds
- Auth overlay (`authModalOpen`) triggerable anytime from sidebar without routing

**Profile page** (`/profile`): avatar picker sheet, inline username edit, watch stats (titles watched, hours), change password modal, sign out, delete account with confirmation.

**Sidebar state:**
- Signed in → avatar + username pill → navigate to `/profile`
- Guest → "Sign in" ghost button → open auth overlay

**Supabase tables (all with RLS):**
- `profiles` — avatar_style, avatar_seed, username, theme, preferences
- `watchlist` — per-user saved titles
- `watch_history` — per-user watched titles
- `watch_progress` — per-user playback positions

**Sync behavior:**
- Sign-in triggers `syncFromCloud()` — pulls all watchlist, history, and progress (cloud wins on conflicts)
- Write-through: every add/remove/save also writes to Supabase when signed in
- Theme + preferences sync bidirectionally (Supabase ↔ Zustand store)
- Auto-trigger `handle_new_user` creates `profiles` row on sign-up
- Guests: 100% localStorage-only; pre-sign-in local data not recovered on sign-in

---

## ANN News Feed (v1.5.2+)

**Location:** Top of `Anime.jsx`, above genre tabs

**Features:**
- Paginated 2-up card grid with AnimatePresence transitions
- Auto-advances every 6 seconds
- Category-themed gradient backgrounds (Manga=purple, Anime=blue, Industry=amber, Live-Action=green, Game=teal)
- OG image extracted from each article page via `fetch_og_image` Rust command
- Images returned as `data:image/...;base64,...` (bypasses ANN hotlink protection entirely)
- Lazy fetch of all article images starts immediately when feed loads
- localStorage image cache (2h TTL) — images appear instantly on return visits
- Dot indicators + prev/next arrow buttons
- Card hover: `translateY(-6px)` lift + category-colored glow

**Feed source:** `https://www.animenewsnetwork.com/news/rss.xml` (live, ~14 articles)

---

## Theming System

6 premium themes driven entirely by CSS custom properties:

| Theme | Background | Accent | Feel |
|-------|-----------|--------|------|
| **Nova Dark** | `#050508` | Violet/coral | Deep space default |
| **Nova Light** | `#F0F2FA` | Purple | Frosted glass day |
| **Midnight Blue** | `#020818` | Electric blue | Cinematic navy |
| **Ember** | `#0C0704` | Amber/orange | Warm noir |
| **Aurora** | `#020C0A` | Green/teal | Neon forest |
| **Sakura** | `#0D080C` | Pink/rose | Soft Japanese |

Theme persists via Zustand store, syncs to Supabase `profiles.theme` when signed in.

---

## Auto-Update System

- **Check:** `raw.githubusercontent.com/uchennaexecutive-sudo/novastream-test/main/updates/latest.json`
- **Download:** Rust streams chunks directly to disk (`.part` temp file) → emits `download-progress` events (0–100) → verifies file size → renames to `_update/nova-stream.exe`
- **Apply:** Launches `_update.bat` → copies new exe → restarts app
- **Frontend:** Listens via `@tauri-apps/api/event`, shows progress bar in Settings, retries failed downloads with exponential backoff
- **Logging:** `%TEMP%\nova-stream-updater.log`
- **Non-Windows:** Error loop prevented; update path gracefully exits on non-Windows platforms

---

## Technical Achievements

### Embedded Runtime Architecture
The Nuvio sidecar (Node.js + 15 scrapers + Puppeteer + Chromium) is embedded into the binary at build time via `build.rs`:
- Rust build script bundles `vendor/nuvio-streams-addon/` + a Node binary into a ZIP
- Extracted to `%LOCALAPPDATA%/NOVA STREAM/runtime/` on first launch
- Auto-recreates if deleted — fully self-healing
- Runs hidden (no console) with logging to temp files
- The shipped `.exe` is a **completely self-contained streaming platform**

### CORS Bypass via Rust Proxy
All stream resolution, HLS manifest fetching, and segment downloads flow through Rust rather than browser fetch, completely sidestepping CORS restrictions.

### Session-Aware Streaming
Rust maintains cookie jars and session state across requests, enabling navigation through provider authentication flows (Kwik, Gogoanime embeds, AnimePahe sessions) that require persistent cookies.

### OG Image Extraction
`fetch_og_image` Rust command: fetches article HTML → extracts `og:image` URL → resolves relative URLs → fetches image bytes with proper `Referer` header → returns `data:{mime};base64,...`. Completely bypasses hotlink protection; images load instantly in the webview from a data URL with no external requests.

### Provider Isolation
Anime and movie/series/animation are architecturally **completely separate**:
- Separate resolution pipelines
- Separate player components (`AnimePlayer.jsx` vs `MoviePlayer.jsx`)
- Separate fallback strategies
- Changes to one cannot break the other

### Fine-Grained IPC Permissions
Every Tauri command has its own `.toml` permission definition in `src-tauri/permissions/`, following least-privilege principles. `capabilities/default.json` explicitly grants each permission.

---

## Key File Map

| Area | File | Purpose |
|------|------|---------|
| **App Core** | `src/main.jsx` | Entry point, version, initial update check |
| | `src/App.jsx` | Route definitions, special windows (iframe, bridge) |
| | `src/store/useAppStore.js` | Zustand: theme, prefs, update state |
| | `src/store/useAuthStore.js` | Zustand: auth, session, profile, modal state |
| **Anime** | `src/lib/animeAddons/resolveAnimeStreams.js` | Gogoanime + AnimePahe orchestration |
| | `src/lib/animeAddons/providers/gogoanimeScraper.js` | Gogoanime search/detail/episodes (in-project) |
| | `src/lib/animeAddons/providers/gogoanime.js` | Gogoanime stream resolution |
| | `src/lib/animeAddons/providers/animepahe.js` | AnimePahe fallback with MP4 preference |
| | `src/lib/animeMapper.js` | Franchise grouping, long-runner detection |
| | `src/lib/animeClassification.js` | Anime detection & TMDB routing |
| | `src/components/Player/AnimePlayer.jsx` | Anime player UI + provider logic |
| **Movies/Series** | `src/lib/movieStreams.js` | Nuvio resolver wrapper |
| | `src/lib/movieResolvers.js` | Stream validation & sorting |
| | `src/lib/movieSubtitles.js` | Wyzie subtitle integration |
| | `src/components/Player/MoviePlayer.jsx` | Movie/series player UI |
| **Auth** | `src/pages/Auth.jsx` | Auth flow (sign up / sign in / forgot) |
| | `src/pages/Profile.jsx` | Profile management page |
| | `src/lib/supabase.js` | Supabase CRUD + sync |
| | `src/lib/supabaseClient.js` | Supabase instance + DiceBear helper |
| **News** | `src/lib/annFeed.js` | ANN RSS + OG images + localStorage cache |
| **Progress** | `src/lib/progress.js` | Watch progress tracking + sync |
| | `src/lib/sessionCache.js` | In-memory session cache |
| **Search** | `src/components/Search/SearchOverlay.jsx` | Multi-source search overlay |
| **Backend** | `src-tauri/src/main.rs` | All Tauri commands (~30) |
| | `src-tauri/build.rs` | Embeds Nuvio runtime ZIP |
| **Release** | `release.ps1` | Version bumping, tagging, CI trigger |
| | `.github/workflows/release.yml` | Windows + macOS builds |
| **Vendor** | `vendor/nuvio-streams-addon/addon.js` | Nuvio provider orchestration |
| | `vendor/nuvio-streams-addon/providers/` | 15 provider scrapers |

---

## API & Service Integrations

| Service | Purpose | Auth | Status |
|---------|---------|------|--------|
| **TMDB** | Movie/series metadata, genres, search, IMDb ID lookup | API key | Active |
| **AniList GraphQL** | Anime discovery, identity, detail, search | None (public) | Active |
| **Wyzie** (`sub.wyzie.io`) | English subtitle resolution | None | Active |
| **Supabase** | Auth (sign up/in), profiles, watchlist, history, progress sync | Anon key | Active |
| **DiceBear** (`api.dicebear.com`) | Avatar generation (6 styles, SVG) | None | Active |
| **ANN RSS** | Anime news feed | None | Active |
| **GitHub (raw)** | Auto-update manifest (`latest.json`) | None | Active |
| **Nuvio sidecar** (`127.0.0.1:7779`) | Movie/series/animation stream resolution | None (local) | Active |
| **Gogoanime** (in-project scraper) | Anime stream resolution | None (scraped) | Active |
| **AnimePahe** (in-project scraper) | Anime fallback streams | Session cookies | Active |

---

## Project Stats

| Metric | Value |
|--------|-------|
| **Current version** | v1.5.3 |
| **Created** | March 13, 2026 |
| **Versions shipped** | 30+ in ~11 days |
| **Pages** | 13 |
| **Components** | 20+ |
| **Lib files** | 26+ |
| **Rust commands** | ~30 |
| **Nuvio providers** | 15 scrapers |
| **Anime providers** | 2 active (Gogoanime + AnimePahe) |
| **Themes** | 6 |
| **Languages** | JS 75%, Rust 23%, CSS 1.5%, PowerShell 0.3% |

---

## Summary

NOVA STREAM successfully delivers:

1. **Unified 4-content-type platform** — movies, series, anime, animation under one premium interface
2. **18+ upstream providers** with intelligent staged fallback chains
3. **Fully embedded self-contained runtime** — single portable `.exe` ships with an entire Node.js runtime, 15 scrapers, and Puppeteer
4. **Rust proxy layer** — bypasses CORS, session auth, and hotlink protection for streams, HLS, subtitles, and news images
5. **Optional account system** — Supabase auth, DiceBear avatars, full cross-device sync for watchlist / history / progress / theme
6. **Live anime news** — ANN RSS carousel with OG images cached locally for instant display
7. **Cross-platform shipping** — Windows portable exe + macOS DMG, automated CI/CD via GitHub Actions
8. **Self-updating** — streamed download with real progress, auto-restart
9. **Premium UX** — 6 glassmorphism themes, smooth animations, keyboard shortcuts, custom window controls

It is a **fully self-contained, one-person Netflix-class streaming platform** with the architectural sophistication of a commercial desktop media client, built on Tauri 2 + React + Rust in under two weeks.
