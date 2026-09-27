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
   hard shadow). Each has a home on the card and bobs there on its own clock; they lean a little as your
   pointer crosses the banner (nearer ones more), hop and spin when clicked, and can be dragged anywhere,
   springing home when let go. No physics loop, so nothing jitters, tunnels or gets stuck. */
type Kind = 'dot' | 'pill' | 'ring' | 'square' | 'mark'
const STICKERS: { kind: Kind; size: number; color: string; x: number; y: number; depth: number }[] = [
  { kind: 'mark', size: 46, color: 'var(--ink)', x: 0.5, y: 0.2, depth: 1 },
  { kind: 'dot', size: 34, color: 'var(--triager)', x: 0.6, y: 0.8, depth: 0.6 },
  { kind: 'pill', size: 30, color: 'var(--coder)', x: 0.68, y: 0.3, depth: 1.3 },
  { kind: 'ring', size: 38, color: 'var(--tester)', x: 0.55, y: 0.6, depth: 0.8 },
  { kind: 'square', size: 30, color: 'var(--reviewer)', x: 0.74, y: 0.7, depth: 1.1 },
  { kind: 'dot', size: 20, color: 'var(--white)', x: 0.64, y: 0.1, depth: 1.6 },
]

function SwarmField() {
  const box = useRef<HTMLDivElement>(null)
  // each sticker's home: the free spot nearest where it would like to be, clear of your name, photo and numbers
  // (and of the others). Worked out on mount and whenever the banner changes size; one with no room hides.
  const [homes, setHomes] = useState<({ x: number; y: number } | null)[]>(() => STICKERS.map(() => null))
  useEffect(() => {
    const layer = box.current, host = layer?.parentElement
    if (!layer || !host) return
    const place = () => {
      const r = host.getBoundingClientRect()
      // what's actually drawn: the text itself, not the full-width lines it sits on
      const box = (el: Element) => {
        if (el.matches('.idc-id h1, .idc-sub')) { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect() }
        if (el.matches('.idc-chips') && el.children.length) {
          const bs = [...el.children].map((c) => c.getBoundingClientRect())
          return { left: Math.min(...bs.map((b) => b.left)), top: Math.min(...bs.map((b) => b.top)), right: Math.max(...bs.map((b) => b.right)), bottom: Math.max(...bs.map((b) => b.bottom)) }
        }
        return el.getBoundingClientRect()
      }
      const walls = [...host.querySelectorAll('.idc-photo, .idc-id h1, .idc-sub, .idc-chips, .idc-stat')].map((el) => {
        const b = box(el); return { l: b.left - r.left, t: b.top - r.top, r: b.right - r.left, b: b.bottom - r.top }
      })
      const taken: { x: number; y: number; rad: number }[] = []
      setHomes(STICKERS.map((st) => {
        const rad = (st.kind === 'pill' ? st.size * 1.5 : st.size) / 2 + 10
        const free = (x: number, y: number) => x > rad && x < r.width - rad && y > rad && y < r.height - rad &&
          !walls.some((w) => Math.hypot(x - Math.max(w.l, Math.min(x, w.r)), y - Math.max(w.t, Math.min(y, w.b))) < rad) &&
          !taken.some((q) => Math.hypot(q.x - x, q.y - y) < q.rad + rad)
        const want = { x: st.x * r.width, y: st.y * r.height }
        let best: { x: number; y: number } | null = null, bestD = Infinity
        for (let x = rad; x < r.width - rad; x += 10) for (let y = rad; y < r.height - rad; y += 10) {
          const d = Math.hypot(x - want.x, y - want.y)
          if (d < bestD && free(x, y)) { bestD = d; best = { x, y } }
        }
        if (best) taken.push({ ...best, rad })
        return best
      }))
    }
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      layer.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3))
      layer.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3))
    }
    const leave = () => { layer.style.setProperty('--px', '0'); layer.style.setProperty('--py', '0') }
    place()
    const settle = window.setTimeout(place, 1000) // after the banner's own entrance
    const ro = new ResizeObserver(place)
    ro.observe(host)
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave)
    return () => { window.clearTimeout(settle); ro.disconnect(); host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave) }
  }, [])
  const hop = (el: HTMLElement | null) => el?.animate(
    [{ transform: 'none' }, { transform: 'translateY(-22px) rotate(200deg) scale(1.15)', offset: 0.45 }, { transform: 'translateY(2px) rotate(350deg) scale(0.95)', offset: 0.8 }, { transform: 'rotate(360deg)' }],
    { duration: 760, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' })
  return (
    <div ref={box} className="idc-stickers" aria-hidden="true">
      {STICKERS.map((st, i) => homes[i] && (
        <motion.span key={i} className={`idc-sticker idc-sticker--${st.kind}`}
          style={{ left: homes[i].x, top: homes[i].y, ['--c' as string]: st.color, ['--s' as string]: `${st.size}px`, ['--d' as string]: st.depth,
            ['--bob' as string]: `${2.6 + (i % 3) * 0.7}s`, ['--delay' as string]: `${-i * 0.6}s`, animationDelay: `${0.35 + i * 0.07}s` }}
          drag dragSnapToOrigin dragElastic={0.5} dragTransition={{ bounceStiffness: 260, bounceDamping: 12 }}
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }} whileDrag={{ scale: 1.18, rotate: i % 2 ? 12 : -12, zIndex: 5 }}
          onTap={(e) => hop((e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.idc-sticker-body') ?? null)}>
          <span className="idc-sticker-lean">
            <span className="idc-sticker-body">{st.kind === 'mark' && <><i /><i /><i /><i /></>}</span>
          </span>
        </motion.span>
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
