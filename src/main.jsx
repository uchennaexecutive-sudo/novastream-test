import '@fontsource/poppins/300.css'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource-variable/jetbrains-mono'
import './themes/themes.css'
import './index.css'

const saved = localStorage.getItem('nova-theme') || 'nova-dark'
document.documentElement.setAttribute('data-theme', saved)

import React, { lazy, Suspense, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import App from './App'
import { recoverCompletedDownloadCatalog } from './lib/downloadCatalogRecovery'
import useAppStore, { getIsIntelMacRuntime, getReducedEffectsMode } from './store/useAppStore'
import useDownloadStore from './store/useDownloadStore'

const UpdateToast = lazy(() => import('./components/UI/UpdateToast'))

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__
const APP_VERSION = '1.7.6'
const UPDATE_API = 'https://raw.githubusercontent.com/uchennaexecutive-sudo/novastream-test/main/updates/latest.json'
const UPDATE_CHECK_TIMEOUT_MS = 15000
const UPDATE_INITIAL_DELAY_MS = 5000
const UPDATE_RETRY_DELAYS_MS = [10000, 20000, 45000, 90000, 180000]
const UPDATE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_UPDATER_CONTEXT = {
  platformKey: 'windows-x86_64',
  applyMode: 'restart',
}

function dismissBootSplash() {
  if (typeof document === 'undefined') return

  const splash = document.getElementById('boot-splash')
  if (!splash || splash.dataset.dismissed === 'true') return

  splash.dataset.dismissed = 'true'
  splash.classList.add('boot-splash--hidden')
  window.setTimeout(() => {
    splash.remove()
  }, 220)
}

function scheduleNonCritical(task, delay = 250) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(() => task(), { timeout: 1500 })
    return () => window.cancelIdleCallback(handle)
  }

  const handle = window.setTimeout(task, delay)
  return () => window.clearTimeout(handle)
}

async function reconcileCompletedDownloadFileSize(payload, updateDownload) {
  const id = String(payload?.id || '').trim()
  const filePath = String(payload?.filePath || payload?.file_path || '').trim()
  if (!id || !filePath) return

  try {
    const metadata = await invoke('get_local_file_metadata', { filePath })
    const exists = Boolean(metadata?.exists)
    const isFile = Boolean(metadata?.isFile)
    const sizeBytes = Number(metadata?.sizeBytes || 0)

    if (!exists || !isFile || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return
    }

    updateDownload(id, {
      bytesDownloaded: sizeBytes,
      totalBytes: sizeBytes,
    })
  } catch (error) {
    console.warn('[downloads] failed to reconcile completed download size', error)
  }
}

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
  const reduceAnimations = useAppStore(s => s.preferences.reduceAnimations)
  const reducedEffectsMode = useAppStore(getReducedEffectsMode)
  const isIntelMacRuntime = useAppStore(getIsIntelMacRuntime)
  const setRuntimeInfo = useAppStore(s => s.setRuntimeInfo)
  const promoteIntelMacCompatibilityDefault = useAppStore(s => s.promoteIntelMacCompatibilityDefault)

  useEffect(() => {
    let cancelled = false

    const fallbackPlatform = typeof navigator !== 'undefined'
      ? `${navigator.userAgent || ''} ${navigator.platform || ''}`
      : ''
    const fallbackIsMac = /mac/i.test(fallbackPlatform)
    const fallbackIsIntelMac = fallbackIsMac && /intel|macintel/i.test(fallbackPlatform)

    async function loadRuntimeInfo() {
      if (!isTauri) {
        setRuntimeInfo({
          os: fallbackIsMac ? 'macos' : 'web',
          arch: fallbackIsIntelMac ? 'x86_64' : 'unknown',
        })
        return
      }

      try {
        const runtimeInfo = await invoke('get_runtime_environment')
        if (!cancelled) {
          setRuntimeInfo(runtimeInfo || {})
        }
      } catch (error) {
        console.warn('[runtime] failed to resolve runtime environment', error)
        if (!cancelled) {
          setRuntimeInfo({
            os: fallbackIsMac ? 'macos' : 'unknown',
            arch: fallbackIsIntelMac ? 'x86_64' : 'unknown',
          })
        }
      }
    }

    const cancelScheduledTask = scheduleNonCritical(() => {
      void loadRuntimeInfo()
    }, 120)

    return () => {
      cancelled = true
      cancelScheduledTask()
    }
  }, [setRuntimeInfo])

  useEffect(() => {
    if (isIntelMacRuntime) {
      promoteIntelMacCompatibilityDefault()
    }
  }, [isIntelMacRuntime, promoteIntelMacCompatibilityDefault])

  useEffect(() => {
    document.documentElement.setAttribute('data-reduce-motion', reduceAnimations ? 'true' : 'false')
    document.documentElement.setAttribute('data-reduced-effects', reducedEffectsMode ? 'true' : 'false')
    document.documentElement.setAttribute('data-intel-mac-runtime', isIntelMacRuntime ? 'true' : 'false')
  }, [isIntelMacRuntime, reduceAnimations, reducedEffectsMode])

  const setUpdateState = useAppStore(s => s.setUpdateState)
  const setUpdateInfo = useAppStore(s => s.setUpdateInfo)
  const setUpdateRuntimeContext = useAppStore(s => s.setUpdateRuntimeContext)
  const setDownloadProgress = useAppStore(s => s.setDownloadProgress)
  const applyVideoDownloadProgress = useDownloadStore(s => s.applyProgressEvent)
  const applyVideoDownloadStatus = useDownloadStore(s => s.applyStatusEvent)
  const applyVideoDownloadCompleted = useDownloadStore(s => s.applyCompletedEvent)
  const applyVideoDownloadFailed = useDownloadStore(s => s.applyFailedEvent)
  const setDownloadsStorageInfo = useDownloadStore(s => s.setStorageInfo)
  const hydrateCompletedDownloads = useDownloadStore(s => s.hydrateCompletedDownloads)
  const updateDownload = useDownloadStore(s => s.updateDownload)
  const maxConcurrentDownloads = useDownloadStore(s => s.maxConcurrent)
  const updateState = useAppStore(s => s.updateState)
  const updateVersion = useAppStore(s => s.updateVersion)
  const updateNotes = useAppStore(s => s.updateNotes)
  const updateApplyMode = useAppStore(s => s.updateApplyMode)
  const retryTimerRef = useRef(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      dismissBootSplash()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [])

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
    if (isSpecialWindow || !isTauri) return undefined

    let active = true
    let unlisteners = []

    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const nextUnlisteners = await Promise.all([
          listen('video-download-progress', (event) => {
            applyVideoDownloadProgress(event.payload || {})
          }),
          listen('video-download-status', (event) => {
            applyVideoDownloadStatus(event.payload || {})
          }),
          listen('video-download-completed', (event) => {
            const payload = event.payload || {}
            applyVideoDownloadCompleted(payload)
            void reconcileCompletedDownloadFileSize(payload, updateDownload)
          }),
          listen('video-download-failed', (event) => {
            applyVideoDownloadFailed(event.payload || {})
          }),
          listen('downloads-storage-info', (event) => {
            setDownloadsStorageInfo(event.payload || {})
          }),
        ])

        if (!active) {
          nextUnlisteners.forEach((unlistenFn) => unlistenFn())
          return
        }

        unlisteners = nextUnlisteners
      })
      .catch((error) => {
        console.warn('[downloads] failed to attach media download listeners', error)
      })

    return () => {
      active = false
      unlisteners.forEach((unlistenFn) => unlistenFn())
      unlisteners = []
    }
  }, [
    applyVideoDownloadCompleted,
    applyVideoDownloadFailed,
    applyVideoDownloadProgress,
    applyVideoDownloadStatus,
    isSpecialWindow,
    setDownloadsStorageInfo,
    updateDownload,
  ])

  useEffect(() => {
    if (isSpecialWindow || !isTauri) return undefined

    let cancelled = false
    const cancelScheduledTask = scheduleNonCritical(() => {
      import('./lib/videoDownloads')
        .then(({ getDownloadsStorageInfo }) => getDownloadsStorageInfo())
        .then((payload) => {
          if (!cancelled && payload) {
            setDownloadsStorageInfo(payload)
          }
        })
        .catch((error) => {
          console.warn('[downloads] failed to load storage info', error)
        })
    }, 900)

    return () => {
      cancelled = true
      cancelScheduledTask()
    }
  }, [isSpecialWindow, setDownloadsStorageInfo])

  useEffect(() => {
    if (isSpecialWindow || !isTauri) return undefined

    let cancelled = false
    const cancelScheduledTask = scheduleNonCritical(() => {
      import('./lib/videoDownloads')
        .then(({ scanDownloadLibrary }) => scanDownloadLibrary())
        .then(async (payload) => {
          if (cancelled || !Array.isArray(payload) || payload.length === 0) {
            return
          }

          hydrateCompletedDownloads(payload)
          const existingItems = useDownloadStore.getState().items

          const recoveredItems = await recoverCompletedDownloadCatalog(payload, existingItems)
          if (!cancelled && recoveredItems.length > 0) {
            hydrateCompletedDownloads(recoveredItems)
          }
        })
        .catch((error) => {
          console.warn('[downloads] failed to scan existing library items', error)
        })
    }, 1100)

    return () => {
      cancelled = true
      cancelScheduledTask()
    }
  }, [hydrateCompletedDownloads, isSpecialWindow])

  useEffect(() => {
    if (isSpecialWindow || !isTauri) return undefined

    let cancelled = false
    const cancelScheduledTask = scheduleNonCritical(() => {
      const completedItems = useDownloadStore.getState().items
        .filter((item) => item?.status === 'completed' && item?.filePath)

      Promise.allSettled(completedItems.map(async (item) => {
        const payload = await invoke('get_local_file_metadata', {
          filePath: item.filePath,
        })

        const exists = Boolean(payload?.exists)
        const isFile = Boolean(payload?.isFile)
        const sizeBytes = Number(payload?.sizeBytes || 0)

        if (!exists || !isFile || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
          return
        }

        const knownSize = Math.max(
          Number(item?.totalBytes || 0),
          Number(item?.bytesDownloaded || 0),
        )

        if (sizeBytes === knownSize) {
          return
        }

        if (!cancelled) {
          updateDownload(item.id, {
            bytesDownloaded: sizeBytes,
            totalBytes: sizeBytes,
          })
        }
      }))
        .catch((error) => {
          console.warn('[downloads] failed to reconcile completed download metadata', error)
        })
    }, 1200)

    return () => {
      cancelled = true
      cancelScheduledTask()
    }
  }, [isSpecialWindow, updateDownload])

  useEffect(() => {
    if (isSpecialWindow || !isTauri) return undefined

    const cancelScheduledTask = scheduleNonCritical(() => {
      import('./lib/videoDownloads')
        .then(({ setVideoDownloadMaxConcurrent }) => (
          setVideoDownloadMaxConcurrent(maxConcurrentDownloads > 0 ? maxConcurrentDownloads : null)
        ))
        .catch((error) => {
          console.warn('[downloads] failed to sync max concurrent setting', error)
        })
    }, 600)

    return () => {
      cancelScheduledTask()
    }
  }, [isSpecialWindow, maxConcurrentDownloads])

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

    const resolvePlatformDownloadUrl = async (platforms) => {
      if (!isTauri) {
        return platforms?.[DEFAULT_UPDATER_CONTEXT.platformKey]?.url || null
      }

      try {
        const context = await invoke('get_updater_context')
        const resolvedContext = {
          platformKey: context?.platformKey || DEFAULT_UPDATER_CONTEXT.platformKey,
          applyMode: context?.applyMode || DEFAULT_UPDATER_CONTEXT.applyMode,
        }
        setUpdateRuntimeContext(resolvedContext)
        return platforms?.[resolvedContext.platformKey]?.url || null
      } catch (error) {
        console.warn('[updater] failed to resolve runtime context', error)
        setUpdateRuntimeContext(DEFAULT_UPDATER_CONTEXT)
        return platforms?.[DEFAULT_UPDATER_CONTEXT.platformKey]?.url || null
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

        const downloadUrl = await resolvePlatformDownloadUrl(data.platforms)
        if (!downloadUrl) {
          setUpdateState('ready')
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
  }, [isSpecialWindow, setDownloadProgress, setUpdateInfo, setUpdateRuntimeContext, setUpdateState])

  const handleRestart = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('apply_update')
      if (updateApplyMode === 'installer') {
        const { message } = await import('@tauri-apps/plugin-dialog')
        await message(
          'The installer disk image is open. Launch NOVA STREAM Installer.app to copy the new version into Applications.',
          {
            title: 'Installer Opened',
            kind: 'info',
          },
        )
      }
    } catch (error) {
      console.error('Failed to apply update:', error)
    }
  }

  return (
    <React.StrictMode>
      <App />
      {!isSpecialWindow && updateState === 'ready' && isTauri && (
        <Suspense fallback={null}>
          <UpdateToast
            version={updateVersion}
            notes={updateNotes}
            applyMode={updateApplyMode}
            onAction={handleRestart}
          />
        </Suspense>
      )}
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />)
