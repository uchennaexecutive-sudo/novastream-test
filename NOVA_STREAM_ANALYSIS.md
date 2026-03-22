# NOVA STREAM — Deep Project Analysis

## What It Is

**NOVA STREAM** is a premium desktop streaming application built with **Tauri 2 (Rust) + React 18 + Vite 6**. It functions as a unified media hub that aggregates movies, TV series, anime, and animation content from multiple upstream providers into a single polished native desktop experience — essentially a self-contained streaming client comparable to commercial platforms like Netflix or Crunchyroll, but powered by open provider backends.

---

## Architecture Overview

The app is a **hybrid desktop application** with three interconnected layers:

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | React 18 + TailwindCSS + Framer Motion + Zustand | UI, navigation, search, theming, player controls |
| **Backend** | Rust (Tauri 2) + Axum + Reqwest | Native window management, HLS proxying, session-aware fetching, stream validation, subtitle resolution, auto-updates, sidecar management |
| **Sidecar** | Node.js (Nuvio addon) + Puppeteer + Express | Movie/series/animation stream provider resolution via 15+ upstream scrapers |

**Language breakdown** (from GitHub): ~75% JavaScript, ~23% Rust, ~1.5% CSS, ~0.3% PowerShell

---

## Core Capabilities

### 1. Content Discovery & Browsing
- **Movies & Series**: Powered by TMDB API — genre filters, paginated grids, trending/popular content
- **Anime**: Powered by AniList GraphQL — tabs for Trending/Popular/Top Rated, infinite scroll, genre filters
- **Animation**: Dedicated browse grid with its own provider preferences
- **Home Page**: Hero carousel (5 trending titles, 8-second auto-advance) + 9 content rows
- **Detail Pages**: Backdrop imagery, poster, metadata, cast, trailers, episode selectors, similar titles
- **Search**: Debounced multi-source overlay (TMDB + AniList simultaneously), keyboard navigation, grouped results by category

### 2. Streaming Playback — Anime
The anime pipeline is completely **self-contained** with no external API dependency for stream resolution:

```
AniList identity → gogoanimeScraper.js (search/match/episodes)
                 → gogoanime.js (embed/stream capture)
                 → Rust (session-aware HLS fetch, manifest/segment proxy)
                 → AnimePlayer.jsx (native playback)

        FALLBACK → animepahe.js (search/episodes/Kwik MP4 resolution)
                 → Rust (session fetch, native transport)
```

- **Per-episode provider reset**: Each episode starts fresh with Gogoanime; only falls to AnimePahe if that specific episode fails
- Source-quality guardrails reject CAM/bad wrapper streams
- Dynamic subtitle capture from live embeds
- Full player controls: seekbar, volume, speed, keyboard shortcuts, episode navigation

### 3. Streaming Playback — Movies/Series/Animation
Uses an **embedded Nuvio sidecar** (local Node.js server on port 7779) with 15+ upstream providers:

```
TMDB ID → IMDb conversion → Nuvio sidecar health-check/start
       → Staged provider fetch:
         1. Primary provider (Vixsrc)
         2. Fast providers (MoviesMod, MoviesDrive, UHDMovies)
         3. Full fallback (4KHDHub, HDRezkas, Showbox, etc.)
       → Stream validation (reject junk/HTML/dead URLs)
       → Rust HLS proxy (manifest/segment/key fetching)
       → MoviePlayer.jsx (native playback with auto-fallback)
```

- **15 provider scrapers**: Vixsrc, MoviesMod, MoviesDrive, UHDMovies, 4KHDHub, HDRezkas, Showbox, SoaperTV, MovieBox, MP4Hydra, VidZee, DramaDrip, TopMovies, HiAnime, HDHub4u
- Auto-fallback to next validated stream on failure
- Content-type-specific provider preferences (animation has its own ordering)

### 4. Subtitles
- Separate from stream resolution — fetched via Wyzie (`sub.wyzie.io`)
- Rust-side resolution and download of English subtitle candidates
- Ranked toward WEB-aligned English tracks
- Parsed into timed cues with styled SUB ON/OFF toggle in player

### 5. Watch Intelligence
- **Continue Watching**: Deduplicated episodic entries (shows only latest episode per series)
- **Watch History**: Auto-recorded on play, localStorage-backed
- **Watchlist**: Add/remove/check, responsive grid
- **Progress Tracking**: Resume playback from last position

### 6. Theming
6 premium themes with CSS variable-driven glassmorphism:
- **Nova Dark** — Deep space (#050508, violet/coral accents)
- **Nova Light** — Frosted glass (#F0F2FA)
- **Midnight Blue** — Cinematic navy (#020818)
- **Ember** — Warm amber noir (#0C0704)
- **Aurora** — Green-teal neon (#020C0A)
- **Sakura** — Soft pink Japanese (#0D080C)

### 7. Auto-Update System
- Checks `raw.githubusercontent.com` for `latest.json`
- Rust streams download chunks with real-time progress events (0-100%)
- File size verification, `.part` temp file safety
- Resilient retry with exponential backoff
- `_update.bat` applies update and restarts the app
- Full logging to `%TEMP%\nova-stream-updater.log`

### 8. Cross-Platform Release
- **Windows**: Portable `.exe` with auto-update capability
- **macOS**: `.dmg` bundle (unsigned, built via GitHub Actions)
- Single CI workflow: tag push → Windows build → macOS build → GitHub Release → update `latest.json`
- Automated via `release.ps1` — bumps version in 4 files, commits, tags, pushes

---

## Technical Achievements

### Embedded Runtime Architecture
The Nuvio sidecar (Node.js + 15 scrapers + Puppeteer) is **embedded directly into the binary** at build time via `build.rs`:
- Rust's build script bundles the entire `vendor/nuvio-streams-addon/` + a Node binary into a ZIP
- On first launch, the runtime is extracted to `%LOCALAPPDATA%/NOVA STREAM/runtime/`
- Auto-recreates if deleted — fully self-healing
- Sidecar runs hidden (no console window) with logging to temp files

This means the shipped `.exe` is a **completely self-contained streaming platform** — no external dependencies, no npm install, no Node.js requirement.

### CORS Bypass via Rust Proxy
All stream resolution, HLS manifest fetching, and segment downloads go through Rust rather than browser fetch, completely sidestepping CORS restrictions that would otherwise block direct provider access from a web frontend.

### Session-Aware Streaming
The Rust backend maintains cookie jars and session state across requests, enabling it to navigate provider authentication flows (Kwik, Gogoanime embeds, AnimePahe sessions) that require persistent cookies.

### Provider Isolation
Anime and movie/series streaming are architecturally **completely separate**:
- Different resolution pipelines
- Different player components (`AnimePlayer.jsx` vs `MoviePlayer.jsx`)
- Different fallback strategies
- Changes to one cannot break the other

### 22 Granular IPC Permissions
Tauri commands are locked behind fine-grained permission files — each Rust command has its own TOML permission definition, following the principle of least privilege.

---

## Key File Map

| Component | File | Purpose |
|-----------|------|---------|
| **App Core** | `src/main.jsx` | Entry, version, update check |
| | `src/App.jsx` | Route definitions, special windows |
| | `src/store/useAppStore.js` | Zustand state (theme, prefs, updates) |
| **Anime** | `src/lib/animeAddons/resolveAnimeStreams.js` | Gogoanime + AnimePahe orchestration |
| | `src/lib/animeAddons/providers/gogoanimeScraper.js` | Gogoanime search/detail/episodes |
| | `src/lib/animeAddons/providers/animepahe.js` | AnimePahe fallback with MP4 preference |
| | `src/lib/animeMapper.js` | Season grouping, long-runner detection |
| | `src/components/Player/AnimePlayer.jsx` | Anime player UI |
| **Movies/Series** | `src/lib/movieStreams.js` | Fetch streams via Rust |
| | `src/lib/movieSubtitles.js` | Fetch subtitles via Wyzie |
| | `src/components/Player/MoviePlayer.jsx` | Movie/series player UI |
| **Search** | `src/components/Search/SearchOverlay.jsx` | Multi-search (TMDB + AniList) |
| **Backend** | `src-tauri/src/main.rs` | Nuvio sidecar, stream/subtitle resolution, embed capture |
| **Build** | `src-tauri/build.rs` | Embeds Nuvio runtime ZIP |
| **Release** | `release.ps1` | Version bumping, tagging, CI trigger |
| **CI/CD** | `.github/workflows/release.yml` | Windows + macOS builds |

---

## Project Stats (GitHub)

| Metric | Value |
|--------|-------|
| **Created** | March 13, 2026 |
| **Latest release** | v1.4.6 (March 21, 2026) |
| **Total releases** | 25+ versions in ~9 days |
| **Repo size** | ~1.6 MB (code only) |
| **On-disk size** | ~20 GB (incl. node_modules, Puppeteer/Chromium) |
| **Main Rust file** | ~1,600+ lines (`src-tauri/src/main.rs`) |
| **Nuvio providers** | 15+ scrapers |
| **Anime providers** | 2 active (Gogoanime + AnimePahe) |
| **Languages** | JS 75%, Rust 23%, CSS 1.5%, PowerShell 0.3% |

The project went from initial release (v1.0.1) to a fully self-contained multi-provider streaming platform with embedded runtimes, cross-platform builds, and auto-updates (v1.4.6) in under **10 days**.

---

## API & Service Integrations

| Service | Purpose | Auth |
|---------|---------|------|
| TMDB | Movie/series metadata, genres, search | API key |
| AniList GraphQL | Anime discovery, identity, search | None (public) |
| Wyzie (`sub.wyzie.io`) | English subtitle resolution | None |
| Supabase | Backend/database (configured, future use) | Anon key |
| GitHub (raw) | Auto-update manifest (`latest.json`) | None |
| Nuvio sidecar (localhost:7779) | Movie/series/animation stream resolution | None (local) |
| Gogoanime (in-project scraper) | Anime stream resolution | None (scraped) |
| AnimePahe (in-project scraper) | Anime fallback streams | Session cookies |

---

## Summary

NOVA STREAM is a technically ambitious desktop streaming application that successfully:

1. **Unifies 4 content types** (movies, series, anime, animation) under one interface
2. **Aggregates 17+ upstream providers** with intelligent fallback chains
3. **Embeds an entire Node.js runtime** inside a single portable executable
4. **Bypasses browser limitations** (CORS, cookies, HLS) through a Rust proxy layer
5. **Ships cross-platform** (Windows + macOS) with automated CI/CD
6. **Self-updates** with streamed downloads and restart handling
7. **Maintains premium UX** with 6 themes, glassmorphism, keyboard shortcuts, and smooth animations

It's essentially a **one-person Netflix client** with the technical sophistication of a commercial streaming app, built on a modern Tauri 2 + React + Rust stack.
