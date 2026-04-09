import { useEffect, useState } from 'react'

function readMainScrollActivity() {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.mainScrolling === 'true'
}

export default function useMainScrollActivity() {
  const [isMainScrolling, setIsMainScrolling] = useState(readMainScrollActivity)

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined
    }

    const root = document.documentElement

    const sync = () => {
      const nextValue = root.dataset.mainScrolling === 'true'
      setIsMainScrolling((currentValue) => (currentValue === nextValue ? currentValue : nextValue))
    }

    sync()

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-main-scrolling') {
          sync()
          break
        }
      }
    })

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-main-scrolling'],
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return isMainScrolling
}
