# NOVA STREAM

## Project
Premium streaming desktop application (Tauri 2) - v1.2.0

## Stack
React 18 + Vite 6 + TailwindCSS + Framer Motion + Zustand + Tauri 2 (Rust)

## Dev Location
Working copy at `c:\Users\uchen\nova-stream-dev` (outside OneDrive for npm compatibility)

## Build Output
Local test builds go to `C:\Users\uchen\OneDrive\Documents\ANTIGRAVITY\APPLICATIONS`

## Repository
GitHub: `uchennaexecutive-sudo/novastream`

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
- [x] Search overlay - debounced TMDB multi-search, keyboard navigation, grouped results
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
- Anime discovery remains AniList-powered in the browse page
- Anime detail pages carry the AniList title into the player flow for better API search matching
- Anime playback uses `src/components/Player/AnimePlayer.jsx`, not iframe embeds or the old hidden-webview interceptor
- Anime stream resolution uses `src/lib/consumet.js` as the client wrapper, targeting the live aniwatch HiAnime API
- HLS manifests still load through HLS.js, but fragments and keys are fetched through the Tauri `fetch_hls_segment` command
- The Rust command uses `reqwest` with HiAnime `Referer`, `Origin`, and desktop `User-Agent` headers so segment requests are no longer blocked
- `AnimePlayer.jsx` installs a custom HLS loader that routes `.ts`, `.m4s`, `.aac`, `.mp4`, and key requests through Rust while keeping playlists on the default loader
- Current source flow:
  1. `GET /api/v2/hianime/search?q=...`
  2. `GET /api/v2/hianime/anime/{animeId}/episodes`
  3. `GET /api/v2/hianime/episode/sources?animeEpisodeId=...&server=hd-2&category=sub`
  4. HLS.js loads the manifest and Rust fetches protected HLS assets over IPC
- Default server order is `hd-2`, then `hd-1`, then `hd-3`
- `AnimePlayer.jsx` silently auto-tries all 3 HiAnime servers with a 3 second delay before showing an error
- Subtitle tracks come from the HiAnime `tracks` payload and render as a styled HTML overlay
- Resolution choices are derived from the HLS manifest levels inside the player
- The anime popup keeps the custom seekbar, play/pause, skip, volume, subtitle toggle, playback speed, fullscreen, keyboard shortcuts, and previous/next episode navigation
- Anime is stable and should stay isolated from movie/series/animation resolver work

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

## Version History
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
