import { useEffect, useState, type CSSProperties } from 'react'

/** The window's real inner height as a --win-h style, for pages that must fit exactly one screen. */
export function useWinHeight(): CSSProperties {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return { '--win-h': `${h}px` } as CSSProperties
}
