# MAC_CHECKLIST

Purpose: bring the macOS build and user experience closer to the Windows build without regressing the Windows streaming, downloading, updater, or offline playback paths that already work.

Critical guardrails:
- Do not break or redesign the current Windows flow.
- Do not regress movie, series, animation, or anime streaming on Windows.
- Do not regress the current Windows download architecture:
  - direct downloads via Rust
  - HLS downloads via `N_m3u8DL-RE`
  - local validation/remux/recovery via `ffmpeg`
  - offline playback via the Rust local media proxy
- Do not change anime provider rules:
  - `gogoanime` primary
  - `animepahe` fallback
  - never reintroduce `animekai`
- Treat mac work as additive and OS-aware, not a rewrite of the working Windows implementation.

Current known mac status:
- Universal mac app build is already enabled in `.github/workflows/release.yml`.
- A tester confirmed movies/series/animation playback works on mac.
- Full mac downloads support is not finished yet because the bundled tool/runtime strategy is still Windows-oriented.
- Current mac DMG uses `Install First.command`, which is functional but too technical for novice users.
- Current app auto-update is Windows-only.

Relevant files to read before implementation:
- `CLAUDE.md`
- `download_offline.md`
- `.github/workflows/release.yml`
- `release.ps1`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/main.rs`
- `src/main.jsx`
- `src/pages/Settings.jsx`

Additional files likely relevant during implementation:
- `vendor/tools/*`
- `vendor/nuvio-streams-addon/*`
- `release/macos/*`
- any updater-related frontend/store files that call into the existing Tauri commands

Implementation phases:

## Phase 1 - Audit and isolate the mac-specific tool/runtime paths

Goal:
- fully map the existing Windows-oriented assumptions before changing behavior

Tasks:
- trace how `ffmpeg` is resolved on each OS
- trace how `N_m3u8DL-RE` is resolved on each OS
- trace how embedded Node/Nuvio runtime is packaged in `build.rs`
- trace how embedded runtime is extracted/resolved in `main.rs`
- trace how the updater currently decides which platform asset to use
- confirm the exact places where Windows-only filenames or URLs are hardcoded

Deliverable:
- a short written summary of the current behavior and the exact file/function touchpoints for mac work

Success criteria:
- no code changes yet unless a tiny harmless refactor is necessary for clarity
- the implementation plan for the later phases is confirmed against real code

## Phase 2 - Mac media tools: bundle mac `ffmpeg` and mac `N_m3u8DL-RE`

Goal:
- make the download toolchain available on mac instead of only on Windows

Tasks:
- add mac-compatible `ffmpeg` binaries to the repo/tool packaging flow
- add mac-compatible `N_m3u8DL-RE` binaries to the repo/tool packaging flow
- decide whether to ship:
  - separate Intel + Apple Silicon binaries, or
  - universal binaries where possible
- ensure the release/build pipeline includes the correct mac binaries

Deliverable:
- mac versions of the required tools are available to the built app

Success criteria:
- Windows still resolves `.exe` tools exactly as before
- mac builds have actual native binaries available for runtime use

## Phase 3 - OS-aware tool packaging and resolution

Goal:
- make tool lookup robust and platform-specific

Tasks:
- update tool resolution logic so Windows resolves Windows binaries and mac resolves mac binaries
- avoid Windows assumptions like `.exe` for mac paths
- make the tool packaging/extraction logic architecture-aware where necessary
- ensure release builds only check real packaged/runtime paths for the current OS

Deliverable:
- clean OS-aware tool discovery path in `main.rs` and any related packaging code

Success criteria:
- Windows download behavior remains unchanged
- mac can resolve `ffmpeg` and `N_m3u8DL-RE` from real packaged paths

## Phase 4 - Embedded Node / Nuvio sidecar for mac

Goal:
- make the local Nuvio sidecar runtime properly support mac if it is still required for movies/series/animation

Tasks:
- verify whether movies/series/animation on mac are using embedded Node/Nuvio or some fallback path
- if Node/Nuvio is still required, package a mac-compatible embedded Node runtime
- support both:
  - Apple Silicon
  - Intel Mac
- make embedded runtime packaging/extraction/resolution OS-aware
- preserve the already-hardened Windows runtime extraction/update behavior

Deliverable:
- reliable mac-compatible Node/Nuvio sidecar runtime path

Success criteria:
- Windows runtime hardening from recent versions remains intact
- mac movies/series/animation sidecar path is explicitly supported rather than incidentally working

## Phase 5 - Replace `Install First.command` with a mac installer helper `.app`

Goal:
- improve novice mac install UX without Apple Developer signing/notarization

Tasks:
- replace the terminal-oriented command file with a double-clickable helper `.app`
- helper `.app` should:
  - find `NOVA STREAM.app` beside itself in the DMG
  - copy it to `/Applications`
  - clear quarantine attributes on the installed app
  - open the installed app
- update DMG packaging in the GitHub workflow to include:
  - `NOVA STREAM.app`
  - installer helper `.app`
  - `Applications` shortcut

Deliverable:
- users can install from the DMG without manually opening Terminal and pasting commands

Success criteria:
- workflow still produces a valid DMG
- the install helper is easier than the current `.command` flow
- no Windows release behavior is changed

## Phase 6 - Mac auto-update flow

Goal:
- add a mac-friendly updater flow without trying to force the Windows `.exe` replacement model onto mac

Tasks:
- extend the frontend updater logic to recognize mac platform assets
- extend `updates/latest.json` generation to publish mac release URLs
- implement a mac update flow that:
  - downloads the latest DMG
  - opens the DMG for the user
  - guides the user to run the installer helper `.app`
- keep Windows auto-apply exactly as it is

Deliverable:
- a cross-platform updater UX where:
  - Windows auto-applies
  - mac downloads and opens the DMG for guided install

Success criteria:
- Windows updater still behaves exactly as before
- mac users can update from inside the app without hunting down GitHub releases manually

## Phase 7 - Validation and regression protection

Goal:
- prove the mac additions do not break the already-working Windows system

Tasks:
- verify Windows still supports:
  - movie/series/animation/anime streaming
  - direct downloads
  - HLS downloads
  - offline playback
  - offline subtitles
  - updater behavior
- verify mac supports, at minimum:
  - launch/install via DMG helper `.app`
  - movie/series/animation playback
  - updater DMG handoff flow
- if download tools are completed, verify mac downloads too

Deliverable:
- test summary listing what was verified on each platform

Success criteria:
- no regressions in Windows core behavior
- mac experience is materially improved and closer to Windows

Recommended implementation order:
1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7

Notes for the implementing chat:
- Be conservative with streaming and download logic that already works on Windows.
- Favor OS-conditional additions over shared rewrites.
- If a mac change has risk of destabilizing Windows, isolate it behind explicit platform branching.
- Before editing, inspect current local changes and recent release-related logic carefully.
- After understanding the code and this checklist, do not start implementing immediately unless explicitly asked. First provide a concise understanding summary and say you are ready to begin Phase 1.
