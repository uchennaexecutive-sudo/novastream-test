import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Eye, EyeOff, ArrowLeft, Mail, User, Lock, Check } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { dicebearUrl } from '../lib/supabaseClient'

// --- Avatar catalogue ---
const AVATAR_STYLES = [
  { id: 'bottts', label: 'Bot' },
  { id: 'pixel-art', label: 'Pixel' },
  { id: 'adventurer', label: 'Hero' },
  { id: 'lorelei', label: 'Soft' },
  { id: 'thumbs', label: 'Thumb' },
  { id: 'micah', label: 'Sketch' },
]
const AVATAR_SEEDS = [
  'nova', 'stream', 'cosmic', 'ember', 'stellar',
  'aurora', 'midnight', 'pixel', 'nebula', 'quasar',
]

// Card animation variants
const cardVariants = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.38, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, y: -16, scale: 0.97, transition: { duration: 0.22 } },
}

// --- Shared input component ---
function AuthInput({ icon: Icon, type = 'text', placeholder, value, onChange, autoComplete, rightSlot }) {
  return (
    <div className="relative flex items-center">
      <Icon size={15} className="absolute left-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full text-sm outline-none"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 10,
          padding: '11px 14px 11px 38px',
          color: 'var(--text-primary)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
          paddingRight: rightSlot ? 40 : 14,
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb,220,38,38),0.5)'
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(var(--accent-rgb,220,38,38),0.12)'
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      />
      {rightSlot && (
        <div className="absolute right-3 flex items-center">{rightSlot}</div>
      )}
    </div>
  )
}

// --- Primary action button ---
function AuthButton({ children, loading, onClick, type = 'submit' }) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={loading}
      className="w-full py-3 rounded-xl text-sm font-semibold relative overflow-hidden cursor-pointer"
      style={{
        background: loading ? 'rgba(220,38,38,0.5)' : 'var(--accent)',
        color: '#fff',
        boxShadow: loading ? 'none' : '0 0 24px var(--accent-glow)',
        border: 'none',
      }}
      whileHover={loading ? {} : { boxShadow: '0 0 32px var(--accent-glow-strong)' }}
      whileTap={loading ? {} : { scale: 0.98 }}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          Please wait...
        </span>
      ) : children}
    </motion.button>
  )
}

// --- Error display ---
function AuthError({ message }) {
  if (!message) return null
  return (
    <motion.p
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-xs text-center py-2 px-3 rounded-lg"
      style={{ background: 'rgba(220,38,38,0.1)', color: '#f87171', border: '1px solid rgba(220,38,38,0.2)' }}
    >
      {message}
    </motion.p>
  )
}

// --- SIGN UP CARD ---
function SignUpCard({ onDone, onSwitchToSignIn }) {
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp } = useAuthStore()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.username.trim()) return setError('Username is required.')
    if (!form.email.trim()) return setError('Email is required.')
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    setLoading(true)
    try {
      await signUp(form.email, form.password, form.username)
      onDone(form.username)
    } catch (err) {
      setError(err.message || 'Sign up failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Create your account
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Save your watchlist and history across devices.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <AuthInput
          icon={User} placeholder="Username" value={form.username}
          onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
          autoComplete="username"
        />
        <AuthInput
          icon={Mail} placeholder="Email address" value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          autoComplete="email"
        />
        <AuthInput
          icon={Lock} type={showPw ? 'text' : 'password'} placeholder="Password (min 6 chars)"
          value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          autoComplete="new-password"
          rightSlot={
            <button type="button" onClick={() => setShowPw(v => !v)} style={{ color: 'var(--text-muted)', cursor: 'pointer' }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />
      </div>

      <AuthError message={error} />
      <AuthButton loading={loading}>Create account</AuthButton>

      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToSignIn} className="font-medium cursor-pointer" style={{ color: 'var(--accent)' }}>
          Sign in
        </button>
      </p>
    </form>
  )
}

// --- SIGN IN CARD ---
function SignInCard({ onDone, onSwitchToSignUp, onForgot }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuthStore()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.email.trim()) return setError('Email is required.')
    if (!form.password) return setError('Password is required.')
    setLoading(true)
    try {
      await signIn(form.email, form.password)
      onDone()
    } catch (err) {
      setError(err.message || 'Incorrect email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Welcome back
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Sign in to access your watchlist and history.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <AuthInput
          icon={Mail} placeholder="Email address" value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          autoComplete="email"
        />
        <AuthInput
          icon={Lock} type={showPw ? 'text' : 'password'} placeholder="Password"
          value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          autoComplete="current-password"
          rightSlot={
            <button type="button" onClick={() => setShowPw(v => !v)} style={{ color: 'var(--text-muted)', cursor: 'pointer' }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />
      </div>

      <div className="flex justify-end -mt-1">
        <button type="button" onClick={onForgot} className="text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          Forgot password?
        </button>
      </div>

      <AuthError message={error} />
      <AuthButton loading={loading}>Sign in</AuthButton>

      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Don't have an account?{' '}
        <button type="button" onClick={onSwitchToSignUp} className="font-medium cursor-pointer" style={{ color: 'var(--accent)' }}>
          Sign up
        </button>
      </p>
    </form>
  )
}

// --- FORGOT PASSWORD CARD ---
function ForgotCard({ onBack }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { resetPassword } = useAuthStore()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Email is required.')
    setLoading(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      setError(err.message || 'Failed to send reset link.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs cursor-pointer w-fit" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={13} /> Back to sign in
      </button>

      <div>
        <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Reset password
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Enter your email and we'll send a reset link.
        </p>
      </div>

      {sent ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 py-4"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.15)' }}>
            <Check size={22} style={{ color: '#22c55e' }} />
          </div>
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Reset link sent to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.<br />
            Check your inbox.
          </p>
        </motion.div>
      ) : (
        <>
          <AuthInput
            icon={Mail} placeholder="Email address" value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
          <AuthError message={error} />
          <AuthButton loading={loading}>Send reset link</AuthButton>
        </>
      )}
    </form>
  )
}

// --- AVATAR PICKER CARD ---
function AvatarCard({ username, onDone }) {
  const [activeStyle, setActiveStyle] = useState('bottts')
  const [selected, setSelected] = useState({ style: 'bottts', seed: 'nova' })
  const [saving, setSaving] = useState(false)
  const { updateProfile } = useAuthStore()

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateProfile({ avatar_style: selected.style, avatar_seed: selected.seed })
    } catch {
      // non-fatal — profile will be updated on next fetch
    }
    onDone()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h2 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--text-primary)' }}>
          Choose your avatar
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Pick one. You can always change it later.
        </p>
      </div>

      {/* Preview */}
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)', border: '2px solid var(--accent)' }}>
          <img src={dicebearUrl(selected.style, selected.seed)} alt="Selected avatar" className="w-full h-full" />
        </div>
      </div>

      {/* Style tabs */}
      <div className="flex gap-1.5 flex-wrap justify-center">
        {AVATAR_STYLES.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => { setActiveStyle(s.id); setSelected(sel => ({ ...sel, style: s.id })) }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all duration-150"
            style={{
              background: activeStyle === s.id ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
              color: activeStyle === s.id ? '#fff' : 'var(--text-secondary)',
              border: activeStyle === s.id ? 'none' : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Seed grid */}
      <div className="grid grid-cols-5 gap-2">
        {AVATAR_SEEDS.map(seed => {
          const isSelected = selected.style === activeStyle && selected.seed === seed
          return (
            <button
              key={seed}
              type="button"
              onClick={() => setSelected({ style: activeStyle, seed })}
              className="relative aspect-square rounded-xl overflow-hidden cursor-pointer transition-all duration-150"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                boxShadow: isSelected ? '0 0 12px var(--accent-glow)' : 'none',
              }}
            >
              <img src={dicebearUrl(activeStyle, seed)} alt={seed} className="w-full h-full" loading="lazy" />
              {isSelected && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.15)' }}>
                  <Check size={14} style={{ color: 'var(--accent)' }} />
                </div>
              )}
            </button>
          )
        })}
      </div>

      <AuthButton loading={saving} onClick={handleSave} type="button">
        {saving ? 'Saving...' : 'Start watching'}
      </AuthButton>
    </div>
  )
}

// --- ANIMATED BACKGROUND ---
function AuthBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Deep base */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 0%, #0d0a1a 0%, #000 70%)' }} />

      {/* Orb 1 — accent red/violet */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 700, height: 700,
          background: 'radial-gradient(circle, rgba(220,38,38,0.18) 0%, transparent 70%)',
          top: '-200px', left: '-100px',
          filter: 'blur(60px)',
        }}
        animate={{ x: [0, 40, 0], y: [0, 20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Orb 2 — deep purple */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 600, height: 600,
          background: 'radial-gradient(circle, rgba(109,40,217,0.14) 0%, transparent 70%)',
          bottom: '-100px', right: '-100px',
          filter: 'blur(80px)',
        }}
        animate={{ x: [0, -30, 0], y: [0, -25, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />

      {/* Orb 3 — blue accent center */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 400, height: 400,
          background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
          top: '40%', left: '55%',
          filter: 'blur(50px)',
        }}
        animate={{ x: [0, 20, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
      />

      {/* Fine grain noise overlay */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
        }}
      />
    </div>
  )
}

// --- MAIN AUTH COMPONENT ---
export default function Auth({ onComplete, closeable = false, onClose }) {
  const [view, setView] = useState('signup') // 'signup' | 'signin' | 'forgot' | 'avatar'
  const [pendingUsername, setPendingUsername] = useState('')

  const handleSignUpDone = useCallback((username) => {
    setPendingUsername(username)
    setView('avatar')
  }, [])

  const handleSignInDone = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleAvatarDone = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleSkip = useCallback(() => {
    onComplete()
  }, [onComplete])

  const isAvatarView = view === 'avatar'

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      <AuthBackground />

      {/* Logo top-left */}
      <div className="absolute top-6 left-7 flex items-center gap-2.5 pointer-events-none select-none">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center font-display font-bold text-sm"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 16px var(--accent-glow)' }}
        >
          N
        </div>
        <span className="font-display font-bold text-sm tracking-wide" style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--accent)' }}>NOVA</span> STREAM
        </span>
      </div>

      {/* Close (X) button — only when closeable */}
      {closeable && onClose && (
        <motion.button
          onClick={onClose}
          className="absolute top-6 right-6 w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}
          whileHover={{ background: 'rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
          whileTap={{ scale: 0.93 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <X size={16} />
        </motion.button>
      )}

      {/* Glass card */}
      <div
        className="relative w-full overflow-y-auto"
        style={{
          maxWidth: 420,
          maxHeight: 'calc(100vh - 80px)',
          background: 'rgba(8,8,18,0.82)',
          backdropFilter: 'blur(60px) saturate(160%)',
          WebkitBackdropFilter: 'blur(60px) saturate(160%)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
          padding: isAvatarView ? '28px 28px 32px' : '32px 32px 36px',
        }}
      >
        <AnimatePresence mode="wait">
          {view === 'signup' && (
            <motion.div key="signup" variants={cardVariants} initial="initial" animate="animate" exit="exit">
              <SignUpCard onDone={handleSignUpDone} onSwitchToSignIn={() => setView('signin')} />
            </motion.div>
          )}

          {view === 'signin' && (
            <motion.div key="signin" variants={cardVariants} initial="initial" animate="animate" exit="exit">
              <SignInCard
                onDone={handleSignInDone}
                onSwitchToSignUp={() => setView('signup')}
                onForgot={() => setView('forgot')}
              />
            </motion.div>
          )}

          {view === 'forgot' && (
            <motion.div key="forgot" variants={cardVariants} initial="initial" animate="animate" exit="exit">
              <ForgotCard onBack={() => setView('signin')} />
            </motion.div>
          )}

          {view === 'avatar' && (
            <motion.div key="avatar" variants={cardVariants} initial="initial" animate="animate" exit="exit">
              <AvatarCard username={pendingUsername} onDone={handleAvatarDone} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Skip link — hidden on avatar step (use "Start watching" button there) */}
      {!isAvatarView && (
        <motion.button
          onClick={handleSkip}
          className="absolute bottom-7 left-1/2 -translate-x-1/2 text-xs cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          whileHover={{ color: 'var(--text-secondary)' }}
        >
          Continue without account →
        </motion.button>
      )}
    </div>
  )
}
