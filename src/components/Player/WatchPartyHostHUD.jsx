/**
 * WatchPartyHostHUD
 *
 * Compact in-player broadcast HUD shown only when:
 *   - Watch Party status === 'live'
 *   - current user is the host
 *   - broadcastStatus !== 'idle'
 *
 * Positioned absolute top-right inside the player container (zIndex 35,
 * above the zIndex-30 controls gradient).
 *
 * Reads all state from useWatchPartyStore and useAuthStore — no props needed.
 * Drop <WatchPartyHostHUD /> anywhere inside the player's relative container.
 *
 * Codex placeholder hookup points are marked with:
 *   // Placeholder: Codex will wire real runtime state
 */

import { useState, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Square, Users } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import useWatchPartyStore from '../../store/useWatchPartyStore'
import { dicebearUrl } from '../../lib/supabaseClient'

const MAX_AVATAR_STACK = 3

// ─── Status label + dot colour ──────────────────────────────────────────────

function StatusIndicator({ broadcastStatus, transportState }) {
  if (broadcastStatus === 'publishing') {
    return (
      <>
        <motion.span
          className="flex-shrink-0"
          style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'block' }}
          animate={{ opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
        <span style={{ color: '#fca5a5', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em' }}>
          LIVE
        </span>
      </>
    )
  }

  // Placeholder: Codex will wire real runtime transport state into broadcastStatus
  const isConnecting =
    broadcastStatus === 'connecting' ||
    transportState === 'connecting' ||
    transportState === 'reconnecting'

  if (isConnecting) {
    return (
      <>
        <span
          className="w-2 h-2 rounded-full border border-white/30 animate-spin flex-shrink-0"
          style={{ borderTopColor: '#c4b5fd' }}
        />
        <span style={{ color: '#c4b5fd', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em' }}>
          CONNECTING
        </span>
      </>
    )
  }

  if (broadcastStatus === 'awaiting-source') {
    return (
      <>
        <span
          className="flex-shrink-0"
          style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'block' }}
        />
        <span style={{ color: '#fde68a', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em' }}>
          WATCH PARTY
        </span>
      </>
    )
  }

  // fallback — broadcastStatus === 'idle' or unknown (HUD hidden in this case anyway)
  return null
}

// ─── Waveform bars (shown in guest row when anyone is speaking) ───────────────

function WaveformBars() {
  const bars = [
    { height: [2, 7, 3], duration: 0.55 },
    { height: [5, 10, 4], duration: 0.42 },
    { height: [3, 8, 2], duration: 0.6 },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 10 }}>
      {bars.map((b, i) => (
        <motion.span
          key={i}
          style={{
            display: 'block',
            width: 2,
            borderRadius: 1,
            background: '#a78bfa',
            flexShrink: 0,
          }}
          animate={{ height: b.height }}
          transition={{ duration: b.duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

// ─── Speaking ring overlay on a single avatar ────────────────────────────────

function SpeakingRing() {
  return (
    <motion.span
      style={{
        position: 'absolute',
        inset: -2,
        borderRadius: 8,
        border: '2px solid #a78bfa',
        pointerEvents: 'none',
      }}
      animate={{ opacity: [0.9, 0.35, 0.9], scale: [1, 1.06, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

// ─── Guest avatar stack ──────────────────────────────────────────────────────

function GuestStack({ participants }) {
  const guests = participants.filter((p) => !p.isHost)
  const visible = guests.slice(0, MAX_AVATAR_STACK)
  const extra = Math.max(0, guests.length - MAX_AVATAR_STACK)
  const anyoneSpeaking = guests.some((p) => p.isSpeaking)

  if (guests.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <Users size={11} style={{ color: 'rgba(255,255,255,0.32)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', fontWeight: 500 }}>
          No guests yet
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        {visible.map((p, i) => (
          <div
            key={p.id}
            title={p.name}
            style={{
              position: 'relative',
              width: 20,
              height: 20,
              borderRadius: 6,
              overflow: 'visible',
              marginLeft: i === 0 ? 0 : -6,
              flexShrink: 0,
              zIndex: p.isSpeaking ? 2 : 1,
            }}
          >
            {/* avatar image */}
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                overflow: 'hidden',
                border: p.isSpeaking
                  ? '1.5px solid #a78bfa'
                  : '1.5px solid rgba(0,0,0,0.72)',
                background: 'rgba(255,255,255,0.08)',
              }}
            >
              <img
                src={dicebearUrl(p.avatarStyle || 'bottts', p.avatarSeed || p.id || 'guest')}
                alt={p.name}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
            {/* animated ring for speaking state */}
            <AnimatePresence>
              {p.isSpeaking && <SpeakingRing key="ring" />}
            </AnimatePresence>
          </div>
        ))}
        {extra > 0 && (
          <span
            style={{
              marginLeft: 4,
              fontSize: 10,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.48)',
            }}
          >
            +{extra}
          </span>
        )}
      </div>

      {/* guest count + speaking indicator */}
      <div className="flex items-center gap-1.5">
        <AnimatePresence>
          {anyoneSpeaking && (
            <motion.div
              key="wave"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: 'hidden' }}
            >
              <WaveformBars />
            </motion.div>
          )}
        </AnimatePresence>
        <span style={{ fontSize: 10, color: anyoneSpeaking ? '#c4b5fd' : 'rgba(255,255,255,0.38)', fontWeight: 500, transition: 'color 0.3s' }}>
          {guests.length} {guests.length === 1 ? 'guest' : 'guests'}
        </span>
      </div>
    </div>
  )
}

// ─── Main HUD ────────────────────────────────────────────────────────────────

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export default function WatchPartyHostHUD({ sourceLabel = '' }) {
  const user = useAuthStore((s) => s.user)

  const status = useWatchPartyStore((s) => s.status)
  const isHost = useWatchPartyStore((s) => s.isHost)
  const roomCode = useWatchPartyStore((s) => s.roomCode)
  const broadcastStatus = useWatchPartyStore((s) => s.broadcastStatus)
  const broadcastLabel = useWatchPartyStore((s) => s.broadcastLabel)
  const transportState = useWatchPartyStore((s) => s.transportState)
  const participants = useWatchPartyStore((s) => s.participants)
  const entryPending = useWatchPartyStore((s) => s.entryPending)
  const stopBroadcast = useWatchPartyStore((s) => s.stopBroadcast)

  const [copied, setCopied] = useState(false)
  const normalizedSourceLabel = useMemo(() => normalizeLabel(sourceLabel), [sourceLabel])
  const normalizedBroadcastLabel = useMemo(() => normalizeLabel(broadcastLabel), [broadcastLabel])
  const isCurrentPlayerSource = Boolean(normalizedSourceLabel)
    && normalizedSourceLabel === normalizedBroadcastLabel

  // HUD only visible when this player is the active host Watch Party source.
  const visible =
    Boolean(user) &&
    isHost &&
    status === 'live' &&
    broadcastStatus !== 'idle' &&
    isCurrentPlayerSource

  const handleCopy = useCallback(() => {
    if (!roomCode) return
    navigator.clipboard.writeText(roomCode).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2200)
  }, [roomCode])

  const handleStopBroadcast = useCallback(() => {
    if (entryPending) return
    // Placeholder: Codex will confirm pauseWatchPartyBroadcast / stopBroadcast runtime path
    void stopBroadcast()
  }, [entryPending, stopBroadcast])

  const isPublishing = broadcastStatus === 'publishing'
  const borderColor = isPublishing
    ? 'rgba(239,68,68,0.3)'
    : 'rgba(255,255,255,0.12)'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="wp-host-hud"
          initial={{ opacity: 0, scale: 0.9, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -6 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          // Stops click-through to the player backdrop close handler
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 56,
            right: 14,
            zIndex: 35,
            minWidth: 152,
            maxWidth: 200,
            borderRadius: 12,
            overflow: 'hidden',
            background: 'rgba(6,6,12,0.72)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: `1px solid ${borderColor}`,
            boxShadow: isPublishing
              ? '0 4px 20px rgba(239,68,68,0.18)'
              : '0 4px 20px rgba(0,0,0,0.45)',
          }}
        >
          {/* ── Status row ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px 6px',
            }}
          >
            <StatusIndicator
              broadcastStatus={broadcastStatus}
              transportState={transportState}
            />
          </div>

          {/* ── Room code + copy ── */}
          {roomCode && (
            <button
              onClick={handleCopy}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: 6,
                padding: '5px 10px',
                background: 'rgba(255,255,255,0.04)',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                cursor: 'pointer',
              }}
              title="Copy room code"
            >
              <span
                style={{
                  color: 'rgba(255,255,255,0.88)',
                  fontSize: 13,
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  letterSpacing: '0.18em',
                }}
              >
                {roomCode}
              </span>
              {copied
                ? <Check size={11} color="#6ee7b7" />
                : <Copy size={11} color="rgba(255,255,255,0.35)" />}
            </button>
          )}

          {/* ── Guest presence ── */}
          <div
            style={{
              padding: '6px 10px 7px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <GuestStack participants={participants} />
          </div>

          {/* ── Stop broadcast action (publishing only) ── */}
          {isPublishing && (
            <button
              onClick={handleStopBroadcast}
              disabled={entryPending}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                gap: 5,
                padding: '5px 10px 7px',
                borderTop: '1px solid rgba(239,68,68,0.18)',
                background: 'rgba(239,68,68,0.07)',
                color: entryPending ? 'rgba(255,255,255,0.22)' : '#fca5a5',
                fontSize: 11,
                fontWeight: 600,
                cursor: entryPending ? 'not-allowed' : 'pointer',
              }}
              title="Stop broadcasting to guests"
            >
              <Square size={9} fill="currentColor" />
              Stop Broadcast
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
