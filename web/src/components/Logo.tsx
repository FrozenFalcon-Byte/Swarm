import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

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

const LIVE = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)']
const SLOT = [[6.5, 6.5], [15.9, 6.5], [6.5, 15.9], [15.9, 15.9]] // each dot's corner in the 30px tile (top-left of a 7.5px dot)
const WORD = 'Swarm'
const CYCLE = 6400 // ms for one trip across the word and back
const TRAIL = 0.075 // how far (of a cycle) each dot follows the one ahead

/** The sidebar's logo, alive across the whole row. Every few seconds the four agents hop out of their tile
 *  one after another and bounce along the word, each letter giving a little under them, then arc back home.
 *  Point at it and they line up under the word as a relay, joined by a thread, while the letters wave. */
export function LiveLogo({ to = '/', busy = false, still = false, folded = false, label = 'Swarm home' }: { to?: string; busy?: boolean; still?: boolean; folded?: boolean; label?: string }) {
  const root = useRef<HTMLAnchorElement>(null)
  const dots = useRef<(HTMLElement | null)[]>([])
  const letters = useRef<(HTMLElement | null)[]>([])
  const tile = useRef<HTMLElement>(null)
  const thread = useRef<HTMLElement>(null)
  const loop = useRef<Animation[]>([])
  const [hover, setHover] = useState(false)
  const [fontsIn, setFontsIn] = useState(false)
  const [size, setSize] = useState(0) // re-plan the route when fonts land or the window changes
  useEffect(() => {
    void document.fonts?.ready.then(() => setFontsIn(true))
    let id = 0
    const on = () => { window.clearTimeout(id); id = window.setTimeout(() => setSize((n) => n + 1), 200) }
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('resize', on); window.clearTimeout(id) }
  }, [])
  const quiet = still || folded || (typeof document !== 'undefined' && (document.documentElement.classList.contains('less-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches))

  // where the letters are, relative to the logo, so the dots land on them
  const measure = () => {
    const box = root.current?.getBoundingClientRect()
    if (!box) return null
    const ls = letters.current.map((l) => l!.getBoundingClientRect())
    const top = Math.min(...ls.map((r) => r.top)) - box.top, bottom = Math.max(...ls.map((r) => r.bottom)) - box.top
    return { ls: ls.map((r) => ({ cx: r.left + r.width / 2 - box.left, w: r.width })), top, bottom, left: ls[0].left - box.left, right: ls[ls.length - 1].right - box.left }
  }

  // the trip across the word, on repeat
  useEffect(() => {
    loop.current.forEach((a) => a.cancel())
    loop.current = []
    if (quiet || hover) return
    const m = measure()
    if (!m || m.right - m.left < 10) return
    const period = busy ? CYCLE * 0.6 : CYCLE
    const land = m.top + (m.bottom - m.top) * 0.3 - 7 // a dot's top edge when it sits on a letter (cap height, roughly)
    const out = 0.12, step = 0.075, home = out + 0.05 + WORD.length * step + 0.14
    const hop = (x: number, y: number, s = 1) => ({ x, y, s })
    const route = [
      { t: 0, p: hop(0, 0) },
      { t: out, p: hop(0, 0) },
      { t: out + 0.04, p: hop(34, land - 12, 1.1) },
      ...m.ls.flatMap((l, i) => [
        { t: out + 0.05 + i * step + step * 0.5, p: hop(l.cx - 3.75, land, 1) },
        ...(i < m.ls.length - 1 ? [{ t: out + 0.05 + (i + 1) * step + step * 0.02, p: hop((l.cx + m.ls[i + 1].cx) / 2 - 3.75, land - 8, 1.05) }] : []),
      ]),
      { t: home - 0.07, p: hop((m.left + m.right) / 2, land - 20, 1.1) },
      { t: home, p: hop(0, 0) },
      { t: 1, p: hop(0, 0) },
    ]
    dots.current.forEach((el, k) => {
      if (!el) return
      const [sx, sy] = SLOT[k]
      // absolute points are measured from the logo's corner; the tile's own spots are relative to the slot
      const frames = route.map(({ t, p }, i) => {
        const rel = i < 2 || i >= route.length - 2
        const x = rel ? p.x : p.x - sx, y = rel ? p.y : p.y - sy - 5
        return { offset: t, transform: `translate(${x}px, ${y}px) scale(${p.s})`, easing: 'cubic-bezier(0.45, 0, 0.35, 1)' }
      })
      loop.current.push(el.animate(frames, { duration: period, iterations: Infinity, delay: k * TRAIL * period }))
    })
    // each letter gives a little as each dot lands on it
    letters.current.forEach((el, i) => {
      if (!el) return
      const hits = [0, 1, 2, 3].map((k) => out + 0.05 + i * step + step * 0.5 + k * TRAIL).map((t) => t % 1).sort((a, b) => a - b)
      const frames: Keyframe[] = [{ offset: 0, transform: 'none' }]
      hits.forEach((t) => {
        if (t < 0.02 || t > 0.95) return
        frames.push({ offset: t - 0.004, transform: 'none' }, { offset: t + 0.008, transform: 'translateY(1.5px) scale(1.04, 0.9)' }, { offset: t + 0.03, transform: 'translateY(-1.5px) scale(0.98, 1.04)' }, { offset: t + 0.05, transform: 'none' })
      })
      frames.push({ offset: 1, transform: 'none' })
      loop.current.push(el.animate(frames, { duration: period, iterations: Infinity, easing: 'ease-out' }))
    })
    // the tile nods as each one leaves and comes home
    const nods = [0, 1, 2, 3].flatMap((k) => [out + 0.02 + k * TRAIL, home - 0.005 + k * TRAIL]).filter((t) => t < 0.97).sort((a, b) => a - b)
    const tf: Keyframe[] = [{ offset: 0, transform: 'none' }]
    nods.forEach((t) => tf.push({ offset: t - 0.005, transform: 'none' }, { offset: t + 0.012, transform: 'scale(0.9)' }, { offset: t + 0.035, transform: 'none' }))
    tf.push({ offset: 1, transform: 'none' })
    if (tile.current) loop.current.push(tile.current.animate(tf, { duration: period, iterations: Infinity }))
    return () => { loop.current.forEach((a) => a.cancel()); loop.current = [] }
  }, [quiet, hover, busy, fontsIn, size]) // eslint-disable-line react-hooks/exhaustive-deps

  // hover: a relay under the word
  useEffect(() => {
    if (!hover || folded) return
    const m = measure()
    if (!m) return
    const anims: Animation[] = []
    const y = m.bottom + 1
    const gap = (m.right - m.left - 7.5) / 3
    dots.current.forEach((el, k) => {
      if (!el) return
      const [sx, sy] = SLOT[k]
      anims.push(el.animate([{ transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform },
        { transform: `translate(${m.left + k * gap - sx}px, ${y - sy - 5}px) scale(1)` }], { duration: 520, delay: k * 50, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)', fill: 'forwards' }))
    })
    letters.current.forEach((el, i) => el && anims.push(el.animate(
      [{ transform: 'none' }, { transform: 'translateY(-4px)', offset: 0.4 }, { transform: 'none' }], { duration: 560, delay: 60 + i * 55, easing: 'cubic-bezier(0.34, 1.5, 0.5, 1)' })))
    if (thread.current) {
      Object.assign(thread.current.style, { left: `${m.left + 3.75}px`, width: `${m.right - m.left - 7.5}px`, top: `${y + 3}px` })
      anims.push(thread.current.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 480, delay: 200, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' }))
    }
    return () => {
      // and home again
      dots.current.forEach((el) => {
        if (!el) return
        const from = getComputedStyle(el).transform
        anims.forEach((a) => a.effect && (a.effect as KeyframeEffect).target === el && a.cancel())
        el.animate([{ transform: from }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.34, 1.3, 0.5, 1)' })
      })
      anims.forEach((a) => a.cancel())
    }
  }, [hover, folded]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Link ref={root} to={to} className="logo live-logo" aria-label={label} data-tip={label} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="live-mark mark" ref={tile} aria-hidden="true" />
      {LIVE.map((c, k) => <i key={k} className="live-dot" ref={(el) => { dots.current[k] = el }} style={{ background: c, left: 0 + SLOT[k][0], top: 5 + SLOT[k][1] }} aria-hidden="true" />)}
      <i className="live-thread" ref={thread} aria-hidden="true" />
      <span className="live-word" aria-hidden="true">{[...WORD].map((ch, i) => <span key={i} ref={(el) => { letters.current[i] = el }}>{ch}</span>)}</span>
    </Link>
  )
}
