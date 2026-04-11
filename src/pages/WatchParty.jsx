import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Copy,
  Crown,
  LogIn,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Play,
  Radio,
  RefreshCw,
  Square,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import useWatchPartyStore from '../store/useWatchPartyStore'
import { dicebearUrl } from '../lib/supabaseClient'

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
}

function Card({ children, className = '', style = {} }) {
  return (
    <div
      className={`rounded-2xl p-6 ${className}`}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function PrimaryButton({ onClick, disabled, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 h-11 px-6 rounded-xl font-semibold text-sm transition-opacity ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'} ${className}`}
      style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 18px var(--accent-glow)' }}
    >
      {children}
    </button>
  )
}

function GhostButton({ onClick, disabled, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 h-11 px-5 rounded-xl font-medium text-sm transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  )
}

function ErrorBanner({ message }) {
  if (!message) return null

  return (
    <div
      className="mb-5 max-w-2xl rounded-2xl px-4 py-3"
      style={{
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.22)',
        color: '#fca5a5',
      }}
    >
      <p className="text-sm font-medium">Watch Party</p>
      <p className="text-xs mt-1 opacity-90">{message}</p>
    </div>
  )
}

function BroadcastStatusBadge({ transportState, broadcastStatus, isHost }) {
  const isConnecting = (
    transportState === 'connecting'
    || transportState === 'reconnecting'
    || transportState === 'signalreconnecting'
  )

  if (isConnecting) {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0"
        style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', color: '#c4b5fd' }}
      >
        <span
          className="w-3 h-3 rounded-full border border-t-transparent animate-spin flex-shrink-0"
          style={{ borderColor: 'rgba(196,181,253,0.35)', borderTopColor: '#c4b5fd' }}
        />
        Connecting
      </span>
    )
  }

  if (broadcastStatus === 'publishing') {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0"
        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}
      >
        <motion.span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: '#ef4444' }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        Broadcasting
      </span>
    )
  }

  if (broadcastStatus === 'receiving') {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0"
        style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.28)', color: '#6ee7b7' }}
      >
        <motion.span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: '#10b981' }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        Receiving
      </span>
    )
  }

  if (broadcastStatus === 'waiting-for-host') {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0"
        style={{ background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8' }}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#94a3b8' }} />
        Waiting for host
      </span>
    )
  }

  if (isHost && broadcastStatus === 'awaiting-source') {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0"
        style={{ background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.25)', color: '#fde68a' }}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#f59e0b' }} />
        Awaiting source
      </span>
    )
  }

  return null
}

// Animated vertical bars shown while the user is actively speaking
function VoiceActivityBars() {
  return (
    <div className="flex items-end gap-[2px]" style={{ height: 14 }}>
      {[0.45, 0.8, 1, 0.8, 0.45].map((peak, i) => (
        <motion.span
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="w-[3px] rounded-full flex-shrink-0"
          style={{ background: 'var(--accent)', transformOrigin: 'bottom', height: '100%' }}
          animate={{ scaleY: [peak * 0.25, peak, peak * 0.25] }}
          transition={{
            duration: 0.55 + i * 0.07,
            repeat: Infinity,
            delay: i * 0.06,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

// Strip that appears above the participant grid when at least one person is speaking
// Shows only a waveform visual — no textual name narration
function ActiveSpeakerStrip({ participants }) {
  const anyoneSpeaking = participants.some((p) => p.isSpeaking)

  return (
    <AnimatePresence>
      {anyoneSpeaking && (
        <motion.div
          key="strip"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl overflow-hidden"
          style={{
            background: 'rgba(139,92,246,0.08)',
            border: '1px solid rgba(139,92,246,0.18)',
          }}
        >
          <VoiceActivityBars />
          <span className="text-[10px] font-medium" style={{ color: 'rgba(196,181,253,0.55)' }}>
            Voice active
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function RoomStateBadge({ roomState }) {
  const normalized = String(roomState || '').trim().toLowerCase()
  if (!normalized) return null

  const palette = normalized === 'live'
    ? {
      background: 'rgba(239,68,68,0.12)',
      border: '1px solid rgba(239,68,68,0.28)',
      color: '#fca5a5',
      label: 'Room Live',
    }
    : normalized === 'ended'
      ? {
        background: 'rgba(148,163,184,0.12)',
        border: '1px solid rgba(148,163,184,0.22)',
        color: '#cbd5e1',
        label: 'Room Ended',
      }
      : {
        background: 'rgba(59,130,246,0.12)',
        border: '1px solid rgba(59,130,246,0.26)',
        color: '#93c5fd',
        label: 'Lobby',
      }

  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]"
      style={palette}
    >
      {palette.label}
    </span>
  )
}

function ParticipantAvatar({ participant, size = 52, showName = true }) {
  const url = dicebearUrl(
    participant.avatarStyle || 'bottts',
    participant.avatarSeed || participant.id || 'nova'
  )

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {participant.isSpeaking && (
          <motion.div
            className="absolute inset-0 rounded-2xl"
            style={{
              border: '2px solid var(--accent)',
              boxShadow: '0 0 12px var(--accent-glow)',
            }}
            animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.06, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        <div
          className="w-full h-full rounded-2xl overflow-hidden"
          style={{
            border: participant.isSpeaking
              ? '2px solid var(--accent)'
              : '2px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.06)',
          }}
        >
          <img src={url} alt={participant.name} className="w-full h-full" />
        </div>

        {participant.isMuted && (
          <div
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(239,68,68,0.85)', border: '1.5px solid var(--bg-surface)' }}
          >
            <MicOff size={10} color="#fff" />
          </div>
        )}

        {participant.isHost && (
          <div
            className="absolute -top-2 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(234,179,8,0.9)', border: '1.5px solid var(--bg-surface)' }}
          >
            <Crown size={10} color="#1a1000" />
          </div>
        )}
      </div>

      {showName && (
        <span className="text-xs font-medium max-w-[64px] truncate text-center" style={{ color: 'var(--text-secondary)' }}>
          {participant.name}
        </span>
      )}
    </div>
  )
}

function SignedOutGate({ onSignIn }) {
  return (
    <motion.div className="flex flex-col items-center justify-center flex-1 py-16 gap-6" {...fadeUp}>
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <Users size={34} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="text-center max-w-xs">
        <h2 className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--text-primary)' }}>
          Watch Party
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Watch together with friends in real time. Sign in to create or join a room.
        </p>
      </div>
      <PrimaryButton onClick={onSignIn} className="min-w-[160px]">
        <LogIn size={16} />
        Sign in to continue
      </PrimaryButton>
    </motion.div>
  )
}

function Landing({ onStart, onJoin }) {
  return (
    <motion.div className="flex flex-col gap-6" {...fadeUp}>
      <div>
        <h1 className="font-display font-bold text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Watch Party
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Host a room or join a friend&apos;s session and watch together across devices.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-xl items-stretch">
        <Card className="flex flex-col gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}
          >
            <Radio size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-semibold text-base mb-1" style={{ color: 'var(--text-primary)' }}>
              Start a Room
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Create a room and invite friends with a code. You host the stream and guests watch your playback live.
            </p>
          </div>
          <PrimaryButton onClick={onStart} className="w-full">
            <Play size={15} />
            Start Watch Party
          </PrimaryButton>
        </Card>

        <Card className="flex flex-col gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)' }}
          >
            <UserPlus size={22} style={{ color: '#6ee7b7' }} />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-semibold text-base mb-1" style={{ color: 'var(--text-primary)' }}>
              Join a Room
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Enter a 6-character code to join a friend&apos;s Watch Party.
            </p>
          </div>
          <PrimaryButton onClick={onJoin} className="w-full">
            <UserPlus size={15} />
            Join with Code
          </PrimaryButton>
        </Card>
      </div>
    </motion.div>
  )
}

function StartFlow({ onBack, onCreate, pending }) {
  return (
    <motion.div className="flex flex-col gap-5 max-w-sm" {...fadeUp}>
      <button
        onClick={onBack}
        disabled={pending}
        className="flex items-center gap-1.5 text-sm self-start"
        style={{ color: pending ? 'rgba(255,255,255,0.32)' : 'var(--text-muted)' }}
      >
        <ChevronLeft size={16} />
        Back
      </button>

      <div>
        <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Start a Watch Party
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          A room code will be generated for you to share with friends.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <div
          className="w-full h-20 rounded-xl flex flex-col items-center justify-center gap-1.5"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px dashed rgba(255,255,255,0.12)',
          }}
        >
          <Radio size={18} style={{ color: 'rgba(255,255,255,0.25)' }} />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Start the room here, then open any NOVA STREAM player to broadcast it.
          </span>
        </div>

        <PrimaryButton onClick={onCreate} disabled={pending} className="w-full">
          <Users size={15} />
          {pending ? 'Creating Room...' : 'Create Room'}
        </PrimaryButton>
      </Card>
    </motion.div>
  )
}

function JoinFlow({ onBack, onJoin, pending, entryError }) {
  const [code, setCode] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    if (code.length === 6) {
      onJoin(code)
    }
  }

  return (
    <motion.div className="flex flex-col gap-5 max-w-sm" {...fadeUp}>
      <button
        onClick={onBack}
        disabled={pending}
        className="flex items-center gap-1.5 text-sm self-start"
        style={{ color: pending ? 'rgba(255,255,255,0.32)' : 'var(--text-muted)' }}
      >
        <ChevronLeft size={16} />
        Back
      </button>

      <div>
        <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Join a Watch Party
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Enter the 6-character room code shared by your host.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Room Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase())}
              placeholder="AB12CD"
              autoFocus
              disabled={pending}
              className="w-full h-12 rounded-xl px-4 text-center text-xl font-display font-bold tracking-[0.3em] outline-none"
              style={{
                background: 'var(--bg-elevated)',
                border: `1px solid ${entryError ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                color: 'var(--text-primary)',
                letterSpacing: '0.3em',
              }}
              maxLength={6}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              {code.length}/6 characters
            </p>
          </div>

          <AnimatePresence>
            {entryError && (
              <motion.div
                key="join-error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl overflow-hidden"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.22)',
                }}
              >
                <AlertTriangle size={13} style={{ color: '#fca5a5', flexShrink: 0, marginTop: 1 }} />
                <span className="text-xs leading-relaxed" style={{ color: '#fca5a5' }}>
                  {entryError}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <PrimaryButton disabled={code.length !== 6 || pending} className="w-full">
            <UserPlus size={15} />
            {pending ? 'Joining Room...' : 'Join Room'}
          </PrimaryButton>
        </form>
      </Card>
    </motion.div>
  )
}

function RoomCodeBadge({ code }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl self-start"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>
          Room Code
        </p>
        <p className="font-display font-bold text-2xl tracking-[0.3em]" style={{ color: 'var(--text-primary)' }}>
          {code}
        </p>
      </div>
      <button
        onClick={handleCopy}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
        style={{
          background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
          color: copied ? '#6ee7b7' : 'var(--text-muted)',
        }}
        title="Copy code"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function Lobby({ roomCode, roomState, isHost, participants, onStart, onLeave, pending }) {
  return (
    <motion.div className="flex flex-col gap-6 max-w-lg" {...fadeUp}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
            {isHost ? 'Your Room' : 'Waiting to Start'}
          </h2>
          <div className="mb-2">
            <RoomStateBadge roomState={roomState} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {isHost
              ? 'Share the code below. Start when everyone is ready.'
              : 'Waiting for the host to start the Watch Party.'}
          </p>
        </div>
        <RoomCodeBadge code={roomCode} />
      </div>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
          Participants {participants.length > 0 && `· ${participants.length}`}
        </p>

        {participants.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-8 gap-3 rounded-xl"
            style={{ background: 'var(--bg-elevated)', border: '1px dashed rgba(255,255,255,0.08)' }}
          >
            <Users size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
            <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {isHost ? 'Waiting for guests to join.' : 'Connecting to room.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-5">
            {participants.map((participant) => (
              <ParticipantAvatar key={participant.id} participant={participant} size={52} showName />
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3 flex-wrap">
        {isHost && (
          <PrimaryButton onClick={onStart} disabled={pending} className="min-w-[160px]">
            <Play size={15} />
            {pending ? 'Starting...' : 'Start Watch Party'}
          </PrimaryButton>
        )}
        <GhostButton onClick={onLeave} disabled={pending}>
          <PhoneOff size={15} />
          {pending && isHost ? 'Ending...' : isHost ? 'End Room' : 'Leave'}
        </GhostButton>
      </div>
    </motion.div>
  )
}

function VoiceControls({ isMuted, isSpeakingSelf, onToggleMute, onLeave, isHost, onEndRoom, pending, micUnavailable }) {
  return (
    <div className="flex flex-col gap-2">
      {/* "You're muted" nudge — visible reminder when mic is off */}
      <AnimatePresence>
        {isMuted && (
          <motion.div
            key="muted-nudge"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl overflow-hidden"
            style={{
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.18)',
            }}
          >
            <MicOff size={13} style={{ color: 'rgba(252,165,165,0.7)', flexShrink: 0 }} />
            <span className="text-xs" style={{ color: 'rgba(252,165,165,0.7)' }}>
              Your microphone is off — others can&apos;t hear you.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-2xl flex-wrap"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        {/* Mute / unmute button — disabled when mic hardware unavailable */}
        <button
          onClick={onToggleMute}
          disabled={pending || micUnavailable}
          className="flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium transition-colors"
          style={{
            background: (pending || micUnavailable)
              ? 'rgba(255,255,255,0.04)'
              : isMuted ? 'rgba(239,68,68,0.15)' : 'var(--bg-elevated)',
            border: `1px solid ${(pending || micUnavailable) ? 'rgba(255,255,255,0.1)' : isMuted ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
            color: (pending || micUnavailable)
              ? 'rgba(255,255,255,0.28)'
              : isMuted ? '#fca5a5' : 'var(--text-secondary)',
          }}
          title={micUnavailable ? 'Microphone unavailable' : isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <MicOff size={15} />
          <span>{micUnavailable ? 'Mic unavailable' : isMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        <div className="flex-1" />

        {/* Mic state indicator — centred between Mute and End Room */}
        <div
          className="flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium"
          style={{
            background: micUnavailable
              ? 'rgba(234,179,8,0.07)'
              : isMuted
                ? 'rgba(239,68,68,0.06)'
                : isSpeakingSelf
                  ? 'rgba(139,92,246,0.12)'
                  : 'var(--bg-elevated)',
            border: `1px solid ${
              micUnavailable
                ? 'rgba(234,179,8,0.22)'
                : isMuted
                  ? 'rgba(239,68,68,0.15)'
                  : isSpeakingSelf
                    ? 'rgba(139,92,246,0.28)'
                    : 'var(--border)'
            }`,
            color: micUnavailable
              ? '#fde68a'
              : isMuted
                ? 'rgba(252,165,165,0.5)'
                : isSpeakingSelf
                  ? '#c4b5fd'
                  : 'var(--text-muted)',
          }}
        >
          {micUnavailable ? (
            <>
              <AlertTriangle size={12} />
              <span className="ml-1">No mic access</span>
            </>
          ) : !isMuted && isSpeakingSelf ? (
            <>
              <VoiceActivityBars />
              <span className="ml-1">Speaking</span>
            </>
          ) : (
            <>
              {isMuted ? <MicOff size={12} /> : <Mic size={12} />}
              <span className="ml-1">{isMuted ? 'Mic off' : 'Mic on'}</span>
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Leave / end — pushed to the right */}
        {isHost ? (
          <button
            onClick={onEndRoom}
            disabled={pending}
            className="flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium"
            style={{
              background: pending ? 'rgba(255,255,255,0.04)' : 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.28)',
              color: pending ? 'rgba(255,255,255,0.32)' : '#fca5a5',
            }}
          >
            <PhoneOff size={14} />
            {pending ? 'Ending...' : 'End Room'}
          </button>
        ) : (
          <button
            onClick={onLeave}
            disabled={pending}
            className="flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium"
            style={{
              background: pending ? 'rgba(255,255,255,0.04)' : 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: pending ? 'rgba(255,255,255,0.32)' : 'var(--text-secondary)',
            }}
          >
            <PhoneOff size={14} />
            {pending ? 'Leaving...' : 'Leave'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Fullscreen participant overlay ──────────────────────────────────────────
// Shown in the top-right corner of the BroadcastViewport when the guest has
// entered fullscreen. Displays all participants with speaking rings.
// Placeholder: Codex will wire fullscreen speaking data if transport callbacks
// need re-attachment after the fullscreen context change.
function FullscreenParticipantOverlay({ participants }) {
  const visible = participants.slice(0, 6)
  const extra = Math.max(0, participants.length - 6)
  const anyoneSpeaking = participants.some((p) => p.isSpeaking)

  if (participants.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(6,6,12,0.65)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRadius: 12,
        padding: '7px 10px',
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {/* Mini waveform when anyone is speaking */}
      <AnimatePresence>
        {anyoneSpeaking && (
          <motion.div
            key="fs-wave"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 2 }}
          >
            {[3, 7, 5].map((h, i) => (
              <motion.span
                key={i}
                style={{ display: 'block', width: 2, borderRadius: 1, background: '#a78bfa', flexShrink: 0 }}
                animate={{ height: [h * 0.4, h, h * 0.4] }}
                transition={{ duration: 0.5 + i * 0.1, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stacked avatars */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {visible.map((p) => (
          <div
            key={p.id}
            title={p.name}
            style={{
              position: 'relative',
              width: 26,
              height: 26,
              flexShrink: 0,
              zIndex: p.isSpeaking ? 2 : 1,
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                overflow: 'hidden',
                border: p.isSpeaking ? '1.5px solid #a78bfa' : '1.5px solid rgba(0,0,0,0.7)',
                background: 'rgba(255,255,255,0.08)',
              }}
            >
              <img
                src={dicebearUrl(p.avatarStyle || 'bottts', p.avatarSeed || p.id || 'guest')}
                alt={p.name}
                style={{ width: '100%', height: '100%' }}
              />
            </div>

            {/* Speaking pulse ring */}
            <AnimatePresence>
              {p.isSpeaking && (
                <motion.span
                  key="fs-ring"
                  style={{
                    position: 'absolute',
                    inset: -2,
                    borderRadius: 10,
                    border: '2px solid #a78bfa',
                    pointerEvents: 'none',
                  }}
                  animate={{ opacity: [0.9, 0.3, 0.9], scale: [1, 1.07, 1] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </AnimatePresence>

            {/* Muted badge */}
            {p.isMuted && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -3,
                  right: -3,
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  background: 'rgba(239,68,68,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MicOff size={7} color="#fff" />
              </div>
            )}

            {/* Host crown */}
            {p.isHost && (
              <div
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  background: 'rgba(234,179,8,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Crown size={7} color="#1a1000" />
              </div>
            )}
          </div>
        ))}

        {extra > 0 && (
          <span
            style={{
              marginLeft: 5,
              fontSize: 10,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.45)',
              flexShrink: 0,
            }}
          >
            +{extra}
          </span>
        )}
      </div>
    </div>
  )
}

function getBroadcastMessage({
  isHost,
  broadcastStatus,
  transportState,
  transportConfigured,
  hasPlaybackSurface,
  remoteMediaReady,
}) {
  if (!transportConfigured) {
    return {
      title: 'Transport not configured',
      detail: 'Configure the desktop LiveKit runtime or provide a web token service before running Watch Party media tests.',
    }
  }

  if (transportState === 'connecting' || transportState === 'reconnecting' || transportState === 'signalreconnecting') {
    return {
      title: 'Connecting media transport',
      detail: isHost
        ? 'Preparing your Watch Party broadcast room.'
        : 'Joining the host broadcast room.',
    }
  }

  if (isHost) {
    if (broadcastStatus === 'publishing') {
      return {
        title: 'Broadcast is live',
        detail: 'Guests should now receive the active player output.',
      }
    }

    if (hasPlaybackSurface) {
      return {
        title: 'Source detected',
        detail: 'The active NOVA STREAM player is ready to publish as soon as the transport is fully connected.',
      }
    }

    return {
      title: 'Waiting for a title',
      detail: 'Open any movie, series, anime, or offline player in NOVA STREAM to start broadcasting it to guests.',
    }
  }

  if (remoteMediaReady || broadcastStatus === 'receiving') {
    return {
      title: 'Receiving host stream',
      detail: 'The host broadcast is attached below.',
    }
  }

  if (transportState === 'disconnected') {
    return {
      title: 'Host disconnected',
      detail: 'The host lost connection. Waiting for them to reconnect.',
    }
  }

  return {
    title: 'Waiting for host stream',
    detail: 'The room is live, but the host has not started publishing media yet.',
  }
}

function BroadcastViewport({
  isHost,
  broadcastStatus,
  broadcastLabel,
  transportState,
  transportConfigured,
  remoteMediaReady,
  remoteSubtitleText,
  remoteSubtitleVisible,
  hasPlaybackSurface,
  attachRemoteMedia,
  onRetryTransport,
  // New: participants list for fullscreen overlay
  participants,
}) {
  const containerRef = useRef(null)
  const guestVideoRef = useRef(null)
  const guestAudioRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const message = getBroadcastMessage({
    isHost,
    broadcastStatus,
    transportState,
    transportConfigured,
    hasPlaybackSurface,
    remoteMediaReady,
  })

  // Track fullscreen state via DOM events
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(
        Boolean(document.fullscreenElement) &&
        document.fullscreenElement === containerRef.current
      )
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    document.addEventListener('webkitfullscreenchange', handleFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
      document.removeEventListener('webkitfullscreenchange', handleFsChange)
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      containerRef.current.requestFullscreen?.()
    }
  }, [])

  useEffect(() => {
    if (isHost) {
      attachRemoteMedia({ videoElement: null, audioElement: null })
      return undefined
    }

    const reattachRemoteMedia = () => {
      attachRemoteMedia({
        videoElement: guestVideoRef.current,
        audioElement: guestAudioRef.current,
      })
    }

    const frameId = window.requestAnimationFrame(reattachRemoteMedia)

    return () => {
      window.cancelAnimationFrame(frameId)
      attachRemoteMedia({ videoElement: null, audioElement: null })
    }
  }, [attachRemoteMedia, isFullscreen, isHost, remoteMediaReady])

  const isConnecting = (
    transportState === 'connecting'
    || transportState === 'reconnecting'
    || transportState === 'signalreconnecting'
  )
  const isTransportError = transportState === 'error'
  const showPlaceholder = !remoteMediaReady || isHost

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 16,
        overflow: 'hidden',
        background: isTransportError ? 'rgba(239,68,68,0.05)' : '#000',
        border: `1px solid ${isTransportError ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.08)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Guest receiver video — hidden until remoteMediaReady */}
      {!isHost && (
        <>
          <video
            ref={guestVideoRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#000',
              opacity: remoteMediaReady ? 1 : 0,
              transition: 'opacity 0.4s ease',
            }}
            autoPlay
            playsInline
            controls={false}
          />
          <audio ref={guestAudioRef} autoPlay playsInline />
        </>
      )}

      {!isHost && remoteMediaReady && remoteSubtitleVisible && remoteSubtitleText && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 58,
            transform: 'translateX(-50%)',
            zIndex: 8,
            maxWidth: isFullscreen ? '72%' : '82%',
            padding: isFullscreen ? '10px 18px' : '8px 14px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.68)',
            color: '#fff',
            fontSize: isFullscreen ? 20 : 16,
            lineHeight: 1.45,
            textAlign: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {remoteSubtitleText}
        </div>
      )}

      {/* Placeholder shown when no stream or host view */}
      {showPlaceholder && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
          }}
        >
          {isConnecting ? (
            <div
              className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'rgba(139,92,246,0.25)', borderTopColor: 'var(--accent)' }}
            />
          ) : (
            <Radio
              size={28}
              style={{ color: isTransportError ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.18)' }}
            />
          )}

          <div className="text-center max-w-md">
            <p
              className="text-sm font-medium"
              style={{ color: isTransportError ? '#fca5a5' : 'rgba(255,255,255,0.72)' }}
            >
              {message.title}
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: isTransportError ? 'rgba(252,165,165,0.55)' : 'rgba(255,255,255,0.42)' }}
            >
              {message.detail}
            </p>
            {isHost && broadcastLabel && (
              <p className="text-[11px] mt-3 font-medium" style={{ color: '#c4b5fd' }}>
                Active source: {broadcastLabel}
              </p>
            )}
            {isTransportError && onRetryTransport && (
              <button
                onClick={onRetryTransport}
                className="flex items-center gap-1.5 mx-auto mt-4 px-4 h-8 rounded-xl text-xs font-medium"
                style={{
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  color: '#fca5a5',
                }}
              >
                <RefreshCw size={12} />
                Retry Connection
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom-left: live stream badge */}
      {!isHost && remoteMediaReady && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <motion.span
            style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0, display: 'block' }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <span style={{ fontSize: 11, fontWeight: 500, color: '#6ee7b7' }}>Live stream</span>
        </div>
      )}

      {/* Bottom-right: fullscreen toggle — guests only */}
      {!isHost && (
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            zIndex: 5,
            width: 30,
            height: 30,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.75)',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      )}

      {/* Top-right: fullscreen participant overlay — only visible in fullscreen */}
      {isFullscreen && Array.isArray(participants) && participants.length > 0 && (
        <FullscreenParticipantOverlay participants={participants} />
      )}
    </div>
  )
}

// Host-only broadcast management strip shown when the room is live
function HostBroadcastControls({
  broadcastStatus,
  transportState,
  pending,
  hasPlaybackSurface,
  onStopBroadcast,
  onResumeBroadcast,
}) {
  const isConnecting = (
    transportState === 'connecting'
    || transportState === 'reconnecting'
    || transportState === 'signalreconnecting'
  )
  const isPublishing = broadcastStatus === 'publishing'
  const isAwaitingSource = broadcastStatus === 'awaiting-source'

  if (!isPublishing && !isAwaitingSource) return null

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
      style={{
        background: isPublishing ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isPublishing ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)'}`,
      }}
    >
      {isPublishing ? (
        <>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <motion.span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: '#ef4444' }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-xs font-medium" style={{ color: '#fca5a5' }}>
              Broadcasting to guests
            </span>
          </div>
          <button
            onClick={onStopBroadcast}
            disabled={pending}
            className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium flex-shrink-0"
            style={{
              background: pending ? 'rgba(255,255,255,0.04)' : 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: pending ? 'rgba(255,255,255,0.32)' : '#fca5a5',
            }}
          >
            <Square size={9} fill="currentColor" />
            Stop Broadcast
          </button>
        </>
      ) : (
        <div className="flex items-center gap-3 flex-wrap w-full">
          <p className="text-xs flex-1 min-w-[220px]" style={{ color: 'var(--text-muted)' }}>
            {isConnecting
              ? 'Connecting media transport...'
              : hasPlaybackSurface
                ? 'Current player is ready. Resume it or open another NOVA STREAM player to broadcast to guests.'
                : 'Open any NOVA STREAM player to start broadcasting to your guests.'}
          </p>
          {hasPlaybackSurface && (
            <button
              onClick={onResumeBroadcast}
              disabled={pending || isConnecting}
              className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium flex-shrink-0"
              style={{
                background: pending ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: pending ? 'rgba(255,255,255,0.32)' : 'var(--text-secondary)',
              }}
            >
              <Play size={10} fill="currentColor" />
              Resume Broadcast
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function InRoom({
  roomCode,
  roomState,
  isHost,
  participants,
  isMuted,
  pending,
  userId,
  transportState,
  broadcastStatus,
  broadcastLabel,
  remoteMediaReady,
  remoteSubtitleText,
  remoteSubtitleVisible,
  transportConfigured,
  hasPlaybackSurface,
  attachRemoteMedia,
  onToggleMute,
  onLeave,
  onEndRoom,
  onStopBroadcast,
  onResumeBroadcast,
  onRetryTransport,
  micUnavailable,
}) {
  const selfParticipant = participants.find((p) => p.userId === userId)
  const isSpeakingSelf = Boolean(selfParticipant?.isSpeaking)

  return (
    <motion.div className="flex flex-col gap-4 w-full max-w-5xl" {...fadeUp}>
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="font-display font-semibold text-xl" style={{ color: 'var(--text-primary)' }}>
            Watch Party
          </h2>
          <RoomStateBadge roomState={roomState} />
          <BroadcastStatusBadge
            transportState={transportState}
            broadcastStatus={broadcastStatus}
            isHost={isHost}
          />
        </div>
        <RoomCodeBadge code={roomCode} />
      </div>

      {/* ── Transport config warning ── */}
      {!transportConfigured && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-xl"
          style={{
            background: 'rgba(234,179,8,0.07)',
            border: '1px solid rgba(234,179,8,0.2)',
          }}
        >
          <AlertTriangle size={15} style={{ color: '#fde68a', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: '#fde68a' }}>
              Media transport not configured
            </p>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'rgba(253,230,138,0.6)' }}>
              Watch Party video and voice require LiveKit. For the desktop app, set{' '}
              <span className="font-mono">WATCH_PARTY_LIVEKIT_URL</span>,{' '}
              <span className="font-mono">WATCH_PARTY_LIVEKIT_API_KEY</span>, and{' '}
              <span className="font-mono">WATCH_PARTY_LIVEKIT_API_SECRET</span>. Web builds can still use{' '}
              <span className="font-mono">VITE_WATCH_PARTY_LIVEKIT_URL</span> and{' '}
              <span className="font-mono">VITE_WATCH_PARTY_TOKEN_ENDPOINT</span>.
            </p>
          </div>
        </div>
      )}

      {/* ── Video surface — full width, 16:9 ── */}
      <BroadcastViewport
        isHost={isHost}
        broadcastStatus={broadcastStatus}
        broadcastLabel={broadcastLabel}
        transportState={transportState}
        transportConfigured={transportConfigured}
        remoteMediaReady={remoteMediaReady}
        remoteSubtitleText={remoteSubtitleText}
        remoteSubtitleVisible={remoteSubtitleVisible}
        hasPlaybackSurface={hasPlaybackSurface}
        attachRemoteMedia={attachRemoteMedia}
        onRetryTransport={onRetryTransport}
        participants={participants}
      />

      {/* ── Host broadcast controls ── */}
      {isHost && (
        <HostBroadcastControls
          broadcastStatus={broadcastStatus}
          transportState={transportState}
          pending={pending}
          hasPlaybackSurface={hasPlaybackSurface}
          onStopBroadcast={onStopBroadcast}
          onResumeBroadcast={onResumeBroadcast}
        />
      )}

      {/* ── Participants + voice controls — stacked ── */}
      <div
        className="flex flex-col gap-4"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '14px 16px',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        {/* Participant avatars row */}
        <div>
          <p
            className="text-[10px] font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            In Room{participants.length > 0 && ` · ${participants.length}`}
          </p>

          {participants.length === 0 ? (
            <div className="flex items-center gap-2 py-1">
              <Users size={14} style={{ color: 'rgba(255,255,255,0.2)' }} />
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Participants appear here while the room is live.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {participants.map((participant) => (
                <ParticipantAvatar key={participant.id} participant={participant} size={40} showName />
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Voice controls below participants */}
        <VoiceControls
          isMuted={isMuted}
          isSpeakingSelf={isSpeakingSelf}
          onToggleMute={onToggleMute}
          onLeave={onLeave}
          isHost={isHost}
          onEndRoom={onEndRoom}
          pending={pending}
          micUnavailable={micUnavailable}
        />
      </div>
    </motion.div>
  )
}

function Ended({ reason, onReturn }) {
  const lower = String(reason || '').toLowerCase()

  let title = 'Watch Party ended'
  let detail = 'The session has been closed.'
  let EndIcon = PhoneOff

  if (lower.includes('no longer part') || lower.includes('removed')) {
    title = 'Removed from room'
    detail = 'You are no longer a participant in this Watch Party.'
    EndIcon = UserPlus
  } else if (lower.includes('no longer available') || lower.includes('unavailable')) {
    title = 'Room unavailable'
    detail = 'This Watch Party room no longer exists.'
    EndIcon = WifiOff
  } else if (lower.includes('disconnected') || lower.includes('host has left')) {
    title = 'Host disconnected'
    detail = 'The host left the session unexpectedly.'
    EndIcon = WifiOff
  } else if (lower.includes('host ended') || lower.includes('ended this')) {
    title = 'Watch Party ended'
    detail = 'The host ended the session.'
  }

  return (
    <motion.div className="flex flex-col items-center justify-center flex-1 py-16 gap-5" {...fadeUp}>
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <EndIcon size={26} style={{ color: 'var(--text-muted)' }} />
      </div>
      <div className="text-center max-w-xs">
        <p className="font-display font-semibold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </p>
        {reason && (
          <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {reason}
          </p>
        )}
      </div>
      {onReturn && (
        <GhostButton onClick={onReturn}>
          <Users size={15} />
          Start a New Watch Party
        </GhostButton>
      )}
    </motion.div>
  )
}

export default function WatchParty() {
  const { user, setAuthModalOpen } = useAuthStore()

  const status = useWatchPartyStore((state) => state.status)
  const roomCode = useWatchPartyStore((state) => state.roomCode)
  const roomState = useWatchPartyStore((state) => state.roomState)
  const isHost = useWatchPartyStore((state) => state.isHost)
  const participants = useWatchPartyStore((state) => state.participants)
  const isMuted = useWatchPartyStore((state) => state.isMuted)
  const entryPending = useWatchPartyStore((state) => state.entryPending)
  const error = useWatchPartyStore((state) => state.error)
  const transportConfigured = useWatchPartyStore((state) => state.transportConfigured)
  const transportState = useWatchPartyStore((state) => state.transportState)
  const broadcastStatus = useWatchPartyStore((state) => state.broadcastStatus)
  const broadcastLabel = useWatchPartyStore((state) => state.broadcastLabel)
  const remoteMediaReady = useWatchPartyStore((state) => state.remoteMediaReady)
  const remoteSubtitleText = useWatchPartyStore((state) => state.remoteSubtitleText)
  const remoteSubtitleVisible = useWatchPartyStore((state) => state.remoteSubtitleVisible)
  const hasPlaybackSurface = useWatchPartyStore((state) => state.hasPlaybackSurface)

  const beginCreate = useWatchPartyStore((state) => state.beginCreate)
  const beginJoin = useWatchPartyStore((state) => state.beginJoin)
  const cancelFlow = useWatchPartyStore((state) => state.cancelFlow)
  const clearSession = useWatchPartyStore((state) => state.clearSession)
  const createRoom = useWatchPartyStore((state) => state.createRoom)
  const hydrateActiveRoom = useWatchPartyStore((state) => state.hydrateActiveRoom)
  const refreshTransportConfiguration = useWatchPartyStore((state) => state.refreshTransportConfiguration)
  const joinRoom = useWatchPartyStore((state) => state.joinRoom)
  const startBroadcast = useWatchPartyStore((state) => state.startBroadcast)
  const stopBroadcast = useWatchPartyStore((state) => state.stopBroadcast)
  const resumeBroadcast = useWatchPartyStore((state) => state.resumeBroadcast)
  const endRoom = useWatchPartyStore((state) => state.endRoom)
  const leaveRoom = useWatchPartyStore((state) => state.leaveRoom)
  const toggleMute = useWatchPartyStore((state) => state.toggleMute)
  const attachRemoteMedia = useWatchPartyStore((state) => state.attachRemoteMedia)
  const syncTransport = useWatchPartyStore((state) => state.syncTransport)

  // Derived: mic unavailable when muted AND error mentions mic/voice/audio/permission
  const micUnavailable = isMuted && Boolean(error) && /mic|voice|audio|permission|denied/i.test(error)

  useEffect(() => {
    if (!user) {
      void clearSession()
    }
  }, [clearSession, user])

  useEffect(() => {
    if (user) {
      void hydrateActiveRoom()
    }
  }, [hydrateActiveRoom, user])

  useEffect(() => {
    if (user) {
      void refreshTransportConfiguration()
    }
  }, [refreshTransportConfiguration, user])

  return (
    <div className="flex flex-col min-h-full px-6 py-6 items-center">
      {user && <ErrorBanner message={error} />}

      <AnimatePresence mode="wait">
        {!user && (
          <motion.div key="signed-out" className="flex flex-col flex-1" {...fadeUp}>
            <SignedOutGate onSignIn={() => setAuthModalOpen(true)} />
          </motion.div>
        )}

        {user && status === 'ended' && (
          <motion.div key="ended" className="flex flex-col flex-1" {...fadeUp}>
            <Ended reason={error} onReturn={clearSession} />
          </motion.div>
        )}

        {user && status === 'idle' && entryPending && (
          <motion.div key="hydrating" className="flex flex-col flex-1 items-center justify-center py-16 gap-3" {...fadeUp}>
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'rgba(139,92,246,0.25)', borderTopColor: 'var(--accent)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Reconnecting to room...
            </span>
          </motion.div>
        )}

        {user && status === 'idle' && !entryPending && (
          <motion.div key="landing" {...fadeUp}>
            <Landing onStart={beginCreate} onJoin={beginJoin} />
          </motion.div>
        )}

        {user && status === 'creating' && (
          <motion.div key="creating" {...fadeUp}>
            <StartFlow onBack={cancelFlow} onCreate={createRoom} pending={entryPending} />
          </motion.div>
        )}

        {user && status === 'joining' && (
          <motion.div key="joining" {...fadeUp}>
            <JoinFlow onBack={cancelFlow} onJoin={joinRoom} pending={entryPending} entryError={error} />
          </motion.div>
        )}

        {user && status === 'lobby' && (
          <motion.div key="lobby" {...fadeUp}>
            <Lobby
              roomCode={roomCode}
              roomState={roomState}
              isHost={isHost}
              participants={participants}
              onStart={startBroadcast}
              onLeave={isHost ? endRoom : leaveRoom}
              pending={entryPending}
            />
          </motion.div>
        )}

        {user && status === 'live' && (
          <motion.div key="live" {...fadeUp}>
            <InRoom
              roomCode={roomCode}
              roomState={roomState}
              isHost={isHost}
              participants={participants}
              isMuted={isMuted}
              pending={entryPending}
              userId={user.id}
              transportState={transportState}
              broadcastStatus={broadcastStatus}
              broadcastLabel={broadcastLabel}
              remoteMediaReady={remoteMediaReady}
              remoteSubtitleText={remoteSubtitleText}
              remoteSubtitleVisible={remoteSubtitleVisible}
              transportConfigured={transportConfigured}
              hasPlaybackSurface={hasPlaybackSurface}
              attachRemoteMedia={attachRemoteMedia}
              onToggleMute={toggleMute}
              onLeave={leaveRoom}
              onEndRoom={endRoom}
              onStopBroadcast={stopBroadcast}
              onResumeBroadcast={resumeBroadcast}
              onRetryTransport={() => syncTransport({ forceReconnect: true })}
              micUnavailable={micUnavailable}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
