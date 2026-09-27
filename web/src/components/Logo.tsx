import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { animate } from 'motion/react'

/** The Swarm mark: four agents in a tile. */
export function Mark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={animated ? 'mark mark--live' : 'mark'}>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <circle cx="11" cy="11" r="4" fill="var(--triager)" />
      <circle cx="21" cy="11" r="4" fill="var(--coder)" />
      <circle cx="11" cy="21" r="4" fill="var(--tester)" />
      <circle cx="21" cy="21" r="4" fill="var(--reviewer)" />
    </svg>
  )
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Swarm home">
      <Mark />
      <span>Swarm</span>
    </Link>
  )
}

const LIVE = ['--triager', '--coder', '--tester', '--reviewer']
const SLOT = [[6.5, 6.5], [15.9, 6.5], [6.5, 15.9], [15.9, 15.9]] // each dot's corner in the 30px tile (top-left of a 7.5px dot)
const DOT = 7.5, TOP = 5 // the tile sits 5px down the 40px row
const WORD = 'Swarm'
const DROPS = 12

type Phase = 'idle' | 'out' | 'play' | 'splash' | 'home' | 'hover'
type Ctl = { stop: () => void; then: (f: () => void) => unknown }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const done = (as: Ctl[]) => Promise.all(as.map((a) => new Promise<void>((r) => a.then(r))))

/** The sidebar's logo. Every so often the four agents hop out of their tile and land on the word, which
 *  melts away under them; they play on their own for a moment, circling like a carousel, then crash
 *  together in the middle and burst: a ring and a splash of drops go out, and the word springs back from
 *  the point they met, letter by letter. Then they pop back into the tile.
 *  Pointing at it is part of the same timeline: mid-play, they skip to the splash so the word comes back
 *  straight away; otherwise they chase round the tile while the word waves in their colours. */
export function LiveLogo({ to = '/', busy = false, still = false, folded = false, label = 'Swarm home' }: { to?: string; busy?: boolean; still?: boolean; folded?: boolean; label?: string }) {
  const root = useRef<HTMLAnchorElement>(null)
  const dots = useRef<(HTMLElement | null)[]>([])
  const letters = useRef<(HTMLElement | null)[]>([])
  const drops = useRef<(HTMLElement | null)[]>([])
  const tile = useRef<HTMLElement>(null)
  const ring = useRef<HTMLElement>(null)
  const st = useRef({ phase: 'idle' as Phase, hover: false, run: 0, rush: null as null | (() => void), live: [] as Ctl[] })
  const [fontsIn, setFontsIn] = useState(false)
  useEffect(() => { void document.fonts?.ready.then(() => setFontsIn(true)) }, [])
  const quiet = still || folded || (typeof document !== 'undefined' && (document.documentElement.classList.contains('less-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches))
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const s = st.current
    const run = ++s.run
    const alive = () => s.run === run
    const go = (el: Element | null | undefined, kf: Record<string, unknown>, o: Record<string, unknown>) => {
      if (!el) return null
      const a = animate(el, kf as never, o as never) as unknown as Ctl
      s.live.push(a)
      return a
    }
    const all = (xs: (Ctl | null)[]) => done(xs.filter(Boolean) as Ctl[])
    const color = (v: string) => getComputedStyle(root.current!).getPropertyValue(v).trim() || '#0f0f0f'
    // where the letters are, relative to the logo, and the slot-relative offset that puts a dot's centre at a point
    const measure = () => {
      const box = root.current!.getBoundingClientRect()
      const ls = letters.current.map((l) => l!.getBoundingClientRect())
      const top = Math.min(...ls.map((r) => r.top)) - box.top, bottom = Math.max(...ls.map((r) => r.bottom)) - box.top
      const left = ls[0].left - box.left, right = ls[ls.length - 1].right - box.left
      return { cx: ls.map((r) => r.left + r.width / 2 - box.left), mid: top + (bottom - top) * 0.52, left, right, center: (left + right) / 2 }
    }
    const off = (k: number, x: number, y: number) => ({ x: x - SLOT[k][0] - DOT / 2, y: y - TOP - SLOT[k][1] - DOT / 2 })
    const reset = () => {
      dots.current.forEach((el) => el && animate(el, { x: 0, y: 0, scale: 1, opacity: 1 }, { duration: 0 }))
      letters.current.forEach((el) => el && animate(el, { x: 0, y: 0, scale: 1, opacity: 1, filter: 'blur(0px)' }, { duration: 0 }))
    }
    const stopAll = () => { s.live.forEach((a) => a.stop()); s.live = [] }

    // the word comes back from wherever the dots met, with a splash
    const splash = async (m: ReturnType<typeof measure>) => {
      s.phase = 'splash'
      const cx = m.center, cy = m.mid
      await all(dots.current.map((el, k) => { const p = off(k, cx + (k % 2 ? 2 : -2), cy + (k < 2 ? -2 : 2)); return go(el, { x: p.x, y: p.y, scale: 1.15 }, { duration: 0.34, ease: [0.34, 1.4, 0.5, 1], delay: k * 0.03 }) }))
      if (!alive()) return
      await all(dots.current.map((el) => go(el, { scale: [1.15, 0.7, 1.9, 0], opacity: [1, 1, 1, 0] }, { duration: 0.42, times: [0, 0.35, 0.7, 1], ease: 'easeOut' })))
      if (!alive()) return
      const rg = ring.current
      if (rg) { rg.style.left = `${cx}px`; rg.style.top = `${cy}px`; go(rg, { scale: [0.2, 3.4], opacity: [0.9, 0] }, { duration: 0.7, ease: [0.2, 0.7, 0.3, 1] }) }
      drops.current.forEach((el, i) => {
        if (!el) return
        const a = (i / DROPS) * Math.PI * 2 + 0.3, d = 16 + (i % 3) * 7
        el.style.left = `${cx}px`; el.style.top = `${cy}px`; el.style.background = color(LIVE[i % 4])
        go(el, { x: [0, Math.cos(a) * d, Math.cos(a) * d * 1.15], y: [0, Math.sin(a) * d * 0.6, Math.sin(a) * d * 0.6 + 9], scale: [0.4, 1, 0], opacity: [1, 1, 0] },
          { duration: 0.75, times: [0, 0.45, 1], ease: 'easeOut' })
      })
      letters.current.forEach((el, i) => el && go(el, { x: [(cx - m.cx[i]) * 0.8, 0], y: [2, 0], scale: [0.2, 1], opacity: [0, 1], filter: ['blur(3px)', 'blur(0px)'] },
        { type: 'spring', stiffness: 380, damping: 17, delay: 0.04 + Math.abs(i - 2) * 0.05 }))
      await sleep(380) // the word is most of the way back; the dots go home while it settles
      if (!alive()) return
      // and the dots pop back into the tile
      s.phase = 'home'
      go(tile.current, { scale: [1, 0.86, 1] }, { duration: 0.45, ease: 'easeOut' })
      await all(dots.current.map((el, k) => { if (el) animate(el, { x: 0, y: 0 }, { duration: 0 }); return go(el, { scale: [0, 1], opacity: [0, 1] }, { type: 'spring', stiffness: 520, damping: 16, delay: 0.1 + k * 0.07 }) }))
    }

    const cycle = async () => {
      const m = measure()
      if (m.right - m.left < 10) return
      const fast = busyRef.current ? 0.75 : 1
      // 1. out of the tile and onto the word, which melts away under them
      s.phase = 'out'
      go(tile.current, { scale: [1, 0.88, 1] }, { duration: 0.5, ease: 'easeOut' })
      const spots = [0, 1, 2, 3].map((k) => m.left + ((k + 0.5) / 4) * (m.right - m.left))
      const outs = dots.current.map((el, k) => {
        const land = off(k, spots[k], m.mid), peak = off(k, (spots[k] + 15) / 2, m.mid - 16 - k * 2)
        return go(el, { x: [0, peak.x, land.x], y: [0, peak.y, land.y], scale: [1, 1.3, 1] }, { duration: 0.62 * fast, delay: k * 0.11 * fast, times: [0, 0.5, 1], ease: 'easeInOut' })
      })
      letters.current.forEach((el, i) => {
        const k = Math.min(3, Math.floor(((m.cx[i] - m.left) / (m.right - m.left)) * 4))
        go(el, { y: [0, 3, 5], scale: [1, 1.08, 0.3], opacity: [1, 1, 0], filter: ['blur(0px)', 'blur(0px)', 'blur(4px)'] }, { duration: 0.38, times: [0, 0.3, 1], delay: (0.5 + k * 0.11) * fast, ease: 'easeIn' })
      })
      await all(outs)
      if (!alive()) return
      // 2. play: a carousel round the middle of the word, bigger as each passes the front
      s.phase = 'play'
      const rx = (m.right - m.left) * 0.36, ry = 7, turns = 2, n = 24 * turns
      const rush = new Promise<void>((r) => { s.rush = r })
      const play = dots.current.map((el, k) => {
        const xs: number[] = [], ys: number[] = [], sc: number[] = []
        for (let j = 0; j <= n; j++) {
          const a = (j / 24) * Math.PI * 2 + (k * Math.PI) / 2 - Math.PI / 2
          const p = off(k, m.center + Math.cos(a) * rx * Math.min(1, j / 6 + 0.35), m.mid + Math.sin(a) * ry)
          xs.push(p.x); ys.push(p.y); sc.push(1 + Math.sin(a) * 0.28)
        }
        const start = off(k, spots[k], m.mid)
        return go(el, { x: [start.x, ...xs], y: [start.y, ...ys], scale: [1, ...sc] }, { duration: 1.5 * turns * fast, ease: 'linear' })
      })
      await Promise.race([all(play), rush])
      s.rush = null
      play.forEach((a) => a?.stop())
      if (!alive()) return
      // 3. crash together and burst back into the word
      await splash(m)
    }

    // hover: they chase round the tile, one slot on each beat, while the word waves in their colours
    const chase = async () => {
      s.phase = 'hover'
      letters.current.forEach((el, i) => el && go(el, { y: [0, -4, 0], color: [color('--ink'), color(LIVE[i % 4]), color('--ink')] },
        { duration: 0.55, delay: i * 0.05, ease: 'easeOut' }))
      let step = 0
      while (alive() && s.hover) {
        step++
        await all(dots.current.map((el, k) => {
          const order = [0, 1, 3, 2], to = SLOT[order[(order.indexOf(k) + step) % 4]] // clockwise round the tile
          return go(el, { x: to[0] - SLOT[k][0], y: to[1] - SLOT[k][1], scale: [1, 1.25, 1] }, { type: 'spring', stiffness: 420, damping: 22, scale: { duration: 0.35 } })
        }))
        await sleep(160)
      }
      if (!alive()) return
      await all(dots.current.map((el) => go(el, { x: 0, y: 0, scale: 1 }, { type: 'spring', stiffness: 380, damping: 24 })))
      if (alive()) s.phase = 'idle'
    }

    const onEnter = () => {
      s.hover = true
      if (s.phase === 'idle') void chase()
      else if (s.phase === 'play') s.rush?.() // skip to the splash, the word comes straight back
      else if (s.phase === 'out') {
        // they've only just left: turn round and splash now
        stopAll(); void splash(measure()).then(() => { if (alive() && s.hover) void chase(); else if (alive()) s.phase = 'idle' })
      }
    }
    const onLeave = () => { s.hover = false }
    const el = root.current
    el?.addEventListener('pointerenter', onEnter)
    el?.addEventListener('pointerleave', onLeave)

    reset()
    s.phase = 'idle'
    let timer = 0
    const loop = async () => {
      if (!alive()) return
      if (!quiet && s.phase === 'idle' && !s.hover && !document.hidden) {
        await cycle()
        if (!alive()) return
        const now = s.phase as Phase // cycle() moved it on
        if (s.hover && now !== 'hover') void chase()
        else if (now !== 'hover') s.phase = 'idle'
      }
      timer = window.setTimeout(loop, busyRef.current ? 4200 : 8500)
    }
    if (!quiet && !folded) timer = window.setTimeout(loop, 1800)
    return () => {
      s.run++; window.clearTimeout(timer); stopAll(); reset(); s.phase = 'idle'
      el?.removeEventListener('pointerenter', onEnter); el?.removeEventListener('pointerleave', onLeave)
    }
  }, [quiet, folded, fontsIn]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Link ref={root} to={to} className="logo live-logo" aria-label={label} data-tip={label}>
      <span className="live-mark mark" ref={tile} aria-hidden="true" />
      {LIVE.map((c, k) => <i key={k} className="live-dot" ref={(el) => { dots.current[k] = el }} style={{ background: `var(${c})`, left: SLOT[k][0], top: TOP + SLOT[k][1] }} aria-hidden="true" />)}
      <i className="live-ring" ref={ring} aria-hidden="true" />
      {Array.from({ length: DROPS }, (_, i) => <i key={i} className="live-drop" ref={(el) => { drops.current[i] = el }} aria-hidden="true" />)}
      <span className="live-word" aria-hidden="true">{[...WORD].map((ch, i) => <span key={i} ref={(el) => { letters.current[i] = el }}>{ch}</span>)}</span>
    </Link>
  )
}
