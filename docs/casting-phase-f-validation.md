# Casting Phase F Validation

## Scope

Phase F hardens the casting runtime without changing the existing local playback architecture.

Focus areas:

- cast session health checks
- interrupted-session teardown
- relay cleanup for replaced relays
- regression validation for existing desktop playback flows

## What Was Hardened

- `get_cast_session_status` now verifies the live device session instead of only echoing cached local state.
- Chromecast status checks now inspect the active Default Media Receiver session before reporting `casting`.
- DLNA status checks now inspect `AVTransport` state and detect when the renderer switched away from the NOVA STREAM relay URL.
- Interrupted sessions now clear the backend active-session record so the UI can recover cleanly.
- Manual disconnect now clears local cast state even if the device has already gone away.
- Relay cleanup now removes relay-linked HLS asset entries when a relay is explicitly cleared or replaced by a new active cast relay.
- The cast store now polls live session status while casting and converts dropped sessions into a recoverable interrupted state.

## Validation Run

Validated in local dev environment on April 11, 2026:

- `cargo check` in `src-tauri`
- `npm run build`

## Known Limits

- Same-network casting is still required.
- Physical Chromecast validation was not possible in this environment.
- Physical DLNA / smart TV validation was not possible in this environment.
- DLNA remains more limited than Chromecast for HLS and device-specific format support.
- Subtitle behavior still depends on target-device support and is not guaranteed across all renderers.

## Release Readiness Checklist

- [x] Cast relay remains additive to the existing localhost playback proxy.
- [x] Active cast sessions no longer rely on stale cached state alone.
- [x] Interrupted sessions fall back to reconnect-capable UI state.
- [x] Replaced relays clean up their linked relay assets.
- [x] `cargo check` passed after Phase F runtime changes.
- [x] `npm run build` passed after Phase F runtime changes.
- [ ] Validate on a real Chromecast on the same LAN.
- [ ] Validate on a real DLNA / UPnP renderer on the same LAN.
- [ ] Smoke-test normal local playback after cast start/stop cycles on Windows.
- [ ] Smoke-test normal local playback after cast start/stop cycles on macOS.
- [ ] Recheck downloads, offline playback, subtitles, and updater flows on release candidates.
