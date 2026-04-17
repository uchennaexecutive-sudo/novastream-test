<div align="center">

# NOVA STREAM

**Premium desktop streaming for Movies, Series, Anime, and Animation**

*Built with Tauri 2, React 18, and Rust*

[![Version](https://img.shields.io/badge/version-1.8.0-brightgreen?style=flat-square)](https://github.com/uchennaexecutive-sudo/novastream-test/releases)
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

Nova Stream is a fast native desktop app for browsing and watching movies, TV series, anime, and animation from one place. It runs as a lightweight Tauri desktop application, so it feels more like a real app than a browser wrapper.

No browser tabs. No extensions. No fuss.

---

## Features

### Content and Discovery
- **Movies, Series, Anime, Animation** in one unified browse experience
- **TMDB-powered discovery** with genre filters, trending, top-rated, and paginated grids
- **AniList-backed anime** browsing with Trending, Popular, and Top Rated tabs
- **Anime News Network feed** on the Anime page
- **Fast search** across Movies, Series, and Anime

### Playback
- **Native custom player** with no browser embeds
- **Multi-provider fallback** when a source fails
- **Anime streaming** via fast Gogoanime primary resolution plus AnimeKai fallback for newer or missing episodes
- **Movie, Series, and Animation streaming** via embedded Nuvio resolver flows
- **English subtitles** with Wyzie-backed resolution
- **Continue Watching** deduplicated per show
- **Resume playback** for movies and episodes with detail-page reopen support
- **Episode navigation** inside the player
- **Anime route persistence** so anime opened from Search, Watchlist, History, Continue Watching, or Downloads stays on the anime detail/playback path
- **Movie HD availability warning** so recent theatrical-only films can show `No HD` / `HD not out yet` before digital release

### Downloads and Offline
- **Download anything**: movies, series episodes, anime, and animation
- **Downloads and Library tabs** for active queue plus completed items
- **Offline playback** through the Rust local media proxy
- **Offline subtitles** stored beside downloaded media
- **Grouped library** for series and anime
- **Storage overview** with per-type usage breakdown
- **Queue management**: pause, resume, cancel, retry failed downloads
- **Configurable download location**
- **Library recovery** so existing downloaded files can repopulate the Library after logout/login, restart, or update, with a visible manual refresh path

### Accounts and Sync
- **Optional Supabase accounts**: sign up, sign in, or skip entirely
- **Cross-device sync** for watchlist, history, playback position, theme, and preferences
- **Hydration recovery** so signed-in watchlist, history, profile stats, Continue Watching, and resume state rehydrate correctly after auth/session changes
- **DiceBear avatars** with multiple styles and seeds
- **Guest mode** with local-only behavior when no account is used

### App Experience
- **6 themes**: Nova Dark, Nova Light, Midnight Blue, Ember, Aurora, Sakura
- **Collapsible sidebar** with smooth hover expansion
- **Ambient orbs** and cinematic styling
- **Watch Party** with rooms, shared playback, and live voice chat
- **Auto-update** with streamed download progress
- **Mac installer helper and updater flow** with universal DMG packaging
- **Intel Mac compatibility mode**
- **Frameless window** with custom title bar controls

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
| **Windows** | Portable `.exe` | No install needed, run directly |
| **macOS** | `.dmg` | Unsigned, see macOS note below |

> Linux support may follow in a later release.

---

## Installation

### Windows

1. Go to the [Releases](https://github.com/uchennaexecutive-sudo/novastream-test/releases) page.
2. Download `NOVA-STREAM-x.x.x-portable.exe`.
3. Run the file.

Nova Stream includes built-in auto-update and will prompt when a new version is available.

### macOS

1. Go to the [Releases](https://github.com/uchennaexecutive-sudo/novastream-test/releases) page.
2. Download `NOVA-STREAM-x.x.x-macos.dmg`.
3. Open the DMG.
4. Double-click **NOVA STREAM Installer.app**.
5. Approve the prompt if needed and enter your password when asked.

> The app is currently unsigned. The DMG includes `NOVA STREAM Installer.app` to automate the copy and quarantine-clear step before first launch.

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
| Movie and Series data | [TMDB API](https://www.themoviedb.org/documentation/api) |
| Auth and Sync | [Supabase](https://supabase.com) |
| Watch Party transport | [LiveKit Cloud](https://livekit.io) + Vercel token service |
| Subtitles | [Wyzie](https://sub.wyzie.io) |
| Avatars | [DiceBear](https://www.dicebear.com) |

---

## Development

**Prerequisites:** Node.js 18+, Rust stable, Tauri CLI

```bash
git clone https://github.com/uchennaexecutive-sudo/novastream-test
cd novastream-test
npm install
npm run tauri:dev
```

Production build:

```bash
npm run tauri:build
```

macOS notes:
- Local macOS builds must be run on a Mac.
- For a local universal macOS build, run `npm run tauri:build -- --target universal-apple-darwin`.
- Tagged releases are still done with `release.ps1`, and GitHub Actions builds the universal macOS DMG with `NOVA STREAM Installer.app`.

Watch Party notes:
- Watch Party uses Supabase for room membership and identity plus LiveKit for media and voice transport.
- Packaged builds use the Vercel token-service flow rather than desktop-local LiveKit secrets.

---

## Current Version

**v1.8.0** - Ship AnimeKai fallback behind Gogoanime, speed up anime startup, fix AnimeKai streaming/download resolution, and persist anime routing from Watchlist and History.

See [Releases](https://github.com/uchennaexecutive-sudo/novastream-test/releases) for the full changelog.

---

## License

Private project. All rights reserved.
