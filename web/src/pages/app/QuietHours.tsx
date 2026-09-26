import { AnimatePresence, animate, motion, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Select } from '../../components/Select'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { setSchedule, useProfile, useRepos } from '../../lib/data'
import { weekHour } from '../../lib/houserules'
import type { Schedule } from '../../lib/types'
import { PageHead } from './Overview'
import { RepoSelect, SaveChip, rise, useDraft, useRepoChoice } from './repoDraft'
import { EmptyState } from './ui'

/* Quiet hours: when the swarm may go looking for new issues and start work on its own. Pick a mode or
   paint the week, and the worker skips its automatic checks outside those hours (swarm/houserules.py).
   Runs you start yourself, and your approvals and merges, always go ahead.

   Changing mode is meant to be felt: the big card floods with the new mode's colour, its title rolls over,
   the dial sweeps round and the week ripples across. Painting by hand stays instant, one cell at a time. */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ALL = '1'.repeat(168)
const build = (on: (d: number, h: number) => boolean) => Array.from({ length: 168 }, (_, i) => (on(Math.floor(i / 24), i % 24) ? '1' : '0')).join('')
type ModeId = 'any' | 'nights' | 'work' | 'dawn' | 'custom'
const MODES: { id: ModeId; label: string; says: string; hours: string | null }[] = [
  { id: 'any', label: 'Any time', says: 'No quiet hours. The swarm starts work whenever the worker comes round.', hours: null },
  { id: 'nights', label: 'Nights & weekends', says: 'Weeknights from 7 pm to 7 am, and all weekend. Out of your way while you work.', hours: build((d, h) => d >= 5 || h >= 19 || h < 7) },
  { id: 'work', label: 'Working hours', says: 'Weekdays 9 to 6, while someone’s around to review what it makes.', hours: build((d, h) => d < 5 && h >= 9 && h < 18) },
  { id: 'dawn', label: 'Before dawn', says: 'Every day from 2 to 6 am. One quiet batch, ready with your coffee.', hours: build((_d, h) => h >= 2 && h < 6) },
  { id: 'custom', label: 'Your own', says: 'Painted by hand. Drag across the week to change it.', hours: null },
]
const zones = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone') } catch { return [] as string[] } })()
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const zoneOptions = (tz: string) => (zones.includes(tz) ? zones : [tz, ...zones]).map((z) => ({ value: z, label: z.replace(/_/g, ' '), hint: z === localTz ? 'yours' : undefined }))
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')
const EASE = [0.22, 1, 0.36, 1] as const

type Clock = '24h' | '12h'
const hourName = (h: number, clock: Clock) => (clock === '12h' ? `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}` : `${String(h).padStart(2, '0')}:00`)
const hourTick = (h: number, clock: Clock) => (clock === '12h' ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : String(h))

export default function QuietHours() {
  const { user } = useAuth()
  const toast = useToast()
  const prefs = useProfile(user?.uid)?.prefs
  const clock: Clock = prefs?.clock ?? '24h'
  const order = prefs?.weekStart === 'sun' ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const [repoId, setRepoId] = useRepoChoice(repos, 'swarm.quiet.repo')
  const repo = repos.find((r) => r.id === repoId)
  const mine = !!repo && repo.ownerUid === user?.uid
  const [sched, setSched, saveState] = useDraft<Schedule | null>(repoId, repo?.settings?.schedule ?? null, (v) => setSchedule(repoId, v))
  const tz = sched?.tz || localTz
  const hours = sched?.hours || ALL
  const mode: ModeId = !sched ? 'any' : MODES.find((m) => m.hours === sched.hours)?.id ?? 'custom'
  const info = MODES.find((m) => m.id === mode)!
  // whether the last change was a whole mode (animate it big) or a stroke of the brush (keep it instant)
  const source = useRef<'mode' | 'paint'>('mode')
  const [nudge, setNudge] = useState(0)

  // remember a hand-painted week, so trying a preset and coming back doesn't lose it
  const customKey = `swarm.quiet.custom.${repoId}`
  useEffect(() => { if (mode === 'custom') try { localStorage.setItem(customKey, hours) } catch { /* private window */ } }, [mode, hours, customKey])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 20_000); return () => window.clearInterval(t) }, [])
  const at = weekHour(tz, now)
  const today = Math.floor(at.index / 24)
  const [day, setDay] = useState<number | null>(null)
  const shownDay = day ?? today

  const write = (next: string) => { source.current = 'paint'; setSched(next === ALL ? null : { tz, hours: next }) }
  const pickMode = (id: ModeId) => {
    if (!mine || id === mode) return
    source.current = 'mode'
    if (id === 'custom') {
      let saved: string | null = null
      try { saved = localStorage.getItem(customKey) } catch { /* private window */ }
      if (saved && saved.length === 168 && !MODES.some((m) => m.hours === saved) && saved !== ALL) return setSched({ tz, hours: saved })
      setNudge((n) => n + 1)
      return toast.info('Paint your own', 'Drag across the week below. Green hours are when it may start.')
    }
    const m = MODES.find((x) => x.id === id)!
    setSched(m.hours ? { tz, hours: m.hours } : null)
  }
  const pickRepo = (id: string) => { source.current = 'mode'; setDay(null); setRepoId(id) }
  const applyAll = async () => {
    const others = repos.filter((r) => r.id !== repoId && r.ownerUid === user?.uid)
    try { await Promise.all(others.map((r) => setSchedule(r.id, sched))); toast.ok('Copied', `Same hours on ${others.length} more repositor${others.length === 1 ? 'y' : 'ies'}.`) }
    catch (e) { toast.error('Couldn’t copy', (e as Error).message) }
  }

  if (!loading && repos.length === 0) {
    return <div className="page"><PageHead title="Quiet hours" /><EmptyState title="No repository yet" text="Connect one and you can choose when the swarm works on it."><Link to="/app" className="btn btn-dark">Connect a repository</Link></EmptyState></div>
  }

  const open = hours.split('').filter((c) => c === '1').length
  const wave = source.current === 'mode'
  const next = nextChange(hours, at)
  return (
    <div className="page fit qh-page">
      <PageHead title="Quiet hours" sub="When the swarm may pick up new issues on its own. Anything you start yourself always goes ahead.">
        <div className="toolbar-side"><RepoSelect repos={repos} value={repoId} onChange={pickRepo} /><SaveChip state={saveState} readOnly={!mine} /></div>
      </PageHead>

      <motion.div className="qh-modes" role="radiogroup" aria-label="Mode" {...rise(0)}>
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={`qh-mode ${mode === m.id ? 'on' : ''}`} disabled={!mine && mode !== m.id} onClick={() => pickMode(m.id)}>
            {mode === m.id && <motion.span layoutId="qh-mode-pill" className="qh-mode-pill" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}
            <ModeIcon id={m.id} />
            <span>{m.label}</span>
          </button>
        ))}
      </motion.div>

      <div className="qh-stage">
        <motion.section className={`qh-hero m-${mode}`} {...rise(1)}>
          <Washes mode={mode} />
          <Orb mode={mode} />
          <div className="qh-hero-in">
            <Now scheduled={!!sched} open={hours[at.index] === '1'} next={next} />
            <div className="qh-title" aria-live="polite">
              {/* old and new share one grid cell: the old one leaves upward first, then the new one rises in */}
              <div className="qh-stack">
                <AnimatePresence initial={false}>
                  <motion.h2 key={mode} variants={roll} initial="below" animate="in" exit="above">
                    {info.label.split(' ').map((w, i) => <span key={i} className="qh-word"><motion.span variants={word} custom={i}>{w}</motion.span></span>)}
                  </motion.h2>
                </AnimatePresence>
              </div>
              <div className="qh-stack">
                <AnimatePresence initial={false}>
                  <motion.p key={mode} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE, delay: 0.3 } }} exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}>{info.says}</motion.p>
                </AnimatePresence>
              </div>
            </div>
            <Dial hours={hours} day={shownDay} today={today} hour={at.index % 24} minute={at.minute} wave={wave} clock={clock} />
            <div className="qh-days" role="tablist" aria-label="Day on the dial">
              {order.map((i) => (
                <button key={i} role="tab" aria-selected={shownDay === i} className={shownDay === i ? 'on' : ''} onClick={() => setDay(i === today ? null : i)}>
                  {DAYS[i].slice(0, 2)}{i === today && <i />}
                </button>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section className="qh-week" {...rise(2)}>
          <header>
            <div><h2>Paint your week</h2><p>Drag across the grid. Green hours are when it may start on its own. Click a day or an hour to flip the whole row.</p></div>
            <Select value={tz} disabled={!mine} label="Time zone" searchable align="right" className="qh-tz" onChange={(z) => { source.current = 'mode'; setSched({ tz: z, hours }) }}
              options={zoneOptions(tz)} />
          </header>
          <Painter hours={hours} now={at.index} order={order} clock={clock} wave={wave} nudge={nudge} disabled={!mine} onChange={write}
            onDay={(d) => setDay(d === today ? null : d)} />
          <footer className="qh-stats">
            <div><b><Count value={open} /><small>/168</small></b><span>hours open</span></div>
            <div><b><Count value={longestQuiet(hours)} /><small>h</small></b><span>longest quiet stretch</span></div>
            <div><b>{next ? next.label : '—'}</b><span>{!sched ? 'no quiet hours set' : next ? (hours[at.index] === '1' ? 'until it goes quiet' : 'until it opens') : 'never changes'}</span></div>
            {mine && repos.filter((r) => r.ownerUid === user?.uid).length > 1 && <button className="btn btn-line btn-sm" onClick={applyAll}>Use on all my repositories</button>}
          </footer>
        </motion.section>
      </div>
    </div>
  )
}

const roll: Variants = { below: {}, in: { transition: { staggerChildren: 0.05, delayChildren: 0.22 } }, above: { transition: { staggerChildren: 0.02 } } }
const word: Variants = {
  below: { y: '110%' },
  in: { y: '0%', transition: { duration: 0.6, ease: EASE } },
  above: { y: '-110%', transition: { duration: 0.24, ease: [0.55, 0, 0.9, 0.4] } },
}

function longestQuiet(hours: string) {
  if (!hours.includes('1')) return 168
  const twice = hours + hours
  let best = 0, run = 0
  for (const c of twice) { run = c === '0' ? run + 1 : 0; best = Math.max(best, run) }
  return Math.min(best, 168)
}

/** How long until the week flips between open and quiet, from now. null when it never does. */
function nextChange(hours: string, at: { index: number; minute: number }) {
  const openNow = hours[at.index] === '1'
  let steps = 1
  while (steps < 168 && (hours[(at.index + steps) % 168] === '1') === openNow) steps++
  if (steps >= 168) return null
  const mins = steps * 60 - at.minute
  return { mins, label: mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${Math.round(mins / 1440)}d` }
}

/** Every mode change floods the card with the new colour from the top, over the old one. */
function Washes({ mode }: { mode: ModeId }) {
  const [layers, setLayers] = useState([{ id: 0, mode, still: true }])
  const last = useRef(mode)
  useEffect(() => {
    if (last.current === mode) return
    last.current = mode
    setLayers((l) => [...l, { id: l[l.length - 1].id + 1, mode, still: calm() }])
  }, [mode])
  return (
    <div className="qh-washes" aria-hidden="true">
      {layers.map((l, k) => (
        <motion.span key={l.id} className={`qh-wash m-${l.mode}`}
          initial={l.still ? false : { clipPath: 'circle(0% at 50% -10%)' }} animate={{ clipPath: 'circle(160% at 50% -10%)' }}
          transition={{ duration: 1.05, ease: [0.76, 0, 0.24, 1] }}
          onAnimationComplete={() => { if (k === layers.length - 1) setLayers((all) => all.slice(-1)) }} />
      ))}
    </div>
  )
}

/** The big shape in the corner: a sun for daytime modes, a moon at night. It sinks out and the next one rises. */
function Orb({ mode }: { mode: ModeId }) {
  return (
    <div className="qh-orb-box" aria-hidden="true">
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={mode} className={`qh-orb m-${mode}`} initial={{ scale: 0.3, opacity: 0, rotate: -40 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.2, ease: [0.55, 0, 0.9, 0.4] } }} transition={{ type: 'spring', stiffness: 200, damping: 18 }}>
          {mode === 'nights' && Array.from({ length: 9 }, (_, k) => <i key={k} style={{ ['--k' as string]: k }} />)}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

function Now({ scheduled, open, next }: { scheduled: boolean; open: boolean; next: { label: string } | null }) {
  const text = !scheduled ? 'Always open' : open ? (next ? `Open now · quiet in ${next.label}` : 'Open all week') : next ? `Quiet now · opens in ${next.label}` : 'Quiet all week'
  return (
    <div className={`qh-now ${!scheduled || open ? 'open' : 'quiet'}`}>
      <span className="qh-pulse" aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={text} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0, transition: { duration: 0.14 } }} transition={{ duration: 0.3, ease: EASE }}>{text}</motion.span>
      </AnimatePresence>
    </div>
  )
}

function Count({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)
  useEffect(() => {
    const from = prev.current
    prev.current = value
    if (from === value || !ref.current || calm()) return
    const run = animate(from, value, { duration: 0.8, ease: EASE, onUpdate: (v) => { if (ref.current) ref.current.textContent = String(Math.round(v)) } })
    return () => run.stop()
  }, [value])
  return <span ref={ref}>{value}</span>
}

/** Pops the cells whose state just changed: a wave spreading out for a new mode, a single quick pop for a brush stroke. */
function usePops(root: React.RefObject<HTMLElement | SVGSVGElement | null>, state: string, delay: (i: number) => number, frames: Keyframe[], duration: number) {
  const prev = useRef(state)
  useLayoutEffect(() => {
    const before = prev.current
    prev.current = state
    if (before === state || !root.current || calm()) return
    const cells = root.current.querySelectorAll<HTMLElement>('[data-i]')
    cells.forEach((el) => {
      const i = Number(el.dataset.i)
      if (before[i] === state[i]) return
      el.getAnimations().forEach((a) => { if (a instanceof CSSAnimation || a instanceof CSSTransition) return; a.cancel() })
      el.animate(frames, { duration, delay: delay(i), easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' })
    })
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** One day as a 24-hour ring. On today's dial a marker rides the ring to the current time. */
function Dial({ hours, day, today, hour, minute, wave, clock }: { hours: string; day: number; today: number; hour: number; minute: number; wave: boolean; clock: Clock }) {
  const R = 112, r = 78, C = 130
  const seg = (h: number) => {
    const a0 = ((h / 24) * 360 - 90 + 1) * (Math.PI / 180), a1 = (((h + 1) / 24) * 360 - 90 - 1) * (Math.PI / 180)
    const p = (rad: number, a: number) => `${(C + rad * Math.cos(a)).toFixed(2)} ${(C + rad * Math.sin(a)).toFixed(2)}`
    return `M${p(R, a0)} A${R} ${R} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 0 0 ${p(r, a0)}Z`
  }
  const row = hours.slice(day * 24, day * 24 + 24)
  const open = row.split('').filter((c) => c === '1').length
  const angle = ((hour + minute / 60) / 24) * 360
  const svg = useRef<SVGSVGElement>(null)
  const sweep = wave
  usePops(svg, row + day, (i) => (sweep ? i * 18 : 0), [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: 0.5 }, { transform: 'scale(1)' }], 500)
  return (
    <div className="qh-dial-wrap"><div className="qh-dial">
      <svg ref={svg} viewBox="0 0 260 260" aria-label={`${DAYS[day]}: ${open} hours open`}>
        <circle cx={C} cy={C} r={R + 10} className="qh-dial-rim" />
        {Array.from({ length: 24 }, (_, h) => (
          <path key={h} data-i={h} d={seg(h)} className={`qh-seg ${row[h] === '1' ? 'on' : ''}`} style={{ transitionDelay: sweep ? `${h * 18}ms` : '0ms' }} />
        ))}
        {[0, 6, 12, 18].map((h) => {
          const a = ((h / 24) * 360 - 90) * (Math.PI / 180)
          return <text key={h} x={C + 64 * Math.cos(a)} y={C + 64 * Math.sin(a) + 3.5} textAnchor="middle" className="qh-dial-num">{hourTick(h, clock)}</text>
        })}
      </svg>
      <AnimatePresence>
        {day === today && (
          <motion.span key="now" className="qh-marker" initial={{ rotate: angle - 40, opacity: 0 }} animate={{ rotate: angle, opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ rotate: { duration: 1.1, ease: EASE }, opacity: { duration: 0.3 } }}>
            <i />
          </motion.span>
        )}
      </AnimatePresence>
      <div className="qh-dial-mid">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={day} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }} transition={{ duration: 0.35, ease: EASE }}>
            <b>{day === today ? 'Today' : DAYS[day]}</b>
            <span>{open === 24 ? 'open all day' : open === 0 ? 'quiet all day' : <><Count value={open} />h open</>}</span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div></div>
  )
}

function ModeIcon({ id }: { id: ModeId }) {
  const d: Record<ModeId, string> = {
    any: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 16a4 4 0 100-8 4 4 0 000 8z',
    nights: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    work: 'M4 8h16v11H4z M9 8V5h6v3 M4 13h16',
    dawn: 'M3 18h18 M7 18a5 5 0 0110 0 M12 7v3 M5.6 10.6l1.5 1.5 M18.4 10.6l-1.5 1.5 M9 21h6',
    custom: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3',
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d[id]} /></svg>
}

/** The week grid. Press on a cell to start painting (it paints the opposite of that cell), drag to continue. */
function Painter({ hours, now, order, clock, wave, nudge, disabled, onChange, onDay }: {
  hours: string; now: number; order: number[]; clock: Clock; wave: boolean; nudge: number; disabled: boolean; onChange: (h: string) => void; onDay: (d: number) => void
}) {
  const paint = useRef<'1' | '0' | null>(null)
  const [drag, setDrag] = useState(false)
  const work = useRef(hours)
  const [hover, setHover] = useState<number | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => { if (paint.current === null) work.current = hours }, [hours])
  useEffect(() => {
    const up = () => { paint.current = null; setDrag(false) }
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [])
  // a new mode ripples out diagonally from the top-left; a brush stroke just pops the cell under it
  const row = (i: number) => order.indexOf(Math.floor(i / 24))
  const lag = (i: number) => (wave ? (i % 24) * 12 + row(i) * 30 : 0)
  usePops(grid, hours, lag, [{ transform: 'scale(1)' }, { transform: wave ? 'scale(0.86)' : 'scale(0.8)', offset: 0.4 }, { transform: 'scale(1)' }], wave ? 460 : 260)
  // "Your own" with nothing painted yet: the grid gives a little shake to say "start here"
  useEffect(() => { if (nudge && grid.current && !calm()) grid.current.animate([{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' }) }, [nudge])

  const set = (i: number) => {
    if (paint.current === null || work.current[i] === paint.current) return
    work.current = work.current.slice(0, i) + paint.current + work.current.slice(i + 1)
    onChange(work.current)
  }
  const cellAt = (e: ReactPointerEvent) => {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-i]') as HTMLElement | null
    return el && grid.current?.contains(el) ? Number(el.dataset.i) : null
  }
  const down = (e: ReactPointerEvent) => {
    if (disabled) return
    const i = cellAt(e); if (i === null) return
    e.preventDefault()
    work.current = hours
    paint.current = hours[i] === '1' ? '0' : '1'
    setDrag(true)
    set(i)
  }
  const move = (e: ReactPointerEvent) => { const i = cellAt(e); setHover(i); if (i !== null) set(i) }
  const flipRow = (d: number) => {
    onDay(d)
    if (disabled) return
    const r = hours.slice(d * 24, d * 24 + 24), to = r.includes('0') ? '1' : '0'
    onChange(hours.slice(0, d * 24) + to.repeat(24) + hours.slice(d * 24 + 24))
  }
  const flipCol = (h: number) => {
    if (disabled) return
    const col = DAYS.map((_, d) => hours[d * 24 + h]), to = col.includes('0') ? '1' : '0'
    onChange(hours.split('').map((c, i) => (i % 24 === h ? to : c)).join(''))
  }
  const hd = hover === null ? null : { d: Math.floor(hover / 24), h: hover % 24 }
  return (
    <div className={`qh-paint ${disabled ? 'off' : ''}`}>
      <div className="qh-hours" aria-hidden="true">
        <span />
        {Array.from({ length: 24 }, (_, h) => <button key={h} tabIndex={-1} className={hd?.h === h ? 'hot' : ''} onClick={() => flipCol(h)}>{h % 3 === 0 ? hourTick(h, clock) : ''}</button>)}
      </div>
      <div ref={grid} className={`qh-rows ${drag ? 'painting' : ''}`} onPointerDown={down} onPointerMove={move} onPointerLeave={() => setHover(null)} role="grid" aria-label="Hours of the week">
        {order.map((di, r) => (
          <div key={di} className="qh-row" role="row">
            <button className={`qh-day ${hd?.d === di ? 'hot' : ''}`} onClick={() => flipRow(di)} onPointerDown={(e) => e.stopPropagation()}>{DAYS[di]}</button>
            {Array.from({ length: 24 }, (_, h) => {
              const i = di * 24 + h
              return <i key={h} data-i={i} role="gridcell" aria-selected={hours[i] === '1'} aria-label={`${DAYS[di]} ${hourName(h, clock)}`}
                className={`${hours[i] === '1' ? 'on' : ''} ${i === now ? 'now' : ''} ${hd && (hd.d === di || hd.h === h) ? 'cross' : ''}`}
                style={{ ['--d' as string]: `${(r + h) * 12}ms`, transitionDelay: `${lag(i)}ms` }} />
            })}
          </div>
        ))}
      </div>
      <AnimatePresence>
        {hd && (
          <motion.p className="qh-tip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {DAYS[hd.d]} {hourName(hd.h, clock)}–{hourName((hd.h + 1) % 24, clock)} · {hours[hover!] === '1' ? 'open' : 'quiet'}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
