import { AnimatePresence, motion, useMotionValueEvent, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { savePrefs, usePrefs } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import { DAY_NAMES, clockWords, lastSlot, nextSlot, openRewind, rewindWhen, type RewindWhen } from '../../lib/rewind'
import { Section } from './ui'
import './rewindpick.css'

/*
 * Settings → Weekly Rewind: when your week pops up by itself. Two big pickers:
 * a ring of days you spin (drag it, tap a day, or use the arrow keys) that snaps the day under the notch,
 * and a sky dial where you drag the sun round the clock. The sky, the light and the four agents on the hill
 * follow the time you pick: they doze at night and wave in the day. A ticket underneath counts down to the next one.
 */

const STEP = 360 / 7
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function RewindSettings() {
  const { user } = useAuth()
  const prefs = usePrefs(user?.uid)
  const toast = useToast()
  const saved = rewindWhen(prefs)
  const [draft, setDraft] = useState<RewindWhen | null>(null)
  const w = draft ?? saved
  const clock24 = prefs?.clock === '24h'

  const save = (next: RewindWhen) => {
    setDraft(next)
    if (!user) return
    // a new time that has already passed this week shouldn't pop up at once: the next one is the first
    const due = lastSlot(next).toISOString()
    const seen = prefs?.rewindSeen && prefs.rewindSeen > due ? prefs.rewindSeen : due
    savePrefs(user.uid, { rewind: next, rewindSeen: seen }).then(() => setDraft(null), (e) => toast.error('Couldn’t save that', (e as Error).message))
  }

  return (
    <Section title="Weekly Rewind" action={
      <label className="toggle" title="Your week as a short film, once a week">
        <input type="checkbox" checked={w.on} onChange={(e) => save({ ...w, on: e.target.checked })} />
        <span className="toggle-track"><span className="toggle-thumb" /></span>
        <span>{w.on ? 'On' : 'Off'}</span>
      </label>
    }>
      <p className="muted-p rp-lede">Once a week your swarm’s week plays as a short film the next time you open Swarm: what came in, who did the most, what got fixed and what’s waiting for you. Pick when.</p>
      <motion.div className={`rp ${w.on ? '' : 'is-off'}`} animate={{ opacity: w.on ? 1 : 0.45, filter: w.on ? 'saturate(1)' : 'saturate(0.2)' }} transition={{ duration: 0.4 }}>
        <DayRing day={w.day} onPick={(day) => save({ ...w, day })} />
        <SkyDial minutes={w.minutes} clock24={clock24} onPick={(minutes, done) => (done ? save({ ...w, minutes }) : setDraft({ ...w, minutes }))} />
      </motion.div>
      <Ticket w={w} clock24={clock24} />
    </Section>
  )
}

/* ------------------------------------------------------------------ the ring of days */

function DayRing({ day, onPick }: { day: number; onPick: (d: number) => void }) {
  const turns = useRef(-day * STEP) // where the ring is headed, unwrapped so Sunday → Monday takes the short way
  const rot = useSpring(-day * STEP, { stiffness: 110, damping: 13, mass: 0.9 })
  const ring = useRef<HTMLDivElement>(null)
  const drag = useRef<{ a: number; r: number; moved: boolean } | null>(null)
  const [burst, setBurst] = useState(0)

  // follow the saved day (another tab, or the first load) the short way round
  useEffect(() => {
    const cur = ((Math.round(-turns.current / STEP) % 7) + 7) % 7
    if (cur === day) return
    const delta = ((day - cur + 7 + 3) % 7) - 3
    turns.current -= delta * STEP
    rot.set(turns.current)
    setBurst((b) => b + 1)
  }, [day, rot])

  const angle = (e: { clientX: number; clientY: number }) => {
    const r = ring.current!.getBoundingClientRect()
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI
  }
  const down = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { a: angle(e), r: rot.get(), moved: false }
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    let delta = angle(e) - d.a
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    if (Math.abs(delta) > 2) d.moved = true
    d.r += delta; d.a = angle(e)
    rot.jump(d.r)
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const snapped = Math.round(d.r / STEP) * STEP
    turns.current = snapped
    rot.set(snapped)
    const picked = ((Math.round(-snapped / STEP) % 7) + 7) % 7
    if (picked !== day) { onPick(picked); setBurst((b) => b + 1) }
  }
  const key = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onPick((day + 1) % 7) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onPick((day + 6) % 7) }
  }

  return (
    <div className="rp-panel">
      <span className="rp-k">Day</span>
      <div ref={ring} className="rp-ring" role="slider" tabIndex={0} aria-label="Day of the week" aria-valuemin={0} aria-valuemax={6} aria-valuenow={day} aria-valuetext={DAY_NAMES[day]}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <svg className="rp-ring-bg" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="92" fill="none" stroke="var(--ink)" strokeWidth="2" strokeDasharray="2 5" opacity="0.35" />
          <circle cx="100" cy="100" r="58" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5" />
        </svg>
        <motion.div className="rp-notch" key={`n${burst}`} initial={{ y: -8, scaleY: 1.4 }} animate={{ y: 0, scaleY: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 12 }} aria-hidden="true" />
        <motion.div className="rp-ring-spin" style={{ rotate: rot }}>
          {SHORT.map((d, i) => <DayChip key={d} i={i} label={d} on={i === day} rot={rot} onPick={() => onPick(i)} />)}
        </motion.div>
        <div className="rp-ring-mid" aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.b key={day} className="rp-dayname">
              {DAY_NAMES[day].split('').map((c, k) => (
                <motion.span key={k} initial={{ rotateX: -90, y: 14, opacity: 0 }} animate={{ rotateX: 0, y: 0, opacity: 1 }} exit={{ rotateX: 90, y: -14, opacity: 0, transition: { duration: 0.18, delay: k * 0.015 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 22, delay: k * 0.035 }}>{c}</motion.span>
              ))}
            </motion.b>
          </AnimatePresence>
          <span>every week</span>
        </div>
        <Burst key={burst} n={burst} />
      </div>
      <span className="rp-help">Spin it, or tap a day</span>
    </div>
  )
}

function DayChip({ i, label, on, rot, onPick }: { i: number; label: string; on: boolean; rot: MotionValue<number>; onPick: () => void }) {
  const upright = useTransform(rot, (r) => -(r + i * STEP))
  return (
    <div className="rp-chip-arm" style={{ rotate: `${i * STEP}deg` }}>
      <motion.button type="button" className={`rp-chip ${on ? 'on' : ''}`} style={{ rotate: upright }} onClick={onPick} tabIndex={-1}
        animate={{ scale: on ? 1.28 : 1 }} whileHover={{ scale: on ? 1.32 : 1.12 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 400, damping: 16 }}>
        {label}
      </motion.button>
    </div>
  )
}

/** A little firework from the notch when a day lands. */
function Burst({ n }: { n: number }) {
  if (!n) return null
  const colors = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)']
  return (
    <div className="rp-burst" aria-hidden="true">
      {Array.from({ length: 10 }, (_, k) => {
        const a = (k / 10) * Math.PI * 2
        return <motion.i key={k} style={{ background: colors[k % 4] }} initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={{ x: Math.cos(a) * 46, y: Math.sin(a) * 46, scale: 0, opacity: 0 }} transition={{ duration: 0.7, ease: easeOut }} />
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ the sky dial */

const SKY: [number, string, string][] = [ // hour, top colour, bottom colour
  [0, '#141a3c', '#2a2c63'], [5, '#1d2150', '#4b3f7e'], [6.3, '#ff9fa0', '#ffd39a'], [8, '#8fcbff', '#d9efff'], [12, '#6fc2ff', '#c9ebff'],
  [16.5, '#8cc9ff', '#ffe3b0'], [18.4, '#ff9a6b', '#ffcf7d'], [19.6, '#6c4b9e', '#d77b8f'], [21, '#1d2150', '#3a3372'], [24, '#141a3c', '#2a2c63'],
]
function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
}
function skyAt(minutes: number) {
  const h = minutes / 60
  const k = SKY.findIndex(([at]) => at > h)
  const [h0, t0, b0] = SKY[k - 1], [h1, t1, b1] = SKY[k]
  const t = (h - h0) / (h1 - h0)
  return { top: mix(t0, t1, t), bottom: mix(b0, b1, t) }
}
const C = 150, R = 104

function SkyDial({ minutes, clock24, onPick }: { minutes: number; clock24: boolean; onPick: (m: number, done: boolean) => void }) {
  const box = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const m = useSpring(minutes, { stiffness: 140, damping: 20 })
  const [shown, setShown] = useState(minutes)
  useEffect(() => { if (!dragging.current) m.set(minutes) }, [minutes, m])
  useMotionValueEvent(m, 'change', (v) => setShown(((v % 1440) + 1440) % 1440))

  const ang = (shown / 1440) * 360 + 90 // midnight at the bottom, noon at the top, the sun rising on the left
  const rad = (ang * Math.PI) / 180
  const sx = C + Math.cos(rad) * R, sy = C + Math.sin(rad) * R
  const height = (C - sy) / R // 1 at noon, -1 at midnight
  const day = height > -0.08
  const sky = skyAt(shown)
  const night = Math.max(0, Math.min(1, (-height + 0.1) * 2.2))

  const fromPointer = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * 300 - C, y = ((e.clientY - r.top) / r.height) * 300 - C
    let a = (Math.atan2(y, x) * 180) / Math.PI - 90
    a = ((a % 360) + 360) % 360
    return Math.round(((a / 360) * 1440) / 15) * 15 % 1440
  }
  const down = (e: ReactPointerEvent<SVGSVGElement>) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; const v = fromPointer(e); m.set(unwrap(m.get(), v)); onPick(v, false) }
  const move = (e: ReactPointerEvent<SVGSVGElement>) => { if (!dragging.current) return; const v = fromPointer(e); m.set(unwrap(m.get(), v)); onPick(v, false) }
  const up = (e: ReactPointerEvent<SVGSVGElement>) => { if (!dragging.current) return; dragging.current = false; onPick(fromPointer(e), true) }
  const nudge = (d: number) => { const v = (minutes + d + 1440) % 1440; m.set(unwrap(m.get(), v)); onPick(v, true) }
  const key = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(15) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(-15) }
  }
  const cw = clockWords(minutes)
  const hh = clock24 ? String(Math.floor(minutes / 60)).padStart(2, '0') : String(cw.h12).padStart(2, ' ')

  return (
    <div className="rp-panel">
      <span className="rp-k">Time</span>
      <svg ref={box} className="rp-sky" viewBox="0 0 300 300" role="slider" tabIndex={0} aria-label="Time of day" aria-valuemin={0} aria-valuemax={1439} aria-valuenow={minutes} aria-valuetext={cw.text}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <defs>
          <linearGradient id="rp-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky.top} /><stop offset="1" stopColor={sky.bottom} /></linearGradient>
          <clipPath id="rp-clip"><circle cx={C} cy={C} r="140" /></clipPath>
        </defs>
        <circle cx={C + 4} cy={C + 5} r="140" fill="var(--ink)" />
        <g clipPath="url(#rp-clip)">
          <rect width="300" height="300" fill="url(#rp-sky)" />
          {STARS.map(([x, y, s], k) => <circle key={k} cx={x} cy={y} r={s} fill="#fff" opacity={night * (0.5 + (k % 3) * 0.2)} className="rp-star" style={{ animationDelay: `${k * 0.37}s` }} />)}
          <circle cx={C} cy={C} r={R} fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 6" />
          {Array.from({ length: 24 }, (_, h) => {
            const a = ((h / 24) * 360 + 90) * Math.PI / 180
            return <line key={h} x1={C + Math.cos(a) * 124} y1={C + Math.sin(a) * 124} x2={C + Math.cos(a) * (h % 6 ? 130 : 136)} y2={C + Math.sin(a) * (h % 6 ? 130 : 136)} stroke="#fff" strokeOpacity={h % 6 ? 0.4 : 0.85} strokeWidth={h % 6 ? 1.5 : 2.5} strokeLinecap="round" />
          })}
          {/* the sun or the moon */}
          <g transform={`translate(${sx} ${sy})`}>
            {day ? <>
              <g className="rp-rays">{Array.from({ length: 8 }, (_, k) => <rect key={k} x="-2.5" y="-27" width="5" height="9" rx="2.5" fill="#ffd85a" stroke="#0f0f0f" strokeWidth="1.5" transform={`rotate(${k * 45})`} />)}</g>
              <circle r="15" fill="#ffd85a" stroke="#0f0f0f" strokeWidth="2.5" />
              <circle cx="-5" cy="-2" r="1.8" fill="#0f0f0f" /><circle cx="5" cy="-2" r="1.8" fill="#0f0f0f" />
              <path d="M-5 4q5 4 10 0" fill="none" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" />
            </> : <>
              <circle r="14" fill="#f4f1e6" stroke="#0f0f0f" strokeWidth="2.5" />
              <circle cx="6" cy="-4" r="11" fill={sky.top} />
              <path d="M-7 1q2 2 4 0" fill="none" stroke="#0f0f0f" strokeWidth="1.8" strokeLinecap="round" />
            </>}
          </g>
          {/* the hill, and the crew on it */}
          <path d="M0 212 C 60 186, 110 196, 150 190 S 250 180, 300 206 V300 H0z" fill={mix('#7fd08a', '#2d4a3a', night)} stroke="#0f0f0f" strokeWidth="2.5" />
          {(['triager', 'coder', 'tester', 'reviewer'] as const).map((a, k) => <HillBot key={a} a={a} x={96 + k * 36} y={190 - (k % 2) * 4} asleep={!day} k={k} />)}
        </g>
        <circle cx={C} cy={C} r="140" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
      </svg>
      <div className="rp-time">
        <button type="button" className="rp-nudge" onClick={() => nudge(-15)} aria-label="15 minutes earlier">−</button>
        <div className="rp-digits" aria-hidden="true">
          {hh.split('').map((c, k) => <Roll key={`h${k}`} c={c} />)}
          <span className="rp-colon">:</span>
          {cw.m.split('').map((c, k) => <Roll key={`m${k}`} c={c} />)}
          {!clock24 && <AnimatePresence mode="popLayout" initial={false}><motion.span key={cw.ampm} className="rp-ampm" initial={{ y: 20, opacity: 0, rotate: -20 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -20, opacity: 0 }}>{cw.ampm}</motion.span></AnimatePresence>}
        </div>
        <button type="button" className="rp-nudge" onClick={() => nudge(15)} aria-label="15 minutes later">+</button>
      </div>
      <span className="rp-help">Drag the {day ? 'sun' : 'moon'} round the sky</span>
    </div>
  )
}

/** The value closest to `from` that means the same time of day, so the sun never spins the long way round. */
function unwrap(from: number, v: number) {
  const base = Math.round((from - v) / 1440) * 1440
  return v + base
}

const STARS: [number, number, number][] = [[62, 70, 1.6], [98, 44, 1.2], [140, 30, 1.8], [196, 48, 1.3], [232, 78, 1.7], [78, 118, 1.1], [220, 120, 1.4], [120, 96, 1], [178, 88, 1.5], [252, 150, 1.2], [46, 150, 1.3], [160, 60, 1]]

function HillBot({ a, x, y, asleep, k }: { a: string; x: number; y: number; asleep: boolean; k: number }) {
  return (
    <motion.g initial={false} animate={{ y: asleep ? 3 : [0, -5, 0] }} transition={asleep ? { duration: 0.5 } : { repeat: Infinity, duration: 0.9 + k * 0.1, delay: k * 0.15 }}>
      <g transform={`translate(${x} ${y})`}>
        <circle cx="1.5" cy="2" r="11" fill="#0f0f0f" />
        <circle r="11" fill={`var(--${a})`} stroke="#0f0f0f" strokeWidth="2" />
        {asleep
          ? <><path d="M-6 -1h4M2 -1h4" stroke="#0f0f0f" strokeWidth="1.8" strokeLinecap="round" /><text className="rp-z" x="8" y="-12" fontSize="9" fontWeight="800" fill="#fff" style={{ animationDelay: `${k * 0.4}s` }}>z</text></>
          : <><circle cx="-4" cy="-2" r="1.8" fill="#0f0f0f" /><circle cx="4" cy="-2" r="1.8" fill="#0f0f0f" /><path d="M-3 3q3 3 6 0" fill="none" stroke="#0f0f0f" strokeWidth="1.6" strokeLinecap="round" /></>}
      </g>
    </motion.g>
  )
}

/** One digit on a drum: the numbers 0 to 9 stacked, rolled to the right one. */
function Roll({ c }: { c: string }) {
  if (!/\d/.test(c)) return <span className="rp-roll rp-roll--blank" />
  const n = Number(c)
  return (
    <span className="rp-roll">
      <motion.span className="rp-roll-strip" animate={{ y: `${-n * 10}%` }} transition={{ type: 'spring', stiffness: 170, damping: 19 }}>
        {Array.from({ length: 10 }, (_, k) => <span key={k}>{k}</span>)}
      </motion.span>
    </span>
  )
}

/* ------------------------------------------------------------------ the next one */

function Ticket({ w, clock24 }: { w: RewindWhen; clock24: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 20_000); return () => window.clearInterval(id) }, [])
  const next = nextSlot(w, new Date(now))
  const left = next.getTime() - now
  const d = Math.floor(left / 86_400_000), h = Math.floor((left % 86_400_000) / 3_600_000), mi = Math.floor((left % 3_600_000) / 60_000)
  const date = next.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const time = clock24 ? `${String(Math.floor(w.minutes / 60)).padStart(2, '0')}:${String(w.minutes % 60).padStart(2, '0')}` : clockWords(w.minutes).text
  return (
    <motion.div className={`rp-ticket ${w.on ? '' : 'is-off'}`} layout transition={{ duration: 0.4, ease: easeOut }}>
      <div className="rp-ticket-main">
        <span className="rp-k">{w.on ? 'Next Rewind' : 'Rewind is off'}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.b key={date + time} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>{date} · {time}</motion.b>
        </AnimatePresence>
        {w.on && <span className="rp-count">in {[d && `${d} day${d === 1 ? '' : 's'}`, h && `${h} hour${h === 1 ? '' : 's'}`, `${mi} min`].filter(Boolean).join(', ')}</span>}
      </div>
      <div className="rp-ticket-cut" aria-hidden="true" />
      <button type="button" className="btn btn-dark btn-sm rp-play" onClick={() => openRewind()}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor" /></svg>
        Play this week’s now
      </button>
    </motion.div>
  )
}
