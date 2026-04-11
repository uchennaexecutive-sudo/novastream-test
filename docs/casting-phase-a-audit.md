# Casting Phase A Audit

Purpose: map the current playback, proxy, and runtime architecture before adding casting support, so later phases extend the existing transport model instead of bypassing it.

This document is an audit only. It does not change streaming, downloads, offline playback, subtitles, updater behavior, or platform-specific flows.

## Validation context

- Workspace: `C:\Users\uchen\nova-stream-dev-test`
- Audit date: 2026-04-10
- Scope reviewed:
  - `CLAUDE.md`
  - `CASTING_CHECKLIST.md`
  - `download_offline.md`
  - `src-tauri/src/main.rs`
  - `src-tauri/build.rs`
  - `src-tauri/tauri.conf.json`
  - `src/main.jsx`
  - `src/pages/Settings.jsx`
  - `src/pages/Detail.jsx`
  - `src/components/Player/MoviePlayer.jsx`
  - `src/components/Player/AnimePlayer.jsx`
  - `src/components/Player/SharedNativePlayer.jsx`
  - `src/lib/nativePlayback.js`
  - `src/lib/movieStreams.js`
  - `src/lib/animeDownloads.js`
  - `src/lib/animeAddons/**/*`
  - `vendor/nuvio-streams-addon/*`

## Current architecture summary

- NOVA STREAM already has the transport pattern casting should reuse:
  - stream resolution happens in app-managed code
  - protected/session-aware fetches already flow through Rust
  - direct media and offline files already use a Rust HTTP proxy instead of raw file URLs
- The current blocker for casting is not lack of a proxy pattern.
- The blocker is that the current media proxy is localhost-only and player-oriented:
  - it binds to `127.0.0.1`
  - it serves local playback well
  - it is not reachable from Chromecast or DLNA devices on the LAN
- There is no existing casting backend yet:
  - no Chromecast sender/client integration
  - no DLNA/UPnP discovery/control
  - no cast session state in Rust
  - no cast-related Tauri commands

## What the code does today

### 1. Movie, series, and animation stream resolution

Primary files:

- `src/lib/movieStreams.js`
- `src/components/Player/MoviePlayer.jsx`
- `src-tauri/src/main.rs`
- `vendor/nuvio-streams-addon/*`

Observed behavior:

- Frontend stream lookup for movie-like content is thin and Rust-driven.
- `src/lib/movieStreams.js` invokes `fetch_movie_resolver_streams`.
- Rust starts or health-checks the local Nuvio sidecar on `http://127.0.0.1:7779`.
- Rust validates returned provider streams before exposing them to playback.
- `MoviePlayer.jsx` handles two playback paths:
  - HLS via Rust `fetch_movie_manifest` and `fetch_movie_segment`
  - direct media via `register_media_proxy_stream` or `register_media_proxy_file`

Important implication:

- Movie-like content already has a clean backend insertion point for casting.
- The cast relay should build on the existing Rust-side validated stream contract, not ask the frontend to hand a cast device raw provider URLs.

### 2. Anime stream resolution and playback

Primary files:

- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src/lib/animeAddons/resolveAnimeStreams.js`
- `src/lib/animeDownloads.js`
- `src/lib/animeAddons/providers/gogoanime.js`
- `src/lib/animeAddons/providers/animepahe.js`
- `src-tauri/src/main.rs`

Observed behavior:

- Anime provider discovery and candidate selection remain provider-scoped in JS.
- `AnimePlayer.jsx` resolves provider states and per-episode stream candidates through the anime addons flow.
- The selected candidate can still depend on Rust for transport-critical work:
  - `fetch_hls_manifest`
  - `fetch_hls_segment`
  - session-aware fetches
  - managed direct stream proxying in `SharedNativePlayer.jsx`
- `SharedNativePlayer.jsx` already accepts:
  - `streamUrl`
  - `streamHeaders`
  - `streamSessionId`
  - `streamType`

Important implication:

- Anime casting cannot safely skip Rust and hand the chosen provider URL directly to the network device.
- The future cast relay must understand the same header/session constraints that current anime playback already depends on.
- Anime provider ordering and fallback must remain provider-scoped and unchanged.

### 3. Existing Rust media proxy

Primary files:

- `src-tauri/src/main.rs`

Key functions:

- `ensure_media_proxy_server()`
- `media_proxy_handler()`
- `register_media_proxy_stream()`
- `register_media_proxy_file()`
- `media_proxy_local_file_response()`
- `parse_single_http_range()`

Observed behavior:

- Rust already exposes an internal HTTP proxy for:
  - managed upstream media URLs
  - local offline files
- Proxy entries are stored in-memory and keyed by generated UUIDs.
- The proxy supports:
  - arbitrary upstream headers
  - optional session-backed requests
  - byte-range support for local files
  - passthrough of upstream headers and status for remote content
- The server is started lazily and binds to `127.0.0.1:0`.

Important implication:

- The current proxy is the clearest technical foundation for casting.
- The main architectural change for casting is to add a LAN-reachable relay mode, not invent a second unrelated transport stack.

### 4. Existing HLS fetch and rewrite logic

Primary files:

- `src-tauri/src/main.rs`
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`

Key functions:

- `fetch_movie_manifest()`
- `fetch_movie_segment()`
- `fetch_hls_manifest()`
- `fetch_hls_segment()`
- `rewrite_manifest_line()`

Observed behavior:

- The app already rewrites HLS manifests for local playback.
- Movie-like HLS and anime HLS currently use different command paths, but both prove the same backend capability:
  - fetch manifest through Rust
  - preserve required request headers and cookies
  - fetch segments through Rust
- The rewrite result is currently consumed by the local player, not by external devices.

Important implication:

- Cast relay work should consolidate around reusable Rust-side HLS relay helpers.
- The current code already reduces risk by proving that manifest rewriting and protected segment fetching are viable inside the app.

### 5. Offline playback path

Primary files:

- `src/pages/Detail.jsx`
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src-tauri/src/main.rs`

Observed behavior:

- Offline playback is app-managed, not raw file playback.
- Downloaded files are reopened through the Rust media proxy, with sidecar subtitle lookup handled separately.
- Offline playback depends on the existing proxy remaining stable for:
  - local files
  - byte ranges
  - subtitle sidecars

Important implication:

- Casting work must not regress the existing local proxy behavior.
- LAN relay work should be additive beside the current offline/local playback path, not a replacement.

### 6. Runtime packaging and sidecars

Primary files:

- `src-tauri/build.rs`
- `src-tauri/Cargo.toml`
- `vendor/nuvio-streams-addon/*`

Observed behavior:

- The app already packages and extracts an embedded runtime archive for the Nuvio sidecar.
- `build.rs` currently archives:
  - `vendor/nuvio-streams-addon`
  - `vendor/tools`
  - embedded `node`
- The backend already tolerates a mixed Rust plus sidecar runtime model.

Important implication:

- Chromecast support can fit the current architecture even if it requires Node-side runtime support later.
- Phase A does not require that decision yet, but the repo structure does not block it.

### 7. Frontend/runtime wiring surfaces relevant to casting

Primary files:

- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src/pages/Detail.jsx`
- `src/main.jsx`

Observed behavior:

- Playback state is already centralized enough for casting controls to attach cleanly later.
- The best attachment points are the player surfaces, not Settings or Detail business logic.
- `SharedNativePlayer.jsx` is especially important because it already abstracts:
  - stream URL
  - headers
  - session ID
  - playback controls
  - error and retry state
- `src/main.jsx` already shows the pattern for wiring backend event listeners into the app shell.

Important implication:

- Later cast state events and commands should mirror the existing download/updater event wiring style.
- Minimal UI wiring should target the player surfaces first.

## Clean insertion points for later phases

### 1. LAN cast relay on top of the existing media proxy model

Best backend insertion point:

- extend `ensure_media_proxy_server()` and the proxy entry model into a cast-ready relay layer

Why:

- the current proxy already knows how to:
  - serve local files
  - relay remote media
  - preserve request headers
  - use resolver sessions
- the missing capability is LAN visibility plus cast-oriented URL generation

Recommended shape for later phases:

- keep local playback proxy behavior intact
- add a LAN-reachable relay base URL for cast devices
- make relay URLs session-scoped and temporary
- separate cast relay registration from ordinary local playback registration if needed for cleanup and security

### 2. Reusable HLS relay helpers in Rust

Best backend insertion point:

- factor current manifest fetch/rewrite logic into relay-safe helpers for:
  - master playlists
  - nested playlists
  - segments
  - keys

Why:

- current local HLS flows already prove the fetch side
- casting needs externally reachable URLs, not blob-based local player feeds

### 3. Cast command surface in Tauri

Best backend insertion point:

- new `#[tauri::command]` functions in `src-tauri/src/main.rs`

Likely future command groups:

- relay preparation and relay status
- device discovery
- connect/disconnect
- active cast session status
- playback control forwarding

Why:

- the app already uses Tauri command wiring for playback, downloads, and updater behavior
- this matches the existing runtime architecture cleanly

### 4. Player-side state attachment

Best frontend/runtime touchpoints for later phases:

- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`

Why:

- those components know the active media identity and current playable stream context
- they are the natural point to request a cast-ready relay URL for the active source
- they can reflect cast status without altering detail-page data flow

## Phase B starting point

The first backend implementation phase after this audit should focus on the relay only.

Recommended backend scope for the next phase:

- expose a LAN-bindable relay
- create temporary relay entries for active media
- support direct media relay
- support HLS manifest relay and segment relay
- return cast-ready URLs and relay status to the UI

Out of scope for that next phase:

- Chromecast sender integration
- DLNA discovery/control
- full subtitle casting support
- device-specific compatibility work
- broader anime/protected-stream hardening beyond the relay foundation

## Key risks and preservation rules

### 1. Do not bypass Rust for cast playback

- Raw provider URLs should not be sent directly to cast devices.
- This is especially important for:
  - anime/session-aware streams
  - header-sensitive direct media
  - protected HLS paths

### 2. Do not regress the current local proxy

- Existing local playback and offline playback already rely on:
  - `register_media_proxy_stream()`
  - `register_media_proxy_file()`
  - byte-range support
- Casting should extend this system, not replace it.

### 3. Keep anime provider logic isolated

- Do not fold anime into movie-like resolver shortcuts.
- Do not weaken Gogoanime primary plus AnimePahe fallback ordering.
- Do not move anime protection logic out of Rust-backed transport paths.

### 4. Treat downloads and updater behavior as separate systems

- Download, offline, and updater flows have their own event and process wiring.
- Casting work should not reuse or disturb those control paths unless there is a clear shared helper with no behavioral change.

### 5. Relay lifecycle needs cleanup and boundaries

- Current proxy entries are in-memory and UUID-based.
- For casting, later phases will need explicit cleanup, expiry, and active-session ownership rules so relay URLs do not accumulate indefinitely.

### 6. LAN visibility will surface real network issues

- Even with correct implementation, same-network casting can still fail due to:
  - host firewall rules
  - device compatibility differences
  - HLS parser differences on Chromecast or DLNA renderers

## Audit conclusion

- The repo is already structurally ready for casting because the hard part of the architecture is present:
  - Rust-managed transport
  - session-aware fetches
  - manifest rewriting
  - managed proxy URLs
- The clean path forward is to evolve the existing media proxy into a LAN cast relay, then layer device integration on top.
- The highest-risk mistake would be creating a separate casting path that bypasses Rust and sends upstream provider URLs directly to TVs or Chromecasts.
