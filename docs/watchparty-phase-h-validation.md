# Watch Party Phase H Validation

## Automated checks run

- `npm run build`
  - Passed after Phase H hardening changes.
  - Existing chunk-size warning remains for the Watch Party store bundle and is not a functional regression.

## Runtime hardening completed

- Room refresh polling no longer stops permanently after a single transient refresh failure.
- LiveKit reconnect now reapplies the active host playback source after reconnection.
- Guest transport state now resumes cleanly after reconnect without requiring a full page reload.
- Microphone device errors from LiveKit are surfaced as actionable Watch Party errors.

## Manual validation still required

- Windows host -> Windows guest:
  - create room
  - join room
  - start broadcast from streamed content
  - stop broadcast without ending room
  - restart broadcast from another player
  - mute/unmute voice chat
  - verify active speaker indicators

- Windows host -> macOS guest:
  - repeat the same room, broadcast, and voice checks

- macOS host -> Windows guest:
  - repeat the same room, broadcast, and voice checks

- Offline/downloaded playback:
  - host from `SharedNativePlayer`
  - verify guest receives media and voice remains connected

- Failure paths:
  - invalid room code
  - room removed while guest is inside
  - host ends room
  - temporary network interruption during live playback
  - mic permission denied
  - missing LiveKit env vars / token endpoint

## Regression areas to watch

- normal movie streaming playback
- anime playback
- downloads and offline playback
- subtitles
- updater behavior
- existing Windows/mac playback flows outside Watch Party

## Known limitations

- Full end-to-end Watch Party media still requires a working LiveKit server and token endpoint.
- Real-world reconnect behavior still needs manual verification on unstable networks.
- The current build still emits the pre-existing chunk-size warning for large frontend bundles.
