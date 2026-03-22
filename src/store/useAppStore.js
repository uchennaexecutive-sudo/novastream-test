import { create } from 'zustand'
import { syncProfileSetting } from '../lib/supabase'

const useAppStore = create((set, get) => ({
  theme: localStorage.getItem('nova-theme') || 'nova-dark',
  setTheme: (id) => {
    document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('nova-theme', id)
    set({ theme: id })
    syncProfileSetting({ theme: id })
  },

  preferences: (() => {
    const defaults = { defaultEmbed: 'vidsrc', autoplayNext: true, rememberPosition: true, reduceAnimations: false }
    const saved = JSON.parse(localStorage.getItem('nova-preferences') || '{}')
    return { ...defaults, ...saved }
  })(),
  setPreference: (key, value) => {
    const prefs = { ...get().preferences, [key]: value }
    localStorage.setItem('nova-preferences', JSON.stringify(prefs))
    set({ preferences: prefs })
    syncProfileSetting({ preferences: prefs })
  },

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  sidebarExpanded: false,
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),

  // Update state: 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'idle'
  updateState: 'idle',
  updateVersion: null,
  updateNotes: null,
  downloadProgress: 0,           // 0–100 real percentage during download
  setUpdateState: (state) => set({ updateState: state }),
  setUpdateInfo: (version, notes) => set({ updateVersion: version, updateNotes: notes }),
  setDownloadProgress: (pct) => set({ downloadProgress: pct }),
}))

export default useAppStore
