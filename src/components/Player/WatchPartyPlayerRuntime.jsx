import useWatchPartyPlaybackBridge from './useWatchPartyPlaybackBridge'
import WatchPartyHostHUD from './WatchPartyHostHUD'

export default function WatchPartyPlayerRuntime({
  videoRef,
  enabled,
  label,
  subtitleText = '',
  subtitleEnabled = false,
}) {
  useWatchPartyPlaybackBridge({
    videoRef,
    enabled,
    label,
    subtitleText,
    subtitleEnabled,
  })

  return <WatchPartyHostHUD sourceLabel={label} />
}
