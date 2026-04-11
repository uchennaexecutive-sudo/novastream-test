# Watch Party Phase B Architecture Map

Purpose: map the current auth, profile, player, and runtime architecture after the Phase A frontend shell landed, so later Watch Party backend work attaches to the right surfaces without regressing existing playback, downloads, offline behavior, subtitles, casting, or updater flows.

This document is an audit only. It does not implement room logic yet.

## Validation context

- Workspace: `C:\Users\uchen\nova-stream-dev-test`
- Audit date: 2026-04-11
- Scope reviewed:
  - `CLAUDE.md`
  - `WATCHPARTY_CHECKLIST.md`
  - `src-tauri/src/main.rs`
  - `src/main.jsx`
  - `src/App.jsx`
  - `src/pages/Auth.jsx`
  - `src/pages/Profile.jsx`
  - `src/pages/WatchParty.jsx`
  - `src/components/Layout/Sidebar.jsx`
  - `src/components/Player/MoviePlayer.jsx`
  - `src/components/Player/AnimePlayer.jsx`
  - `src/components/Player/SharedNativePlayer.jsx`
  - `src/lib/supabase.js`
  - `src/lib/supabaseClient.js`
  - `src/lib/progress.js`
  - `src/store/useAuthStore.js`
  - `src/store/useWatchPartyStore.js`
  - `src/store/useCastStore.js`

## Phase A shell that now exists

The frontend foundation requested in Phase A is present locally:

- Watch Party route is registered in `src/App.jsx`
- Watch Party sidebar entry is present in `src/components/Layout/Sidebar.jsx`
- The page shell lives in `src/pages/WatchParty.jsx`
- The placeholder room store lives in `src/store/useWatchPartyStore.js`

Current frontend screen states:

- signed-out gate
- idle landing
- creating
- joining
- lobby
- live
- ended

Current placeholder store contract:

- `status`
- `roomCode`
- `isHost`
- `isMuted`
- `participants`
- stub actions for `createRoom`, `joinRoom`, `startBroadcast`, `endRoom`, `leaveRoom`, `toggleMute`

Important implication:

- later backend phases should replace the stub actions in `useWatchPartyStore` rather than invent a second room state system beside it
- the page already expects participant objects shaped like:
  - `id`
  - `name`
  - `avatarStyle`
  - `avatarSeed`
  - `isSpeaking`
  - `isMuted`
  - `isHost`

## Current architecture summary

- Signed-in identity already has a clean source of truth:
  - `useAuthStore`
  - Supabase auth session
  - `profiles` table
- Avatar identity is already normalized enough for room UI:
  - username from `profile.username`
  - avatar style/seed from profile fields
  - DiceBear rendering already exists and is reused by the Watch Party shell
- Current playback architecture already supports the two Watch Party source classes the checklist requires:
  - streamed content
  - offline/downloaded content
- Current playback source resolution is app-managed and transport-heavy:
  - movie-like content resolves through Rust plus the Nuvio sidecar
  - anime provider selection stays provider-scoped in JS but transport still relies on Rust
  - offline files are reopened through Rust-managed playback paths

Important implication:

- Watch Party should reuse current identity and source-selection architecture
- guest playback should never require guests to resolve their own provider streams
- host broadcast wiring must attach to the existing player/runtime path, not bypass it

## What the code does today

### 1. Auth gating and identity

Primary files:

- `src/store/useAuthStore.js`
- `src/pages/Auth.jsx`
- `src/pages/Profile.jsx`
- `src/components/Layout/Sidebar.jsx`
- `src/pages/WatchParty.jsx`

Observed behavior:

- app boot calls `useAuthStore.init()` in `src/App.jsx`
- auth session and profile live in Zustand
- auth modal opening already works globally via `authModalOpen` and `setAuthModalOpen`
- signed-out users already get routed to the auth overlay from multiple surfaces without a dedicated auth route
- Watch Party already uses this pattern in its signed-out gate

Important implication:

- Phase C should enforce signed-in-only create/join by reusing `useAuthStore.user` and `setAuthModalOpen`
- no new auth mechanism is needed for Watch Party
- participant identity should come from the current profile model, not a separate nickname/avatar system

### 2. Supabase profile and cross-device patterns

Primary files:

- `src/lib/supabaseClient.js`
- `src/lib/supabase.js`
- `src/lib/progress.js`
- `src/store/useAuthStore.js`

Observed behavior:

- the repo already uses Supabase for:
  - auth
  - profiles
  - watchlist
  - watch history
  - watch progress
- current sync behavior is write-through when signed in and local-only for guests
- user identity available to app logic is the Supabase user id
- profile fields already provide the data the Watch Party UI wants:
  - display name
  - avatar style
  - avatar seed

Important implication:

- Supabase is the right canonical home for room metadata and participant membership
- Watch Party should follow the same signed-in-user model as current cloud sync features
- room code validation and room membership should be tied to Supabase user identity, not anonymous device IDs

### 3. Movie, series, and animation playback path

Primary files:

- `src/pages/Detail.jsx`
- `src/components/Player/MoviePlayer.jsx`
- `src-tauri/src/main.rs`

Observed behavior:

- `Detail.jsx` is the main entry point into movie-like playback
- `MoviePlayer.jsx` receives enough context to reopen both:
  - streamed content
  - offline content via `offlinePlayback`
- movie-like stream resolution is Rust-driven through `fetch_movie_resolver_streams`
- transport uses Rust-managed HLS fetches or managed media proxy URLs

Important implication:

- host-broadcast source wiring for movie-like titles should attach at the player/runtime layer, not at the Watch Party page alone
- the active movie player already knows the resolved playable source and is the clean place to expose "this title is broadcastable now"

### 4. Anime playback path

Primary files:

- `src/pages/Detail.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src-tauri/src/main.rs`

Observed behavior:

- `AnimePlayer.jsx` handles provider selection and episode resolution
- `SharedNativePlayer.jsx` handles the actual playback surface for anime
- anime transport still depends on Rust for:
  - session-aware HLS fetches
  - manifest fetches
  - segment fetches
  - managed direct stream/file playback
- offline anime also reuses this path

Important implication:

- Watch Party must preserve anime provider ordering and current transport behavior
- if anime hosting is supported later, it should still originate from the host's already-working playback path
- guests should receive the host broadcast, not direct anime provider URLs

### 5. Offline playback path

Primary files:

- `src/pages/Detail.jsx`
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src-tauri/src/main.rs`

Observed behavior:

- downloads route back into `Detail.jsx` with `offlinePlayback`
- both movie-like and anime players accept offline playback context
- local files are still served through Rust-managed paths
- subtitle sidecars are resolved separately and must remain intact

Important implication:

- offline-hosted Watch Party sessions are technically compatible with the current architecture because the host playback path already exists
- Watch Party work must not alter the existing offline path just to add broadcasting

### 6. Current Watch Party frontend contract gaps

Primary files:

- `src/pages/WatchParty.jsx`
- `src/store/useWatchPartyStore.js`

Observed behavior:

- Phase A intentionally stops at placeholders
- there is not yet any room model beyond `roomCode` and `isHost`
- there is not yet any field for:
  - room id
  - backend room state
  - selected media source
  - broadcast state
  - join/create loading state
  - join/create failure state
  - ended reason
  - LiveKit connection state

Important implication:

- later backend phases should extend `useWatchPartyStore` instead of replacing it
- the current UI is clean enough to support that extension without redesigning the page

## Clean insertion points for later phases

### 1. Replace the placeholder actions in `useWatchPartyStore`

Best insertion point:

- `src/store/useWatchPartyStore.js`

Why:

- the page already consumes the store directly
- replacing stub actions here keeps the existing frontend shell intact
- room lifecycle, participant state, speaking state, and mute state all belong in one room store

Recommended direction:

- keep `status` as the page-view state
- add separate backend-facing fields for:
  - `roomId`
  - `roomState`
  - `roomRole`
  - `selectedSource`
  - `broadcastState`
  - `connectionState`
  - `error`

### 2. Add a Watch Party service layer instead of putting network logic in the page

Best insertion point:

- new frontend service files, for example under `src/lib/watchParty/`

Why:

- `src/pages/WatchParty.jsx` is already a UI composition file
- backend calls, room joins, token handling, and event subscriptions should not live inside the page component
- this keeps the eventual LiveKit and Supabase wiring testable and replaceable

Recommended direction:

- isolate:
  - room create/join/leave/end functions
  - room subscription helpers
  - participant mapping helpers
  - LiveKit connection helpers

### 3. Use a secure server-side layer for room creation, validation, and LiveKit tokens

Best insertion point:

- Supabase Edge Functions or another authenticated backend service

Why:

- the repo currently only exposes the Supabase anon client to the app
- LiveKit server secrets must not be embedded in:
  - frontend code
  - Tauri bundle assets
  - Rust client binaries
- room code validation and membership checks are security-sensitive enough to avoid client-only enforcement

Recommended direction:

- create authenticated server-side operations for:
  - create room
  - join room
  - leave room
  - end room
  - mint LiveKit join token

Important implication:

- Phase C should not mint LiveKit tokens in client code
- if Tauri/Rust participates later, it should still not hold the LiveKit secret as a client-distributed secret

### 4. Keep room metadata canonical in Supabase, and realtime speaking/media state canonical in LiveKit

Best insertion point:

- Supabase for persistent room state
- LiveKit for transient media presence state

Why:

- room lifecycle needs persistence:
  - room code
  - host
  - participants
  - lobby/live/ended
- active speaker and mic/media transport are realtime and already fit LiveKit's model better

Recommended split:

- Supabase should own:
  - room existence
  - room code uniqueness
  - host identity
  - participant membership
  - room lifecycle state
- LiveKit should own:
  - mic publishing
  - host media publishing
  - active speaker state
  - participant connection state

### 5. Attach host-broadcast source wiring to the existing player/runtime surfaces

Best insertion points:

- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`

Why:

- those surfaces know the actual playable source that succeeded
- they already know whether the source is:
  - online
  - offline
  - HLS
  - direct media
  - session/header-sensitive
- those surfaces are where the real HTML video element exists today

Recommended direction:

- define a small host-source contract that the active player can register into the Watch Party store
- likely fields:
  - `sourceKind`
  - `contentType`
  - `contentId`
  - `title`
  - `poster`
  - `backdrop`
  - `streamType`
  - `isOffline`
  - `playableContext`
  - `videoElement` or player-capture handle

Important implication:

- this is the cleanest path to supporting both streamed and offline hosting
- it avoids re-resolving provider streams just for Watch Party

Inference from the current code:

- the most promising host-broadcast path is to publish from the host's active playback surface
- if desktop WebView capture proves unreliable, a dedicated hidden broadcaster player may be needed later, but that would duplicate more transport logic and should be treated as fallback, not the first design

### 6. Keep guest viewing isolated from existing detail-page playback flows

Best insertion point:

- the `live` in-room broadcast area inside `src/pages/WatchParty.jsx`

Why:

- guests are not supposed to resolve providers or open detail modals
- guest playback is a room media consumer, not the existing title playback flow

Recommended direction:

- Phase E should render the host's published media inside the Watch Party room UI
- guest viewing should be its own viewer surface, even if host source selection still reuses existing player/runtime logic

## Suggested backend contracts to match the current shell

### Room code model

The current join UI already assumes:

- 6 characters
- uppercase
- alphanumeric

Recommended rule:

- keep that exact format in backend validation so Phase A UI does not need to change

### Room metadata model

Recommended minimum shape:

- `id`
- `code`
- `host_user_id`
- `status` with:
  - `lobby`
  - `live`
  - `ended`
- `created_at`
- `ended_at`

### Participant model for the frontend store

Recommended mapped shape:

- `id`
- `userId`
- `name`
- `avatarStyle`
- `avatarSeed`
- `isHost`
- `isMuted`
- `isSpeaking`
- `joinedAt`

### Store/view state separation

Recommended distinction:

- keep current store `status` for frontend screen state:
  - `idle`
  - `creating`
  - `joining`
  - `lobby`
  - `live`
  - `ended`
- keep backend room `status` separately as room lifecycle data:
  - `lobby`
  - `live`
  - `ended`

This avoids coupling UI transitions too tightly to backend records.

## Phase C starting point

The first real backend phase after this audit should be small and focused:

- replace `createRoom` and `joinRoom` stubs in `useWatchPartyStore`
- enforce signed-in create/join in store actions as well as page UI
- define the room code rule as the current 6-character uppercase contract
- create the canonical room metadata model
- map Supabase user/profile identity into the existing participant shape

## Key risks and preservation rules

### 1. Do not put LiveKit secrets in the shipped app

- frontend and Tauri are both distributed clients
- token minting must be server-side

### 2. Do not bypass the existing playback stack for host source selection

- movie-like playback already depends on Rust validation and proxying
- anime already depends on provider-scoped JS plus Rust transport
- offline playback already depends on current managed file handling

### 3. Do not make guests resolve content providers

- the chosen product model is host-broadcast
- guest devices should only join the room and receive the host media stream

### 4. Do not let Watch Party mutate existing player behavior just to make broadcasting easier

- streaming, downloads, offline playback, subtitles, updater behavior, and current Windows/mac flows are already working paths that should remain additive

### 5. Host media capture is the main technical risk

- the biggest uncertainty is reliable host broadcast capture in desktop WebView environments
- this should be validated against the actual active player surface before deeper Phase E work lands

## Audit conclusion

- The repo is ready to start Phase C because the frontend shell exists and the backend insertion points are clear.
- Auth and participant identity should reuse the current Supabase plus `useAuthStore` path.
- Room metadata should live in Supabase.
- LiveKit token minting should be handled by a secure server-side layer, not the client app.
- Host source plumbing should attach to the existing player/runtime surfaces so streamed and offline sources stay additive.
- Guest viewing should stay inside the Watch Party room UI and should not reuse the normal provider-resolution playback flow.
