import { useLayoutEffect, useSyncExternalStore } from 'react'

/* The boot screen is plain HTML in index.html, so it's on screen before any JS runs. Anything still
   loading (auth, the app's code, the first snapshot of your repos) holds it; once nothing has held it
   for a moment it folds away and the page underneath animates in. One loader, never a chain of them. */

let holds = 0
let done = false
let timer = 0
const listeners = new Set<() => void>()
const el = () => document.getElementById('boot')

export const isBooted = () => done

function schedule() {
  window.clearTimeout(timer)
  if (holds > 0 || done) return
  // a short grace period, so one loader handing over to the next never shows a gap
  timer = window.setTimeout(() => void finishBoot(), 160)
}

/** Keep the boot screen up until the returned function is called. */
export function holdBoot(): () => void {
  if (done) return () => {}
  holds++
  window.clearTimeout(timer)
  let released = false
  return () => { if (released) return; released = true; holds--; schedule() }
}

/** Fold the boot screen away. `instant` skips the animation (the landing page has its own intro). */
export async function finishBoot(instant = false) {
  if (done) return
  done = true
  window.clearTimeout(timer)
  const boot = el()
  if (boot && !instant) {
    // let the dots do at least one lap, and have the headline font in, but never wait long for either
    const lap = Math.max(0, 1100 - performance.now())
    await Promise.all([sleep(lap), document.fonts ? Promise.race([document.fonts.ready, sleep(900)]) : null])
    listeners.forEach((f) => f())
    await exit(boot)
  } else {
    boot?.remove()
    listeners.forEach((f) => f())
  }
}

export interface BootDot { x: number; y: number; size: number }
let handed: BootDot[] | null | undefined

/** The landing page's intro carries on from the boot screen instead of replacing it: this hides the
 *  boot dots and returns where each one is right now (centre and size, in boot-screen order: yellow,
 *  sky, green, coral), so the intro can draw its own dots in exactly those places in the same frame.
 *  null when the app had already booted (you came here from inside the app). Safe to call twice. */
export function takeOverBoot(): BootDot[] | null {
  if (handed !== undefined) return handed
  if (done) return (handed = null)
  done = true
  window.clearTimeout(timer)
  const boot = el()
  handed = boot ? [...boot.querySelectorAll<HTMLElement>('.boot-dot')].map((d) => {
    const r = d.getBoundingClientRect()
    d.style.visibility = 'hidden'
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width }
  }) : []
  if (boot) {
    // the intro underneath is the same white, so the boot screen can simply let go
    boot.style.background = 'transparent'
    boot.style.pointerEvents = 'none'
    const word = boot.querySelector<HTMLElement>('.boot-word')
    word?.animate([{ opacity: getComputedStyle(word).opacity, transform: 'none' }, { opacity: 0, transform: 'translateY(10px)' }], { duration: 320, easing: 'ease-out', fill: 'forwards' })
    window.setTimeout(() => boot.remove(), 360)
  }
  listeners.forEach((f) => f())
  return handed
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)'

/** The exit: the four dots gather in the middle, each floods the screen in its colour in turn, then a
 *  hole opens in the middle of the colours and widens until the app underneath is all there is. */
async function exit(boot: HTMLElement) {
  const html = document.documentElement
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || html.classList.contains('less-motion')
  const canHole = typeof CSS !== 'undefined' && CSS.supports?.('mask-image', 'radial-gradient(circle, transparent 1px, #000 2px)') && !!boot.animate
  if (reduce || !canHole) {
    html.classList.add('booting-in')
    boot.style.transition = 'opacity 0.45s ease'
    boot.style.opacity = '0'
    await sleep(500)
    boot.remove()
    window.setTimeout(() => html.classList.remove('booting-in'), 1200)
    return
  }
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2
  const cover = Math.hypot(window.innerWidth, window.innerHeight) / 2 * 1.12 + 60 // well past the corners, so none peek out
  // swap the orbiting dots for fixed "washes" in exactly the same places, so nothing jumps
  const washes = [...boot.querySelectorAll<HTMLElement>('.boot-dot')].map((dot) => {
    const r = dot.getBoundingClientRect()
    const w = document.createElement('i')
    w.className = 'boot-wash'
    Object.assign(w.style, { left: `${cx - r.width / 2}px`, top: `${cy - r.height / 2}px`, width: `${r.width}px`, height: `${r.height}px`, background: getComputedStyle(dot).backgroundColor })
    w.dataset.dx = String(r.left + r.width / 2 - cx)
    w.dataset.dy = String(r.top + r.height / 2 - cy)
    return w
  })
  const inner = boot.querySelector<HTMLElement>('.boot-in')
  washes.forEach((w) => boot.appendChild(w))
  if (inner) inner.style.visibility = 'hidden'
  const radius = parseFloat(washes[0]?.style.width || '34') / 2
  // 1. gather
  await Promise.all(washes.map((w, k) => w.animate(
    [{ transform: `translate(${w.dataset.dx}px, ${w.dataset.dy}px) scale(1)` }, { transform: 'translate(0, 0) scale(1.15)', offset: 0.8 }, { transform: 'translate(0, 0) scale(1)' }],
    { duration: 420, delay: k * 40, easing: EASE, fill: 'forwards' }).finished))
  // 2. flood, one colour after another. Each flood is a circle drawn at its full, screen-covering size and scaled
  //    up from the size of its dot, so it runs on the compositor (no relayout or repaint per frame) and stays crisp,
  //    since the bitmap is only ever shown at or below the size it was drawn at. It sits just beneath its own dot,
  //    so the dot's outline still reads while the flood is small, and above the dots before it.
  const floods = washes.map((w, k) => {
    const f = document.createElement('i')
    f.className = 'boot-wash'
    Object.assign(f.style, { left: `${cx - cover}px`, top: `${cy - cover}px`, width: `${cover * 2}px`, height: `${cover * 2}px`, background: w.style.background, transform: `scale(${radius / cover})`, willChange: 'transform' })
    boot.insertBefore(f, w)
    // the dot hands over to its flood as it starts to grow
    w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: k * 110 + 160, easing: 'linear', fill: 'forwards' })
    return f.animate([{ transform: `scale(${radius / cover})` }, { transform: 'scale(1)' }],
      { duration: 640, delay: k * 110, easing: 'cubic-bezier(0.7, 0, 0.2, 1)', fill: 'forwards' }).finished
  })
  // wait for the last colour to cover every corner, then make it the whole screen: the colours beneath are
  // gone, so none of them can show at an edge while the hole opens
  await Promise.all(floods)
  const last = washes[washes.length - 1]
  if (last) boot.style.background = last.style.background
  boot.querySelectorAll('.boot-wash').forEach((w) => w.remove())
  // 3. open a hole onto the app, which rises into place behind it
  html.classList.add('booting-in')
  boot.classList.add('boot--hole')
  const hole = boot.animate([{ '--hole': '0px' } as Keyframe, { '--hole': `${cover}px` } as Keyframe], { duration: 760, easing: 'cubic-bezier(0.6, 0, 0.2, 1)', fill: 'forwards' })
  await hole.finished
  boot.remove()
  window.setTimeout(() => html.classList.remove('booting-in'), 1100)
}

/** Called once the app has mounted: if nothing is loading, the boot screen goes. */
export function bootReady() {
  schedule()
  window.setTimeout(() => void finishBoot(), 10000) // never trap anyone behind it
}

export function useBootHold(active = true) {
  useLayoutEffect(() => (active ? holdBoot() : undefined), [active])
}

export function useBooted() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f) } }, isBooted)
}
