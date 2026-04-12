const USER_DATA_CHANGED_EVENT = 'nova:user-data-changed'

export function emitUserDataChanged(detail = {}) {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent(USER_DATA_CHANGED_EVENT, {
    detail: {
      scopes: Array.isArray(detail?.scopes) ? detail.scopes : [],
      reason: detail?.reason || 'unknown',
      at: Date.now(),
    },
  }))
}

export function subscribeUserDataChanged(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') {
    return () => {}
  }

  const handler = (event) => {
    listener(event?.detail || {})
  }

  window.addEventListener(USER_DATA_CHANGED_EVENT, handler)
  return () => window.removeEventListener(USER_DATA_CHANGED_EVENT, handler)
}

export function hasUserDataScope(detail, scopes = []) {
  if (!Array.isArray(scopes) || scopes.length === 0) return true

  const detailScopes = Array.isArray(detail?.scopes) ? detail.scopes : []
  return detailScopes.includes('*') || scopes.some((scope) => detailScopes.includes(scope))
}
