# NOVA STREAM

## Project
Premium streaming desktop application (Tauri 2) - v1.3.3

## Stack
React 18 + Vite 6 + TailwindCSS + Framer Motion + Zustand + Tauri 2 (Rust)

## Dev Location
Working copy at `c:\Users\uchen\nova-stream-dev` (outside OneDrive for npm compatibility)

## Build Output
Local test builds go to `C:\Users\uchen\OneDrive\Documents\ANTIGRAVITY\APPLICATIONS`

## Repository
GitHub: `uchennaexecutive-sudo/novastream-test`

## API Keys
- **TMDB:** `49bd672b0680fac7de50e5b9f139a98b` - Base: `https://api.themoviedb.org/3`
- **Supabase URL:** `https://owymezptcmwmrlkeuxcg.supabase.co`
- **Supabase Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eW1lenB0Y213bXJsa2V1eGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NjEsImV4cCI6MjA4ODU4OTY2MX0.4OZvH_afMKK-CCEgSrW4ga7oC2y0Hqh3uz5ZeRVtvPQ`
- **AniList GraphQL:** `https://graphql.anilist.co` (no key needed)
- **Aniwatch API:** `https://aniwatch-api-orcin-six.vercel.app`
- **Streaming Resolvers:** AniWatch API for anime, Nuvio Streams addon for movie/series/animation native streams

## Completed Features
- [x] Home page - hero carousel (5 trending, 8s auto-advance) + 9 content rows
- [x] Detail page - backdrop, poster, metadata, cast, trailer, episode selector, similar titles
- [x] Movies browse - genre filters, paginated grid
- [x] Series browse - genre filters, paginated grid
- [x] Anime browse - AniList-powered, tabs (Trending/Popular/Top Rated), genre filters, infinite scroll
- [x] Anime player - premium popup with native HLS playback via aniwatch-api, Rust-backed segment fetching, auto server fallback, subtitles, seekbar, keyboard shortcuts, and episode navigation
- [x] Animation browse - grid layout
- [x] Search overlay - debounced TMDB multi-search + AniList anime search, keyboard navigation, grouped Movies / Series / Anime results, and anime search routing through TMDB-matched anime detail flow
- [x] Movie / Series / Animation player - native custom player using Nuvio resolver streams, Rust-backed manifest/segment fetching, custom controls, English subtitle toggle via Wyzie, and series episode navigation
- [x] Watchlist - localStorage-backed add/remove/check, responsive grid
- [x] Watch history - auto-recorded on play, localStorage-backed
- [x] Continue Watching - deduplicated episodic entries so each show displays only the latest watched episode
- [x] Settings - theme picker, playback prefs, update status with real download % progress bar
- [x] 6 themes - Nova Dark, Nova Light, Midnight Blue, Ember, Aurora, Sakura
- [x] Layout - sidebar (top-aligned logo, collapses to 72px, expands to 240px on hover), top bar (search), ambient orbs
- [x] Tauri desktop - native Windows exe, `decorations: true` (native title bar - no 32px offset needed)
- [x] Auto-update - raw GitHub feed check, resilient download retries, streamed progress, local updater logging, and restart prompt

## Layout Notes
- `decorations: true` in `tauri.conf.json` -> native Windows title bar sits OUTSIDE content area
- Sidebar and TopBar BOTH start at `top: 0` - NO isTauri offset
- TopBar: `top:0, left:72px, height:56px`
- Sidebar logo section: `top:0, height:56px, paddingLeft:16px` - aligned with TopBar
- Main content: `paddingTop: 56px`

## Update System
- Check: `raw.githubusercontent.com/uchennaexecutive-sudo/novastream/main/updates/latest.json`
- Rust `download_update`: streams chunks -> emits `download-progress` (0-100) events -> verifies file size -> writes `_update/nova-stream.exe` via `.part` temp file -> logs to `%TEMP%\nova-stream-updater.log`
- Rust `apply_update`: launches `_update.bat` and appends copy/restart progress to `%TEMP%\nova-stream-updater.log`
- Frontend: listens via `@tauri-apps/api/event`, retries failed downloads with backoff, and re-checks on a longer interval after failures or up-to-date checks
- Store: `updateState`, `updateVersion`, `downloadProgress` in Zustand
- Rust deps: `reqwest` (stream + rustls-tls), `futures-util`, `tokio`

## Anime Streaming
- Anime discovery and anime detail identity are now AniList-driven
- Anime detail/playback should remain isolated from Movie / Series / Animation resolver logic
- Anime playback uses `src/components/Player/AnimePlayer.jsx`
- Anime provider client logic lives in `src/lib/consumet.js`
- Live anime backend is the Railway deployment at `https://web-production-f746c.up.railway.app`
- Anime detail pages carry AniList title identity into playback for stronger provider matching
- Current provider order is:
  1. `animekai`
  2. `animesaturn`
- `kickassanime` was removed from automatic fallback because it was returning repeated 500 / no-anime failures in testing
- `animepahe` was tested but is not currently used because its info/episode route was not reliable
- `animeunity` is a possible future third fallback provider and tested alive at search/info level
- Playback fallback now works at multiple stages:
  1. provider search / anime match
  2. provider episode loading
  3. stream resolution
  4. actual media playback failure via `onStreamFailure`
- `AnimePlayer.jsx` now supports provider stickiness:
  - if a fallback provider succeeds for the current episode, it stays locked for that episode
  - the next episode tries the last successful provider first for faster startup
- `SharedNativePlayer.jsx` now receives dynamic `streamType` so `.m3u8` sources are treated as HLS and direct `.mp4` sources are treated as file playback
- This was required because AnimeSaturn can return direct mp4 sources instead of HLS manifests
- Previous / next episode controls were preserved after delayed fallback recovery by re-binding the active provider episode list after successful stream resolution
- Anime browse/detail/search architecture remains:
  - AniList-powered browse in `src/pages/Anime.jsx`
  - AniList identity handling in `src/lib/anilist.js`
  - anime canonical/franchise mapping in `src/lib/animeMapper.js`
  - anime detail handling in `src/pages/Detail.jsx`
  - anime search section in `src/components/Search/SearchOverlay.jsx`
- Anime search results open through TMDB-matched anime detail rather than using AniList/MAL ids as TMDB ids
- Standard seasonal anime and long-running anime still use the existing mapper structure; do not casually rewrite anime browse/detail grouping logic

## Movie / Series / Animation Streaming
- Native playback now uses `src/components/Player/MoviePlayer.jsx`
- Stream discovery is handled by `fetch_movie_resolver_streams` in Rust, not browser fetches, so resolver requests avoid browser CORS failures
- Current working resolver source is Nuvio Streams at `https://nuvio-streams-addon-fawn.vercel.app`
- Resolver flow:
  1. Convert TMDB IDs to IMDb IDs through TMDB `external_ids` when needed
  2. Query Nuvio movie/series endpoints
  3. Reject opaque token URLs and dead direct hosts
  4. Accept validated direct HLS/MP4 streams only
  5. Route movie HLS manifests, nested playlists, segments, and keys through `fetch_movie_manifest` / `fetch_movie_segment`
- `MoviePlayer.jsx` reuses the premium native control model: play/pause, seekbar, volume, speed, fullscreen, keyboard shortcuts, provider/quality badge, and progress persistence
- Movie / series / animation subtitles are now separate from the stream resolver:
  1. `fetch_movie_subtitles` resolves English subtitle candidates in Rust using Wyzie subtitles
  2. `fetch_movie_text` downloads subtitle text through Rust when a subtitle file is selected
  3. `src/lib/movieSubtitles.js` normalizes subtitle results for `MoviePlayer.jsx`
  4. `MoviePlayer.jsx` parses subtitle text into cues and exposes the same styled `SUB ON / SUB OFF` toggle pattern used by anime
- Current subtitle backend is Wyzie at `https://sub.wyzie.io`
- Series playback includes previous/next episode navigation inside the player
- Animation follows the same resolver path as movies

## Release Workflow
1. Update changelog in `src/pages/Settings.jsx`
2. Run the release script:
   ```powershell
   .\release.ps1 1.0.X "Short changelog note"
   ```
3. GitHub Actions CI auto-builds + creates release + updates `updates/latest.json`

- Release workflow now publishes `updates/latest.json` after GitHub release creation. Do not add extra asset polling steps unless they are verified on `windows-latest`.

> `release.ps1` automatically bumps version in all 4 files.
> Never manually edit version numbers - just run `release.ps1`
> **Always use `release.ps1`** - never push manually. The CI bot commits `latest.json` back to `main` after each build, causing rejections. The script handles rebase + force-tag automatically.

## Anime Detail / Search Routing
- `src/pages/Detail.jsx` now uses AniList identity state (`anilistId`, anime titles, anime year) for anime-specific detail handling
- `src/lib/animeMapper.js` separates normal seasonal anime from long-running anime and groups extra content into Movies / OVA / ONA / Specials
- Bleach sequel handling was corrected so sequel seasons can appear without collapsing the whole franchise into a single long-runner bucket
- One Piece is treated as a long-running anime and no longer builds fake sequel seasons from AniList relation noise
- `src/components/Search/SearchOverlay.jsx` now supports AniList anime results in addition to TMDB Movies / Series results
- Anime search navigation now mirrors the Anime browse page flow by matching AniList results to TMDB before opening detail pages

## Version History
- v1.3.3 - Reworked anime playback fallback around the Railway Consumet backend, removed KickAssAnime from automatic fallback, added AnimeSaturn fallback, improved fresh retry/provider locking, preserved episode navigation after delayed recovery, and fixed direct MP4 fallback playback handling
- v1.3.2 - Added AniList-backed anime detail/search routing, anime mapper flow for seasons and grouped extras, fixed anime search to open through TMDB-matched anime detail, improved Bleach sequel handling, and stabilized One Piece long-runner treatment
- v1.3.1 - change release build repo and location
- v1.3.0 - added subtitle to movie/series/animation, still updating anime interface
- v1.2.0 - Native movie, series, and animation playback via Nuvio-backed resolver streams, Rust movie HLS fetching, custom controls, Wyzie-powered English subtitles, and deduplicated continue watching for episodic titles
- v1.1.5 - Fix anime streaming with a Rust segment fetcher and custom HLS.js loader so HiAnime headers are applied to protected HLS assets
- v1.1.4 - Fix GitHub release workflow so `latest.json` updates after release creation without the broken asset wait step
- v1.1.3 - Harden auto-update release ordering, retries, and logging; improve anime proxy transport with source headers and diagnostics
- v1.1.2 - Local Rust HLS proxy server for reliable anime streaming with rewritten playlists and proxied HLS assets
- v1.1.1 - Restore Home row icons, fix continue watching/resume progress, and stabilize anime proxy playback
- v1.1.0 - Watch Intelligence: continue watching, progress tracking, resume playback, recommendations, and anime proxy reliability
- v1.0.21 - HD-2 only smart retry, faster anime startup, control bar episode nav, fullscreen fixes, and loading progress
- v1.0.20 - Full anime player controls with auto server fallback, subtitles, seekbar, shortcuts, and episode navigation
- v1.0.19 - Anime streaming via aniwatch-api HiAnime source
- v1.0.18 - Anime streaming via Consumet API with native HLS.js player
- v1.0.17 - Use standard sources for anime via NativePlayer after sandbox bypass
- v1.0.15 - Phase 1 native player for anime with Tauri stream URL capture
- v1.0.14 - Fix `release.ps1` to auto-bump version in all 4 files
- v1.0.13 - Replace anime sandboxed embeds with anime-safe source changes
- v1.0.11 - Fix anime player: use `/search/tv` TMDB lookup (English+romaji fallback); "Stream not available" toast on failure; loading overlay while resolving
- v1.0.10 - Fix VidSrc sandbox error via WebView2 browser args (additionalBrowserArgs in tauri.conf.json)

- v1.0.8 - Fixed sidebar/TopBar alignment (removed incorrect Tauri 32px offset)
- v1.0.7 - Fixed sidebar/TopBar vertical alignment (partial fix)
- v1.0.6 - Update progress UI in Settings, fixed top-left corner
- v1.0.5 - Fixed watchlist & history, TopBar layout, version display
- v1.0.4 - Fixed black screen on launch, hardcoded API keys for CI builds
- v1.0.3 - Fixed white screen from render-blocking fonts
- v1.0.2 - Portable exe auto-update with silent download + restart prompt
- v1.0.1 - Initial release

## Debug Log v1.1.7
- Pending runtime capture. Rust-side manifest and segment logging has been added locally, but anime playback was not driven from this agent session, so terminal output still needs to be captured from a `npm run tauri:dev` reproduction.

---

> **RESUME PROMPT:** "You are building NOVA STREAM. Read CLAUDE.md for full project context, API keys, stack, layout rules, and release workflow. All phases are complete. Use `release.ps1` for all releases."
