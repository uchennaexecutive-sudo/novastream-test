import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { syncFromCloud } from '../lib/supabase'
import useAppStore, { DEFAULT_PREFERENCES } from './useAppStore'

// Apply profile theme + preferences to the running app (no Supabase write-back)
function applyProfileSettings(profile) {
  if (!profile) return
  const appStore = useAppStore.getState()

  if (profile.theme) {
    document.documentElement.setAttribute('data-theme', profile.theme)
    localStorage.setItem('nova-theme', profile.theme)
    useAppStore.setState({ theme: profile.theme })
  }

  if (profile.preferences && typeof profile.preferences === 'object') {
    const hasExplicitIntelMacCompatibilityMode = Object.prototype.hasOwnProperty.call(
      profile.preferences,
      'intelMacCompatibilityMode'
    )
    const prefs = { ...DEFAULT_PREFERENCES, ...profile.preferences }
    appStore.setPreferencesSnapshot(prefs, { hasExplicitIntelMacCompatibilityMode })
    appStore.promoteIntelMacCompatibilityDefault()
    document.documentElement.setAttribute('data-reduce-motion', prefs.reduceAnimations ? 'true' : 'false')
  }
}

const useAuthStore = create((set, get) => ({
  user: null,
  session: null,
  profile: null,
  authLoading: true,

  // Controls the sign-in overlay (triggered from sidebar or programmatically)
  authModalOpen: false,
  setAuthModalOpen: (open) => set({ authModalOpen: open }),

  // Bootstrap auth session on app start
  init: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const profile = await get()._fetchProfile(session.user.id)
        set({ user: session.user, session, profile, authLoading: false })
        applyProfileSettings(profile)
        syncFromCloud().catch(() => {})
      } else {
        set({ authLoading: false })
      }
    } catch {
      set({ authLoading: false })
    }

    // Listen for auth changes (sign in/out from any tab)
    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await get()._fetchProfile(session.user.id)
        set({ user: session.user, session, profile })
        applyProfileSettings(profile)
        syncFromCloud().catch(() => {})
      } else {
        set({ user: null, session: null, profile: null })
      }
    })
  },

  _fetchProfile: async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      return data || null
    } catch {
      return null
    }
  },

  signUp: async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    })
    if (error) throw error
    return data
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null, profile: null })
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://novastream.app/reset-password',
    })
    if (error) throw error
  },

  updateProfile: async (updates) => {
    const { user } = get()
    if (!user) return null
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single()
    if (error) throw error
    set({ profile: data })
    return data
  },

  deleteAccount: async () => {
    // Requires a Supabase edge function or RPC — handled server-side
    const { error } = await supabase.rpc('delete_user')
    if (error) throw error
    set({ user: null, session: null, profile: null })
  },
}))

export default useAuthStore
