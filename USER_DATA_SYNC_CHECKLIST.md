# USER_DATA_SYNC_CHECKLIST

Purpose: restore and harden NOVA STREAM's signed-in user data features so they work reliably across sessions and devices.

This checklist covers:
- watchlist carryover
- watch history carryover and live updates
- profile stats
- downloads library hydration after logout/login/restart
- resume / continue watching

This is a recovery + hardening pass, not a redesign.

## Product Goal

When a user signs in:
- their full watchlist should appear
- their watch history should appear and keep updating
- their profile stats should reflect real watched data
- their downloads library should repopulate from the existing download folder/store state
- resume should continue to work from where they stopped

When a user signs out and signs back in:
- cloud-backed data should rehydrate cleanly
- local-only downloaded files should still appear in Library
- no stale or empty pages should remain just because sync finished after the page mounted

## Critical Guardrails

- Do not break existing streaming, downloads, offline playback, or subtitles.
- Do not regress the current Windows/mac update flows.
- Do not redesign the watchlist/history/profile/downloads pages.
- Preserve guest/local behavior where appropriate:
  - guests may still use local watchlist/history/progress
  - signed-in users should get merged cloud + local behavior
- Treat this as correctness and hydration work first, polish second.

## Current Broken Symptoms

1. Watchlist does not fully carry over after sign-in.
2. History can appear empty after sign-in.
3. History appears to have stopped updating in some playback paths.
4. Profile stats (`Titles watched`, `Watch time`) do not reflect real data and do not carry over.
5. Downloads storage shows real disk usage, but Library can appear empty after logout/login/restart.
6. Resume / continue watching no longer works reliably.

## Confirmed / Likely Root Causes

### 1. Watchlist page is local-only on mount

File:
- `src/pages/Watchlist.jsx`

Current problem:
- page loads once via `getWatchlist()` and sets local component state
- `getWatchlist()` in `src/lib/supabase.js` currently only reads `localStorage`
- `syncFromCloud()` runs later after auth init, but the page does not re-fetch when sync completes

Effect:
- page can show a stale or partial local watchlist even after cloud sync succeeds

### 2. History page has the same stale-load pattern

File:
- `src/pages/History.jsx`

Current problem:
- page loads once via `getHistory()` + `getAllProgressRows()`
- it never refreshes after cloud sync completes

Effect:
- history can remain empty/stale until remount or manual restart

### 3. Profile stats are sourced from localStorage only

File:
- `src/pages/Profile.jsx`

Current problem:
- stats are derived only from `localStorage.getItem('nova-history')`
- no cloud fetch
- no reactive refresh after sync

Effect:
- titles watched and watch time are wrong after sign-in and often remain `0`

### 4. Native players save progress, but history writes still live in older playback paths

Files:
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src/components/Player/PlayerModal.jsx`
- `src/pages/IframePlayerWindow.jsx`

Current problem:
- current/native players call `saveProgress(...)`
- `addToHistory(...)` is still only visible in the older iframe/modal paths

Effect:
- newer playback paths can update progress without updating watch history
- this explains history “stopped updating / stopped adding newly watched titles”

### 5. Downloads Library is store-driven, not disk-driven

Files:
- `src/pages/Downloads.jsx`
- `src/store/useDownloadStore.js`
- `src/main.jsx`
- `src/lib/videoDownloads.js`

Current problem:
- Library UI is built from persisted Zustand `items`
- storage card reads real disk usage from backend
- there is no full “scan existing downloaded files and rebuild missing completed items” hydration path

Effect:
- storage can show used bytes while Library is empty
- logout/login/restart can leave completed files on disk but no completed entries in the store

### 6. Resume depends on watch_progress, and schema drift may exist

Files:
- `src/lib/progress.js`
- `src/lib/supabase.js`
- `src/pages/Detail.jsx`

Current problem:
- frontend expects `watch_progress.user_id`
- older SQL screenshots show earlier `device_id`-based versions also existed
- if production schema is stale or partially migrated, cloud progress fetch/save can fail or return nothing

Effect:
- resume / continue watching can silently stop working cross-device
- even local/cloud merge logic can become unreliable

## Relevant Files To Read Before Fixing

Core sync/auth:
- `CLAUDE.md`
- `src/lib/supabase.js`
- `src/lib/progress.js`
- `src/lib/supabaseClient.js`
- `src/store/useAuthStore.js`
- `src/store/useAppStore.js`

Pages:
- `src/pages/Watchlist.jsx`
- `src/pages/History.jsx`
- `src/pages/Profile.jsx`
- `src/pages/Downloads.jsx`
- `src/pages/Detail.jsx`

Playback:
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src/components/Player/PlayerModal.jsx`
- `src/pages/IframePlayerWindow.jsx`
- `src/components/Cards/ContinueCard.jsx`

Downloads:
- `src/store/useDownloadStore.js`
- `src/main.jsx`
- `src/lib/videoDownloads.js`
- `src-tauri/src/main.rs`

## Recommended Fix Strategy

## Phase A - Schema and sync audit

Goal:
- confirm the production data contract and remove ambiguity

Tasks:
- verify the actual production Supabase schema for:
  - `profiles`
  - `watchlist`
  - `watch_history`
  - `watch_progress`
- confirm `watch_progress` uses:
  - `user_id`
  - `content_id`
  - `season`
  - `episode`
  - unique constraint on `user_id, content_id, season, episode`
- confirm RLS/policies allow signed-in users to read/write their own rows
- identify any stale code assumptions left over from the older `device_id` schema

Deliverable:
- one authoritative schema target for all sync logic

Notes:
- if production is still stale, create a migration/fix script before changing app logic further

## Phase B - Make watchlist/history data retrieval reactive and merged

Goal:
- pages should show correct data after sign-in without needing manual remounts or restarts

Fixes:
- stop treating `getWatchlist()` and `getHistory()` as local-only helpers
- make them return merged local + cloud state for signed-in users
- or expose a sync-ready signal / auth-ready refresh path so pages re-fetch once cloud sync completes
- make `Watchlist.jsx` and `History.jsx` refresh on auth/session changes and after cloud sync hydration

Recommended implementation:
- centralize merged data reads in `src/lib/supabase.js`
- have `syncFromCloud()` return usable merged results or expose a completion event/signal
- pages should reload when:
  - auth session becomes available
  - sync finishes
  - local data mutates through add/remove actions

Deliverable:
- watchlist and history pages always reflect the latest merged state

## Phase C - Restore history writes from current/native playback paths

Goal:
- any real playback path should update history, not just legacy iframe/modal paths

Fixes:
- add a clean history write path to current/native players
- ensure history is written when meaningful playback has happened
- keep progress + history writes aligned so history and resume reflect the same session

Recommended implementation:
- decide a shared policy for history writes:
  - on close
  - after meaningful playback threshold
  - on playback snapshot updates if needed
- reuse a single helper so MoviePlayer / AnimePlayer / SharedNativePlayer behave consistently
- keep older iframe/modal paths working, but do not rely on them as the only writers

Deliverable:
- history starts updating again for currently used playback flows

## Phase D - Restore profile stats from real merged data

Goal:
- profile stats should be real and portable

Fixes:
- stop reading stats from localStorage history only
- derive stats from merged cloud + local data

Recommended stat model:
- `Titles watched`:
  - count distinct watched titles from history or progress-derived watch history
- `Watch time`:
  - sum meaningful watch progress / watched seconds from merged data
- optionally keep a safe fallback to local-only for guests

Deliverable:
- profile stats are accurate after sign-in and across devices

## Phase E - Rebuild Downloads Library from real existing files/store state

Goal:
- library should reflect actual completed downloads even after logout/login/restart

Fixes:
- add a hydration path that scans the downloads directories and reconciles missing completed entries into the store
- use the current download store as the primary UI source, but rebuild it when files exist on disk and entries are missing

Recommended implementation:
- add a backend command in Tauri to scan the download root and return discovered library items
- supported roots:
  - movies
  - series
  - anime
  - animation
- merge discovered items into `useDownloadStore`
- preserve richer existing metadata when available
- backfill minimal metadata when only the file/folder structure exists

Important:
- storage usage and library entries should come from the same reality
- if storage says files exist, Library should not remain empty

Deliverable:
- completed downloads repopulate cleanly after auth/session/store resets

## Phase F - Restore resume / continue watching fully

Goal:
- titles should start from where the user stopped

Fixes:
- ensure `watch_progress` saves are succeeding against the real schema
- ensure `Detail.jsx` resume loading logic receives valid rows again
- ensure continue watching uses merged rows correctly
- ensure current player close/snapshot behavior persists progress reliably

Recommended implementation:
- make `progress.js` the single source of truth for save/load/merge
- harden save failures with better logging
- if production schema drift exists, migrate and remove old assumptions
- validate movie, series, anime, and offline playback resume paths

Deliverable:
- resume button, continue watching, and detail-page resume all work again

## Phase G - Validation and hardening

Goal:
- ensure all user-data features work together cleanly

Validation checklist:
- sign in and verify full watchlist appears
- add/remove watchlist item and confirm:
  - UI updates immediately
  - cloud data persists
- play new content in the current player path and confirm:
  - history updates
  - progress saves
  - continue watching updates
- sign out and sign back in:
  - watchlist returns
  - history returns
  - profile stats return
- verify downloads library repopulates from existing files
- verify resume works for:
  - movie
  - series episode
  - anime episode
  - offline playback

Deliverable:
- release-ready synced user data behavior

## Best Implementation Order

1. Phase A - schema and sync audit
2. Phase B - reactive merged watchlist/history reads
3. Phase C - restore history writes from current players
4. Phase D - restore profile stats from real merged data
5. Phase E - downloads library hydration from disk/store state
6. Phase F - resume / continue watching hardening
7. Phase G - validation and hardening

## Recommended MVP Recovery Cut

If this must be stabilized quickly, the minimum high-impact set is:
- fix watchlist refresh after cloud sync
- fix history refresh after cloud sync
- restore history writes in native players
- fix profile stats source
- add download library hydration
- verify/fix `watch_progress` schema compatibility

## Acceptance Criteria

- Signed-in watchlist fully carries over and stays current.
- History is visible after sign-in and continues updating during real playback.
- Profile stats are non-zero when data exists and are consistent across devices.
- Downloads Library repopulates from existing files after logout/login/restart.
- Resume works again from Detail and Continue Watching.
- Guest/local behavior still works without breaking signed-in cloud sync.

## Known Risks

- Supabase production schema may not match the latest app assumptions.
- Some stale localStorage data may need careful migration/merge logic.
- Download library hydration may require filename/folder heuristics for older items.

