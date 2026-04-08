import { create } from 'zustand'
import { syncProfileSetting } from '../lib/supabase'

const readStoredPreferences = () => {
  try {
    return JSON.parse(localStorage.getItem('nova-preferences') || '{}')
  } catch {
    return {}
  }
}

export const DEFAULT_PREFERENCES = {
  defaultEmbed: 'vidsrc',
  autoplayNext: true,
  rememberPosition: true,
  reduceAnimations: false,
  intelMacCompatibilityMode: 'auto',
}

export const getIsIntelMacRuntime = (state) => (
  state.runtimeInfo.os === 'macos' && state.runtimeInfo.arch === 'x86_64'
)

export const getReducedEffectsMode = (state) => {
  const preference = state.preferences.intelMacCompatibilityMode

  if (preference === 'on') return true
  if (preference === 'off') return false
  return getIsIntelMacRuntime(state)
}

const storedPreferences = readStoredPreferences()
const hasExplicitIntelMacCompatibilityMode = Object.prototype.hasOwnProperty.call(
  storedPreferences,
  'intelMacCompatibilityMode'
)

const useAppStore = create((set, get) => ({
  theme: localStorage.getItem('nova-theme') || 'nova-dark',
  setTheme: (id) => {
    document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('nova-theme', id)
    set({ theme: id })
    syncProfileSetting({ theme: id })
  },

  preferences: (() => {
    return { ...DEFAULT_PREFERENCES, ...storedPreferences }
  })(),
  setPreference: (key, value) => {
    const prefs = { ...get().preferences, [key]: value }
    localStorage.setItem('nova-preferences', JSON.stringify(prefs))
    set({
      preferences: prefs,
      hasExplicitIntelMacCompatibilityMode: key === 'intelMacCompatibilityMode'
        ? true
        : get().hasExplicitIntelMacCompatibilityMode,
    })
    syncProfileSetting({ preferences: prefs })
  },
  hasExplicitIntelMacCompatibilityMode,
  setPreferencesSnapshot: (preferences = {}, options = {}) => {
    const prefs = { ...DEFAULT_PREFERENCES, ...preferences }
    localStorage.setItem('nova-preferences', JSON.stringify(prefs))
    set({
      preferences: prefs,
      hasExplicitIntelMacCompatibilityMode: Boolean(options.hasExplicitIntelMacCompatibilityMode),
    })
  },
  promoteIntelMacCompatibilityDefault: () => {
    const state = get()
    if (!getIsIntelMacRuntime(state) || state.hasExplicitIntelMacCompatibilityMode) {
      return
    }

    const nextPreferences = {
      ...state.preferences,
      intelMacCompatibilityMode: 'on',
    }

    localStorage.setItem('nova-preferences', JSON.stringify(nextPreferences))
    set({ preferences: nextPreferences })
  },

  runtimeInfo: {
    os: 'unknown',
    arch: 'unknown',
  },
  setRuntimeInfo: (runtimeInfo = {}) => set({
    runtimeInfo: {
      os: runtimeInfo.os || 'unknown',
      arch: runtimeInfo.arch || 'unknown',
    },
  }),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  sidebarExpanded: false,
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),

  isMainScrolling: false,
  setMainScrolling: (isMainScrolling) => set({ isMainScrolling: Boolean(isMainScrolling) }),

  // Update state: 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'idle'
  updateState: 'idle',
  updateVersion: null,
  updateNotes: null,
  updatePlatformKey: 'windows-x86_64',
  updateApplyMode: 'restart',
  downloadProgress: 0,           // 0–100 real percentage during download
  setUpdateState: (state) => set({ updateState: state }),
  setUpdateInfo: (version, notes) => set({ updateVersion: version, updateNotes: notes }),
  setUpdateRuntimeContext: ({ platformKey, applyMode }) => set({
    updatePlatformKey: platformKey || 'windows-x86_64',
    updateApplyMode: applyMode || 'restart',
  }),
  setDownloadProgress: (pct) => set({ downloadProgress: pct }),
}))

export default useAppStore
