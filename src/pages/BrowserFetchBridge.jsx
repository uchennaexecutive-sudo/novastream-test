import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

const WARMUP_TIMEOUT_MS = 4000

const wait = (ms) => new Promise(resolve => window.setTimeout(resolve, ms))

const arrayBufferToBase64 = async (buffer) => {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

export default function BrowserFetchBridge() {
  const iframeRef = useRef(null)
  const warmedUrlRef = useRef('')

  useEffect(() => {

    const warmPage = async (pageUrl) => {
      if (!pageUrl || warmedUrlRef.current === pageUrl) return

      warmedUrlRef.current = pageUrl

      if (!iframeRef.current) return

      await new Promise((resolve) => {
        let settled = false
        const iframe = iframeRef.current

        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }

        const timer = window.setTimeout(finish, WARMUP_TIMEOUT_MS)
        iframe.onload = () => {
          window.clearTimeout(timer)
          finish()
        }
        iframe.src = pageUrl
      })

      await wait(300)
    }

    const unlistenPromise = listen('browser-fetch-request', async (event) => {
      const payload = event.payload || {}
      const requestId = payload.requestId
      const url = payload.url
      const method = payload.method || 'GET'
      const headers = payload.headers || {}
      const body = payload.body ?? null
      const responseType = payload.responseType || 'text'
      const pageUrl = payload.pageUrl || ''

      try {
        await warmPage(pageUrl)

        const response = await fetch(url, {
          method,
          headers,
          body: body ?? undefined,
          credentials: 'include',
          cache: 'no-store',
          referrer: pageUrl || undefined,
          referrerPolicy: pageUrl ? 'unsafe-url' : undefined,
        })

        if (responseType === 'arrayBuffer') {
          const buffer = await response.arrayBuffer()
          const dataBase64 = await arrayBufferToBase64(buffer)
          await invoke('complete_browser_fetch', {
            payload: {
              requestId,
              ok: response.ok,
              responseType,
              dataBase64,
              status: response.status,
              error: response.ok ? null : `HTTP ${response.status}`,
            },
          })
          return
        }

        const text = await response.text()
        await invoke('complete_browser_fetch', {
          payload: {
            requestId,
            ok: response.ok,
            responseType,
            text,
            status: response.status,
            error: response.ok ? null : `HTTP ${response.status}`,
          },
        })
      } catch (error) {
        await invoke('complete_browser_fetch', {
          payload: {
            requestId,
            ok: false,
            responseType,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })

    unlistenPromise.then(() => invoke('browser_fetch_bridge_ready').catch(() => { }))

    return () => {
      unlistenPromise.then(unlisten => unlisten())
    }
  }, [])

  return (
    <div className="h-screen w-screen bg-black">
      <iframe
        ref={iframeRef}
        title="browser-fetch-warmup"
        className="hidden"
      />
    </div>
  )
}
