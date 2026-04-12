import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, LogOut, Trash2, Lock, ChevronRight, User, Clock, Film, Star } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { getHistory } from '../lib/supabase'
import { getAllProgressRows } from '../lib/progress'
import { dicebearUrl, supabase } from '../lib/supabaseClient'
import { hasUserDataScope, subscribeUserDataChanged } from '../lib/userDataEvents'

// Shared avatar catalogue (must match Auth.jsx)
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

function Avatar({ style, seed, size = 96 }) {
  const url = style && seed ? dicebearUrl(style, seed) : dicebearUrl('bottts', 'nova')
  return (
    <div
      className="rounded-2xl overflow-hidden flex-shrink-0"
      style={{
        width: size, height: size,
        background: 'rgba(255,255,255,0.06)',
        border: '2px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <img src={url} alt="Avatar" className="w-full h-full" />
    </div>
  )
}

function StatCard({ icon: Icon, value, label }) {
  return (
    <div
      className="flex-1 flex flex-col items-center gap-1.5 py-4 px-3 rounded-2xl"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <Icon size={16} style={{ color: 'var(--accent)' }} />
      <span className="font-display font-bold text-xl" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  )
}

function SettingRow({ icon: Icon, label, value, onClick, danger = false }) {
  return (
    <motion.button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer text-left"
      style={{
        background: 'transparent',
        border: '1px solid transparent',
        color: danger ? '#f87171' : 'var(--text-primary)',
      }}
      whileHover={{
        background: danger ? 'rgba(220,38,38,0.06)' : 'var(--bg-surface)',
        borderColor: danger ? 'rgba(220,38,38,0.15)' : 'var(--border)',
      }}
      whileTap={{ scale: 0.99 }}
    >
      <Icon size={16} style={{ color: danger ? '#f87171' : 'var(--text-muted)' }} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {value && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{value}</span>}
      {!danger && <ChevronRight size={14} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />}
    </motion.button>
  )
}

// --- Inline editable username ---
function EditUsername({ current, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current || '')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!value.trim() || value === current) { setEditing(false); return }
    setLoading(true)
    await onSave(value.trim())
    setLoading(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
          className="text-lg font-bold outline-none bg-transparent border-b"
          style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)', minWidth: 0, width: `${Math.max(value.length, 6)}ch` }}
        />
        <button onClick={handleSave} disabled={loading} className="cursor-pointer" style={{ color: 'var(--accent)' }}>
          {loading ? <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg> : <Check size={14} />}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-2 cursor-pointer group"
    >
      <span className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
        {current || 'No username'}
      </span>
      <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }}>
        edit
      </span>
    </button>
  )
}

// --- Avatar picker sheet ---
function AvatarPickerSheet({ current, onSave, onClose }) {
  const [activeStyle, setActiveStyle] = useState(current.style || 'bottts')
  const [selected, setSelected] = useState(current)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSave(selected)
    setSaving(false)
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-end justify-center"
      style={{ zIndex: 200, background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        className="w-full max-w-lg rounded-t-3xl p-6 pb-8"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
            Change Avatar
          </h3>
          <button onClick={onClose} className="text-sm cursor-pointer" style={{ color: 'var(--text-muted)' }}>Done</button>
        </div>

        {/* Preview */}
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl overflow-hidden" style={{ border: '2px solid var(--accent)' }}>
            <img src={dicebearUrl(selected.style, selected.seed)} alt="Preview" className="w-full h-full" />
          </div>
        </div>

        {/* Style tabs */}
        <div className="flex gap-1.5 flex-wrap mb-4">
          {AVATAR_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => { setActiveStyle(s.id); setSelected(sel => ({ ...sel, style: s.id })) }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
              style={{
                background: activeStyle === s.id ? 'var(--accent)' : 'var(--bg-surface)',
                color: activeStyle === s.id ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${activeStyle === s.id ? 'transparent' : 'var(--border)'}`,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Seed grid */}
        <div className="grid grid-cols-5 gap-2 mb-5">
          {AVATAR_SEEDS.map(seed => {
            const isSelected = selected.style === activeStyle && selected.seed === seed
            return (
              <button
                key={seed}
                onClick={() => setSelected({ style: activeStyle, seed })}
                className="relative aspect-square rounded-xl overflow-hidden cursor-pointer"
                style={{
                  background: 'var(--bg-surface)',
                  border: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                  boxShadow: isSelected ? '0 0 10px var(--accent-glow)' : 'none',
                }}
              >
                <img src={dicebearUrl(activeStyle, seed)} alt={seed} className="w-full h-full" loading="lazy" />
                {isSelected && (
                  <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                    <Check size={9} style={{ color: '#fff' }} />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        <motion.button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl text-sm font-semibold cursor-pointer"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 20px var(--accent-glow)' }}
          whileHover={{ boxShadow: '0 0 28px var(--accent-glow-strong)' }}
          whileTap={{ scale: 0.98 }}
        >
          {saving ? 'Saving...' : 'Save avatar'}
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

// --- Change password modal ---
function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password: form.password })
      if (err) throw err
      setSuccess(true)
      setTimeout(onClose, 1500)
    } catch (err) {
      setError(err.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 200, background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <h3 className="font-display font-semibold text-base mb-4" style={{ color: 'var(--text-primary)' }}>Change Password</h3>
        {success ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.15)' }}>
              <Check size={18} style={{ color: '#22c55e' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Password updated!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password" placeholder="New password" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full text-sm outline-none px-3 py-2.5 rounded-xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <input
              type="password" placeholder="Confirm new password" value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full text-sm outline-none px-3 py-2.5 rounded-xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm cursor-pointer" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl text-sm font-semibold cursor-pointer" style={{ background: 'var(--accent)', color: '#fff' }}>
                {loading ? 'Saving...' : 'Update'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  )
}

// --- Delete account confirmation ---
function DeleteAccountModal({ onClose, onConfirm }) {
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    if (!confirmed) return
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 200, background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(220,38,38,0.25)' }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(220,38,38,0.12)' }}>
            <Trash2 size={16} style={{ color: '#f87171' }} />
          </div>
          <div>
            <h3 className="font-display font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Delete account</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>This cannot be undone</p>
          </div>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Your watchlist, history, and profile will be permanently deleted. Local data remains on this device.
        </p>
        <label className="flex items-center gap-2.5 cursor-pointer mb-4">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="rounded" />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>I understand this is permanent</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm cursor-pointer" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
          <button
            onClick={handleDelete}
            disabled={!confirmed || loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
            style={{
              background: confirmed ? 'rgba(220,38,38,0.85)' : 'rgba(220,38,38,0.3)',
              color: confirmed ? '#fff' : '#f87171',
            }}
          >
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// --- MAIN PROFILE PAGE ---
export default function Profile() {
  const navigate = useNavigate()
  const { user, profile, updateProfile, signOut, deleteAccount } = useAuthStore()
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [stats, setStats] = useState({ titles: 0, hours: 0 })

  // Redirect if not signed in
  useEffect(() => {
    if (!user) navigate('/', { replace: true })
  }, [user, navigate])

  const loadStats = useCallback(async () => {
    try {
      const [historyItems, progressRows] = await Promise.all([
        getHistory(),
        getAllProgressRows(),
      ])

      const titleKeys = new Set()
      for (const item of historyItems) {
        titleKeys.add(`${item.media_type || 'movie'}::${item.tmdb_id}`)
      }
      for (const row of progressRows) {
        titleKeys.add(`${row.content_type || 'movie'}::${row.content_id}`)
      }

      const totalSecondsFromProgress = progressRows.reduce((sum, row) => (
        sum + Math.max(0, Number(row?.progress_seconds || 0))
      ), 0)
      const fallbackHistorySeconds = historyItems.reduce((sum, item) => (
        sum + Math.max(0, Number(item?.progress_seconds || 0))
      ), 0)

      setStats({
        titles: titleKeys.size,
        hours: Math.round((totalSecondsFromProgress || fallbackHistorySeconds) / 3600),
      })
    } catch {
      setStats({ titles: 0, hours: 0 })
    }
  }, [])

  useEffect(() => {
    if (!user) return undefined
    void loadStats()
    return undefined
  }, [loadStats, user])

  useEffect(() => (
    subscribeUserDataChanged((detail) => {
      if (!hasUserDataScope(detail, ['history', 'progress'])) return
      void loadStats()
    })
  ), [loadStats])

  const handleAvatarSave = async ({ style, seed }) => {
    await updateProfile({ avatar_style: style, avatar_seed: seed })
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/', { replace: true })
  }

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount()
      navigate('/', { replace: true })
    } catch (err) {
      console.error('Delete account failed:', err)
    }
  }

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  const avatarStyle = profile?.avatar_style || 'bottts'
  const avatarSeed = profile?.avatar_seed || (user?.id || 'nova')

  if (!user) return null

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* --- Hero Section --- */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="flex items-start gap-5 mb-8"
      >
        {/* Avatar with change overlay */}
        <div className="relative flex-shrink-0 group cursor-pointer" onClick={() => setShowAvatarPicker(true)}>
          <Avatar style={avatarStyle} seed={avatarSeed} size={88} />
          <div
            className="absolute inset-0 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: 'rgba(0,0,0,0.55)' }}
          >
            <Camera size={18} style={{ color: '#fff' }} />
          </div>
        </div>

        <div className="flex flex-col gap-1 min-w-0 pt-1">
          <EditUsername
            current={profile?.username || user.email?.split('@')[0]}
            onSave={username => updateProfile({ username })}
          />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
          {memberSince && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
              Member since {memberSince}
            </p>
          )}
        </div>
      </motion.div>

      {/* --- Stats Row --- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="flex gap-3 mb-8"
      >
        <StatCard icon={Film} value={stats.titles} label="Titles watched" />
        <StatCard icon={Clock} value={`${stats.hours}h`} label="Watch time" />
        <StatCard icon={Star} value={profile?.username ? '⭐' : '—'} label="Achievements" />
      </motion.div>

      {/* --- Account Settings --- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.14 }}
        className="mb-6"
      >
        <SectionLabel>Account</SectionLabel>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <SettingRow
            icon={User}
            label="Change username"
            onClick={() => {/* handled inline */ document.querySelector('button.group')?.click()}}
          />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />
          <SettingRow icon={Lock} label="Change password" onClick={() => setShowPasswordModal(true)} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />
          <SettingRow icon={Camera} label="Change avatar" onClick={() => setShowAvatarPicker(true)} />
        </div>
      </motion.div>

      {/* --- Session --- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18 }}
        className="mb-6"
      >
        <SectionLabel>Session</SectionLabel>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <SettingRow icon={LogOut} label="Sign out" onClick={handleSignOut} />
        </div>
      </motion.div>

      {/* --- Danger Zone --- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.22 }}
      >
        <SectionLabel>Danger zone</SectionLabel>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(220,38,38,0.18)', background: 'rgba(220,38,38,0.04)' }}>
          <SettingRow icon={Trash2} label="Delete account" onClick={() => setShowDeleteModal(true)} danger />
        </div>
      </motion.div>

      {/* --- Overlays --- */}
      <AnimatePresence>
        {showAvatarPicker && (
          <AvatarPickerSheet
            current={{ style: avatarStyle, seed: avatarSeed }}
            onSave={handleAvatarSave}
            onClose={() => setShowAvatarPicker(false)}
          />
        )}
        {showPasswordModal && (
          <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
        )}
        {showDeleteModal && (
          <DeleteAccountModal
            onClose={() => setShowDeleteModal(false)}
            onConfirm={handleDeleteAccount}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
