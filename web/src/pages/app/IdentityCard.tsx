import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { easeOut } from '../../lib/motion'
import { CountUp } from './ui'

/* The banner at the top of your profile. Its background is one colour, picked from your account id (so
   everyone's differs but yours stays the same), drifting through lighter and deeper shades of itself. A new photo doesn't just swap:
   it opens from the centre as a circle while the old one sinks away, and a ring of agent dots bursts out. */

const PALETTE = ['#9dc4f5', '#fbe74e', '#ff8a7a', '#5dd36a', '#f5b7d0', '#a7cbf6', '#ffd0e2', '#c7b8f5', '#8fe1d0', '#ffc38a']

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** One colour per person, picked from their account id, plus a direction and pace for its drift. */
export function useUserPalette(seed: string) {
  return useMemo(() => {
    let h = hash(seed || 'swarm')
    const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return h }
    return { color: PALETTE[next() % PALETTE.length], angle: next() % 360, speed: 12 + (next() % 8) }
  }, [seed])
}

export function IdentityCard({ uid, name, sub, chips, photo, onPhoto, onRemove, dragging, dropProps, stats }: {
  uid: string; name: string; sub: ReactNode; chips: ReactNode; photo: ReactNode; onPhoto: () => void; onRemove?: () => void
  dragging: boolean; dropProps: Record<string, unknown>; stats: [string, number, string?][]
}) {
  const p = useUserPalette(uid)
  return (
    <motion.header className="idc" initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease: easeOut }}
      style={{ ['--hue' as string]: p.color, ['--spin' as string]: `${p.angle}deg`, ['--speed' as string]: `${p.speed}s` }}>
      <div className="idc-bg" aria-hidden="true"><i /><i /><i /><i /></div>
      <SwarmField />
      <button type="button" className={`idc-photo ${dragging ? 'is-drop' : ''}`} onClick={onPhoto} aria-label="Change profile picture" {...dropProps}>
        {photo}
        <span className="idc-photo-cta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>Change</span>
      </button>
      <div className="idc-id">
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: easeOut, delay: 0.1 }}>{name}</motion.h1>
        <motion.p className="idc-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>{sub}</motion.p>
        <motion.div className="idc-chips" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          {chips}
          {onRemove && <button type="button" className="idc-link" onClick={onRemove}>Remove photo</button>}
        </motion.div>
      </div>
      <div className="idc-stats">
        {stats.map(([label, v, suffix], k) => (
          <motion.div key={label} className="idc-stat" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.3 + k * 0.08 }}>
            <b className="idc-num"><CountUp value={v} suffix={suffix} /></b><span>{label}</span>
          </motion.div>
        ))}
      </div>
    </motion.header>
  )
}

/* The live backdrop: a few chunky stickers in the agents' colours, drawn like the rest of Swarm (ink outline,
   hard shadow). They drift on their own and bounce off the card's edges, each other and your name, photo and
   numbers. Move near one and it shies away; grab one and throw it; click empty space and the nearby ones hop.
   They sit still for reduced motion, and the loop pauses off screen. */
type Kind = 'dot' | 'pill' | 'ring' | 'square' | 'mark'
const STICKERS: { kind: Kind; size: number; color: string; x: number; y: number }[] = [
  { kind: 'mark', size: 46, color: 'var(--ink)', x: 0.47, y: 0.22 },
  { kind: 'dot', size: 34, color: 'var(--triager)', x: 0.58, y: 0.78 },
  { kind: 'pill', size: 30, color: 'var(--coder)', x: 0.66, y: 0.3 },
  { kind: 'ring', size: 38, color: 'var(--tester)', x: 0.52, y: 0.62 },
  { kind: 'square', size: 30, color: 'var(--reviewer)', x: 0.72, y: 0.72 },
  { kind: 'dot', size: 20, color: 'var(--white)', x: 0.62, y: 0.12 },
]

function SwarmField() {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const layer = box.current, host = layer?.parentElement
    if (!layer || !host) return
    const els = [...layer.querySelectorAll<HTMLElement>('.idc-sticker')]
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')
    let w = 0, h = 0, raf = 0, visible = true, last = performance.now()
    let walls: { l: number; t: number; r: number; b: number }[] = []
    const bodies = STICKERS.map((st, i) => ({
      el: els[i], rad: (st.kind === 'pill' ? st.size * 1.5 : st.size) / 2 + 2, x: 0, y: 0, vx: (i % 2 ? 1 : -1) * 14, vy: (i % 3 ? -1 : 1) * 10,
      rot: (i * 37) % 30 - 15, spin: (i % 2 ? 1 : -1) * 6, seed: i * 1.93, placed: false,
    }))
    const pointer = { x: -999, y: -999, in: false, px: 0, py: 0, vx: 0, vy: 0 }
    let held: (typeof bodies)[number] | null = null

    const measure = () => {
      const r = host.getBoundingClientRect()
      w = r.width; h = r.height
      walls = [...host.querySelectorAll<HTMLElement>('.idc-photo, .idc-id h1, .idc-sub, .idc-chips, .idc-stat')].map((el) => {
        const b = el.getBoundingClientRect(); return { l: b.left - r.left - 4, t: b.top - r.top - 4, r: b.right - r.left + 4, b: b.bottom - r.top + 4 }
      })
      // anything sitting on the content (or not placed yet) moves to the nearest free spot to where it wants to be
      STICKERS.forEach((st, i) => { const o = bodies[i]; if (!o.placed || blocked(o, o.x, o.y)) { home(o, o.placed ? o.x : st.x * w, o.placed ? o.y : st.y * h); o.placed = true } })
    }
    const blocked = (o: (typeof bodies)[number], x: number, y: number) =>
      x < o.rad || x > w - o.rad || y < o.rad || y > h - o.rad ||
      walls.some((b) => Math.hypot(x - Math.max(b.l, Math.min(x, b.r)), y - Math.max(b.t, Math.min(y, b.b))) < o.rad + 4) ||
      bodies.some((q) => q !== o && q.placed && Math.hypot(q.x - x, q.y - y) < q.rad + o.rad)
    const home = (o: (typeof bodies)[number], wantX: number, wantY: number) => {
      let best: [number, number] | null = null, bestD = Infinity
      for (let k = 0; k < 160; k++) {
        const x = o.rad + Math.random() * Math.max(1, w - 2 * o.rad), y = o.rad + Math.random() * Math.max(1, h - 2 * o.rad)
        if (blocked(o, x, y)) continue
        const d = Math.hypot(x - wantX, y - wantY)
        if (d < bestD) { bestD = d; best = [x, y] }
      }
      if (best) { o.x = best[0]; o.y = best[1] } else { o.x = Math.min(Math.max(wantX, o.rad), w - o.rad); o.y = Math.min(Math.max(wantY, o.rad), h - o.rad) }
      o.vx *= 0.2; o.vy *= 0.2
    }
    let stuck = 0
    const draw = () => { for (const o of bodies) o.el.style.transform = `translate(${(o.x - o.rad).toFixed(1)}px, ${(o.y - o.rad).toFixed(1)}px) rotate(${o.rot.toFixed(1)}deg)` }

    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000); last = now
      const t = now / 1000
      for (const o of bodies) {
        if (o === held) {
          o.vx = (pointer.x - o.x) / Math.max(dt, 0.008); o.vy = (pointer.y - o.y) / Math.max(dt, 0.008)
          o.x = pointer.x; o.y = pointer.y; o.rot += o.vx * 0.002; continue
        }
        // a slow drift of its own, so the card never goes still
        o.vx += Math.cos(t * 0.4 + o.seed) * 6 * dt; o.vy += Math.sin(t * 0.5 + o.seed * 1.3) * 6 * dt
        // shy of the pointer
        if (pointer.in) {
          const dx = o.x - pointer.x, dy = o.y - pointer.y, d = Math.hypot(dx, dy)
          if (d < o.rad + 70 && d > 0.1) { const f = (1 - d / (o.rad + 70)) * 900 * dt; o.vx += (dx / d) * f; o.vy += (dy / d) * f }
        }
        const damp = Math.exp(-0.9 * dt); o.vx *= damp; o.vy *= damp; o.spin = Math.max(-140, Math.min(140, o.spin * Math.exp(-1.4 * dt)))
        const sp = Math.hypot(o.vx, o.vy); if (sp > 900) { o.vx *= 900 / sp; o.vy *= 900 / sp }
        o.x += o.vx * dt; o.y += o.vy * dt; o.rot = (o.rot + (o.spin + o.vx * 0.04) * dt) % 360
        // your name, photo and numbers: solid, and they bounce off them
        for (const b of walls) {
          const cx = Math.max(b.l, Math.min(o.x, b.r)), cy = Math.max(b.t, Math.min(o.y, b.b))
          let dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy)
          if (d >= o.rad) continue
          if (d < 0.01) { // centre inside the box: leave by the nearest side
            const exits = [[o.x - b.l, -1, 0], [b.r - o.x, 1, 0], [o.y - b.t, 0, -1], [b.b - o.y, 0, 1]].sort((p, q) => p[0] - q[0])[0]
            dx = exits[1]; dy = exits[2]; d = 0
          } else { dx /= d; dy /= d }
          o.x += dx * (o.rad - d); o.y += dy * (o.rad - d)
          const vn = o.vx * dx + o.vy * dy
          if (vn < 0) { o.vx -= 1.7 * vn * dx; o.vy -= 1.7 * vn * dy; o.spin += (o.vx * dy - o.vy * dx) * 0.05 }
        }
        // the card's edges, last, so nothing ever leaves the card
        if (o.x < o.rad) { o.x = o.rad; o.vx = Math.abs(o.vx) * 0.7; o.spin += o.vy * 0.05 }
        if (o.x > w - o.rad) { o.x = w - o.rad; o.vx = -Math.abs(o.vx) * 0.7; o.spin -= o.vy * 0.05 }
        if (o.y < o.rad) { o.y = o.rad; o.vy = Math.abs(o.vy) * 0.7; o.spin -= o.vx * 0.05 }
        if (o.y > h - o.rad) { o.y = h - o.rad; o.vy = -Math.abs(o.vy) * 0.7; o.spin += o.vx * 0.05 }
      }
      // and each other
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy), min = a.rad + c.rad
        if (d >= min || d < 0.01) continue
        const nx = dx / d, ny = dy / d, push = (min - d) / 2
        if (a !== held) { a.x -= nx * push; a.y -= ny * push }
        if (c !== held) { c.x += nx * push; c.y += ny * push }
        const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny
        if (rel < 0) { const k = -1.6 * rel / 2; if (a !== held) { a.vx -= k * nx; a.vy -= k * ny } if (c !== held) { c.vx += k * nx; c.vy += k * ny } }
      }
      // one wedged between the card's edge and the content (it can't fit there) goes somewhere roomier
      if (++stuck % 30 === 0) for (const o of bodies) if (o !== held && blocked(o, o.x, o.y)) home(o, o.x, o.y)
      draw()
      if (visible && !document.hidden) raf = requestAnimationFrame(step)
    }
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); if (!calm) raf = requestAnimationFrame(step) }

    const at = (e: PointerEvent) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const move = (e: PointerEvent) => { const p = at(e); pointer.x = p.x; pointer.y = p.y; pointer.in = true
      const hit = bodies.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < o.rad)
      host.classList.toggle('idc-grab', !!held || (hit && !(e.target as HTMLElement).closest('button, a, input'))) }
    const leave = () => { pointer.in = false; if (!held) host.classList.remove('idc-grab') }
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, .idc-stat')) return
      const p = at(e)
      held = bodies.find((o) => Math.hypot(o.x - p.x, o.y - p.y) < o.rad + 4) ?? null
      if (held) { e.preventDefault(); host.setPointerCapture(e.pointerId); held.el.classList.add('held'); host.classList.add('idc-grab'); return }
      // a click on empty card: everything nearby hops away from it
      for (const o of bodies) { const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < 260) { const f = (1 - d / 260) * 520; o.vx += (dx / d) * f; o.vy += (dy / d) * f - 80; o.spin += (Math.random() - 0.5) * 200 } }
    }
    const up = () => { if (held) { held.el.classList.remove('held'); held.spin += held.vx * 0.3; held = null } }

    measure(); draw()
    const settle = window.setTimeout(measure, 1100) // the banner's own entrance has moved things by then
    const ro = new ResizeObserver(() => { measure(); draw() })
    ro.observe(host)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start() })
    io.observe(host)
    const vis = () => { if (!document.hidden) start() }
    if (!calm) {
      host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave)
      host.addEventListener('pointerdown', down); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up)
    }
    document.addEventListener('visibilitychange', vis)
    start()
    return () => {
      cancelAnimationFrame(raf); window.clearTimeout(settle); ro.disconnect(); io.disconnect()
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave)
      host.removeEventListener('pointerdown', down); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  return (
    <div ref={box} className="idc-stickers" aria-hidden="true">
      {STICKERS.map((st, i) => (
        <span key={i} className={`idc-sticker idc-sticker--${st.kind}`} style={{ ['--c' as string]: st.color, ['--s' as string]: `${st.size}px`, animationDelay: `${0.35 + i * 0.07}s` }}>
          {st.kind === 'mark' && <><i /><i /><i /><i /></>}
        </span>
      ))}
    </div>
  )
}

/** The profile picture, which changes by opening the new one from the centre over the old. */
export function PhotoSwap({ src, initial, size }: { src: string | null; initial: string; size: number }) {
  const key = src ? `${src.length}:${src.slice(-24)}` : 'none'
  const [bursts, setBursts] = useState(0)
  const last = useRef(key)
  useEffect(() => { if (last.current !== key) { last.current = key; setBursts((n) => n + 1) } }, [key])
  return (
    <span className="swap" style={{ width: size, height: size }}>
      <AnimatePresence initial={false}>
        <motion.span key={key} className="swap-layer"
          initial={{ clipPath: 'circle(0% at 50% 50%)', scale: 1.25, rotate: -8 }} animate={{ clipPath: 'circle(72% at 50% 50%)', scale: 1, rotate: 0 }}
          exit={{ scale: 0.85, opacity: 0, filter: 'blur(4px)', transition: { duration: 0.6, ease: [0.65, 0, 0.35, 1] } }}
          transition={{ duration: 0.85, ease: [0.65, 0, 0.35, 1] }}>
          {src ? <img src={src} alt="" draggable={false} /> : <span className="swap-initial" style={{ fontSize: size * 0.42 }}>{initial}</span>}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence>
        {bursts > 0 && (
          <motion.span key={bursts} className="swap-burst" aria-hidden="true" initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, delay: 0.9 }}>
            {Array.from({ length: 8 }, (_, k) => {
              const a = (k / 8) * Math.PI * 2
              return <motion.i key={k} style={{ background: ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)'][k % 4] }}
                initial={{ x: 0, y: 0, scale: 0 }} animate={{ x: Math.cos(a) * size * 0.72, y: Math.sin(a) * size * 0.72, scale: [0, 1.2, 0] }}
                transition={{ duration: 0.9, ease: easeOut, delay: 0.25 }} />
            })}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
