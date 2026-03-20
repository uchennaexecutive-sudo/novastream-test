import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource-variable/jetbrains-mono'
import './themes/themes.css'
import './index.css'

const saved = localStorage.getItem('nova-theme') || 'nova-dark'
document.documentElement.setAttribute('data-theme', saved)

import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import UpdateToast from './components/UI/UpdateToast'
import useAppStore from './store/useAppStore'

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__
const APP_VERSION = '1.4.1'
const UPDATE_API = 'https://raw.githubusercontent.com/uchennaexecutive-sudo/novastream/main/updates/latest.json'
const UPDATE_CHECK_TIMEOUT_MS = 15000
const UPDATE_INITIAL_DELAY_MS = 5000
const UPDATE_RETRY_DELAYS_MS = [10000, 20000, 45000, 90000, 180000]
const UPDATE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)

  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
  }

  return 0
}

export { APP_VERSION }

function Root() {
  const isSpecialWindow = typeof window !== 'undefined'
    && (
      window.location.pathname.startsWith('/player-window')
      || window.location.pathname.startsWith('/fetch-bridge')
    )
  const setUpdateState = useAppStore(s => s.setUpdateState)
  const setUpdateInfo = useAppStore(s => s.setUpdateInfo)
  const setDownloadProgress = useAppStore(s => s.setDownloadProgress)
  const updateState = useAppStore(s => s.updateState)
  const updateVersion = useAppStore(s => s.updateVersion)
  const updateNotes = useAppStore(s => s.updateNotes)
  const retryTimerRef = useRef(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (isSpecialWindow) return undefined

    let unlisten = null

    if (isTauri) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('download-progress', (event) => {
          setDownloadProgress(event.payload)
        }).then(fn => { unlisten = fn })
      })
    }

    return () => {
      if (unlisten) unlisten()
    }
  }, [isSpecialWindow, setDownloadProgress])

  useEffect(() => {
    if (isSpecialWindow) return undefined

    cancelledRef.current = false

    const clearRetryTimer = () => {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    const scheduleCheck = (delayMs) => {
      clearRetryTimer()
      retryTimerRef.current = window.setTimeout(() => {
        if (!cancelledRef.current) {
          checkAndDownload()
        }
      }, delayMs)
    }

    const downloadUpdate = async (downloadUrl, version, attemptIndex = 0) => {
      try {
        setUpdateState('downloading')
        setDownloadProgress(0)

        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('download_update', { url: downloadUrl })

        if (cancelledRef.current) return

        setUpdateState('ready')
      } catch (error) {
        console.error(`[updater] download failed for v${version} (attempt ${attemptIndex + 1})`, error)

        if (cancelledRef.current) return

        if (attemptIndex < UPDATE_RETRY_DELAYS_MS.length - 1) {
          setUpdateState('error')
          retryTimerRef.current = window.setTimeout(() => {
            if (!cancelledRef.current) {
              downloadUpdate(downloadUrl, version, attemptIndex + 1)
            }
          }, UPDATE_RETRY_DELAYS_MS[attemptIndex])
          return
        }

        setUpdateState('error')
        scheduleCheck(UPDATE_REFRESH_INTERVAL_MS)
      }
    }

    async function checkAndDownload() {
      try {
        setUpdateState('checking')

        const res = await fetch(UPDATE_API, {
          cache: 'no-store',
          signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        const data = await res.json()

        if (!data.version || compareVersions(APP_VERSION, data.version) >= 0) {
          setUpdateState('up-to-date')
          scheduleCheck(UPDATE_REFRESH_INTERVAL_MS)
          return
        }

        setUpdateInfo(data.version, data.notes)

        if (!isTauri) {
          setUpdateState('ready')
          return
        }

        const downloadUrl = data.platforms?.['windows-x86_64']?.url
        if (!downloadUrl) {
          console.error(`[updater] missing windows-x86_64 download URL for v${data.version}`)
          setUpdateState('error')
          scheduleCheck(UPDATE_RETRY_DELAYS_MS[0])
          return
        }

        await downloadUpdate(downloadUrl, data.version, 0)
      } catch (error) {
        console.error('[updater] check failed', error)

        if (cancelledRef.current) return

        setUpdateState('error')
        scheduleCheck(UPDATE_RETRY_DELAYS_MS[0])
      }
    }

    scheduleCheck(UPDATE_INITIAL_DELAY_MS)

    return () => {
      cancelledRef.current = true
      clearRetryTimer()
    }
  }, [isSpecialWindow, setDownloadProgress, setUpdateInfo, setUpdateState])

  const handleRestart = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('apply_update')
    } catch (error) {
      console.error('Failed to apply update:', error)
    }
  }

  return (
    <React.StrictMode>
      <App />
      {!isSpecialWindow && updateState === 'ready' && isTauri && (
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
