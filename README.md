<div align="center">

# NOVA STREAM

**Premium desktop streaming for Movies, Series, Anime & Animation**

*Built with Tauri 2 · React 18 · Rust*

[![Version](https://img.shields.io/badge/version-1.7.1-brightgreen?style=flat-square)](https://github.com/uchennaexecutive-sudo/novastream-test/releases)
[![Windows](https://img.shields.io/badge/Windows-portable%20exe-0078D7?style=flat-square&logo=windows)](https://github.com/uchennaexecutive-sudo/novastream-test/releases)
[![macOS](https://img.shields.io/badge/macOS-DMG-lightgrey?style=flat-square&logo=apple)](https://github.com/uchennaexecutive-sudo/novastream-test/releases)
[![License](https://img.shields.io/badge/license-private-red?style=flat-square)](#)

</div>

---

<div align="center">

![Nova Stream Home](Screenshots/Screenshot%202026-03-24%20123357.png)

</div>

---

## What is Nova Stream?

Nova Stream is a fast, native desktop app for browsing and watching movies, TV series, anime, and animation — all from one place. It runs as a lightweight native application built with Tauri, giving you real desktop performance with a cinematic interface.

No browser tabs. No extensions. No fuss.

---

## Features

### Content & Discovery
- **Movies, Series, Anime, Animation** — all in one unified browse experience
- **TMDB-powered** discovery with genre filters, trending, top-rated, and paginated grids
- **AniList-backed anime** browsing with Trending / Popular / Top Rated tabs and genre chips
- **Anime News Network feed** — live news carousel on the Anime page so you always know what's airing
- **Fast search** — debounced multi-search across Movies, Series, and Anime simultaneously

### Playback
- **Native custom player** — no browser embeds, no sandbox restrictions
- **Multi-provider fallback** — automatically tries the next source when one fails
- **Anime streaming** via Gogoanime (primary) with AnimePahe as fallback
- **Movie / Series / Animation streaming** via embedded Nuvio resolver with staged provider tiers
- **English subtitles** — Wyzie-backed subtitle resolution with WEB-aligned track ranking
- **Continue Watching** — auto-resumes from where you left off, deduplicated per show
- **Episode navigation** inside the player — previous / next without leaving playback

### Downloads & Offline
- **Download anything** — movies, series episodes, anime, and animation saved for offline viewing
- **Downloads / Library tabs** — active queue and completed offline library in one place
- **Offline playback** — downloaded titles play locally via Rust media proxy with byte-range support
- **Offline subtitles** — subtitle sidecars saved alongside the video so subtitles work offline
- **Grouped library** — series and anime episodes grouped by show with collapsible episode lists
- **Storage overview** — per-type breakdown (Movies / Series / Anime / Animation) with usage bar
- **Queue management** — pause, resume, cancel, retry failed downloads
- **Configurable download location** — change where files are saved from Settings

### Accounts & Sync
- **Optional Supabase accounts** — sign up, sign in, or skip entirely and stay local
- **Cross-device sync** — watchlist, history, playback position, theme, and preferences sync across all your devices
- **DiceBear avatars** — choose from 6 styles, 10 seeds, fully personalized profile
- **Guest mode** — full app experience with localStorage-only storage, no account required

### App Experience
- **6 themes** — Nova Dark, Nova Light, Midnight Blue, Ember, Aurora, Sakura
- **Collapsible sidebar** — collapses to 72px, expands to 240px on hover with smooth animation
- **Ambient orbs** — cinematic background accents that shift with your theme
- **Watch Party** — create rooms, invite friends with a 6-character code, stream what the host is playing, and talk together with live voice chat
- **Auto-update** - streamed download with progress bar, no re-download on next launch
- **Mac installer helper + updater flow** - universal DMG with a bundled installer app, while Windows keeps in-place auto-apply updates
- **Intel Mac compatibility mode** - reduced visual effects mode for older Intel Macs, with manual override in Settings
- **Frameless window** - custom overlay title bar with native minimize / maximize / close

---

## Screenshots

<div align="center">

### Series Browse
![Series Browse](Screenshots/Screenshot%202026-03-24%20123620.png)

### Detail Page
![Detail Page](Screenshots/Screenshot%202026-03-24%20123456.png)

### Native Player
![Native Player](Screenshots/Screenshot%202026-03-24%20123540.png)

### Anime Page with News Feed
![Anime](Screenshots/Screenshot%202026-03-24%20123607.png)

### Search Overlay
![Search](Screenshots/Screenshot%202026-03-24%20123439.png)

</div>

---

## Supported Platforms

| Platform | Download | Notes |
|----------|----------|-------|
| **Windows** | Portable `.exe` | No install needed — run directly |
| **macOS** | `.dmg` | Unsigned — see macOS note below |

> **Linux** support may follow in a later release.

---

## Installation

### Windows

1. Go to the [**Releases**](https://github.com/uchennaexecutive-sudo/novastream-test/releases) page
2. Download `NOVA-STREAM-x.x.x-portable.exe`
3. Run the file — no installation required

Auto-update is built in. Nova Stream will notify you when a new version is available and handle the download + restart automatically.

---

### macOS

1. Go to the [**Releases**](https://github.com/uchennaexecutive-sudo/novastream-test/releases) page
2. Download `NOVA-STREAM-x.x.x-macos.dmg`
3. Open the DMG
4. Double-click **NOVA STREAM Installer.app**
5. Approve the macOS prompt if it appears, then enter your password when asked
6. The helper copies **NOVA STREAM** into Applications, clears the blocked-launch quarantine flag, and opens the app

> The app is currently unsigned. The DMG includes `NOVA STREAM Installer.app` to automate the copy + quarantine-clear step before first launch.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://tauri.app) |
| Frontend | React 18 + Vite 6 |
| Styling | TailwindCSS + Framer Motion |
| State | Zustand |
| Backend runtime | Rust |
| Anime data | [AniList GraphQL API](https://anilist.co/graphiql) |
| Movie / Series data | [TMDB API](https://www.themoviedb.org/documentation/api) |
| Auth + Sync | [Supabase](https://supabase.com) |
| Watch Party transport | [LiveKit Cloud](https://livekit.io) + Vercel token service |
| Subtitles | [Wyzie](https://sub.wyzie.io) |
| Avatars | [DiceBear](https://www.dicebear.com) |

---

## Development

**Prerequisites:** Node.js 18+, Rust (stable), Tauri CLI

```bash
# Clone
git clone https://github.com/uchennaexecutive-sudo/novastream-test
cd novastream-test

# Install dependencies
npm install

# Start dev server
npm run tauri:dev

# Production build
npm run tauri:build
```

macOS notes:
- Local macOS builds must be run on a Mac.
- For a local universal macOS app build, run `npm run tauri:build -- --target universal-apple-darwin`.
- Tagged releases are still done with `release.ps1`, and GitHub Actions builds the universal macOS DMG with `NOVA STREAM Installer.app`.

Watch Party notes:
- Watch Party uses Supabase for room membership/identity and LiveKit for media + voice transport.
- Packaged/test builds use the Vercel token-service flow rather than relying on desktop-local LiveKit secrets.
- If you change the Watch Party token backend, keep the frontend token endpoint and LiveKit URL in sync with the deployed service.

---

## Current Version

**v1.7.1** - Patch release to sync the vendored Nuvio sidecar lockfile so CI and tagged release builds succeed cleanly

See [Releases](https://github.com/uchennaexecutive-sudo/novastream-test/releases) for the full changelog.

---

## License

Private project — all rights reserved.
