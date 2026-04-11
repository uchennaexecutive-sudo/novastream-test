# WATCHPARTY_CHECKLIST

Purpose: define the recommended architecture and phased implementation plan for Watch Party in NOVA STREAM.

This feature should be handled as its own roadmap, separate from Casting.

Frontend/UI for this feature will be handled by Claude Code.
Backend/runtime/wiring for this feature will be handled by Codex.

## Product Goal

Let signed-in NOVA STREAM users create or join a Watch Party room and watch together across devices.

Chosen model:
- **host-broadcast watch party**
- not simple sync-only playback

That means:
- one host creates the room
- the host plays either:
  - a streamed title
  - or a downloaded/offline title
- guests watch the host’s broadcasted playback stream
- voice chat runs alongside the watch session

This model is preferred because:
- only the host needs the content/provider/download to work
- guest-side provider mismatch problems are avoided
- offline downloaded titles can also be used as watch party sources

## Critical Guardrails

- Do not break existing Windows streaming/downloading/offline playback.
- Do not weaken the current anime provider architecture.
- Do not regress:
  - direct downloads
  - HLS downloads
  - offline playback
  - offline subtitles
  - updater behavior
- Treat Watch Party as additive.
- Reuse existing auth/profile infrastructure where possible.

## Current Repo Facts That Matter

- Existing auth/profile system already exists via Supabase.
- Existing profiles already include avatar identity options.
- Existing app architecture already supports cross-device signed-in user data.
- Existing player/runtime architecture can already handle both:
  - streamed playback
  - offline playback

Relevant files to read before implementation:
- `CLAUDE.md`
- `download_offline.md`
- `src-tauri/src/main.rs`
- `src/main.jsx`
- `src/App.jsx`
- `src/pages/Settings.jsx`
- `src/pages/Auth.jsx`
- `src/pages/Profile.jsx`
- `src/components/Layout/Sidebar.jsx`
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`
- `src/lib/supabase.js`
- `src/lib/supabaseClient.js`
- `src/store/useAuthStore.js`

## Product Rules

- Watch Party is for signed-in users only.
- Any user who is not logged in and tries to:
  - create a room
  - join a room
  should be prompted to sign in.
- Participant identity should use the existing account/profile system.
- Participant avatars should use the chosen account avatar/profile picture.
- There should be visible speaking indicators for active speakers:
  - pulse
  - glow
  - or another clear speaker indicator
- Basic voice controls should exist:
  - mute/unmute
  - leave room
  - host end room

## Cross-Platform Goal

Watch Party must work across devices and platforms:
- Windows users can host or join
- macOS users can host or join
- users on both platforms can be in the same room

## Recommended Architecture

### Core room model

- host creates room
- app generates room code
- guests join by room code
- host broadcasts the media stream
- guests receive the host’s stream
- voice chat exists in the same room

### Recommended transport stack

#### Media + voice + active speaker
- LiveKit OSS (self-hosted)

Why:
- open source
- designed for realtime media
- active speaker support already exists
- cross-platform
- avoids building raw WebRTC room orchestration from scratch

#### Auth / identity / room metadata
- Supabase

Why:
- already in the app
- already handles signed-in users and profiles
- already provides a clean identity layer for room ownership and participant identity

## Claude Code UI Scope

- add a dedicated Watch Party entry/page in the left sidebar
- build:
  - Start Watch Party UI
  - Join Watch Party UI
  - room code UI
  - room lobby UI
  - in-room participant UI
  - voice controls UI
  - active speaker visuals
  - host controls / guest controls
- signed-out prompt / auth gating UI

## Codex Backend Scope

- room creation/join backend logic
- room code generation and validation
- Supabase-backed room metadata / participant handling
- LiveKit integration
- token/join flow
- host-broadcast media transport wiring
- voice chat wiring
- active speaker state plumbing to frontend
- host/guest action wiring

## Phase Execution Rule

This roadmap is now intentionally frontloaded for UI.

Execution model:
- **Phase A is frontend-first and frontend-only**
- Claude Code should fully build the Watch Party UI foundation in Phase A before any backend integration begins
- backend/runtime/wiring should start in the following phases after the frontend structure is in place
- Claude Code may add safe placeholders, mock data hooks, and temporary UI-only states where needed so Codex can later replace them with real integrations

After Phase A:
- later phases may include both `Claude Code tasks` and `Codex tasks`
- but frontend work for each later phase should still land before Codex wires that phase to real backend logic

## Phases

## Phase A - Frontend foundation and Watch Party shell

Goal:
- establish the full Watch Party frontend foundation before backend work begins

Tasks:
- add the Watch Party page entry in the left sidebar
- build the Watch Party page shell
- build signed-in and signed-out entry states
- build Start Watch Party and Join Watch Party UI
- build room code entry UI
- build empty lobby shell
- build initial in-room participant layout shell
- build host/guest control placeholders
- build voice control placeholders
- build active-speaker placeholder visuals
- define the frontend component structure and props that later phases will wire into real data

Deliverable:
- complete frontend-first Watch Party UI foundation with placeholders where necessary

Claude Code tasks:
- inspect current sidebar, auth, profile, and player surfaces
- add Watch Party as its own page entry in the left sidebar
- build UI shells for:
  - Start Watch Party
  - Join Watch Party
  - room code entry
  - signed-out prompt
  - empty lobby
  - participant list shell
  - host controls shell
  - guest controls shell
  - voice controls shell
  - active speaker placeholder states
- use existing profile/avatar presentation patterns
- create clean component boundaries and props so later backend phases can wire into them cleanly
- use placeholders/mock state only where needed and keep them easy to replace

Codex tasks:
- none in this phase

## Phase B - Audit and backend architecture map

Goal:
- understand the current auth/profile/player/runtime paths after the frontend foundation exists

Tasks:
- trace current Supabase auth/profile flow
- trace current avatar/profile usage
- trace player/runtime paths for:
  - streamed playback
  - offline playback
- identify the cleanest insertion points for:
  - watch party creation/join
  - room lifecycle
  - host broadcast media source plumbing
- map those backend touchpoints to the frontend structure created in Phase A

Deliverable:
- short architecture note with touchpoints, integration points, and risks

Claude Code tasks:
- refine any Phase A component contracts if backend integration requires clearer boundaries

Codex tasks:
- inspect auth/profile/player/runtime architecture
- define backend insertion points for room logic and media transport
- align backend integration points to the frontend shell created in Phase A

## Phase C - Watch Party entry points and auth gating

Goal:
- create the signed-in-only entry flow

Tasks:
- require login for create/join
- define room code model
- define room metadata model
- connect watch party entry points to auth status

Deliverable:
- signed-in-only watch party foundation

Claude Code tasks:
- refine Phase A entry-point UI against real auth and room flow needs
- connect signed-out prompt and signed-in entry states to final UX expectations
- update any placeholder room entry forms so they match real backend contracts

Codex tasks:
- enforce auth gating for create/join
- define room code generation/validation
- integrate Supabase identity for room creation/join
- wire the sidebar/page shell and entry actions to backend logic

## Phase D - Room foundation and participant identity

Goal:
- establish real room lifecycle and participant membership

Tasks:
- create room records and participant records
- support host/guest room join flow
- attach profile/avatar identity to room members
- define room states such as:
  - lobby
  - live
  - ended

Deliverable:
- real room presence foundation

Claude Code tasks:
- build lobby UI and participant list shell
- show participant avatars/profile pictures
- show room code/share UI

Codex tasks:
- implement room membership logic
- expose room state to frontend
- feed participant identity/avatar metadata into the room UI

## Phase E - Host-broadcast media transport

Goal:
- let the host actually broadcast a title to guests

Tasks:
- integrate LiveKit OSS
- create token/join flow
- implement host media publishing
- support both:
  - streamed playback sources
  - downloaded/offline playback sources
- ensure guests receive the host’s movie/show stream

Deliverable:
- one host can broadcast a title and guests can watch it

Claude Code tasks:
- build in-room playback UI shell:
  - host live state
  - guest viewing state
  - joining/loading state
  - broadcast status

Codex tasks:
- implement LiveKit integration
- implement room token flow
- implement host-broadcast transport
- support online and offline playback sources
- wire playback state into the room UI

## Phase F - Voice chat and active speaker

Goal:
- add conversation and speaking indicators

Tasks:
- enable mic publishing in the room
- support mute/unmute
- surface active speaker state
- drive avatar pulse/glow when a user is speaking

Deliverable:
- usable voice-enabled watch party

Claude Code tasks:
- add mic controls
- add active speaker visuals around participant avatars
- add mute/unmute UI states

Codex tasks:
- implement voice chat wiring via LiveKit
- expose active speaker state to frontend
- wire mute/unmute behavior

## Phase G - Host and guest controls

Goal:
- make the room practical and safe to use

Tasks:
- host controls:
  - start broadcast
  - stop broadcast
  - end room
- guest controls:
  - join
  - leave
  - mute/unmute
- optional later:
  - remove participant
  - host-only speaking mode

Deliverable:
- practical room management

Claude Code tasks:
- build host/guest control UI
- expose room-ended / host-disconnected states

Codex tasks:
- wire room control actions
- implement room lifecycle transitions

## Phase H - Validation and hardening

Goal:
- ensure reliability and avoid regressions

Tasks:
- verify Windows + macOS interoperability
- verify streamed title hosting
- verify downloaded/offline title hosting
- verify auth gating and participant identity
- verify no regressions to existing playback/download/update flows

Deliverable:
- release-readiness checklist and known limitations

Claude Code tasks:
- polish edge states:
  - join failure
  - host disconnected
  - room ended
  - mic unavailable
  - broadcast unavailable

Codex tasks:
- harden room lifecycle
- harden reconnect/disconnect behavior
- validate no regressions in the current app

## Best Implementation Order

1. Phase A - frontend foundation and Watch Party shell
2. Phase B - audit and backend architecture map
3. Phase C - Watch Party entry points and auth gating
4. Phase D - room foundation and participant identity
5. Phase E - host-broadcast media transport
6. Phase F - voice chat and active speaker
7. Phase G - host/guest controls
8. Phase H - validation and hardening

## Recommended MVP Cut

- signed-in users only
- Watch Party page in the left sidebar
- host creates room code
- guests join with code
- host broadcasts one title
- guests watch and use voice chat
- active speaker indicator
- basic host/guest controls only

## Key Risks

- media-element capture / host broadcast constraints in desktop WebView environments
- host CPU/network load
- media quality tuning
- token/signaling/room lifecycle reliability

## Cross-Platform Feasibility

Yes.

LiveKit/WebRTC is cross-platform, so Windows and macOS users can participate in the same room.

## Reference Links

- LiveKit OSS / self-hosting:
  - https://docs.livekit.io/transport/self-hosting/
  - https://docs.livekit.io/intro/community/
