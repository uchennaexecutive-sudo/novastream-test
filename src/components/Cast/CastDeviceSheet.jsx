import { useEffect, useState, useCallback, useRef, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Wifi, WifiOff } from 'lucide-react'
import useCastStore from '../../store/useCastStore'

// ── Helpers ──────────────────────────────────────────────────────────────────

function DeviceTypeBadge({ type }) {
  const isChrome = type === 'chromecast'
  const label = isChrome ? 'Chromecast' : 'DLNA'
  const color = isChrome
    ? { bg: 'rgba(234,88,12,0.18)', border: 'rgba(234,88,12,0.45)', text: '#fb923c' }
    : { bg: 'rgba(59,130,246,0.18)', border: 'rgba(59,130,246,0.45)', text: '#60a5fa' }

  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0"
      style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text }}
    >
      {label}
    </span>
  )
}

// Animated cast wave — shown next to the active casting device
function CastWave() {
  return (
    <span className="flex items-end gap-[2px] h-4 flex-shrink-0">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: 3,
            background: '#a78bfa',
            animation: `castWave 1.1s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </span>
  )
}

// Stream-ready badge — shown in the sheet header when relay is active
function StreamReadyBadge({ preparedCastMedia }) {
  if (!preparedCastMedia?.relayUrl) return null

  const streamType = preparedCastMedia.streamType || ''
  const contentType = preparedCastMedia.contentType || ''
  const isHls = streamType === 'hls' || contentType.includes('mpegurl')
  const isProtected = Boolean(preparedCastMedia.sessionId)

  let label, dotColor, badgeStyle
  if (isProtected) {
    label = 'Session relay'
    dotColor = '#fde68a'
    badgeStyle = { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.3)', text: '#fde68a' }
  } else if (isHls) {
    label = 'HLS · Relay active'
    dotColor = '#6ee7b7'
    badgeStyle = { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#6ee7b7' }
  } else {
    label = 'MP4 · Cast ready'
    dotColor = '#6ee7b7'
    badgeStyle = { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#6ee7b7' }
  }

  return (
    <span
      className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0"
      style={{ background: badgeStyle.bg, border: `1px solid ${badgeStyle.border}`, color: badgeStyle.text }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}` }}
      />
      {label}
    </span>
  )
}

// ── Device row ────────────────────────────────────────────────────────────────

function DeviceRow({ device, isActiveDevice, isThisDeviceConnecting, anyBusy, onConnect, onDisconnect }) {
  const disabled = anyBusy && !isActiveDevice && !isThisDeviceConnecting

  return (
    <motion.div
      layout
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
      style={{
        background: isActiveDevice
          ? 'rgba(139,92,246,0.12)'
          : isThisDeviceConnecting
            ? 'rgba(139,92,246,0.06)'
            : 'rgba(255,255,255,0.04)',
        border: isActiveDevice
          ? '1px solid rgba(139,92,246,0.4)'
          : isThisDeviceConnecting
            ? '1px solid rgba(139,92,246,0.25)'
            : '1px solid rgba(255,255,255,0.06)',
        opacity: disabled ? 0.45 : 1,
        transition: 'opacity 0.2s, background 0.2s, border-color 0.2s',
      }}
    >
      {/* Left: type badge + name + cast wave when active */}
      <div className="flex items-center gap-2.5 min-w-0">
        <DeviceTypeBadge type={device.type} />
        <span
          className="text-sm font-medium truncate"
          style={{ color: isActiveDevice ? '#c4b5fd' : isThisDeviceConnecting ? '#ddd6fe' : '#fff' }}
        >
          {device.name}
        </span>
        {isActiveDevice && <CastWave />}
      </div>

      {/* Right: action button */}
      {isActiveDevice ? (
        <button
          onClick={onDisconnect}
          className="px-3 h-8 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors duration-150"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.35)',
            color: '#fca5a5',
          }}
        >
          Stop
        </button>
      ) : isThisDeviceConnecting ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'rgba(139,92,246,0.4)', borderTopColor: '#8b5cf6' }}
          />
          <span className="text-xs" style={{ color: '#a78bfa' }}>Connecting…</span>
        </div>
      ) : (
        <button
          onClick={() => onConnect(device)}
          disabled={disabled}
          className="px-3 h-8 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors duration-150 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
          }}
        >
          Cast
        </button>
      )}
    </motion.div>
  )
}

// ── Disconnect confirmation ───────────────────────────────────────────────────

function DisconnectConfirm({ deviceName, onConfirm, onCancel }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-4 py-6"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}
      >
        <Wifi size={20} style={{ color: '#f87171' }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: '#fff' }}>Stop casting?</p>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          This will stop playback on <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{deviceName}</strong>
        </p>
      </div>
      <div className="flex gap-2.5">
        <button
          onClick={onCancel}
          className="px-4 h-9 rounded-xl text-xs font-semibold"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
        >
          Keep casting
        </button>
        <button
          onClick={onConfirm}
          className="px-4 h-9 rounded-xl text-xs font-semibold"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}
        >
          Stop
        </button>
      </div>
    </motion.div>
  )
}

// ── Main sheet ────────────────────────────────────────────────────────────────

/**
 * CastDeviceSheet — slide-up overlay inside the player portal.
 *
 * Props:
 *   open    — boolean controlling visibility
 *   onClose — called when the user dismisses the sheet
 */
function CastDeviceSheet({ open, onClose }) {
  const castStatus = useCastStore((s) => s.castStatus)
  const castDevices = useCastStore((s) => s.castDevices)
  const activeCastDevice = useCastStore((s) => s.activeCastDevice)
  const castError = useCastStore((s) => s.castError)
  const preparedCastMedia = useCastStore((s) => s.preparedCastMedia)
  const startDiscovery = useCastStore((s) => s.startDiscovery)
  const stopDiscovery = useCastStore((s) => s.stopDiscovery)
  const connectDevice = useCastStore((s) => s.connectDevice)
  const disconnectDevice = useCastStore((s) => s.disconnectDevice)
  const clearCastError = useCastStore((s) => s.clearCastError)

  // Track which specific device is mid-connection so we can label it in the list
  const [connectingDeviceId, setConnectingDeviceId] = useState(null)
  // Show disconnect confirmation dialog
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  // Edge-state tracking
  const [wasInterrupted, setWasInterrupted] = useState(false)
  const [interruptedDeviceName, setInterruptedDeviceName] = useState(null)
  const [retryDevice, setRetryDevice] = useState(null)

  // Refs for state-transition detection
  const prevCastStatusRef = useRef(castStatus)
  const connectingDeviceRef = useRef(null)
  const activeCastDeviceRef = useRef(activeCastDevice)

  // Keep activeCastDeviceRef current so the interrupted-banner can read it after
  // activeCastDevice is cleared by the backend
  useEffect(() => {
    activeCastDeviceRef.current = activeCastDevice
  }, [activeCastDevice])

  // Detect status transitions for edge states
  useEffect(() => {
    const prev = prevCastStatusRef.current
    prevCastStatusRef.current = castStatus

    if (castStatus !== 'connecting') {
      // Connection attempt just failed → store device so user can retry
      if (prev === 'connecting' && castStatus === 'error' && connectingDeviceRef.current) {
        setRetryDevice({ ...connectingDeviceRef.current })
      }
      setConnectingDeviceId(null)
    }
    // Close disconnect confirm whenever we leave casting
    if (castStatus !== 'casting') {
      setShowDisconnectConfirm(false)
    }
    // Active cast dropped → show interrupted banner (amber, not red)
    if (prev === 'casting' && castStatus === 'error') {
      setWasInterrupted(true)
      setInterruptedDeviceName(activeCastDeviceRef.current?.name || null)
    }
    // Clear transient edge states on success or clean idle
    if (castStatus === 'casting' || castStatus === 'idle') {
      setWasInterrupted(false)
      setInterruptedDeviceName(null)
      setRetryDevice(null)
    }
  }, [castStatus])

  // Start discovery on open; stop on close
  useEffect(() => {
    if (open) {
      startDiscovery()
    } else {
      stopDiscovery()
      setShowDisconnectConfirm(false)
    }
  }, [open, startDiscovery, stopDiscovery])

  const handleConnect = useCallback((device) => {
    connectingDeviceRef.current = device
    setConnectingDeviceId(device.id)
    connectDevice(device)
  }, [connectDevice])

  const handleReconnect = useCallback(() => {
    const device = retryDevice
      || castDevices.find((d) => d.name === interruptedDeviceName)
    if (!device) return
    clearCastError()
    setWasInterrupted(false)
    setRetryDevice(null)
    handleConnect(device)
  }, [retryDevice, castDevices, interruptedDeviceName, clearCastError, handleConnect])

  const handleDisconnectRequest = useCallback(() => {
    setShowDisconnectConfirm(true)
  }, [])

  const handleDisconnectConfirm = useCallback(() => {
    setShowDisconnectConfirm(false)
    setWasInterrupted(false)
    setInterruptedDeviceName(null)
    setRetryDevice(null)
    disconnectDevice()
  }, [disconnectDevice])

  const handleDisconnectCancel = useCallback(() => {
    setShowDisconnectConfirm(false)
  }, [])

  const isDiscovering = castStatus === 'discovering'
  const isConnecting = castStatus === 'connecting'
  const isCasting = castStatus === 'casting'
  const isError = castStatus === 'error'
  const anyBusy = isConnecting || isCasting
  const hasDevices = castDevices.length > 0

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ zIndex: 40, background: 'rgba(0,0,0,0.6)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={showDisconnectConfirm ? undefined : onClose}
          />

          {/* Sheet */}
          <motion.div
            className="absolute left-1/2 bottom-0 w-full"
            style={{
              zIndex: 41,
              maxWidth: 480,
              transform: 'translateX(-50%)',
              borderRadius: '20px 20px 0 0',
              background: 'rgba(14,8,28,0.98)',
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderBottom: 'none',
              boxShadow: '0 -8px 48px rgba(0,0,0,0.7)',
              padding: '20px 20px 32px',
              overflow: 'hidden',
            }}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-semibold text-base" style={{ color: '#fff' }}>
                    {isCasting ? 'Now Casting' : 'Cast to Device'}
                  </h3>
                  <StreamReadyBadge preparedCastMedia={preparedCastMedia} />
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {isCasting
                    ? `Playing on ${activeCastDevice?.name || 'device'}`
                    : preparedCastMedia?.relayUrl
                      ? 'Devices on your Wi-Fi network'
                      : 'Waiting for stream to be ready…'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.55)',
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Disconnect confirm — overlays the body */}
            <AnimatePresence mode="wait">
              {showDisconnectConfirm ? (
                <DisconnectConfirm
                  key="confirm"
                  deviceName={activeCastDevice?.name || 'device'}
                  onConfirm={handleDisconnectConfirm}
                  onCancel={handleDisconnectCancel}
                />
              ) : (
                <motion.div
                  key="body"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  {/* Cast interrupted banner — amber, distinct from red errors */}
                  {wasInterrupted && isError && (
                    <div
                      className="flex items-start gap-3 px-4 py-3 rounded-xl mb-3"
                      style={{
                        background: 'rgba(234,179,8,0.09)',
                        border: '1px solid rgba(234,179,8,0.28)',
                      }}
                    >
                      <WifiOff size={15} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug" style={{ color: '#fde68a' }}>
                          Casting was interrupted
                        </p>
                        <p className="text-xs mt-0.5 leading-snug" style={{ color: 'rgba(253,230,138,0.5)' }}>
                          {interruptedDeviceName
                            ? `Lost connection to ${interruptedDeviceName}`
                            : 'The connection to your device was lost'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(interruptedDeviceName || retryDevice) && (
                          <button
                            onClick={handleReconnect}
                            className="px-2.5 h-7 rounded-lg text-[11px] font-semibold"
                            style={{
                              background: 'rgba(234,179,8,0.15)',
                              border: '1px solid rgba(234,179,8,0.35)',
                              color: '#fde68a',
                            }}
                          >
                            Reconnect
                          </button>
                        )}
                        <button
                          onClick={() => { setWasInterrupted(false); clearCastError() }}
                          className="text-xs"
                          style={{ color: 'rgba(255,255,255,0.3)' }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Error banner — connection failure / relay error / unsupported content */}
                  {(isError || castError) && !wasInterrupted && (() => {
                    const msg = castError?.toLowerCase() || ''
                    const isUnsupported = msg.includes('unsupported') || msg.includes('codec') || msg.includes('format not') || msg.includes('cannot cast')
                    const isRelayError = msg.includes('relay') && !msg.includes('not ready')
                    const isNotReady = msg.includes('not ready') || msg.includes('still loading')
                    const isConnFail = Boolean(retryDevice) && !wasInterrupted

                    return (
                      <div
                        className="flex items-start gap-3 px-4 py-3 rounded-xl mb-4"
                        style={{
                          background: 'rgba(239,68,68,0.09)',
                          border: '1px solid rgba(239,68,68,0.3)',
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm leading-snug" style={{ color: '#fca5a5' }}>
                            {isUnsupported
                              ? 'This content can\'t be cast'
                              : isConnFail
                                ? `Couldn't connect to ${retryDevice.name}`
                                : castError || 'Something went wrong. Please try again.'}
                          </span>
                          {isUnsupported && (
                            <p className="text-xs mt-1.5 leading-snug" style={{ color: 'rgba(252,165,165,0.55)' }}>
                              This stream format isn't compatible with casting. Try a different title.
                            </p>
                          )}
                          {isRelayError && (
                            <p className="text-xs mt-1.5 leading-snug" style={{ color: 'rgba(252,165,165,0.55)' }}>
                              Try closing and reopening the player, then cast again.
                            </p>
                          )}
                          {isNotReady && (
                            <p className="text-xs mt-1.5 leading-snug" style={{ color: 'rgba(252,165,165,0.55)' }}>
                              Wait a moment for the stream to load, then tap Cast again.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isConnFail && (
                            <button
                              onClick={handleReconnect}
                              className="px-2.5 h-7 rounded-lg text-[11px] font-semibold"
                              style={{
                                background: 'rgba(239,68,68,0.15)',
                                border: '1px solid rgba(239,68,68,0.35)',
                                color: '#fca5a5',
                              }}
                            >
                              Try again
                            </button>
                          )}
                          <button
                            onClick={clearCastError}
                            className="text-xs"
                            style={{ color: 'rgba(255,255,255,0.3)' }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Active cast banner */}
                  {isCasting && activeCastDevice && (
                    <div
                      className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4"
                      style={{
                        background: 'rgba(139,92,246,0.13)',
                        border: '1px solid rgba(139,92,246,0.35)',
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{
                          background: '#a78bfa',
                          boxShadow: '0 0 8px rgba(167,139,250,0.8)',
                          animation: 'pulse 2s ease-in-out infinite',
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold" style={{ color: '#c4b5fd' }}>
                          Casting to {activeCastDevice.name}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'rgba(196,181,253,0.55)' }}>
                          {activeCastDevice.type === 'dlna'
                            ? 'Playing on your TV via DLNA · UPnP renderer'
                            : 'Audio and video are playing on your Chromecast'}
                        </p>
                      </div>
                      <DeviceTypeBadge type={activeCastDevice.type} />
                    </div>
                  )}

                  {/* Body */}
                  <div className="flex flex-col gap-2">

                    {/* Stream preparing — relay not ready, not yet in error */}
                    {!isDiscovering && !isConnecting && !isCasting && !isError && !castError && !preparedCastMedia?.relayUrl && (
                      <div className="flex flex-col items-center justify-center py-7 gap-3">
                        <span
                          className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: 'rgba(139,92,246,0.3)', borderTopColor: '#8b5cf6' }}
                        />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                            Preparing stream for casting…
                          </span>
                          <span
                            className="text-xs text-center"
                            style={{ color: 'rgba(255,255,255,0.25)', maxWidth: 270 }}
                          >
                            Keep the player open while the relay starts
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Discovering — no devices yet */}
                    {isDiscovering && !hasDevices && (
                      <div className="flex flex-col items-center justify-center py-8 gap-3">
                        <span
                          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: 'rgba(139,92,246,0.35)', borderTopColor: '#8b5cf6' }}
                        />
                        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          Looking for devices on your network…
                        </span>
                      </div>
                    )}

                    {/* No devices found */}
                    {!isDiscovering && !isConnecting && !hasDevices && !isCasting && !isError && preparedCastMedia?.relayUrl && (
                      <div className="flex flex-col items-center py-6 gap-4">
                        <div
                          className="w-11 h-11 rounded-full flex items-center justify-center"
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.09)',
                          }}
                        >
                          <WifiOff size={20} style={{ color: 'rgba(255,255,255,0.28)' }} />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            No devices found
                          </p>
                          <p
                            className="text-xs mt-1 leading-relaxed"
                            style={{ color: 'rgba(255,255,255,0.3)', maxWidth: 280 }}
                          >
                            Make sure your Chromecast or DLNA TV is powered on and on the same Wi-Fi network.
                          </p>
                        </div>
                        <div
                          className="w-full flex flex-col gap-1.5 px-2 py-3 rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                        >
                          {[
                            'Check the device is not in standby or sleep mode',
                            'Both devices must be on the same Wi-Fi network',
                            'Some routers block device discovery — try disabling AP isolation',
                          ].map((tip) => (
                            <p key={tip} className="text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.25)' }}>
                              · {tip}
                            </p>
                          ))}
                        </div>
                        <button
                          onClick={startDiscovery}
                          className="px-5 h-9 rounded-xl text-xs font-semibold"
                          style={{
                            background: 'rgba(255,255,255,0.07)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fff',
                          }}
                        >
                          Scan again
                        </button>
                      </div>
                    )}

                    {/* Device list — grouped by type when both are present */}
                    {hasDevices && (() => {
                      const chromecasts = castDevices.filter((d) => d.type === 'chromecast')
                      const dlnaDevices = castDevices.filter((d) => d.type === 'dlna')
                      const showHeaders = chromecasts.length > 0 && dlnaDevices.length > 0

                      const renderRows = (devices) => devices.map((device) => (
                        <DeviceRow
                          key={device.id}
                          device={device}
                          isActiveDevice={isCasting && activeCastDevice?.id === device.id}
                          isThisDeviceConnecting={isConnecting && connectingDeviceId === device.id}
                          anyBusy={anyBusy}
                          onConnect={handleConnect}
                          onDisconnect={handleDisconnectRequest}
                        />
                      ))

                      if (!showHeaders) return renderRows(castDevices)

                      return (
                        <>
                          {chromecasts.length > 0 && (
                            <div className="flex flex-col gap-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider px-1 mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                Chromecast
                              </p>
                              {renderRows(chromecasts)}
                            </div>
                          )}
                          {dlnaDevices.length > 0 && (
                            <div className="flex flex-col gap-2 mt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                Smart TV · DLNA
                              </p>
                              {renderRows(dlnaDevices)}
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {/* Still scanning while devices already shown */}
                    {isDiscovering && hasDevices && (
                      <div
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl mt-1"
                        style={{
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.05)',
                        }}
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-t-transparent animate-spin flex-shrink-0"
                          style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'rgba(255,255,255,0.5)' }}
                        />
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          Still scanning…
                        </span>
                      </div>
                    )}

                    {/* Per-type hints — only when not casting/connecting */}
                    {hasDevices && !isCasting && !isConnecting && (
                      <div className="flex flex-col gap-1 mt-2">
                        {castDevices.some((d) => d.type === 'chromecast') && (
                          <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.22)' }}>
                            Chromecast requires the same Wi-Fi network and a compatible stream
                          </p>
                        )}
                        {castDevices.some((d) => d.type === 'dlna') && (
                          <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.22)' }}>
                            DLNA/UPnP renderers support direct playback · Subtitle support varies by device
                          </p>
                        )}
                        {/* HLS + DLNA compat warning */}
                        {castDevices.some((d) => d.type === 'dlna') &&
                          (preparedCastMedia?.streamType === 'hls' || preparedCastMedia?.contentType?.includes('mpegurl')) && (
                          <p className="text-[11px] text-center" style={{ color: 'rgba(251,191,36,0.5)' }}>
                            HLS streams may not play on all DLNA renderers — MP4 has broader support
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default memo(CastDeviceSheet)
