<div align="center">

# NOVA STREAM

**Premium desktop streaming for Movies, Series, Anime & Animation**

*Built with Tauri 2 · React 18 · Rust*

[![Version](https://img.shields.io/badge/version-1.5.3-brightgreen?style=flat-square)](https://github.com/uchennaexecutive-sudo/novastream-test/releases)
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

### Accounts & Sync
- **Optional Supabase accounts** — sign up, sign in, or skip entirely and stay local
- **Cross-device sync** — watchlist, history, playback position, theme, and preferences sync across all your devices
- **DiceBear avatars** — choose from 6 styles, 10 seeds, fully personalized profile
- **Guest mode** — full app experience with localStorage-only storage, no account required

### App Experience
- **6 themes** — Nova Dark, Nova Light, Midnight Blue, Ember, Aurora, Sakura
- **Collapsible sidebar** — collapses to 72px, expands to 240px on hover with smooth animation
- **Ambient orbs** — cinematic background accents that shift with your theme
- **Auto-update** — streamed download with progress bar, no re-download on next launch
- **Frameless window** — custom overlay title bar with native minimize / maximize / close

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
3. Open the DMG and drag **NOVA STREAM** to your Applications folder
4. **First launch only** — right-click the app → **Open** → **Open**

> The app is currently unsigned. macOS will warn you on first launch. After you approve it once, it opens normally from then on.

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
npm run tauri dev

# Production build
npm run tauri build
```

Releases are managed with `release.ps1` and built automatically via GitHub Actions.

---

## Current Version

**v1.5.3** — Sidebar animation overhaul, ANN news feed, Supabase cross-device sync, DiceBear avatars, native movie/anime player with multi-provider fallback, auto-update with progress streaming.

See [Releases](https://github.com/uchennaexecutive-sudo/novastream-test/releases) for the full changelog.

---

## License

Private project — all rights reserved.
