# macOS Phase 7 Validation

Purpose: record what was validated for the macOS uplift work and what still requires real-device smoke testing, while confirming the Windows-first behavior was not redesigned.

This document is a validation summary, not a new runtime feature.

## Validation environment

- Local workspace: `C:\Users\uchen\nova-stream-dev-test`
- Validation date: 2026-04-08
- Host environment used for validation: Windows development machine

## What was verified in this environment

### Build and compile checks

- `cargo check` passed in `src-tauri`
- `npm run build` passed at the repo root

### Scope review

- The anime provider rules were not changed:
  - `gogoanime` primary
  - `animepahe` fallback
  - `animekai` not reintroduced
- The Windows movie, series, animation, anime, direct-download, HLS-download, offline playback, and offline subtitle paths were not redesigned.
- The mac work remained additive and OS-aware:
  - mac tool packaging
  - mac Node packaging
  - mac installer helper `.app`
  - mac updater DMG handoff

### Windows updater regression protection

- Windows update manifest key remains `windows-x86_64`
- Windows update payload remains the portable `.exe`
- Windows `download_update()` still downloads into the updater runtime directory and reports progress
- Windows `apply_update()` behavior remains the same copy-and-restart flow, now isolated behind the non-mac branch in `src-tauri/src/main.rs`

### mac updater readiness

- `updates/latest.json` now includes `darwin-universal`
- `release.ps1` now seeds both Windows and macOS update assets
- `.github/workflows/release.yml` now rewrites `updates/latest.json` with both:
  - `windows-x86_64`
  - `darwin-universal`
- mac updater flow now downloads a DMG and opens it instead of attempting Windows-style in-place replacement
- mac update UI now instructs the user to launch `NOVA STREAM Installer.app`

### mac packaging readiness

- mac `ffmpeg` binaries are present in `vendor/tools`
- mac `N_m3u8DL-RE` binaries are present in `vendor/tools`
- mac Node runtimes are downloaded and packaged in the release workflow
- the DMG staging flow now includes:
  - `NOVA STREAM.app`
  - `NOVA STREAM Installer.app`
  - `Applications` shortcut

## Windows validation summary

### Verified by direct local checks

- Rust project compiles after the mac uplift changes
- Frontend production build completes after the updater UI changes
- Update manifest generation now includes both platforms without removing the Windows asset

### Verified by code review of touched paths

- No Windows streaming provider logic was changed
- No anime resolver/provider ordering was changed
- No direct-download or HLS-download command orchestration was redesigned
- No offline playback or offline subtitle transport logic was changed
- Windows updater behavior remains on the existing `.exe` auto-apply path

### Residual Windows risk

- No full manual Windows playback/download smoke pass was run in this turn
- A real release candidate pass should still cover:
  - movie playback
  - series playback
  - animation playback
  - anime playback
  - direct download
  - HLS download
  - offline playback
  - offline subtitles
  - in-app Windows update apply

## macOS validation summary

### Structurally validated from code and packaging

- Universal mac build path exists in GitHub Actions
- mac tool/runtime packaging is explicitly wired
- DMG packaging includes the helper `.app`
- updater manifest includes a mac asset
- runtime updater branch opens the DMG on macOS

### Still requires real macOS smoke testing

- Launching the DMG and running `NOVA STREAM Installer.app`
- Verifying the helper copies the app to `/Applications`
- Verifying quarantine clearing on the installed app
- Movie playback
- Series playback
- Animation playback
- In-app updater DMG handoff
- If desired for this release:
  - direct downloads
  - HLS downloads
  - offline playback
  - offline subtitles

## Recommended release sign-off matrix

### Windows

- `PASS`: `cargo check`
- `PASS`: `npm run build`
- `PASS`: updater manifest still includes Windows asset
- `PENDING MANUAL`: playback smoke tests
- `PENDING MANUAL`: download and offline smoke tests
- `PENDING MANUAL`: in-app updater apply smoke test

### macOS

- `PASS`: release workflow is configured for universal app + DMG
- `PASS`: manifest includes `darwin-universal`
- `PASS`: updater opens downloaded DMG on macOS
- `PASS`: DMG stages `NOVA STREAM Installer.app`
- `PENDING MANUAL`: DMG install helper smoke test
- `PENDING MANUAL`: playback smoke tests
- `PENDING MANUAL`: updater handoff smoke test
- `PENDING MANUAL`: mac download/offline smoke tests if included in release scope

## Conclusion

- The mac uplift is materially closer to the Windows experience than before:
  - native mac tool packaging exists
  - embedded mac Node packaging exists
  - DMG install UX is friendlier
  - in-app mac update handoff exists
- Windows core behavior remains the baseline and was preserved by platform-specific branching rather than shared rewrites.
- The remaining gap for Phase 7 is not code structure; it is real-device macOS smoke validation before release sign-off.
