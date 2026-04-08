# macOS Phase 1 Audit

Purpose: map the current Windows-first packaging, download, sidecar, and updater assumptions before changing any behavior for macOS.

This document is an audit only. It does not change the current Windows flow.

## Scope

- Confirm how media tools are packaged and resolved today.
- Confirm how the embedded Node and Nuvio sidecar runtime is packaged and resolved today.
- Confirm how downloads and offline playback currently work.
- Confirm how the updater chooses assets today.
- List the exact file and function touchpoints for later macOS work.

## Current behavior summary

### Windows download and offline architecture

- Direct video downloads use Rust `reqwest` streaming and resume-aware `Range` requests.
- HLS video downloads use `N_m3u8DL-RE` as the primary downloader.
- `ffmpeg` is used for muxing, validation, and recovery around HLS outputs.
- Downloaded files live under the app-local downloads root and can be moved from Settings.
- Offline playback is app-managed through the Rust local media proxy, not raw file URLs.
- Offline subtitles are persisted as local sidecars beside downloaded media.

### Current macOS situation

- GitHub Actions already builds a universal macOS `.app` bundle and packages a custom DMG.
- The DMG currently includes `Install First.command` plus an `Applications` shortcut.
- Movies, series, and animation playback can work on macOS because the embedded Nuvio runtime path is mostly OS-aware already.
- Full macOS downloads are not finished because the bundled tool strategy is still effectively Windows-only.
- The updater remains Windows-only in both the manifest and runtime behavior.

## What the code does today

### 1. Build-time packaging

File: `src-tauri/build.rs`

- `build.rs` zips three things into `nuvio-runtime.zip`:
  - `vendor/nuvio-streams-addon`
  - `vendor/tools`
  - a single resolved `node` binary
- `resolve_node_binary()` uses:
  - `NOVA_STREAM_NODE_BINARY` if set
  - Windows `C:\Program Files\nodejs\node.exe` if present
  - otherwise `node` from `PATH`
- The sidecar directory fingerprint includes `vendor/tools`, so tool changes invalidate the embedded runtime build id.

Important implication:

- The repo currently vendors Windows media tools only:
  - `vendor/tools/ffmpeg.exe`
  - `vendor/tools/N_m3u8DL-RE.exe`
- There are no vendored macOS tool binaries yet.
- The embedded Node packaging is host-build based. The code does not explicitly package separate Intel and Apple Silicon Node runtimes.

### 2. Embedded runtime extraction and completeness

File: `src-tauri/src/main.rs`

Key functions:

- `embedded_nuvio_runtime_is_complete()`
- `extract_embedded_nuvio_runtime()`
- `nuvio_sidecar_dir_candidates()`
- `resolve_node_binary()`

Observed behavior:

- The embedded runtime is extracted under local app data and versioned by `NUVIO_RUNTIME_BUILD_ID`.
- On Unix, extracted file permissions are restored from the archive when available, with an execute fallback for the embedded `node` binary.
- Runtime completeness currently requires:
  - `vendor/nuvio-streams-addon/server.js`
  - `vendor/nuvio-streams-addon/package.json`
  - `vendor/nuvio-streams-addon/addon.js`
  - embedded `node`
  - embedded `ffmpeg` only on Windows

Important implication:

- Runtime completeness does not require `ffmpeg` on macOS.
- Runtime completeness does not require `N_m3u8DL-RE` on any platform.
- That means later macOS tool packaging work should not rely on the current completeness check alone.

### 3. Nuvio sidecar startup and dependency path

File: `src-tauri/src/main.rs`

Key functions:

- `install_nuvio_sidecar_dependencies()`
- `spawn_nuvio_sidecar()`
- `ensure_nuvio_sidecar()`

Observed behavior:

- The app health-checks the local Nuvio sidecar on `http://127.0.0.1:7779`.
- If needed, it extracts the embedded runtime, checks `node_modules`, then starts the sidecar with the resolved `node` binary.
- `install_nuvio_sidecar_dependencies()` uses `npm install`, not an embedded npm runtime.
- In packaged builds, `node_modules` are expected to already be present because CI runs `npm ci` inside `vendor/nuvio-streams-addon` before `tauri build`, and `build.rs` archives the whole sidecar directory.

Important implication:

- The main packaged path is self-contained enough as long as archived `node_modules` stay intact.
- The emergency dependency-install path is not fully self-contained because it relies on `npm` from the host system `PATH`.
- This matters for later macOS hardening if we want sidecar recovery to remain reliable without assuming a developer machine.

### 4. Media tool resolution

File: `src-tauri/src/main.rs`

Key functions:

- `resolve_ffmpeg_binary()`
- `resolve_n_m3u8dl_binary()`

Observed behavior:

- `resolve_ffmpeg_binary()` chooses:
  - extracted runtime `vendor/tools/ffmpeg(.exe)` in release
  - repo `vendor/tools/ffmpeg(.exe)`
  - `release/win-unpacked/ffmpeg(.exe)`
  - `src-tauri/ffmpeg(.exe)`
  - finally `PATH`
- `resolve_n_m3u8dl_binary()` chooses:
  - extracted runtime `vendor/tools/N_m3u8DL-RE(.exe)` in release
  - repo `vendor/tools/N_m3u8DL-RE(.exe)`
  - `release/win-unpacked/N_m3u8DL-RE(.exe)`
  - `src-tauri/N_m3u8DL-RE(.exe)`
  - finally `PATH`

Important implication:

- The code already switches file names by OS:
  - Windows: `.exe`
  - non-Windows: no extension
- But the repo only ships Windows binaries today, so macOS resolution usually falls through to `PATH` or fails.
- The `release/win-unpacked` probe is explicitly Windows-oriented.

### 5. Download engine behavior

File: `src-tauri/src/main.rs`

Key functions:

- `start_video_download()`
- `run_direct_video_download()`
- `run_hls_video_download()`
- `get_download_location()`
- `set_download_location()`
- `reset_download_location()`

Observed behavior:

- Direct downloads use Rust networking and resume with `Range`.
- HLS downloads fail early if `N_m3u8DL-RE` or `ffmpeg` cannot be resolved.
- The app saves downloads under the resolved app-local download root and supports moving the entire library to a custom path.

Important implication:

- Windows downloads are complete because the required tools are vendored.
- macOS downloads are blocked or incomplete until macOS-native tool binaries are bundled and resolved consistently.

### 6. Offline playback path

File: `src-tauri/src/main.rs`

Key functions:

- `register_media_proxy_stream()`
- `register_media_proxy_file()`
- `media_proxy_handler()`
- `get_local_file_metadata()`

Observed behavior:

- Offline playback is served by an internal HTTP media proxy with byte-range support.
- This path is not Windows-specific and is already suitable for both Windows and macOS.

Important implication:

- The main macOS gap is tool/runtime packaging, not the offline playback transport itself.

### 7. Release packaging

Files:

- `.github/workflows/release.yml`
- `release.ps1`
- `release/macos/install-first.command`

Observed behavior:

- Windows release job:
  - builds on `windows-latest`
  - publishes the portable `.exe`
  - rewrites `updates/latest.json` with a `windows-x86_64` asset URL only
- macOS release job:
  - builds `--target universal-apple-darwin --bundles app`
  - stages the `.app`
  - copies `release/macos/install-first.command`
  - adds an `Applications` symlink
  - creates `NOVA-STREAM-x.x.x-macos.dmg`
  - uploads the DMG to the existing GitHub release
- `release.ps1` seeds `updates/latest.json` with a Windows-only platform entry before tagging.

Important implication:

- macOS already has a release artifact path.
- The release manifest used by the app updater remains Windows-only.
- The current DMG helper is functional but terminal-oriented.

### 8. Frontend updater behavior

Files:

- `src/main.jsx`
- `src/components/UI/UpdateToast.jsx`
- `src/pages/Settings.jsx`
- `src/store/useAppStore.js`

Observed behavior:

- The app fetches `updates/latest.json` from GitHub raw content.
- `src/main.jsx` currently reads only `data.platforms['windows-x86_64'].url`.
- If a newer version exists, the frontend invokes:
  - `download_update`
  - then `apply_update`
- The UI language assumes Windows-style auto-apply:
  - "Restart to Apply"
  - "Restart Required"
  - "Update Ready"

Important implication:

- The updater selection logic is explicitly hardcoded to the Windows manifest key.
- The current frontend does not branch into a macOS-specific DMG handoff flow.

### 9. Rust updater behavior

File: `src-tauri/src/main.rs`

Key functions:

- `download_update()`
- `apply_update()`

Observed behavior:

- `download_update()` writes:
  - `_update/nova-stream.exe.part`
  - then `_update/nova-stream.exe`
- `apply_update()` generates and runs `apply-update.bat`.
- The apply script copies the downloaded `.exe` over the running app and relaunches it.

Important implication:

- The current Rust updater implementation is entirely Windows-specific.
- It should stay untouched for Windows while a separate macOS flow is added.

## Exact macOS touchpoints for later phases

### Phase 2 and Phase 3: macOS media tool bundling and resolution

- `vendor/tools/`
- `src-tauri/build.rs`
  - `zip_directory()`
  - runtime fingerprinting
- `src-tauri/src/main.rs`
  - `resolve_ffmpeg_binary()`
  - `resolve_n_m3u8dl_binary()`
  - `embedded_nuvio_runtime_is_complete()`
  - `run_hls_video_download()`

### Phase 4: embedded Node and Nuvio runtime on macOS

- `src-tauri/build.rs`
  - `resolve_node_binary()`
  - runtime archive creation
- `src-tauri/src/main.rs`
  - `extract_embedded_nuvio_runtime()`
  - `resolve_node_binary()`
  - `resolve_nuvio_sidecar_dir()`
  - `install_nuvio_sidecar_dependencies()`
  - `spawn_nuvio_sidecar()`
  - `ensure_nuvio_sidecar()`

### Phase 5: DMG installer helper app

- `release/macos/install-first.command`
- `.github/workflows/release.yml`
  - `Package Mac DMG Artifact`

### Phase 6: macOS update flow

- `updates/latest.json`
- `release.ps1`
- `.github/workflows/release.yml`
  - Windows `latest.json` rewrite step
  - macOS DMG upload step
- `src/main.jsx`
  - update check and platform asset selection
  - update download/apply flow
- `src/components/UI/UpdateToast.jsx`
- `src/pages/Settings.jsx`
- `src/store/useAppStore.js`
- `src-tauri/src/main.rs`
  - `download_update()`
  - `apply_update()`

## Windows-first assumptions currently present

- Only Windows tool binaries are vendored in `vendor/tools`.
- The updater manifest only publishes `windows-x86_64`.
- The frontend updater only reads the Windows manifest entry.
- The Rust updater downloads `nova-stream.exe` and applies it with a `.bat` script.
- Tool resolution still probes `release/win-unpacked`.
- UI wording for updates assumes restart-based auto-apply.
- The current DMG install flow still relies on `Install First.command`.

## Conclusions for later phases

- Windows already has the complete download and updater path. It should remain the baseline.
- macOS playback support is partially in place because the embedded sidecar path is mostly OS-aware.
- macOS downloads are mainly blocked by missing native tool bundling and packaging checks.
- macOS updating needs a separate DMG handoff model, not a port of the Windows `.exe` replacement flow.
- The safest path is additive platform branching in the current touchpoints, not shared rewrites.
