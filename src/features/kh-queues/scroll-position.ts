export type WindowScrollPosition = { left: number; top: number } | undefined

export function captureWindowScrollPosition(): WindowScrollPosition {
  if (typeof window === 'undefined') {
    return undefined
  }
  return { left: window.scrollX, top: window.scrollY }
}

export function restoreWindowScrollPosition(position: WindowScrollPosition) {
  if (!position || typeof window === 'undefined') {
    return
  }
  window.requestAnimationFrame(() => {
    if (window.scrollX !== position.left || window.scrollY !== position.top) {
      window.scrollTo({ ...position, behavior: 'auto' })
    }
  })
}
