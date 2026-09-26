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
