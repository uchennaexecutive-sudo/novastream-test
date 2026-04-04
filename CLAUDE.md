# NOVA STREAM

## Project
Premium streaming desktop application (Tauri 2) - v1.5.8

## Stack
React 18 + Vite 6 + TailwindCSS + Framer Motion + Zustand + Tauri 2 (Rust)

## Dev Location
Working copy at `c:\Users\uchen\nova-stream-dev` (outside OneDrive for npm compatibility)

## Build Output
Local test builds go to `C:\Users\uchen\OneDrive\Documents\ANTIGRAVITY\APPLICATIONS`

## Repository
GitHub: `uchennaexecutive-sudo/novastream-test`

## Completed Features
- [x] Home page - hero carousel (5 trending, 8s auto-advance) + 9 content rows
- [x] Detail page - backdrop, poster, metadata, cast, trailer, episode selector, similar titles
- [x] Movies browse - genre filters, paginated grid
- [x] Series browse - genre filters, paginated grid
- [x] Anime browse - AniList-powered, tabs (Trending/Popular/Top Rated), genre filters, infinite scroll
- [x] Anime player - premium popup with native playback via in-project Gogoanime primary resolution plus AnimePahe fallback, Rust-backed manifest/segment/session fetching, subtitles, seekbar, keyboard shortcuts, and episode navigation
- [x] Animation browse - grid layout
- [x] Search overlay - debounced TMDB multi-search + AniList anime search, keyboard navigation, grouped Movies / Series / Anime results, and anime search routing through TMDB-matched anime detail flow
- [x] Movie / Series / Animation player - native custom player using Nuvio resolver streams, Rust-backed manifest/segment fetching, custom controls, English subtitle toggle via Wyzie, and series episode navigation
- [x] Download + offline playback system - Downloads/Library page, queueing, pause/resume/cancel/delete, configurable download location, real storage metrics, offline playback via local Rust media proxy, and persisted local subtitle sidecars
- [x] Watchlist - localStorage-backed add/remove/check, responsive grid
- [x] Watch history - auto-recorded on play, localStorage-backed
- [x] Continue Watching - deduplicated episodic entries so each show displays only the latest watched episode
- [x] Resume flow - Continue Watching opens detail first, detail pages refresh resume state after player close, and episodic players sync final episode/progress back to detail
- [x] Settings - theme picker, playback prefs, update status with real download % progress bar
- [x] 6 themes - Nova Dark, Nova Light, Midnight Blue, Ember, Aurora, Sakura
- [x] Layout - sidebar (top-aligned logo, collapses to 72px, expands to 240px on hover), top bar (search), ambient orbs
- [x] Tauri desktop - native Windows exe, `decorations: false` with custom overlay TitleBar.jsx (minimize/maximize/close, z:60, top-right 138px)
- [x] Auto-update - raw GitHub feed check, resilient download retries, streamed progress, local updater logging, and restart prompt
- [x] macOS release artifact via GitHub Actions (`.dmg`, unsigned)
- [x] Auth & profiles - optional Supabase accounts, sign up / sign in / forgot password, frictionless onboarding (splash → auth → avatar picker → home), DiceBear avatars, profile page with stats and account management
- [x] Cross-device sync - Supabase-backed watchlist, history, progress, theme, and preferences; write-through sync; cloud wins on conflicts; guests stay localStorage-only
- [x] Anime news feed - ANN RSS carousel on Anime page, paginated 2-up cards, OG image extraction via Rust (base64 data URLs), localStorage image cache for instant return visits

## Layout Notes
- `decorations: false` in `tauri.conf.json` -> custom overlay title bar (TitleBar.jsx, z:60, top-right 138px)
- Sidebar and TopBar BOTH start at `top: 0` - NO isTauri offset
- TopBar: `top:0, left:72px, right:0, height:56px` — extends full viewport width, drag region inside
- Sidebar: `left:0, top:0`, collapses to 72px, expands to 240px on hover
- Main: `ml-[72px], height:100vh` (no marginTop — content flows behind TopBar for glass blur)
- Motion wrapper inside main: `paddingTop: 56px` — offsets all pages below TopBar
- Home hero: `<div className="-mt-14">` cancels the paddingTop so the hero extends behind the TopBar

## Update System
- Check: `raw.githubusercontent.com/uchennaexecutive-sudo/novastream-test/main/updates/latest.json`
- Rust `download_update`: streams chunks directly to disk (`.part` temp file) -> emits `download-progress` (0-100) events -> verifies file size -> renames to `_update/nova-stream.exe` -> logs to `%TEMP%\nova-stream-updater.log`
- Rust `apply_update`: launches `_update.bat` and appends copy/restart progress to `%TEMP%\nova-stream-updater.log`
- Frontend: listens via `@tauri-apps/api/event`, retries failed downloads with backoff, and re-checks on a longer interval after failures or up-to-date checks
- Store: `updateState`, `updateVersion`, `downloadProgress` in Zustand
- Rust deps: `reqwest` (stream + rustls-tls), `futures-util`, `tokio`

## Anime Streaming
- Anime discovery and anime detail identity are now AniList-driven
- Anime detail/playback should remain isolated from Movie / Series / Animation resolver logic
- Anime playback uses `src/components/Player/AnimePlayer.jsx`
- Anime provider orchestration lives in:
  - `src/lib/animeAddons/resolveAnimeStreams.js`
  - `src/lib/animeAddons/providers/gogoanime.js`
  - `src/lib/animeAddons/providers/gogoanimeScraper.js`
  - `src/lib/animeAddons/providers/animepahe.js`
- Anime detail pages carry AniList title identity into playback for stronger provider matching
- Current provider order is `gogoanime` primary and `animepahe` fallback
- Gogoanime search, anime detail, and server discovery are now self-contained in-project; the old localhost Rust bridge has been removed
- Current Gogo flow:
  1. AniList/TMDB identity reaches `AnimePlayer.jsx`
  2. `gogoanimeScraper.js` resolves search match, anime detail, and episode server URLs
  3. `gogoanime.js` resolves wrapper pages / embed pages / dynamic stream capture
  4. Rust handles session-aware fetch, HLS manifest/segment fetching, and native playback transport
- Current AnimePahe fallback flow:
  1. AniList/TMDB identity reaches `AnimePlayer.jsx`
  2. `animepahe.js` resolves AnimePahe search, release episode lists, and play-page resolution options through provider-scoped browser sessions
  3. AnimePahe prefers a direct MP4-style handoff derived from resolved Kwik stream URLs and falls back to direct embed/runtime capture when needed
  4. Rust still handles session-aware fetch, embed capture, and native playback transport for the selected candidate
- DotStream is deprioritized and rejected where possible; the working path is the non-DotStream dynamic capture/native playback flow
- Dynamic subtitle tracks captured from the live embed/runtime are forwarded into the native player
- Gogo source-quality guardrails reject obvious CAM / bad wrapper cases when they are detected
- Anime fallback changes must remain provider-scoped; do not use shared timeout/path tweaks that weaken Gogoanime because AnimePahe exists as fallback
- Anime next-episode behavior now resets provider stickiness on episode change so each episode starts with Gogoanime as fresh primary and only falls through to AnimePahe when that specific episode fails on Gogo
- AnimePahe fallback now works for episodes Gogoanime cannot play, but AnimePahe startup is still best improved through provider-specific optimization rather than shared resolver shortcuts
- Anime browse/detail/search architecture remains:
  - AniList-powered browse in `src/pages/Anime.jsx`
  - AniList identity handling in `src/lib/anilist.js`
  - anime canonical/franchise mapping in `src/lib/animeMapper.js`
  - anime detail handling in `src/pages/Detail.jsx`
  - anime search section in `src/components/Search/SearchOverlay.jsx`
- AniList browse/search fetches are now hardened against timeouts, non-JSON responses, and transient rate-limit/server failures, with a lightweight retry path in `src/lib/anilist.js`
- Search overlay now degrades gracefully: TMDB results still render when AniList search fails because `src/components/Search/SearchOverlay.jsx` uses settled-result handling instead of all-or-nothing failure
- Anime search results open through TMDB-matched anime detail rather than using AniList/MAL ids as TMDB ids
- Standard seasonal anime and long-running anime still use the existing mapper structure; do not casually rewrite anime browse/detail grouping logic
- AnimeKai fallback experiments were dropped from the active path; do not reintroduce AnimeKai changes into the working anime stack unless they are rebuilt cleanly and isolated from Gogoanime

## Movie / Series / Animation Streaming
- Native playback now uses `src/components/Player/MoviePlayer.jsx`
- Stream discovery is handled by `fetch_movie_resolver_streams` in Rust, not browser fetches, so resolver requests avoid browser CORS failures
- Current working resolver source is the app-managed embedded local Nuvio sidecar at `http://127.0.0.1:7779`
- Resolver flow:
  1. Convert TMDB IDs to IMDb IDs through TMDB `external_ids` when needed
  2. Start / health-check the local Nuvio sidecar if needed
  3. Query staged Nuvio movie/series endpoints:
     - primary-provider
     - fast-providers
     - full-fallback
  4. Reject opaque token URLs, junk URLs, HTML pages, and dead direct hosts
  5. Accept only validated HLS / direct-media streams
  6. Route movie HLS manifests, nested playlists, segments, and keys through `fetch_movie_manifest` / `fetch_movie_segment`
- `MoviePlayer.jsx` reuses the premium native control model: play/pause, seekbar, volume, speed, fullscreen, keyboard shortcuts, provider/quality badge, and progress persistence
- `MoviePlayer.jsx` now auto-falls back to the next validated stream when the current stream fails
- Provider preference is tuned to favor `Vixsrc`, `MoviesMod`, `MoviesDrive`, and `UHDMovies` ahead of `4KHDHub`
- Animation now uses its own staged provider preference set instead of piggybacking on the generic movie fast path
- Movie / series / animation subtitles are now separate from the stream resolver:
  1. `fetch_movie_subtitles` resolves English subtitle candidates in Rust using Wyzie subtitles
  2. `fetch_movie_text` downloads subtitle text through Rust when a subtitle file is selected
  3. `src/lib/movieSubtitles.js` normalizes subtitle results for `MoviePlayer.jsx`
  4. `MoviePlayer.jsx` parses subtitle text into cues and exposes the same styled `SUB ON / SUB OFF` toggle pattern used by anime
- Current subtitle backend is Wyzie at `https://sub.wyzie.io`
- Subtitle selection is now ranked toward WEB-aligned English tracks, but subtitle quality is still source-dependent
- Series playback includes previous/next episode navigation inside the player
- Animation follows the same resolver path as movies
- The vendored Nuvio sidecar lives in `vendor/nuvio-streams-addon`
- Release builds now embed the Nuvio runtime and extract it to local app data on launch, so packaged apps do not depend on the repo layout
- Release builds now also embed the vendored Nuvio sidecar dependencies, so packaged users should not hit a first-run `npm install`
- If the extracted Nuvio runtime is deleted, the app recreates it automatically on next launch
- Nuvio sidecar startup and any emergency dependency install path now run hidden in the background on Windows and log to `%TEMP%\nova-stream-nuvio-sidecar.log` instead of opening a visible terminal
- Embedded Nuvio runtime refresh now stops stale sidecar processes before retrying extraction, reducing Windows `os error 32` file-lock failures
- Some individual titles can still fail because upstream provider links themselves are bad or non-playable; this is currently treated as a source-quality edge case, not an absorption failure

## Downloads + Offline Playback
- Downloads are first-class for Movies / Series / Animation / Anime through `src/pages/Downloads.jsx`, `src/store/useDownloadStore.js`, `src/lib/videoDownloads.js`, and `src/lib/animeDownloads.js`
- The Downloads page is split into active `Downloads` and completed `Library` tabs, with storage summary, filter chips, row actions, and per-item offline entry points
- Download actions are wired from `src/pages/Detail.jsx` and episode surfaces; completed items feed back into detail pages as offline-capable entries
- Rust command surface for the feature lives in `src-tauri/src/main.rs` and includes:
  - `start_video_download`
  - `pause_video_download`
  - `cancel_video_download`
  - `delete_video_download`
  - `get_downloads_storage_info`
  - `get_download_location` / `set_download_location` / `reset_download_location`
- Current download engine split:
  - direct MP4-style downloads use Rust `reqwest` streaming with resume-aware progress updates
  - HLS downloads use `N_m3u8DL-RE` as the primary downloader
  - `ffmpeg` is not the primary downloader anymore; it is now kept for local validation, remux, and recovery only
- HLS hardening now includes:
  - preferred video/audio selector discovery for multi-track HLS streams
  - per-download HLS log parsing so incomplete selected-track downloads fail instead of silently completing
  - recovery rules that reject wrong-language, invalid, or obviously mismatched outputs
  - completion metadata refresh so library size reflects the final file on disk
- Offline playback path:
  - `MoviePlayer.jsx`, `AnimePlayer.jsx`, and `SharedNativePlayer.jsx` support local playback
  - local files are served through the Rust media proxy with byte-range support instead of direct raw file URLs
  - offline playback should remain app-managed, not DRM
- Offline subtitles are part of the shipped path, not optional polish:
  - subtitle sidecars are saved beside the downloaded media and persisted in catalog state
  - offline subtitle lookup uses local sidecars only and no longer treats audio `.ts` artifacts as subtitle files
  - movie/series subtitle download prefers aligned English candidates and supports direct text, zip/gzip archives, and merged HLS subtitle playlists
- Anime downloads are integrated into the same system and must remain provider-ordered:
  - `gogoanime` primary
  - `animepahe` fallback
  - do not reintroduce `animekai`
- AnimePahe now uses `animepahe.com` and browser-session-backed resolution where needed; normal direct network fetches may still fail in environments where AnimePahe is browser-only
- Delete behavior is expected to remove both UI/catalog entries and related on-disk download artifacts; if you touch delete flows, preserve that invariant
- Download location is user-configurable from Settings, with reset-to-default support and real disk usage reporting

## Release Workflow
1. Update changelog in `src/pages/Settings.jsx`
2. Run the release script:
   ```powershell
   .\release.ps1 1.0.X "Short changelog note"
   ```
3. GitHub Actions CI auto-builds + creates release + updates `updates/latest.json`

- Release workflow now publishes `updates/latest.json` after GitHub release creation. Do not add extra asset polling steps unless they are verified on `windows-latest`.
- macOS CI now builds the macOS app bundle, stages `Install First.command`, and packages a custom DMG for GitHub Releases

> `release.ps1` automatically bumps and verifies the runtime version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src/main.jsx`, keeps `package-lock.json` in sync, and seeds `updates/latest.json` before the tagged build.
> Never manually edit version numbers - just run `release.ps1`
> **Always use `release.ps1`** - never push manually. The CI bot commits `latest.json` back to `main` after each build, causing rejections. The script handles rebase + force-tag automatically, while GitHub Actions rewrites `updates/latest.json` after the tagged build publishes the release asset.
- GitHub Actions now also builds a custom macOS DMG containing the app, `Install First.command`, and the Applications shortcut, then uploads it to the GitHub Release page
- Current macOS release artifact is `NOVA-STREAM-x.x.x-macos.dmg`
- The app is still unsigned, so macOS trust warnings may still require manual open/allow steps until signing/notarization is added
- Windows release flow remains unchanged and still publishes the portable exe + `updates/latest.json`

## Anime Detail / Search Routing
- `src/pages/Detail.jsx` now uses AniList identity state (`anilistId`, anime titles, anime year) for anime-specific detail handling
- `src/lib/animeMapper.js` separates normal seasonal anime from long-running anime and groups extra content into Movies / OVA / ONA / Specials
- Bleach sequel handling was corrected so sequel seasons can appear without collapsing the whole franchise into a single long-runner bucket
- One Piece is treated as a long-running anime and no longer builds fake sequel seasons from AniList relation noise
- `src/components/Search/SearchOverlay.jsx` now supports AniList anime results in addition to TMDB Movies / Series results
- Anime search navigation now mirrors the Anime browse page flow by matching AniList results to TMDB before opening detail pages

## Auth + Profile System
- Optional Supabase account system — sign up / sign in / forgot password, frictionless (no email verification)
- First-time onboarding flow: splash → auth page (sign up / sign in / skip) → avatar picker → home; shown once, never repeated unless app reinstalled
- Sidebar bottom: signed-in users see avatar + username (→ `/profile`); skipped users see "Sign in" ghost button (→ auth overlay)
- Auth overlay (`authModalOpen` in useAuthStore) can be triggered at any time from sidebar without routing
- DiceBear avatar picker: 6 styles (bottts, pixel-art, adventurer, lorelei, thumbs, micah) × 10 seeds via HTTP API (`https://api.dicebear.com/9.x/{style}/svg?seed={seed}`)
- Profile page (`/profile`): large avatar, inline username edit, watch stats (titles, hours), avatar picker sheet, change password modal, sign out, delete account (with confirmation)
- `src/lib/supabaseClient.js` — shared Supabase client + `dicebearUrl()` helper
- `src/store/useAuthStore.js` — auth state: user, session, profile, authLoading, authModalOpen; methods: init, signUp, signIn, signOut, resetPassword, updateProfile, deleteAccount
- `src/pages/Auth.jsx` — immersive full-screen auth with animated cinematic background, glass card, AnimatePresence view transitions
- `src/pages/Profile.jsx` — full profile page with avatar picker sheet, modals, and stats

## Cross-Device Sync (Supabase)
- Supabase tables: `profiles` (avatar_style, avatar_seed, username, theme, preferences), `watchlist`, `watch_history`, `watch_progress` — all with RLS
- `syncFromCloud()` in `src/lib/supabase.js` — pulls watchlist, history, and watch_progress from cloud on sign-in/session-restore; merges with local (cloud wins on conflicts)
- Write-through sync: every `addToWatchlist`, `removeFromWatchlist`, `addToHistory`, `saveProgress` call also syncs to Supabase when signed in
- Theme + preferences sync: `setTheme` / `setPreference` in `useAppStore.js` call `syncProfileSetting()` to update `profiles` row; restored via `applyProfileSettings()` in useAuthStore on session boot
- Watch progress (`src/lib/progress.js`): uses shared Supabase client, switched from `device_id` to `user_id`; guests get localStorage-only (cloud skipped gracefully)
- Supabase auto-trigger `handle_new_user` creates `profiles` row with username + avatar_seed on sign-up
- Guest users: all data is localStorage-only; signing in later does not recover pre-sign-in local data

## Version History
- v1.5.8 - Ship downloads and offline playback with anime support, hardened HLS downloads, AnimePahe fallback fixes, configurable storage, and working offline subtitles
- v1.5.7 - Fix anime Continue Watching cards so they route with anime identity and load episode/season data correctly on detail pages
- v1.5.6 - Fix episodic resume flow, make Continue Watching open detail first, and harden Nuvio sidecar startup against Windows file-lock failures
- v1.5.5 - Update Mac release helper packaging and fix Anime + Search behavior
- v1.5.4 - Cleanup updates and current app version baseline
- v1.5.3 - Refactor sidebar label animations from AnimatePresence mount/unmount to persistent motion.div width/opacity for smoother and more reliable expand/collapse behavior
- v1.5.2 - Add ANN live news feed carousel to Anime page with paginated 2-up cards, OG image extraction via Rust (base64 data URLs to bypass hotlink protection), localStorage image cache for instant return visits, and fix sidebar collapse sticking by switching to pointer events
- v1.5.0 - Fix auto-update system: correct GitHub repository URL so checks reach the right repo, stream update download directly to disk instead of buffering in RAM, remove unused Tauri updater plugin, and prevent error-loop on non-Windows platforms
- v1.4.8 - Add optional Supabase account system with sign up, sign in, DiceBear avatar picker, profile page, and full cross-device sync for watchlist, history, playback position, theme, and preferences
- v1.4.7 - Fix window controls with correct Tauri 2 `core:window:*` capability grants, add custom overlay title bar (TitleBar.jsx), extend TopBar to full viewport width so hero images show through the glass blur, and add in-memory session cache for instant page navigation
- v1.4.6 - Added in-project AnimePahe fallback behind Gogoanime, normalized AnimePahe episode numbering for mapped seasons, preferred direct MP4-style AnimePahe handoff, and reset provider stickiness so each episode starts fresh with Gogoanime as primary
- v1.4.5 - Fixed Windows release packaging again by installing vendored Nuvio sidecar dependencies from inside the sidecar directory and skipping unreadable/symlinked package-manager artifacts during embedded runtime archiving
- v1.4.4 - Hardened the embedded Nuvio runtime build step on Windows CI by preferring a readable system Node binary over the hosted toolcache path and added better archive-build error context for future packaging failures
- v1.4.3 - Fixed GitHub Actions Nuvio sidecar dependency installation so packaged releases can embed vendored sidecar dependencies without relying on an untracked sidecar lockfile
- v1.4.2 - Embedded vendored Nuvio sidecar dependencies into packaged builds, hid Nuvio startup/install console windows behind background logging, and prepared portable releases so movie/series/animation sidecar startup behaves like an end-user runtime instead of a repo-relative dev setup
- v1.4.1 - Embedded the Nuvio sidecar runtime into packaged builds so portable releases can launch movie/series/animation resolvers without repo-relative files, added automatic runtime re-extraction, and relaxed anime HLS startup timeout behavior after initial level load/buffer
- v1.4.0 - Absorbed Gogoanime search/detail/server discovery into the app, removed the old anime localhost bridge from Rust, adopted a local Nuvio sidecar for movie/series/animation, added staged provider fetch and auto-fallback for movie playback, improved startup/selection behavior, and switched macOS release builds to DMG
- v1.3.9 - Added GitHub Actions macOS test builds, upload of macOS release artifacts to GitHub Releases, macOS transparent window support via `macOSPrivateApi`, and cross-platform iframe player parent-window handling using `.parent(main_window)`
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

---

> **RESUME PROMPT:** "You are building NOVA STREAM. Read CLAUDE.md for full project context, stack, layout rules, and release workflow. Use `release.ps1` for all releases."
