# CASTING_CHECKLIST

Purpose: define the recommended architecture and phased implementation plan for Casting in NOVA STREAM.

This feature should be handled as its own roadmap, separate from Watch Party.

Frontend/UI for this feature will be handled by Claude Code.
Backend/runtime/wiring for this feature will be handled by Codex.

## Product Goal

Let users cast NOVA STREAM content to compatible devices on their local network.

Primary targets:
- Chromecast / Google Cast devices
- DLNA / UPnP smart TVs and related media renderers

Long-term goal:
- work for:
  - direct MP4
  - HLS
  - anime/session-aware streams
  - protected streams that currently rely on Rust-side session/header logic

## Critical Guardrails

- Do not break existing Windows streaming/downloading/offline playback.
- Do not weaken the current anime provider architecture.
- Do not regress:
  - direct downloads
  - HLS downloads
  - offline playback
  - offline subtitles
  - updater behavior
- Treat casting as additive.
- Reuse the current Rust transport/proxy architecture wherever possible.

## Current Repo Facts That Matter

- NOVA STREAM already has a strong Rust transport layer and local proxy patterns.
- Anime and protected HLS already rely on session-aware Rust fetching logic.
- The current architecture already proves the app can fetch, proxy, and serve media in controlled ways.
- Existing player and native playback surfaces are the most likely insertion point for cast controls.

Relevant files to read before implementation:
- `CLAUDE.md`
- `download_offline.md`
- `src-tauri/src/main.rs`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`
- `src/main.jsx`
- `src/pages/Settings.jsx`
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src/lib/nativePlayback.js`
- `vendor/nuvio-streams-addon/*`

## Recommended Architecture

### Core transport model

Casting should not hand the original provider URL directly to the TV or Chromecast.

Instead:
- Rust exposes a LAN-accessible relay/proxy URL
- Rust handles:
  - headers
  - cookies
  - session-aware fetches
  - HLS manifests
  - HLS segments
- the cast target only sees a clean local-network URL

Important:
- the cast target cannot use `127.0.0.1`
- the relay must be exposed on the host machine’s LAN IP, e.g. `http://192.168.x.x:7781/...`
- the laptop and cast device must be on the same Wi-Fi/LAN

### Recommended stack

#### Chromecast
- `castv2-client`
- Why:
  - mature open-source Chromecast sender/client
  - fits the existing Node-side runtime model well

#### DLNA / UPnP
- `rupnp`
- Why:
  - async Rust library for UPnP device discovery/control
  - good fit for the Rust backend

Optional reference:
- `crab-dlna`

## Claude Code UI Scope

- cast button in player UI
- device picker UI
- cast connection state UI
- no-device / discovery / error states
- in-player cast controls:
  - disconnect
  - status
  - device name
  - playback control state if needed

## Codex Backend Scope

- LAN relay/proxy
- manifest rewriting and segment proxying
- Chromecast integration
- DLNA / UPnP integration
- Tauri commands for device discovery / connect / disconnect / status
- wiring to existing player surfaces

## Phase Execution Rule

Each phase should include:
- `Claude Code tasks`
- `Codex tasks`

Preferred sequencing:
- Claude builds the UI shell first
- Codex wires the backend into that UI shape immediately after

## Phases

## Phase A - Audit and architecture map

Goal:
- understand the current proxy, player, and stream-resolution architecture before implementation

Tasks:
- trace existing Rust local media proxy paths
- trace how stream URLs are resolved for:
  - movies
  - series
  - animation
  - anime
- identify clean insertion points for a LAN cast relay
- identify the player control/state surfaces that casting should attach to

Deliverable:
- short architecture note with touchpoints and risks

Claude Code tasks:
- inspect current player UI surfaces and determine where the cast button/device sheet should live
- define minimal UI entry points without implementing full final polish yet

Codex tasks:
- inspect Rust/player/native playback architecture
- define backend insertion points for the relay and cast control commands

## Phase B - Cast relay foundation

Goal:
- create a cast-ready LAN relay/proxy

Tasks:
- expose a LAN-bindable Rust HTTP relay
- support:
  - direct byte relay
  - HLS manifest relay
  - HLS segment relay
- make relay URLs safe and temporary to the active session
- ensure relay URLs are suitable for external cast devices

Deliverable:
- stable LAN relay URLs for active media

Claude Code tasks:
- add the initial cast UI shell:
  - cast button
  - disabled state
  - loading/discovery state
  - empty-state device picker shell

Codex tasks:
- implement the LAN relay
- return cast-ready URLs and relay state for the future UI

## Phase C - Chromecast MVP

Goal:
- support Chromecast first

Tasks:
- integrate `castv2-client`
- discover Chromecast devices
- connect/disconnect cast sessions
- load relay URLs on Chromecast devices
- wire playback control signals to the active cast session

Deliverable:
- working Chromecast casting MVP

Claude Code tasks:
- finalize Chromecast-capable device picker UI
- add cast-session states:
  - connecting
  - casting
  - disconnect

Codex tasks:
- implement Chromecast discovery/control
- wire the UI to real backend commands

## Phase D - DLNA / UPnP MVP

Goal:
- support broader smart TV casting

Tasks:
- integrate `rupnp`
- discover DLNA / UPnP devices
- validate relay URLs against DLNA-compatible renderers
- implement basic media handoff/control

Deliverable:
- working DLNA casting MVP

Claude Code tasks:
- extend device picker UI to support DLNA devices cleanly
- add device labels/badges if useful

Codex tasks:
- implement DLNA discovery and launch/control wiring

## Phase E - Full stream compatibility

Goal:
- make casting work across NOVA STREAM content types

Tasks:
- implement robust HLS manifest rewriting
- rewrite nested playlists, keys, and segment URLs to relay URLs
- reuse Rust session-aware fetch logic for anime/protected streams
- pass subtitles where feasible and supported

Deliverable:
- casting support for:
  - direct MP4
  - HLS
  - anime/session-aware streams

Claude Code tasks:
- add content-state UI:
  - preparing cast stream
  - cast compatibility status
  - error/fallback states

Codex tasks:
- implement manifest rewriting and protected/session-aware media relay
- provide accurate status/errors to the UI

## Phase F - Validation and hardening

Goal:
- ensure reliability and avoid regressions

Tasks:
- verify Windows + macOS behavior
- verify same-network casting reliability
- verify casting does not regress normal local playback
- verify no regressions in downloads/offline/update flows

Deliverable:
- release-readiness checklist and known casting limitations

Claude Code tasks:
- polish edge states:
  - no devices found
  - cast interrupted
  - unsupported content
  - connection failure

Codex tasks:
- harden session teardown
- harden relay cleanup
- validate no regressions in current app behavior

## Best Implementation Order

1. Phase A - audit
2. Phase B - cast relay foundation
3. Phase C - Chromecast MVP
4. Phase D - DLNA / UPnP MVP
5. Phase E - full stream compatibility
6. Phase F - validation and hardening

## Recommended MVP Cut

- same-network only
- Chromecast first
- DLNA second
- direct MP4 and simple HLS first
- subtitles later if needed

## Key Risks

- local firewall/network visibility issues
- device-specific compatibility differences
- HLS manifest rewriting complexity
- subtitle support differences by target device

## Cross-Platform Feasibility

Yes.

Casting can work on both Windows and macOS as long as:
- the host machine can expose the LAN relay
- the device is on the same network

## Reference Links

- `castv2-client`: https://github.com/thibauts/node-castv2-client
- `rupnp`: https://docs.rs/rupnp
- `crab-dlna`: https://docs.rs/crab-dlna
