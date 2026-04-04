import { open } from '@tauri-apps/plugin-dialog'

const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)

async function invokeIfAvailable(command, payload = {}) {
  if (!isTauri) return null

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, payload)
}

export async function startVideoDownload(payload) {
  return invokeIfAvailable('start_video_download', { payload })
}

export async function pauseVideoDownload(id) {
  return invokeIfAvailable('pause_video_download', { id })
}

export async function cancelVideoDownload(id) {
  return invokeIfAvailable('cancel_video_download', { id })
}

export async function deleteVideoDownload({ id, filePath = null } = {}) {
  return invokeIfAvailable('delete_video_download', {
    payload: {
      id,
      filePath,
    },
  })
}

export async function getDownloadsStorageInfo() {
  return invokeIfAvailable('get_downloads_storage_info')
}

export async function setVideoDownloadMaxConcurrent(maxConcurrent) {
  return invokeIfAvailable('set_video_download_max_concurrent', {
    payload: {
      maxConcurrent,
    },
  })
}

export async function getDownloadLocation() {
  return invokeIfAvailable('get_download_location')
}

export async function setDownloadLocation(path) {
  return invokeIfAvailable('set_download_location', { path })
}

export async function resetDownloadLocation() {
  return invokeIfAvailable('reset_download_location')
}

export async function pickDownloadFolder({ defaultPath } = {}) {
  if (!isTauri) return null

  const result = await open({
    directory: true,
    multiple: false,
    defaultPath: defaultPath || undefined,
  })

  if (Array.isArray(result)) {
    return result[0] || null
  }

  return result || null
}
