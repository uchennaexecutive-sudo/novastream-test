let hlsModulePromise = null

export function loadHls() {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js').then((module) => module.default || module)
  }

  return hlsModulePromise
}
