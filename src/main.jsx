import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource-variable/jetbrains-mono'
import './themes/themes.css'
import './index.css'

// Apply theme before first render to prevent flash
const saved = localStorage.getItem('nova-theme') || 'nova-dark'
document.documentElement.setAttribute('data-theme', saved)

import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import UpdateToast from './components/UI/UpdateToast'
import useAppStore from './store/useAppStore'

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__

// Current app version — must match tauri.conf.json
const APP_VERSION = '1.0.20'

// GitHub Contents API — returns raw JSON regardless of network
const UPDATE_API = 'https://api.github.com/repos/uchennaexecutive-sudo/novastream/contents/updates/latest.json'

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
  }
  return 0
}

export { APP_VERSION }

function Root() {
  const setUpdateState = useAppStore(s => s.setUpdateState)
  const setUpdateInfo = useAppStore(s => s.setUpdateInfo)
  const setDownloadProgress = useAppStore(s => s.setDownloadProgress)
  const updateState = useAppStore(s => s.updateState)
  const updateVersion = useAppStore(s => s.updateVersion)
  const updateNotes = useAppStore(s => s.updateNotes)

  useEffect(() => {
    // Listen for streaming progress events from Rust
    let unlisten = null
    if (isTauri) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('download-progress', (event) => {
          setDownloadProgress(event.payload)
        }).then(fn => { unlisten = fn })
      })
    }
    return () => { if (unlisten) unlisten() }
  }, [])

  useEffect(() => {
    async function checkAndDownload(attempt = 1) {
      try {
        setUpdateState('checking')

        const res = await fetch(UPDATE_API, {
          headers: { 'Accept': 'application/vnd.github.v3.raw' },
          signal: AbortSignal.timeout(10000), // 10s timeout on the check
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        if (!data.version || compareVersions(APP_VERSION, data.version) >= 0) {
          setUpdateState('up-to-date')
          return
        }

        setUpdateInfo(data.version, data.notes)

        if (!isTauri) {
          setUpdateState('ready')
          return
        }

        const downloadUrl = data.platforms?.['windows-x86_64']?.url
        if (!downloadUrl) {
          setUpdateState('up-to-date')
          return
        }

        setUpdateState('downloading')
        setDownloadProgress(0)

        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('download_update', { url: downloadUrl })

        setUpdateState('ready')
      } catch (e) {
        console.log(`Update check failed (attempt ${attempt}):`, e)
        if (attempt < 3) {
          // Retry up to 2 more times with 8s delay
          setTimeout(() => checkAndDownload(attempt + 1), 8000)
        } else {
          setUpdateState('error')
        }
      }
    }

    // Wait 5s after launch before first check
    const timer = setTimeout(checkAndDownload, 5000)
    return () => clearTimeout(timer)
  }, [])

  const handleRestart = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('apply_update')
    } catch (e) {
      console.error('Failed to apply update:', e)
    }
  }

  return (
    <React.StrictMode>
      <App />
      {updateState === 'ready' && isTauri && (
        <UpdateToast
          version={updateVersion}
          notes={updateNotes}
          onRestart={handleRestart}
        />
      )}
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />)
