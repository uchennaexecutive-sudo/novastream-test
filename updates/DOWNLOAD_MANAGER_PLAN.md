# Download Manager Plan

## Intent
Add a first-class download manager to NOVA STREAM so users can download movies, series episodes, anime episodes, and animation titles for offline playback inside the app.

The download system should feel native to NOVA STREAM:
- download from detail pages
- track progress live
- resume unfinished downloads after app restart
- play downloaded items offline inside NOVA STREAM
- show storage usage and download status in a dedicated downloads page

## Goal
Build a reliable offline playback system without disturbing the currently stable streaming pipelines, especially anime.

Required product goals:
- one-click `Download` entry point on detail pages
- resolution picker
- episode selection for series/anime
- bulk episode download support later
- pause / resume / cancel / retry
- persistent queue and progress
- offline playback library
- downloaded files should be intended for in-app playback only

## Non-Negotiables
- Do not break the current anime playback path.
- Reuse the proven Rust fetch pattern that made anime and movies work.
- Avoid depending on browser-side downloads for protected media.
- Downloads only need to run while the app is open.
- If the app closes, downloads should resume from saved state when reopened.

## Recommended Architecture

### 1. Hybrid Downloader
Use two download engines:

- `aria2` sidecar for direct file downloads:
  - `.mp4`
  - `.mkv`
  - plain HTTP/HTTPS files

- custom Rust downloader for HLS:
  - `.m3u8`
  - protected segment URLs
  - keys
  - custom headers / referer

Reason:
- aria2 is excellent for resumable direct files
- aria2 is not the best core for protected HLS packaging
- NOVA STREAM already has working Rust manifest/segment fetch logic patterns for anime and movies

### 2. Download State Store
Use SQLite as the source of truth for download jobs.

Suggested tables:
- `download_jobs`
- `download_segments`
- `offline_media`

Each job should store:
- `id`
- `content_type`
- `content_id`
- `imdb_id`
- `title`
- `season`
- `episode`
- `quality`
- `stream_type`
- `stream_url`
- `headers_json`
- `provider`
- `status`
- `progress_bytes`
- `total_bytes`
- `downloaded_segments`
- `total_segments`
- `save_path`
- `offline_path`
- `poster`
- `backdrop`
- `created_at`
- `updated_at`

### 3. Offline Packaging
Downloaded content should not simply be dumped as raw playable files if the goal is “play in NOVA STREAM”.

Recommended approach:
- store media in an app-managed offline library folder
- save metadata alongside the download
- encrypt local media package when practical

Suggested package contents:
- `metadata.json`
- media file or HLS package
- poster / backdrop cache
- subtitles if available

Long-term protection approach:
- encrypt with AES-GCM
- protect key with OS storage:
  - Windows DPAPI
  - macOS Keychain
  - Linux secret store where possible

Note:
- this can discourage casual extraction
- it cannot guarantee perfect DRM-like protection

## Download Flow By Media Type

### Movies / Animation
- resolve stream through the working movie resolver layer
- if direct file:
  - queue in aria2
- if HLS:
  - queue in Rust HLS downloader

### Series
- resolve one episode at a time
- allow:
  - single episode download
  - selected episode download
  - full season download later

### Anime
- keep the current AniWatch resolution path
- add a separate anime download flow built on the same Rust HLS pattern
- do not change the current anime streaming playback path when implementing downloads

## Playback Strategy For Offline Media

### MVP
- prefer storing content in a form that is easy to replay locally
- direct MP4 downloads can be played from local storage through the existing native player shell
- HLS downloads should either:
  - be packaged as local manifests + local segments
  - or be remuxed into a single MP4 later via `ffmpeg`

### Recommended Progression
- Phase 1: local direct file playback
- Phase 2: offline HLS playback from packaged local manifest
- Phase 3: optional remux/transcode pipeline for unified offline MP4 playback

## UI Plan

### Detail Pages
Add:
- `Download` button
- resolution picker
- provider badge if needed
- episode selection grid for series/anime
- “Download Episode” and later “Download Season”

### Downloads Page
Add a dedicated page showing:
- queued
- downloading
- paused
- completed
- failed
- storage used

Actions:
- pause
- resume
- cancel
- retry
- remove
- play offline

### Offline Indicators
Show:
- downloaded badge on detail pages
- partially downloaded status
- storage footprint

## Implementation Strategy

### Phase 1: Foundation
1. Add SQLite download store in Tauri
2. Add `DownloadManager` Rust service
3. Add Tauri commands:
   - create job
   - list jobs
   - pause job
   - resume job
   - cancel job
   - remove job
4. Add downloads page shell in React

### Phase 2: Direct File Downloads
1. Bundle `aria2c` as a Tauri sidecar
2. Start / stop aria2 RPC from Rust
3. Map direct MP4 jobs into aria2 tasks
4. Persist GID/session data so they can resume after reopen
5. Stream progress events into the UI

### Phase 3: HLS Download Engine
1. Build Rust HLS downloader using manifest + segment fetch logic
2. Reuse headers-aware request strategy from working streaming paths
3. Save segment completion state in SQLite
4. Support pause / resume / retry
5. Build local offline manifest packaging

### Phase 4: Offline Playback
1. Detect local offline copy before remote playback
2. Route local content into the same premium player shell
3. Preserve progress and resume for offline items

### Phase 5: Encryption / App-Only Playback
1. Add optional encrypted package format
2. Store keys with OS-protected storage
3. Decrypt only inside the app playback path

### Phase 6: Bulk Downloads
1. Multi-episode queue creation
2. Season batch downloads
3. Anime multi-episode selection
4. Queue priority controls

## File-Level Implementation Outline

### New Rust Areas
- `src-tauri/src/downloads.rs`
  - job models
  - queue manager
  - aria2 integration
  - HLS downloader

- `src-tauri/src/offline_media.rs`
  - package metadata
  - local file lookup
  - optional encryption helpers

### Likely Existing Rust Touchpoints
- `src-tauri/src/main.rs`
  - register download-related commands
  - keep anime streaming commands intact

### New Frontend Areas
- `src/pages/Downloads.jsx`
  - queue UI
  - progress
  - pause/resume/cancel/retry

- `src/lib/downloads.js`
  - JS wrapper over Tauri commands/events

- `src/components/Downloads/*`
  - row cards
  - progress bars
  - batch controls

### Existing Frontend Touchpoints
- `src/pages/Detail.jsx`
  - add download button
  - pass title/poster/backdrop/season/episode metadata into download flow

- `src/components/Player/MoviePlayer.jsx`
  - support local offline sources later

- `src/components/Player/AnimePlayer.jsx`
  - add anime download entry later without altering stable stream path

## Risks
- HLS packaging is more complex than direct file downloading
- some providers may rotate tokens too quickly for long downloads
- encrypted local storage adds complexity
- full app-only protection is not absolute

## Best MVP Recommendation
Ship in this order:
1. direct MP4 downloads with aria2
2. downloads page + resume
3. offline playback for direct files
4. HLS download support
5. bulk series/anime downloads
6. optional encrypted offline packages

This gives NOVA STREAM a real download manager quickly while keeping the architecture compatible with the existing streaming system.

## Resume Note
If work resumes later, start from:
- Phase 1 foundation
- then Phase 2 direct file downloads

Do not start with encrypted HLS packaging first. It is not the fastest path to a working download manager.
