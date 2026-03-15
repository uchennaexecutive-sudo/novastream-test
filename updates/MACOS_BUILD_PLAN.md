# macOS Build Plan

## Intent
Add macOS build and distribution support to NOVA STREAM so Mac users can install and run the desktop app with the same core experience currently available on Windows.

This plan focuses on:
- producing `.app` / `.dmg` macOS builds
- setting up code signing
- notarizing releases for normal macOS installation
- extending the updater flow later for macOS

## Goal
Make NOVA STREAM buildable and distributable for macOS without changing the current working Windows and anime/movie streaming architecture.

Required product goals:
- successful macOS CI build
- Apple Silicon and Intel support when practical
- signed app bundles
- notarized app for smooth installation
- updater support later once the base release path works

## Non-Negotiables
- Do not disturb the currently working Windows release flow.
- Do not mix macOS signing setup into unrelated feature work.
- Treat macOS support as a distribution/build task, not a frontend rewrite.

## Core Reality
You cannot do full macOS distribution correctly from a Windows-only environment.

For production-ready macOS builds, you need:
- a macOS build environment
- Apple signing credentials
- notarization credentials

The practical path is:
- use GitHub Actions `macos-latest`
- configure Apple signing and notarization secrets

## Required Prerequisites

### 1. Apple Developer Account
Needed for:
- `Developer ID Application` signing certificate
- notarization

Without a paid Apple Developer account:
- you may still do limited local testing
- you will not have proper outside-App-Store notarized distribution

### 2. macOS Build Environment
Use one of:
- local Mac machine
- GitHub Actions `macos-latest`

Recommended:
- GitHub Actions for repeatable builds

### 3. Xcode Command Line Tools
Required on macOS build environments for Tauri macOS builds.

### 4. Signing Assets
You will eventually need:
- signing certificate exported as `.p12`
- certificate password
- Apple ID / App Store Connect credentials for notarization

## Distribution Strategy

### Phase 1: Unsigned Internal Test Build
Objective:
- confirm NOVA STREAM compiles on macOS
- produce a `.app` or `.dmg` for local/internal testing

This phase does not require:
- notarization
- release-grade updater support

### Phase 2: Signed Build
Objective:
- sign the macOS app bundle with `Developer ID Application`

This reduces trust issues but is not enough alone for ideal distribution.

### Phase 3: Notarized Build
Objective:
- notarize the signed app with Apple
- staple notarization ticket where applicable

This is the proper public-distribution path.

### Phase 4: macOS Updater Support
Objective:
- extend the existing updater release pipeline so macOS artifacts are published and referenced in `latest.json`
- make the app able to update itself on macOS just like Windows

## Architecture Notes

### Frontend
No major frontend rewrite should be required just to support macOS.

Potential macOS-specific UI issues to verify later:
- window chrome behavior
- fullscreen behavior
- keyboard shortcuts using `Meta` vs `Ctrl`
- file path / storage locations for downloads or offline content

### Tauri
Tauri already supports macOS targets:
- `aarch64-apple-darwin` (Apple Silicon)
- `x86_64-apple-darwin` (Intel)

### Updater
The existing updater currently points to Windows artifacts.
macOS support later will require:
- publishing macOS artifacts in GitHub Releases
- adding macOS platforms to `updates/latest.json`
- verifying Tauri updater config accepts them

## Implementation Strategy

### Phase 1: Audit Current Config
Review:
- `src-tauri/tauri.conf.json`
- release workflow in `.github/workflows`
- updater pipeline
- bundle target settings

Check for Windows-only assumptions:
- platform-specific paths
- updater platform map
- sidecar compatibility if future features use them

### Phase 2: Add macOS CI Build
Create or update GitHub Actions to:
- build on `macos-latest`
- install Rust target(s):
  - `aarch64-apple-darwin`
  - optionally `x86_64-apple-darwin`
- run Tauri build

Initial goal:
- produce unsigned test artifact

### Phase 3: Configure Signing
Add GitHub secrets for:
- Apple certificate `.p12`
- certificate password
- Apple developer identifiers

Update workflow to:
- import cert into temporary keychain
- sign the app during Tauri build

### Phase 4: Configure Notarization
Add secrets for notarization:
- Apple ID or App Store Connect API credentials
- team ID
- app-specific password if using Apple ID flow

Update workflow to:
- submit app for notarization
- wait for result
- staple notarization ticket

### Phase 5: Release Artifacts
Publish:
- `.app`
- `.dmg`
- or whichever macOS artifact format is selected

Recommended public format:
- `.dmg`

### Phase 6: Updater Integration
Extend release metadata generation to include:
- macOS ARM
- macOS Intel if both are built

Update `latest.json` generation so Tauri updater can resolve:
- `darwin-aarch64`
- `darwin-x86_64`

## File-Level Implementation Outline

### Likely Existing Files To Update
- `.github/workflows/*`
  - add macOS build job
  - add signing and notarization steps

- `src-tauri/tauri.conf.json`
  - confirm bundle targets
  - confirm updater compatibility

- `release.ps1`
  - may need updates only if it assumes Windows-only assets or release metadata

- `updates/latest.json`
  - generated output should eventually include macOS platforms

### Possible New Files
- workflow helper scripts for:
  - certificate import
  - notarization
  - artifact packaging

## Recommended Build Targets

### Minimum
- `aarch64-apple-darwin`

Reason:
- most current Mac users are on Apple Silicon

### Better Coverage
- `aarch64-apple-darwin`
- `x86_64-apple-darwin`

If build/release complexity grows too much, start with Apple Silicon only and expand later.

## Storage / Runtime Considerations
For future offline downloads and local caches:
- use Tauri app data directories instead of Windows-specific assumptions
- verify local file handling on macOS paths

For keyboard shortcuts:
- review whether some controls should display `⌘`/`Command` equivalents in UI later

## Risks
- Apple signing and notarization setup can be tedious
- GitHub Actions macOS builds are slower than Windows builds
- notarization failures can block release until credentials and bundle metadata are correct
- dual-arch support adds more CI complexity

## Best MVP Recommendation
Ship macOS support in this order:
1. unsigned CI test build
2. signed Apple Silicon build
3. notarized Apple Silicon build
4. optional Intel build
5. updater support

This keeps the rollout practical and reduces risk.

## What Will Be Needed From You Later
When implementation begins, you will likely need to provide:
- Apple Developer account access
- signing certificate export
- certificate password
- Apple team ID
- notarization credentials

## Resume Note
When work resumes, start with:
- CI audit
- unsigned macOS test build

Do not begin with updater support before a signed/notarized app can be built successfully.
