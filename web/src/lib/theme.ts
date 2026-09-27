import { useSyncExternalStore } from 'react'

/* Light or dark, for the whole site. Everyone starts in light; the choice lives in this browser (index.html
   reads it before the first paint, so a dark page never flashes white), and "system" follows the device as it
   changes once someone picks it. Switching
   opens the new look as a circle from wherever you clicked, over the old one. */

export type Mode = 'light' | 'dark' | 'system'
const KEY = 'swarm:mode'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export function getMode(): Mode {
  try { const m = localStorage.getItem(KEY); if (m === 'light' || m === 'dark' || m === 'system') return m } catch { /* private mode */ }
  return 'light'
}
export const resolve = (m: Mode = getMode()): 'light' | 'dark' => (m === 'system' ? (media().matches ? 'dark' : 'light') : m)

function apply() {
  const r = resolve()
  const root = document.documentElement
  if (root.dataset.theme !== r) root.dataset.theme = r
  root.style.colorScheme = r
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#121212' : '#ffffff')
  listeners.forEach((f) => f())
}

if (typeof window !== 'undefined') {
  media().addEventListener('change', () => { if (getMode() === 'system') morph(apply) })
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply() })
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')

/** Change how the page looks inside a view transition: the new look opens as a circle from `at` (or the
 *  middle of the screen). `commit` may be async, e.g. wait for React to render the change. */
export function morph(commit: () => void | Promise<void>, at?: { x: number; y: number }, shape: 'circle' | 'wipe' = 'circle') {
  const doc = document as Document & { startViewTransition?: (cb: () => void | Promise<void>) => { ready: Promise<void>; finished: Promise<void> } }
  if (!doc.startViewTransition || calm()) {
    // no view transitions here: at least ease the colours across
    const root = document.documentElement
    root.classList.add('mode-easing')
    void Promise.resolve(commit()).then(() => window.setTimeout(() => root.classList.remove('mode-easing'), 520))
    return
  }
  const x = at?.x ?? window.innerWidth / 2, y = at?.y ?? window.innerHeight / 2
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  document.documentElement.classList.add('vt-morph')
  const t = doc.startViewTransition(commit)
  t.ready.then(() => {
    const clipPath = shape === 'circle'
      ? [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`]
      : [`inset(0 100% 0 0 round 0 40px 40px 0)`, `inset(0 0 0 0 round 0 0 0 0)`]
    document.documentElement.animate({ clipPath }, { duration: shape === 'circle' ? 720 : 820, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' })
  }).catch(() => {})
  t.finished.finally(() => document.documentElement.classList.remove('vt-morph'))
}

export function setMode(m: Mode, at?: { x: number; y: number }) {
  const before = resolve()
  try { localStorage.setItem(KEY, m) } catch { /* private mode */ }
  if (resolve(m) === before) { listeners.forEach((f) => f()); return }
  morph(apply, at)
}

/** Flip between light and dark from a click, opening the new look from the pointer. */
export function toggleMode(e?: { clientX: number; clientY: number }) {
  setMode(resolve() === 'dark' ? 'light' : 'dark', e && e.clientX ? { x: e.clientX, y: e.clientY } : undefined)
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
/** The chosen mode and what it comes to right now. */
export function useMode() {
  const mode = useSyncExternalStore(subscribe, getMode, () => 'light' as Mode)
  const dark = useSyncExternalStore(subscribe, () => resolve() === 'dark', () => false)
  return { mode, dark }
}

apply()
