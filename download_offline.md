# Download + Offline Playback - Revised Architecture Recommendation

## Overview

This document defines the recommended architecture for Nova Stream's download manager and offline playback feature.

It merges:
- the strongest technical findings from the research
- Nova Stream's existing Rust/Tauri infrastructure
- the product constraints that matter for a premium desktop streaming app

This feature should be built in two layers:
- **UI/product shell first**
- **download engine and offline playback execution second**

## Core Product Constraints

1. **The feature should feel premium before it feels complex**
   - Users should first see the correct surfaces:
     - download buttons
     - quality and episode selection
     - a Downloads page
     - offline status indicators

2. **Offline playback is app-managed, not true DRM**
   - Nova Stream can make downloaded files intended for in-app playback by using app-private storage, internal cataloging, and non-obvious filenames.
   - But without a real DRM/license system, this is **not** true file lock-in.

3. **Anime should come later than movies/series/animation**
   - Movies / Series / Animation already share a stronger unified path through Nuvio.
   - Anime is more provider-sensitive and should be layered on after the core system works.

4. **UI implementation should start first**
   - Movies and episode-based content need different download UX.
   - The product shell should be stabilized first, then the backend should be built to support it.

## Core Tool Decision

The original suggestion was `aria2 + FFmpeg`.

After comparing that against Nova Stream's current architecture, the better v1 stack is:

| Stream Type | Source | Tool | Reason |
|---|---|---|---|
| Movies / Series / Animation HLS | Nuvio resolver | **FFmpeg sidecar** | Handles m3u8 -> MP4, AES-128, custom headers natively |
| Gogoanime anime HLS | Session-locked | **Rust pre-fetch -> FFmpeg** | Rust extracts session/key data, rewrites manifest, hands off to FFmpeg |
| AnimePahe anime direct MP4 | Kwik MP4 URL | **Pure reqwest** | `download_update` in `main.rs` is already the right template |
| Future DASH streams | Nuvio providers | **N_m3u8DL-RE sidecar** | Best mature open-source DASH fallback if needed later |

### Recommendation for `aria2`

Do **not** use aria2 in v1.

Why:
- it adds little value to HLS
- Nova Stream already has a strong Rust template for direct-file streaming downloads
- it is one more sidecar/process to manage

Longer-term note:
- aria2 is still worth reconsidering later only if direct-file resume or aggressive parallel chunking becomes a real bottleneck for MP4-style downloads

## Why FFmpeg Is the Right Primary Tool

- Nova Stream already embeds the Nuvio sidecar via `build.rs`, and FFmpeg fits the same packaging model
- `configure_background_process` already supports hidden/background execution on Windows
- FFmpeg `-c copy` remux is lossless and produces a single clean `.mp4`
- FFmpeg already handles HLS well when given the final playlist plus the required headers/key setup
- It keeps the architecture simpler than trying to fully rebuild HLS muxing inside Rust

## Why Not the Alternatives

| Tool | Verdict |
|---|---|
| **aria2** | Not useful for HLS in Nova Stream's v1 design. Only maybe useful later for direct-file optimization. |
| **yt-dlp** | Overkill once Nova Stream already has the resolved final stream URLs. |
| **N_m3u8DL-RE** | Strong tool, but best kept as a later fallback, not the default v1 dependency. |
| **Pure Rust HLS pipeline** | Possible for parts of the flow, but FFmpeg is still the simplest final mux/remux solution. |

## What Nova Stream Already Has

Nova Stream's current Rust backend already provides most of what this feature needs.

| Needed Piece | Existing Location |
|---|---|
| Stream bytes to disk with progress events | `download_update` in `src-tauri/src/main.rs` |
| Fetch HLS manifest with session headers | `fetch_hls_manifest` in `main.rs` |
| Fetch individual HLS segments | `fetch_hls_segment` in `main.rs` |
| Session-aware reqwest pool with cookies | Already used in resolver commands |
| Hidden sidecar process launch | `configure_background_process` in `main.rs` |
| Sidecar binary embedding at build time | `build.rs` Nuvio zip pattern |
| Progress events to frontend | Existing `app.emit(...)` patterns |
| Zustand store with persist middleware | Existing store patterns already used in the app |

What is genuinely new:
- FFmpeg binary embedding
- per-download-id event multiplexing
- `useDownloadStore.js`
- Downloads page UI
- download button components
- Gogoanime session/key rewrite flow for offline anime HLS
- offline playback file lookup and local subtitle persistence

## Product-Layer Recommendation

Before building the full engine, Nova Stream should establish the product shell for downloads.

### UI-first rollout

Start with:
- a **Downloads** destination/page
- download buttons on:
  - movie detail
  - animation detail
  - series episode rows and season header actions
  - anime episode rows and season header actions
- quality picker surfaces
- episode/season download surfaces
- offline badges and "Play Offline" state hooks

This is the right first move because:
- the UX differs for movie vs episode vs season downloads
- it allows the product behavior to be shaped before heavy backend work
- it lets the existing UI design language stay consistent

### Responsibility split

- **React/UI layer**
  - download buttons
  - queue page
  - progress rows
  - filter tabs
  - storage indicators
  - offline badges / entry points
- **Rust**
  - queue orchestration
  - progress emission
  - file system layout
  - provider/session-aware download execution
  - background process control
- **FFmpeg**
  - HLS capture / remux
- **Pure reqwest**
  - direct MP4-style downloads

## Architecture Flow

```text
User clicks Download on Detail page
        |
        v
React: enqueue() in useDownloadStore
  - adds item with status: queued
  - auto-starts if active downloads < maxConcurrent
        |
        v
Rust: start_video_download
  |
  |-- AnimePahe direct MP4?
  |     -> reqwest streaming -> disk
  |     -> emit progress / complete / failure events
  |
  |-- Gogoanime HLS?
  |     -> Rust fetches manifest and session-locked key material
  |     -> rewrite manifest if needed
  |     -> FFmpeg remuxes to final offline file
  |
  |-- Nuvio HLS?
        -> FFmpeg with headers / protocol settings
        -> emit progress / complete / failure events
```

## Storage Layout

```text
%LOCALAPPDATA%/NOVA STREAM/
  downloads/
    movies/
      {tmdbId}_{SafeTitle}_{year}.mp4
    series/
      {tmdbId}_{SafeTitle}/
        S{season}E{episode}_{SafeEpisodeTitle}.mp4
    anime/
      {anilistId}_{SafeTitle}/
        S{season}E{episode}.mp4
    animation/
      {tmdbId}_{SafeTitle}_{year}.mp4
  tools/
    ffmpeg.exe
    ffmpeg-mac-arm64
    ffmpeg-mac-x64
```

Recommended storage rules:
- sanitize filenames
- store absolute `filePath` in app state/catalog
- never scan the filesystem as the primary source of truth
- subtitle files should be saved locally when selected for offline use

## Download Catalog Shape

For v1, Zustand persist is acceptable.

Recommended per-download item fields:
- `id`
- `contentId`
- `contentType`
- `title`
- `poster`
- `season`
- `episode`
- `episodeTitle`
- `quality`
- `streamUrl`
- `headers`
- `subtitleUrl`
- `status`
- `progress`
- `bytesDownloaded`
- `totalBytes`
- `speedBytesPerSec`
- `filePath`
- `subtitleFilePath`
- `errorMessage`
- `queuedAt`
- `startedAt`
- `completedAt`

Longer-term note:
- if the offline library becomes large, move from Zustand-only storage to a stronger local catalog, likely Rust-managed SQLite or equivalent structured storage

## Offline Playback Integration

When a file is downloaded:
- the detail page should surface a **Play Offline** option
- the players should prefer local file playback when an offline file is available

Recommended path:
- use `convertFileSrc(localFilePath)` for local playback
- keep progress tracking working for offline playback too
- save local subtitles when selected so offline playback does not depend on the network

### Subtitle Persistence

Subtitle handling should be treated as a first-class part of offline playback, not a small follow-up detail.

Why:
- if a user downloads a movie or episode expecting subtitles and they disappear offline, the download experience is broken
- the current online player flow can fetch subtitle text at playback time, but offline playback cannot depend on remote subtitle URLs

Recommended v1 rule:
- download the selected subtitle track alongside the video when subtitles are enabled for offline use
- store `subtitleFilePath`, subtitle label/language metadata, and format in the catalog entry
- load the subtitle from local disk during offline playback via `convertFileSrc` the same way the video is loaded
- if no subtitle was downloaded, show offline playback as video-only instead of implying subtitle support

This means subtitle persistence should be implemented as part of Phase D, not treated as optional polish after offline playback already exists.

## UI Component Direction

Likely files/components:

```text
src/
  pages/
    Downloads.jsx
  components/
    Downloads/
      DownloadButton.jsx
      DownloadProgressRing.jsx
      DownloadQueueItem.jsx
      DownloadLibraryRow.jsx
      StorageIndicator.jsx
      SeasonDownloadSheet.jsx
      QualityPickerSheet.jsx
  store/
    useDownloadStore.js
  lib/
    downloads.js
```

Recommended UX states for buttons:
- default
- queued
- downloading
- paused
- completed
- failed

## Rust Command Direction

Recommended command set:
- `start_video_download`
- `pause_video_download`
- `cancel_video_download`
- `delete_download_file`
- `get_downloads_storage_info`

Rust event payloads should include:
- progress
- bytes downloaded
- total bytes
- speed
- completion path
- failure reason

## Implementation Phases

### Phase A - UI shell first

This phase should be handled first so the product surfaces are stable before the download engine is finalized.

1. Add `/downloads` page scaffolding
2. Add a sidebar entry for Downloads
3. Add `DownloadButton` placement on:
   - movie detail
   - animation detail
   - series episode rows / season header actions
   - anime episode rows / season header actions
4. Add the progress ring plus queued/downloading/completed button states
5. Add quality picker surface
6. Add season/episode download sheet surface
7. Add placeholder offline badges / "Play Offline" affordance hooks

Goal:
- the UI should fully express the intended download experience even before the engine is fully wired

### Phase B - Store and frontend wiring

1. Add `src/store/useDownloadStore.js` with Zustand persist
2. Add event listeners in `src/main.jsx`
3. Add queue state, progress state, and completed-item lookup helpers
4. Wire Downloads page sections into:
   - active downloads
   - completed library
   - storage summary

### Phase C - Rust download infrastructure

1. Vendor minimal FFmpeg binaries for Windows and macOS into `vendor/tools/`
2. Add FFmpeg extraction to the startup routine in `main.rs` alongside Nuvio
3. Implement `start_video_download` for:
   - direct MP4 via reqwest
   - Nuvio HLS via FFmpeg
   - Gogoanime HLS via Rust pre-fetch + FFmpeg
4. Implement pause/cancel/delete/storage-info commands
5. Define Tauri event payloads and emit correctly
6. Add needed capability grants

### Phase D - Offline playback integration

1. Use `isDownloaded` checks in detail pages
2. Add "Play Offline" button behavior
3. Use `convertFileSrc(localFilePath)` in `MoviePlayer.jsx` and `AnimePlayer.jsx`
4. Add subtitle persistence as a required offline path:
   - download the chosen `.srt` / `.vtt` file beside the video
   - save `subtitleFilePath` plus subtitle metadata in the catalog
   - make offline playback prefer local subtitle files over remote subtitle URLs
5. Verify progress tracking still works offline

### Phase E - Storage management and polish

1. Build the full Downloads page
2. Add storage indicator
3. Add completed library rows and actions
4. Add cleanup/delete flows
5. Add filter tabs
6. Add storage-management controls in Settings if desired

### Phase F - Anime rollout

1. Start with Gogoanime
2. Then AnimePahe
3. Only after Movies / Series / Animation are stable

## Risks and Honest Limits

### Manageable
- AnimePahe direct MP4 downloads
- Nuvio HLS downloads via FFmpeg
- React/Zustand components
- Offline playback with `convertFileSrc`

### Harder
- Gogoanime session-locked HLS key handling
- FFmpeg progress parsing
- partial file cleanup on cancel
- macOS FFmpeg packaging
- subtitle persistence per downloaded item

### Not Worth Doing in v1
- pause/resume HLS mid-stream beyond kill + re-queue
- playing partially downloaded media
- true DRM / guaranteed app-only playback
- aria2 integration unless direct-file performance later proves it necessary

## Recommended v1 Decisions

| Decision | Choice | Reason |
|---|---|---|
| Primary HLS download tool | **FFmpeg sidecar** | Best fit for HLS and current Tauri sidecar model |
| Direct MP4 downloads | **Pure reqwest** | Reuses existing Rust patterns cleanly |
| DASH support | **N_m3u8DL-RE later if needed** | Keep complexity lower in v1 |
| aria2 | **Skip in v1, reconsider later only for direct-file optimization** | Low value for the current HLS-heavy design |
| Output format | **MP4 via `-c copy`** | Simple, seekable, player-friendly |
| Offline playback | **`convertFileSrc + asset protocol`** | Clean local playback path |
| Catalog | **Zustand first, stronger local catalog later if needed** | Fastest path to ship |
| Downloads page layout | **List rows, not grid** | Better for file sizes and actions |
| Max concurrent downloads | **2** | Prevents saturation, good UX default |
| DRM stance | **App-managed offline, not true DRM** | Honest product boundary |

## Final Recommendation

For Nova Stream, the best download/offline plan is:

1. **UI shell first**
2. **FFmpeg for HLS**
3. **Pure Rust reqwest for direct MP4**
4. **Movies / Series / Animation before Anime**
5. **Anime support later, with Gogoanime first**

This gives the strongest balance of:
- implementation realism
- reuse of existing infrastructure
- premium user experience
- manageable technical risk
