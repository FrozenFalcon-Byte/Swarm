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

/* The live backdrop: a grid of dots and the four agents flying over it. The dots bulge away from your
   pointer and take the colour of the nearest agent; the agents wander, then follow you when you're over the
   card; a click sends a ripple through the grid and scatters them. Paused off screen, still for reduced motion. */
const AGENT_COLORS = ['#fbe74e', '#9dc4f5', '#ff8a7a', '#5dd36a']

function SwarmField() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvas.current, host = cv?.parentElement
    if (!cv || !host) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')
    const GAP = 20
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, last = performance.now()
    const pointer = { x: -9999, y: -9999, in: false }
    const ripples: { x: number; y: number; t: number }[] = []
    const agents = AGENT_COLORS.map((c, i) => ({ c, x: 0, y: 0, vx: 0, vy: 0, seed: i * 1.7, trail: [] as { x: number; y: number }[] }))
    const size = () => {
      const r = host.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1); w = r.width; h = r.height
      cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`
      agents.forEach((a, i) => { if (!a.x) { a.x = w * (0.55 + i * 0.1); a.y = h * (0.3 + (i % 2) * 0.4) } })
    }
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // agents: wander on their own, or gather loosely around the pointer
      const t = now / 1000
      for (const [i, a] of agents.entries()) {
        const ang = t * 0.5 + a.seed + i * (Math.PI / 2)
        const tx = pointer.in ? pointer.x + Math.cos(ang * 2) * 46 : w * 0.5 + Math.cos(ang * 0.7 + a.seed) * w * 0.42
        const ty = pointer.in ? pointer.y + Math.sin(ang * 2) * 34 : h * 0.5 + Math.sin(ang * 1.1 + a.seed) * h * 0.36
        a.vx += ((tx - a.x) * (pointer.in ? 7 : 1.4) - a.vx * (pointer.in ? 3.2 : 1.6)) * dt
        a.vy += ((ty - a.y) * (pointer.in ? 7 : 1.4) - a.vy * (pointer.in ? 3.2 : 1.6)) * dt
        for (const b of agents) if (b !== a) { const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 1; if (d2 < 900) { a.vx += (dx / d2) * 900 * dt; a.vy += (dy / d2) * 900 * dt } }
        a.x += a.vx * dt; a.y += a.vy * dt
        a.trail.push({ x: a.x, y: a.y }); if (a.trail.length > 14) a.trail.shift()
      }
      for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].t > 1.6) ripples.splice(i, 1)
      // the grid
      for (let gy = GAP / 2; gy < h; gy += GAP) for (let gx = GAP / 2; gx < w; gx += GAP) {
        let x = gx, y = gy, r = 1.1, col = 'rgba(15,15,15,0.2)'
        const dx = gx - pointer.x, dy = gy - pointer.y, d = Math.hypot(dx, dy)
        if (pointer.in && d < 130) {
          const f = 1 - d / 130
          x += (dx / (d || 1)) * f * 14; y += (dy / (d || 1)) * f * 14; r += f * 2.6
          let best = 0, bd = Infinity
          agents.forEach((a, k) => { const ad = Math.hypot(a.x - gx, a.y - gy); if (ad < bd) { bd = ad; best = k } })
          col = AGENT_COLORS[best]
        }
        for (const rp of ripples) {
          const rad = (t - rp.t) * 520, rd = Math.abs(Math.hypot(gx - rp.x, gy - rp.y) - rad)
          if (rd < 26) { const f = (1 - rd / 26) * (1 - (t - rp.t) / 1.6); r += f * 3; col = AGENT_COLORS[Math.floor(rad / 60) % 4] }
        }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill()
      }
      // the agents, with a fading trail
      for (const a of agents) {
        a.trail.forEach((p, k) => { ctx.beginPath(); ctx.arc(p.x, p.y, 2 + k * 0.25, 0, Math.PI * 2); ctx.fillStyle = a.c; ctx.globalAlpha = (k / a.trail.length) * 0.5; ctx.fill() })
        ctx.globalAlpha = 1
        ctx.beginPath(); ctx.arc(a.x, a.y, 6.5, 0, Math.PI * 2); ctx.fillStyle = a.c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#0f0f0f'; ctx.stroke()
      }
      if (!calm && visible && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame) }
    const at = (e: PointerEvent) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const move = (e: PointerEvent) => {
      const p = at(e); pointer.x = p.x; pointer.y = p.y; pointer.in = true
      host.style.setProperty('--mx', String(p.x / w - 0.5)); host.style.setProperty('--my', String(p.y / h - 0.5))
      if (calm) start()
    }
    const leave = () => { pointer.in = false; host.style.setProperty('--mx', '0'); host.style.setProperty('--my', '0'); if (calm) start() }
    const down = (e: PointerEvent) => {
      const p = at(e); ripples.push({ ...p, t: performance.now() / 1000 })
      for (const a of agents) { const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy) || 1; a.vx += (dx / d) * 700; a.vy += (dy / d) * 700 }
      if (calm) start()
    }
    size()
    const ro = new ResizeObserver(() => { size(); start() })
    ro.observe(host)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start() })
    io.observe(host)
    const vis = () => { if (!document.hidden) start() }
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave); host.addEventListener('pointerdown', down)
    document.addEventListener('visibilitychange', vis)
    start()
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect()
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); host.removeEventListener('pointerdown', down)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  return <canvas ref={canvas} className="idc-field" aria-hidden="true" />
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
