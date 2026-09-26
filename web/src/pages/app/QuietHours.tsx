import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { setSchedule, useRepos } from '../../lib/data'
import { weekHour } from '../../lib/houserules'
import type { Schedule } from '../../lib/types'
import { PageHead } from './Overview'
import { RepoSelect, SaveChip, rise, useDraft, useRepoChoice } from './repoDraft'
import { EmptyState } from './ui'

/* Quiet hours: when the swarm may go looking for new issues and start work on its own. Paint the week,
   and the worker skips its automatic checks outside those hours (swarm/houserules.py). Runs you start
   yourself, and your approvals and merges, always go ahead. */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ALL = '1'.repeat(168)
const build = (on: (d: number, h: number) => boolean) => Array.from({ length: 168 }, (_, i) => (on(Math.floor(i / 24), i % 24) ? '1' : '0')).join('')
const PRESETS: { id: string; label: string; hint: string; hours: string | null }[] = [
  { id: 'any', label: 'Any time', hint: 'No quiet hours', hours: null },
  { id: 'nights', label: 'Nights & weekends', hint: 'Out of your way while you work', hours: build((d, h) => d >= 5 || h >= 19 || h < 7) },
  { id: 'work', label: 'Working hours', hint: 'While someone’s around to review', hours: build((d, h) => d < 5 && h >= 9 && h < 18) },
  { id: 'dawn', label: 'Before dawn', hint: 'One quiet batch a day', hours: build((_d, h) => h >= 2 && h < 6) },
]
const zones = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone') } catch { return [] as string[] } })()
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export default function QuietHours() {
  const { user } = useAuth()
  const toast = useToast()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const [repoId, setRepoId] = useRepoChoice(repos, 'swarm.quiet.repo')
  const repo = repos.find((r) => r.id === repoId)
  const mine = !!repo && repo.ownerUid === user?.uid
  const [sched, setSched, saveState] = useDraft<Schedule | null>(repoId, repo?.settings?.schedule ?? null, (v) => setSchedule(repoId, v))
  const tz = sched?.tz || localTz
  const hours = sched?.hours || ALL
  const preset = PRESETS.find((p) => (p.hours ?? null) === (sched?.hours ?? null))?.id ?? 'custom'

  // the clock moves on its own; a minute is plenty
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 20_000); return () => window.clearInterval(t) }, [])
  const at = weekHour(tz, now)
  const [day, setDay] = useState<number | null>(null)
  const shownDay = day ?? Math.floor(at.index / 24)

  const write = (next: string) => setSched(next === ALL ? null : { tz, hours: next })
  const pickPreset = (id: string) => { const p = PRESETS.find((x) => x.id === id); if (p) setSched(p.hours ? { tz, hours: p.hours } : null) }
  const applyAll = async () => {
    const others = repos.filter((r) => r.id !== repoId && r.ownerUid === user?.uid)
    try { await Promise.all(others.map((r) => setSchedule(r.id, sched))); toast.ok('Copied', `Same hours on ${others.length} more repositor${others.length === 1 ? 'y' : 'ies'}.`) }
    catch (e) { toast.error('Couldn’t copy', (e as Error).message) }
  }

  if (!loading && repos.length === 0) {
    return <div className="page"><PageHead title="Quiet hours" /><EmptyState title="No repository yet" text="Connect one and you can choose when the swarm works on it."><Link to="/app" className="btn btn-dark">Connect a repository</Link></EmptyState></div>
  }

  const open = hours.split('').filter((c) => c === '1').length
  return (
    <div className="page fit">
      <PageHead title="Quiet hours" sub="When the swarm may pick up new issues on its own. Anything you start yourself always goes ahead.">
        <div className="toolbar-side"><RepoSelect repos={repos} value={repoId} onChange={setRepoId} /><SaveChip state={saveState} readOnly={!mine} /></div>
      </PageHead>

      <motion.div className="qh-top" {...rise(0)}>
        <LayoutGroup id="qh-presets">
          <div className="qh-presets" role="radiogroup" aria-label="Presets">
            {PRESETS.map((p) => (
              <motion.button key={p.id} role="radio" aria-checked={preset === p.id} className={`qh-preset ${preset === p.id ? 'on' : ''}`} disabled={!mine} onClick={() => pickPreset(p.id)}
                whileHover={{ y: -3 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                {preset === p.id && <motion.span layoutId="qh-preset-on" className="qh-preset-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <b>{p.label}</b><small>{p.hint}</small>
                <PresetGlyph id={p.id} hours={p.hours} />
              </motion.button>
            ))}
            <AnimatePresence>
              {preset === 'custom' && (
                <motion.span className="qh-preset qh-custom on" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <motion.span layoutId="qh-preset-on" className="qh-preset-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                  <b>Your own</b><small>Painted by hand</small>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </motion.div>

      <div className="qh-grid-wrap">
        <motion.section className="qh-dial-card" {...rise(1)}>
          <Dial hours={hours} day={shownDay} today={Math.floor(at.index / 24)} hour={at.index % 24} minute={at.minute} />
          <Countdown hours={hours} at={at} scheduled={!!sched} />
          <div className="qh-days" role="tablist" aria-label="Day on the dial">
            {DAYS.map((d, i) => (
              <button key={d} role="tab" aria-selected={shownDay === i} className={shownDay === i ? 'on' : ''} onClick={() => setDay(i === Math.floor(at.index / 24) ? null : i)}>
                {d[0]}{i === Math.floor(at.index / 24) && <i />}
              </button>
            ))}
          </div>
        </motion.section>

        <motion.section className="qh-week" {...rise(2)}>
          <header>
            <div><h2>Paint your week</h2><p>Drag to paint. Green means it may start on its own. Click a day or an hour to flip it.</p></div>
            <div className="qh-tz">
              <select className="selectbox" value={tz} disabled={!mine} aria-label="Time zone" onChange={(e) => setSched({ tz: e.target.value, hours })}>
                {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </header>
          <Painter hours={hours} now={at.index} disabled={!mine} onChange={write} onDay={(d) => setDay(d === Math.floor(at.index / 24) ? null : d)} />
          <footer className="qh-foot">
            <span><b>{open}</b> of 168 hours open{open === 168 ? ', so no quiet hours' : open === 0 ? '. Nothing starts on its own' : ''}</span>
            <span>Longest quiet stretch <b>{longestQuiet(hours)}h</b></span>
            {mine && repos.filter((r) => r.ownerUid === user?.uid).length > 1 && <button className="btn btn-line btn-sm" onClick={applyAll}>Use on all my repositories</button>}
          </footer>
        </motion.section>
      </div>
    </div>
  )
}

function longestQuiet(hours: string) {
  if (!hours.includes('1')) return 168
  const twice = hours + hours
  let best = 0, run = 0
  for (const c of twice) { run = c === '0' ? run + 1 : 0; best = Math.max(best, run) }
  return Math.min(best, 168)
}

/** One day as a 24-hour ring. On today's dial a marker rides the ring to the current time; the centre
 *  says which day it is and how many of its hours are open. */
function Dial({ hours, day, today, hour, minute }: { hours: string; day: number; today: number; hour: number; minute: number }) {
  const R = 108, r = 76, C = 130
  const seg = (h: number) => {
    const a0 = ((h / 24) * 360 - 90 + 0.9) * (Math.PI / 180), a1 = (((h + 1) / 24) * 360 - 90 - 0.9) * (Math.PI / 180)
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`
    return `M${p(R, a0)} A${R} ${R} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 0 0 ${p(r, a0)}Z`
  }
  const row = hours.slice(day * 24, day * 24 + 24)
  const open = row.split('').filter((c) => c === '1').length
  const angle = ((hour + minute / 60) / 24) * 360
  return (
    <div className="qh-dial">
      <svg viewBox="0 0 260 260" aria-label={`${DAYS[day]}: ${open} hours open`}>
        {Array.from({ length: 24 }, (_, h) => {
          const on = row[h] === '1'
          return (
            <motion.path key={h} d={seg(h)} initial={{ opacity: 0 }} animate={{ opacity: 1, fill: on ? 'var(--green)' : 'var(--grey-6)' }} stroke="var(--ink)" strokeWidth={on ? 1.5 : 0}
              transition={{ opacity: { duration: 0.3, delay: 0.1 + h * 0.012 }, fill: { duration: 0.3, delay: h * 0.01 } }} />
          )
        })}
        {[0, 6, 12, 18].map((h) => {
          const a = ((h / 24) * 360 - 90) * (Math.PI / 180)
          return <text key={h} x={C + 124 * Math.cos(a)} y={C + 124 * Math.sin(a) + 4} textAnchor="middle" className="qh-dial-num">{h}</text>
        })}
      </svg>
      {/* the marker is plain HTML turned about the dial's centre, so it can never swing off the ring */}
      <AnimatePresence>
        {day === today && (
          <motion.span key="now" className="qh-marker" initial={{ rotate: angle - 24, opacity: 0 }} animate={{ rotate: angle, opacity: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            transition={{ rotate: { duration: 0.9, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.3 } }}>
            <i />
          </motion.span>
        )}
      </AnimatePresence>
      <div className="qh-dial-mid">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={day} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}>
            <b>{day === today ? 'Today' : DAYS[day]}</b>
            <span>{open === 24 ? 'open all day' : open === 0 ? 'quiet all day' : `${open}h open`}</span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Countdown({ hours, at, scheduled }: { hours: string; at: { index: number; minute: number }; scheduled: boolean }) {
  const openNow = hours[at.index] === '1'
  let steps = 1
  while (steps < 168 && (hours[(at.index + steps) % 168] === '1') === openNow) steps++
  const mins = steps * 60 - at.minute
  const when = steps >= 168 ? null : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim()
  const title = !scheduled ? 'Always open' : openNow ? 'Open now' : 'Quiet now'
  const sub = !scheduled ? 'The swarm checks for new issues whenever the worker runs.'
    : when === null ? (openNow ? 'Open all week.' : 'Nothing starts on its own. Only runs you start.')
    : openNow ? `Goes quiet in ${when}.` : `Opens in ${when}.`
  return (
    <div className={`qh-now ${!scheduled || openNow ? 'open' : 'quiet'}`}>
      <span className="qh-pulse" aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={title + sub} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          <b>{title}</b><span>{sub}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** A tiny week-at-a-glance of a preset, drawn from its own hours. */
function PresetGlyph({ id, hours }: { id: string; hours: string | null }) {
  const h = hours || ALL
  return (
    <span className="qh-glyph" aria-hidden="true">
      {DAYS.map((_, d) => <span key={d}>{Array.from({ length: 8 }, (_, k) => <i key={k} className={h[d * 24 + k * 3] === '1' ? 'on' : ''} style={{ ['--d' as string]: `${(d + k) * 18}ms` }} data-p={id} />)}</span>)}
    </span>
  )
}

/** The week grid. Press on a cell to start painting (it paints the opposite of that cell), drag to continue. */
function Painter({ hours, now, disabled, onChange, onDay }: { hours: string; now: number; disabled: boolean; onChange: (h: string) => void; onDay: (d: number) => void }) {
  const paint = useRef<'1' | '0' | null>(null)
  const [drag, setDrag] = useState(false)
  const work = useRef(hours)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => { if (paint.current === null) work.current = hours }, [hours])
  useEffect(() => {
    const up = () => { paint.current = null; setDrag(false) }
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [])
  const set = (i: number) => {
    if (paint.current === null || work.current[i] === paint.current) return
    work.current = work.current.slice(0, i) + paint.current + work.current.slice(i + 1)
    onChange(work.current)
  }
  const cellAt = (e: ReactPointerEvent) => {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-h]') as HTMLElement | null
    return el ? Number(el.dataset.h) : null
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
    const row = hours.slice(d * 24, d * 24 + 24), to = row.includes('0') ? '1' : '0'
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
        {Array.from({ length: 24 }, (_, h) => <button key={h} tabIndex={-1} className={hd?.h === h ? 'hot' : ''} onClick={() => flipCol(h)}>{h % 3 === 0 ? h : ''}</button>)}
      </div>
      <div className={`qh-rows ${drag ? 'painting' : ''}`} onPointerDown={down} onPointerMove={move} onPointerLeave={() => setHover(null)} role="grid" aria-label="Hours of the week">
        {DAYS.map((d, di) => (
          <div key={d} className="qh-row" role="row">
            <button className={`qh-day ${hd?.d === di ? 'hot' : ''}`} onClick={() => flipRow(di)} onPointerDown={(e) => e.stopPropagation()}>{d}</button>
            {Array.from({ length: 24 }, (_, h) => {
              const i = di * 24 + h
              return <i key={`${h}${hours[i]}`} data-h={i} role="gridcell" aria-selected={hours[i] === '1'} aria-label={`${d} ${h}:00`}
                className={`${hours[i] === '1' ? 'on' : ''} ${i === now ? 'now' : ''} ${hd && (hd.d === di || hd.h === h) ? 'cross' : ''}`}
                style={{ ['--d' as string]: `${(di + h) * 4}ms` }} />
            })}
          </div>
        ))}
      </div>
      <AnimatePresence>
        {hd && (
          <motion.p className="qh-tip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {DAYS[hd.d]} {String(hd.h).padStart(2, '0')}:00–{String((hd.h + 1) % 24).padStart(2, '0')}:00 · {hours[hover!] === '1' ? 'open' : 'quiet'}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

