# API Cleanup And Adoption Plan

## Status Update

Current implementation status:

- Phase 1 completed:
  - Gogoanime localhost bridge removed from Rust
  - Gogoanime search/detail/server discovery is self-contained in-project
- Phase 2A through Phase 2C completed:
  - Nuvio contract frozen in Rust
  - Nuvio vendored into `vendor/nuvio-streams-addon`
  - Nuvio runs as an app-managed local sidecar on `127.0.0.1:7779`
- Current remaining work is stabilization and pruning:
  - improve provider quality handling
  - document the local-sidecar architecture clearly
  - optionally simplify the vendored addon later

## Scope

This plan covers two follow-up tracks:

1. Gogoanime Rust cleanup now that anime search/detail/server discovery is self-contained inside the app.
2. NuvioStreams adoption planning for movies / series / animation, starting from the former hosted-addon integration and ending in the current local sidecar runtime.

This is a plan only. No implementation is included in this document.

---

## Current State

### Gogoanime

What is already true:

- The active Gogo provider path no longer depends on the localhost API for:
  - search
  - anime detail / episode list
  - episode server discovery
- Those three responsibilities now live in:
  - `src/lib/animeAddons/providers/gogoanimeScraper.js`
  - `src/lib/animeAddons/providers/gogoanime.js`
- Final source extraction and playback remain in the existing working path:
  - `gogoanime.js`
  - `SharedNativePlayer.jsx`
  - `src-tauri/src/main.rs`

What is still stale:

- `src-tauri/src/main.rs` still contains:
  - `gogoanime_search`
  - `gogoanime_get_anime`
  - `gogoanime_get_streaming_links`
- `src-tauri/capabilities/default.json` still grants permissions for those commands.
- The generated ACL schema still references those permissions.

### Nuvio

What is already true:

- Movies / series / animation currently work through Rust.
- Rust now starts and manages a local Nuvio sidecar from:
  - `vendor/nuvio-streams-addon`
- Current base URL:
  - `NUVIO_SIDECAR_BASE_URL = "http://127.0.0.1:7779"`
- Rust currently uses these sidecar routes:
  - `/stream/movie/{imdb}.json`
  - `/stream/series/{imdb}:{season}:{episode}.json`
  - `/manifest.json` for health checks
- Rust normalizes returned Stremio-style `streams` via `normalize_nuvio_streams`.
- Rust uses staged fetch + validation:
  - primary provider pass
  - fast provider pass
  - full fallback pass

What the vendored Nuvio repo actually is:

- It is not a small API wrapper.
- It is a full Node/Express Stremio addon with:
  - multiple providers
  - cookies
  - proxy configuration
  - cache logic
  - optional external provider services
  - Puppeteer in dependencies

That means Nuvio absorption is already underway, but deeper pruning and provider simplification remain larger work than the Gogo absorption work.

---

## Phase 1: Gogo Rust Cleanup

### Goal

Remove the dead Rust localhost bridge for Gogoanime without touching the working anime playback path.

### Files In Scope

- `src-tauri/src/main.rs`
- `src-tauri/capabilities/default.json`
- generated ACL outputs if they are committed
- optional docs that still mention the old bridge

### Changes

1. Remove the obsolete commands from `main.rs`
   - delete `gogoanime_search`
   - delete `gogoanime_get_anime`
   - delete `gogoanime_get_streaming_links`

2. Remove the commands from the Tauri invoke handler
   - remove all three from `invoke_handler`

3. Remove their capability entries
   - delete:
     - `allow-gogoanime-search`
     - `allow-gogoanime-get-anime`
     - `allow-gogoanime-get-streaming-links`
   - update generated ACL schema if needed

4. Verify there are no remaining call sites
   - grep for those command names across the repo
   - ensure `gogoanime.js` only uses the in-project scraper

5. Runtime validation
   - launch app with no local anime API running
   - verify:
     - Gogo search still works
     - Gogo episodes still load
     - Gogo playback still works
     - subtitles still work on the supported path

### Risk

- Low, if cleanup is limited to dead command removal and permission cleanup.
- Do not touch:
  - `fetch_anime_text`
  - `fetch_anime_text_with_session`
  - `resolve_embed_stream`
  - HLS fetch / segment transport

### Success Criteria

- No remaining localhost Gogo bridge in Rust.
- Anime works with the local API fully stopped.

---

## Phase 2: Nuvio Adoption Strategy

## Recommendation

Do not attempt a full direct rewrite of Nuvio into app-native JS/Rust as the first step.

Best path:

1. First absorb Nuvio as an app-managed internal sidecar.
2. Then prune and simplify it.
3. Only later port provider logic into the app incrementally.

This keeps Movies / Series / Animation stable while removing the permanent Vercel dependency.

---

## Phase 2A: Freeze The Current Nuvio Contract

### Goal

Document exactly what Nova Stream consumes from Nuvio today before changing architecture.

### Current Contract

Rust currently needs:

- movie endpoint:
  - `/stream/movie/{imdb}.json`
- series endpoint:
  - `/stream/series/{imdb}:{season}:{episode}.json`
- response:
  - JSON with `streams[]`
  - each stream may include:
    - `url`
    - `name`
    - `title`
    - `behaviorHints.headers`

### Work

1. Capture sample responses for:
   - one movie
   - one TV episode
   - one animation title

2. Confirm which parts of the response Rust actually uses:
   - direct playable URL
   - inferred stream type
   - headers
   - quality/provider labeling

3. Keep the contract stable during adoption.

### Why

This lets us change hosting/deployment first without forcing a resolver rewrite at the same time.

---

## Phase 2B: Vendor The Nuvio Addon Into This Repo

### Goal

Bring the current hosted addon code into the Nova Stream project tree so the app can own it.

### Recommended Layout

Example:

- `vendor/nuvio-streams-addon/`
or
- `internal/nuvio-streams-addon/`

### Work

1. Vendor the forked repo source into the app repo.
2. Preserve:
   - `server.js`
   - `addon.js`
   - provider modules
   - required views/assets
3. Add a thin local README describing:
   - source origin
   - branch / commit used
   - which routes Nova Stream actually depends on

### Why

This gives source control over the dependency before any integration rewrite.

---

## Phase 2C: Run Nuvio As An App-Managed Sidecar

### Goal

Make Nuvio self-contained inside the project without requiring Vercel and without requiring the user to run anything manually.

### Recommended Architecture

- Tauri launches the Node addon as a local sidecar process on app startup.
- Rust points `NUVIO_STREAMS_BASE_URL` to the sidecar local address.
- The app manages lifecycle:
  - start
  - health check
  - stop on app exit

### Why This Is The Best First Step

- It removes the external hosted dependency.
- It preserves the currently working movie/series flow.
- It avoids a dangerous full rewrite of a large multi-provider addon.

### Work

1. Choose sidecar launch strategy
   - likely via Tauri process/plugin process
   - prefer fixed local loopback port or app-discovered open port

2. Add sidecar health check
   - app waits until the local server is ready
   - resolver errors clearly if sidecar failed to start

3. Repoint Rust movie resolver
   - make `NUVIO_STREAMS_BASE_URL` configurable
   - switch from Vercel URL to local sidecar URL

4. Keep external contract unchanged
   - Rust still fetches `/stream/movie/...json`
   - Rust still fetches `/stream/series/...json`

### Risks

- Bundling Node runtime / process startup
- Vercel-specific assumptions in current addon
- dependency weight including Puppeteer

### Success Criteria

- Movies / Series / Animation work with Vercel disabled.
- User does not manually run anything.

---

## Phase 2D: Strip Nuvio Down To Nova-Only Runtime

### Goal

Reduce complexity after the sidecar works.

### Work

1. Remove routes Nova Stream does not use
   - manifest customization routes
   - Stremio configuration UI routes if unnecessary

2. Keep only what Nova Stream consumes
   - health endpoint
   - movie stream endpoint
   - series stream endpoint

3. Remove unused providers
   - keep only providers that currently produce value in Nova Stream

4. Reduce environment surface
   - remove unused config knobs
   - minimize proxy and personalization logic where possible

### Why

This shrinks maintenance cost before any deeper rewrite.

---

## Phase 2E: Optional Full Adoption, Provider By Provider

### Goal

Move away from the embedded Node addon over time, if desired.

### Recommended Rule

Do not port all Nuvio providers at once.

Instead:

1. Rank providers by actual usage and stability.
2. Port one provider family at a time into app-native JS/Rust.
3. Keep the sidecar as fallback until parity is proven.

### Suggested Priority

1. providers that return direct HLS/MP4 with simple headers
2. providers with static HTML extraction
3. providers needing heavier JS/runtime execution
4. providers depending on Puppeteer or unstable anti-bot flows

### Why

A full direct rewrite now would be a large, high-risk project with a real chance of breaking the currently working movie/series pipeline.

---

## Validation Plan

### After Gogo Cleanup

- Search anime with local API off
- Load anime detail with local API off
- Play supported Gogo episode with local API off

### After Nuvio Sidecar Adoption

- Play one movie
- Play one TV episode
- Play one animation title
- Verify:
  - stream URLs still resolve
  - HLS manifests still fetch
  - segments still fetch
  - subtitles still work where available
  - no user-visible startup requirement exists

### Regression Areas To Leave Untouched

- Gogo final media resolver path
- `SharedNativePlayer` UI / controls design
- Movie player visual UX
- existing Rust manifest/segment transport unless required by sidecar wiring

---

## Recommended Execution Order

1. Gogo Rust cleanup
2. Nuvio contract freeze
3. Vendor Nuvio into repo
4. App-managed Nuvio sidecar
5. Repoint Rust movie resolver to local sidecar
6. Runtime parity testing
7. Nuvio pruning and simplification
8. Optional provider-by-provider full port later

---

## Final Recommendation

For Gogo:

- clean up the dead Rust localhost bridge now

For Nuvio:

- do not jump straight to a full rewrite
- first absorb it as an internal sidecar managed by the app
- then simplify it
- only then consider deeper provider-level in-app ports

That path removes external dependency risk while preserving the currently stable Movies / Series / Animation experience.
