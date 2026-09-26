import { useEffect } from 'react'
import Lenis from 'lenis'

/** Inertial smooth scrolling for marketing pages (skipped for reduced-motion users). */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true, allowNestedScroll: true })
    let raf = 0
    const loop = (time: number) => { lenis.raf(time); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    const onAnchor = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null
      if (!a) return
      const el = document.querySelector(a.getAttribute('href')!)
      if (el) { e.preventDefault(); lenis.scrollTo(el as HTMLElement, { offset: -90 }) }
    }
    document.addEventListener('click', onAnchor)
    return () => { cancelAnimationFrame(raf); lenis.destroy(); document.removeEventListener('click', onAnchor) }
  }, [])
  return null
}
