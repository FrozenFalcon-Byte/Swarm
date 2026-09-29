import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { savePrefs, useAllTasks, usePrefs, useRepos } from '../../lib/data'
import { weekHour } from '../../lib/houserules'
import { easeOut } from '../../lib/motion'
import { DAY_NAMES, nextSlot, rewindWhen } from '../../lib/rewind'
import { useWinHeight } from '../../lib/winHeight'
import { Seg } from './ProfileExtras'
import './clockshop.css'

/*
 * The Clock Shop: a paper-craft wall of timepieces you scroll through, like the Island. Scroll flies the camera
 * (the SVG's viewBox) from piece to piece, and each piece is one part of your Swarm, running live:
 *   the wall clock is your time, with the four agents at 12, 3, 6 and 9; the world clocks tick in six cities;
 *   the cuckoo calls out what needs you; the watch's open back shows four agent gears handing the motion on;
 *   the hourglass drains through the tester's 24 runs; the stopwatch counts down to your Weekly Rewind; and
 *   the 24-hour dial is your quiet hours. Every clock follows your 12 or 24-hour setting.
 * Hands tick from one shared clock; scroll only moves the camera and the pieces it lands on.
 */

type Clock = '24h' | '12h'
const AG = { triager: '#fbe74e', coder: '#9dc4f5', tester: '#ff8a7a', reviewer: '#5dd36a' }
const ROLES = ['triager', 'coder', 'tester', 'reviewer'] as const
type View = [number, number, number, number]

/* ------------------------------------------------------------------ time */

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const RENAMED: Record<string, string> = { Calcutta: 'Kolkata', Saigon: 'Ho Chi Minh City', Kiev: 'Kyiv', Rangoon: 'Yangon', Katmandu: 'Kathmandu' }
const cityOf = (tz: string) => { const c = (tz.split('/').pop() || tz).replace(/_/g, ' '); return RENAMED[c] || c }
function secsIn(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  return (g('hour') % 24) * 3600 + g('minute') * 60 + g('second')
}
/** how far a zone is ahead of the viewer, in seconds, between -12h and +14h */
function offsetOf(tz: string) {
  const at = new Date()
  let d = secsIn(tz, at) - (at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds())
  while (d <= -12 * 3600) d += 86400
  while (d > 14 * 3600) d -= 86400
  return d
}
function fmt(s: number, clock: Clock, secs = false) {
  const t = ((Math.floor(s) % 86400) + 86400) % 86400
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60
  const mm = String(m).padStart(2, '0') + (secs ? ':' + String(x).padStart(2, '0') : '')
  return clock === '12h' ? `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}` : `${String(h).padStart(2, '0')}:${mm}`
}
const hourName = (h: number, clock: Clock) => (clock === '12h' ? `${h % 12 || 12} ${h % 24 < 12 ? 'am' : 'pm'}` : `${String(h % 24).padStart(2, '0')}:00`)

const CITIES: [string, string][] = [
  ['San Francisco', 'America/Los_Angeles'], ['New York', 'America/New_York'], ['São Paulo', 'America/Sao_Paulo'], ['London', 'Europe/London'],
  ['Berlin', 'Europe/Berlin'], ['Dubai', 'Asia/Dubai'], ['Bengaluru', 'Asia/Kolkata'], ['Singapore', 'Asia/Singapore'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'],
]
/** six cities that aren't on your time, the three furthest west on the left and the three furthest east on the right */
function pickCities() {
  const seen = new Set([0])
  const all = CITIES.map(([name, tz]) => ({ name, tz, off: offsetOf(tz) })).filter((c) => { if (seen.has(c.off)) return false; seen.add(c.off); return true })
  all.sort((a, b) => a.off - b.off)
  const west = all.filter((c) => c.off < 0), east = all.filter((c) => c.off > 0)
  const left = west.slice(-3), right = east.slice(0, 3)
  while (left.length < 3 && east.length > right.length + (3 - left.length) - 1) left.unshift(east.pop()!)
  while (right.length < 3 && west.length > left.length) right.push(west.shift()!)
  return [...left, ...right].slice(0, 6)
}

/** one shared clock: seconds since local midnight, unwrapped, set on each real second */
function useSeconds() {
  const midnight = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }, [])
  const read = () => Math.floor((Date.now() - midnight) / 1000)
  const sec = useMotionValue(read())
  useEffect(() => {
    const id = window.setInterval(() => { const v = read(); if (v !== sec.get()) sec.set(v) }, 200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec])
  return sec
}

/* ------------------------------------------------------------------ the camera */

/* Each stop is a spot on the wall and how much of it to show. The frame fits the stage: on a wide screen it's the
   width given; on a tall phone it narrows and grows taller, keeping the piece above the caption. */
let ASPECT = 1.6
type Spot = { x: number; y: number; w: number } | 'open' | 'wide'
function frame(s: Spot): View {
  const A = ASPECT
  if (s === 'open' || s === 'wide') {
    if (A < 1) { const W = 1720, H = W / A; return [-60, 500 - H * (s === 'open' ? 0.62 : 0.5), W, H] }
    return s === 'open' ? [-1080, -300, 2700, 1670] : [-40, -30, 1680, 1060]
  }
  const W = s.w * 1.35 * (A < 1 ? Math.max(0.5, A * 1.15) : 1)
  const H = A < 1 ? W / A : W * 0.62
  return [s.x - W / 2, s.y - H * (A < 1 ? 0.42 : 0.52), W, H]
}

interface Scene { at: number; spot: Spot; tag?: keyof typeof AG | 'lab'; label?: string }
const STOPS: Scene[] = [
  { at: 0, spot: 'open' },
  { at: 0.1, spot: { x: 800, y: 350, w: 680 }, label: 'You' },
  { at: 0.2, spot: { x: 330, y: 200, w: 700 }, label: 'West of you' },
  { at: 0.3, spot: { x: 1270, y: 200, w: 700 }, label: 'East of you' },
  { at: 0.4, spot: { x: 330, y: 500, w: 640 }, tag: 'triager', label: 'Triager' },
  { at: 0.5, spot: { x: 860, y: 830, w: 620 }, tag: 'coder', label: 'Coder' },
  { at: 0.6, spot: { x: 470, y: 800, w: 560 }, tag: 'tester', label: 'Tester' },
  { at: 0.7, spot: { x: 1290, y: 800, w: 580 }, tag: 'reviewer', label: 'Reviewer' },
  { at: 0.8, spot: { x: 1330, y: 480, w: 620 }, tag: 'lab', label: 'Quiet hours' },
  { at: 0.91, spot: 'wide' },
]
const HOLD = 0.055 // how long the camera rests on each piece before flying on
const CAM: [number, number][] = [] // [progress, stop]
STOPS.forEach((s, k) => { CAM.push([s.at, k]); CAM.push([k === 0 ? 0.035 : Math.min(1, s.at + HOLD), k]) })
CAM.push([1, STOPS.length - 1])
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
function camAt(p: number): View {
  for (let k = 0; k < CAM.length - 1; k++) {
    const [a, i] = CAM[k], [b, j] = CAM[k + 1]
    if (p <= b) {
      const va = frame(STOPS[i].spot), vb = frame(STOPS[j].spot)
      const t = b === a ? 1 : ease(Math.min(1, Math.max(0, (p - a) / (b - a))))
      return va.map((v, n) => v + (vb[n] - v) * t) as View
    }
  }
  return frame(STOPS[STOPS.length - 1].spot)
}
// the caption changes once the camera is most of the way to the next piece
const sceneAt = (v: number) => { let s = 0; STOPS.forEach((x, k) => { if (v >= x.at - (k ? 0.012 : 0)) s = k }); return s }
const win = (k: number): [number, number] => [STOPS[k].at, STOPS[k + 1]?.at ?? 1]

/* ------------------------------------------------------------------ the page */

export default function ClockShop() {
  const winH = useWinHeight()
  const { user } = useAuth()
  const prefs = usePrefs(user?.uid)
  const toast = useToast()
  const clock: Clock = prefs?.clock === '12h' ? '12h' : '24h'
  const { data: repos } = useRepos(user?.uid)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const needs = tasks.filter((t) => t.state === 'Needs Human').length
  const sec = useSeconds()
  const cities = useMemo(() => pickCities(), [])
  const rewind = rewindWhen(prefs)
  const next = nextSlot(rewind)
  const sched = repos.find((r) => r.settings?.schedule)
  const today = useMemo(() => {
    if (!sched?.settings?.schedule) return null
    const { tz, hours } = sched.settings.schedule
    const { index } = weekHour(tz)
    const day = Math.floor(index / 24) * 24
    return { tz, hours: Array.from({ length: 24 }, (_, h) => hours[day + h] !== '0'), name: sched.displayName || sched.fullName }
  }, [sched])

  const ref = useRef<HTMLElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 110, damping: 26, mass: 0.45, restDelta: 0.00005 })
  const [scene, setScene] = useState(0)
  useMotionValueEvent(p, 'change', (v) => {
    svg.current?.setAttribute('viewBox', camAt(v).map((n) => n.toFixed(1)).join(' '))
    setScene(sceneAt(v))
  })
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const fit = () => { const r = el.getBoundingClientRect(); if (r.height) ASPECT = r.width / r.height; el.setAttribute('viewBox', camAt(p.get()).map((n) => n.toFixed(1)).join(' ')) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [p])
  const introO = useTransform(p, [0, 0.03], [1, 0])
  const introY = useTransform(p, [0, 0.03], [0, -50])
  const [, setTick] = useState(0)
  useMotionValueEvent(sec, 'change', (v) => { if (v % 60 === 0) setTick(v) }) // captions that name the time follow the minute

  const setClock = (c: Clock) => { if (user) savePrefs(user.uid, { clock: c }).catch(() => toast.error('Couldn’t save that', 'Check your connection and try again.')) }
  const nowS = sec.get()
  const cap = captions({ clock, nowS, cities, needs, next, rewindOn: rewind.on, today })
  const stop = STOPS[scene]

  return (
    <div className="page ck-page" style={winH}>
      <section ref={ref} className="ck-film">
        <div className="ck-pin">
          <svg ref={svg} className="ck-svg" viewBox={camAt(0).join(' ')} role="img" aria-label="A wall of clocks, each one a part of your Swarm">
            <Shop />
            <WallClock sec={sec} clock={clock} />
            {cities.map((c, k) => <WorldClock key={c.tz} sec={sec} clock={clock} city={c} x={k < 3 ? 150 + k * 170 : 1110 + (k - 3) * 170} k={k} />)}
            <Cuckoo p={p} sec={sec} win={win(4)} needs={needs} />
            <DayDial p={p} sec={sec} clock={clock} win={win(8)} today={today?.hours ?? null} />
            <Hourglass p={p} win={win(6)} />
            <Watch p={p} />
            <Stopwatch p={p} sec={sec} win={win(7)} next={next} on={rewind.on} />
          </svg>

          <motion.header className={`ck-intro ${scene > 0 ? 'is-gone' : ''}`} style={{ opacity: introO, y: introY }}>
            <span className="ck-kicker"><i />Just for fun · <Link to="/app/fun">back</Link></span>
            <h1>The Clock Shop</h1>
            <p>Every clock on this wall is a part of your Swarm, and every one is running. Scroll to take the tour.</p>
          </motion.header>

          <div className={`ck-caption ${scene === 0 ? 'is-hidden' : ''}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={scene} initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
                exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }} transition={{ duration: 0.4, ease: easeOut }}>
                {stop.label && <span className="ck-tag" style={{ background: stop.tag ? (stop.tag === 'lab' ? 'var(--lab)' : AG[stop.tag]) : 'var(--white)' }}>{stop.label}</span>}
                <b>{cap[scene]?.t}</b>
                <p>{cap[scene]?.p}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <ol className="ck-rail" aria-hidden="true">
            {STOPS.map((s, k) => <li key={k} className={k === scene ? 'on' : k < scene ? 'done' : ''} style={{ ['--c' as string]: s.tag ? (s.tag === 'lab' ? 'var(--lab)' : AG[s.tag]) : 'var(--ink)' }} />)}
          </ol>
          <motion.div className="ck-bar" style={{ scaleX: scrollYProgress }} />
        </div>
      </section>

      <section className="ck-band">
        <motion.div className="ck-band-inner" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.6, ease: easeOut }}>
          <h2>Every clock here runs on your time.</h2>
          <div className="ck-cards">
            <div className="ck-card" style={{ ['--c' as string]: 'var(--ink)' }}>
              <b>Clock</b>
              <p>How times read everywhere in Swarm, and on every clock in the shop.</p>
              <Seg id="ck-clock" value={clock} onPick={(v) => setClock(v)} options={[['24h', fmt(14 * 3600 + 32 * 60, '24h')], ['12h', fmt(14 * 3600 + 32 * 60, '12h')]]} />
            </div>
            <Link to="/app/quiet-hours" className="ck-card" style={{ ['--c' as string]: 'var(--lab)' }}>
              <b>Quiet hours</b>
              <p>{today ? `${today.name} has quiet hours set. Change when the swarm starts work on its own.` : 'Pick when the swarm may start work on its own.'}</p>
              <span className="link">Open Quiet hours →</span>
            </Link>
            <Link to="/app/settings?tab=rewind" className="ck-card" style={{ ['--c' as string]: AG.reviewer }}>
              <b>Weekly Rewind</b>
              <p>{rewind.on ? `Next one ${DAY_NAMES[rewind.day]} at ${fmt(rewind.minutes * 60, clock)}.` : 'Switched off. Your week, as a short film, once a week.'}</p>
              <span className="link">Change when →</span>
            </Link>
            <Link to="/app/settings?tab=alerts" className="ck-card" style={{ ['--c' as string]: AG.triager }}>
              <b>The cuckoo</b>
              <p>What calls out to you, and how: notes, browser notifications and sounds.</p>
              <span className="link">Notifications →</span>
            </Link>
          </div>
          <div className="ck-band-foot">
            <button className="btn btn-line" onClick={() => { const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY; window.scrollTo({ top, behavior: 'smooth' }) }}>Take the tour again ↑</button>
            <Link to="/app/fun" className="btn btn-dark">More just for fun</Link>
          </div>
        </motion.div>
      </section>
    </div>
  )
}

type City = { name: string; tz: string; off: number }
function captions({ clock, nowS, cities, needs, next, rewindOn, today }: {
  clock: Clock; nowS: number; cities: City[]; needs: number; next: Date; rewindOn: boolean; today: { hours: boolean[]; name: string } | null
}): { t: string; p: string }[] {
  const ahead = cities.find((c) => Math.floor((nowS + c.off) / 86400) > Math.floor(nowS / 86400))
  const west = cities[0]
  const days = Math.max(0, Math.round((next.getTime() - Date.now()) / 86400000))
  const when = `${DAY_NAMES[(next.getDay() + 6) % 7]} at ${fmt(next.getHours() * 3600 + next.getMinutes() * 60, clock)}`
  return [
    { t: '', p: '' },
    { t: `It’s ${fmt(nowS, clock)} in ${cityOf(localTz)}.`, p: 'Your clock sits in the middle of the wall. The four dots on its face are your agents: triager at twelve, coder at three, tester at six, reviewer at nine.' },
    { t: west ? `In ${west.name} it’s ${fmt(nowS + west.off, clock)}.` : 'West of you.', p: 'Issues get opened in every time zone. Whoever’s awake, the swarm picks them up.' },
    { t: ahead ? `In ${ahead.name} it’s already tomorrow.` : 'East of you.', p: 'Every clock on this wall is live, and they all read the way you like: 12 or 24-hour.' },
    { t: needs ? `Cuckoo! ${needs} ${needs === 1 ? 'task needs' : 'tasks need'} you.` : 'Cuckoo! Nothing needs you.', p: 'The triager calls out when a task stops and asks for a person. You choose how it reaches you in Settings → Notifications.' },
    { t: 'Open the back of the watch.', p: 'Four gears, one per agent, each turned by the one before it. That’s a hand-off: nothing moves on its own.' },
    { t: 'Twenty-four runs, before and after.', p: 'The tester runs a test again and again in a sandbox, until the sand runs out and the answer is sure.' },
    rewindOn
      ? { t: `Your Weekly Rewind: ${when}.`, p: `${days === 0 ? 'Later today' : days === 1 ? 'Tomorrow' : `In ${days} days`}, your swarm’s week plays back as a short film. The stopwatch is counting.` }
      : { t: 'The Weekly Rewind is switched off.', p: 'Switch it on in Settings and your week plays back as a short film, once a week.' },
    today
      ? { t: 'Your day, on one dial.', p: `Green is when ${today.name} may start work on its own: ${ranges(today.hours, clock)}. The rest is quiet.` }
      : { t: 'Your day, on one dial.', p: 'No quiet hours yet, so the dial is green all round: your agents may start work any time. Set some in Quiet hours.' },
    { t: 'That’s the shop.', p: 'Scroll on to set your clock, your quiet hours and your Rewind.' },
  ]
}
function ranges(on: boolean[], clock: Clock) {
  if (on.every(Boolean)) return 'all day'
  if (!on.some(Boolean)) return 'not today'
  const start = on.findIndex((v, h) => v && !on[(h + 23) % 24])
  const out: string[] = []
  for (let k = 0, h = start; k < 24; k++, h = (h + 1) % 24) {
    if (on[h] && !on[(h + 23) % 24]) { let e = h; while (on[(e + 1) % 24] && (e + 1) % 24 !== h) e = (e + 1) % 24; out.push(`${hourName(h, clock)} to ${hourName(e + 1, clock)}`) }
  }
  return out.slice(0, 3).join(', ')
}

/* ------------------------------------------------------------------ the room */

function Shop() {
  return (
    <g aria-hidden="true">
      <defs>
        <pattern id="ck-paper" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="18" cy="18" r="2" className="ck-dot" /></pattern>
        <clipPath id="ck-case"><circle r="112" /></clipPath>
      </defs>
      <rect x="-3000" y="-3000" width="7600" height="3700" className="ck-wall" />
      <rect x="-3000" y="-3000" width="7600" height="3700" fill="url(#ck-paper)" />
      {/* the counter: a wooden top and its front edge */}
      <rect x="-3000" y="700" width="7600" height="320" className="ck-wood ink" />
      <rect x="-3000" y="1010" width="7600" height="3000" className="ck-wood-dark ink" />
      {[-400, 200, 800, 1400, 2000].map((x) => <path key={x} d={`M${x} 760q60 -8 120 0M${x + 260} 900q70 -9 140 0`} className="ck-grain" />)}
    </g>
  )
}

/** hands for any face: rotate about the face's centre (the clear circle keeps the pivot there) */
function Hand({ rotate, len, w, color = '#0f0f0f', tail = 0, r }: { rotate: MotionValue<number>; len: number; w: number; color?: string; tail?: number; r: number }) {
  return (
    <motion.g style={{ rotate }}>
      <circle r={r} fill="none" />
      <line x1="0" y1={tail} x2="0" y2={-len} stroke={color} strokeWidth={w} strokeLinecap="round" />
    </motion.g>
  )
}
function useHands(sec: MotionValue<number>, off = 0) {
  const hour = useTransform(sec, (s) => ((s + off) / 3600) * 30)
  const minute = useTransform(sec, (s) => ((s + off) / 60) * 6)
  const raw = useTransform(sec, (s) => s * 6)
  const second = useSpring(raw, { stiffness: 700, damping: 24 }) // a tick, with a tiny kick
  return { hour, minute, second }
}
function Ticks({ r, n = 60, major = 5, long = 14, short = 6, w = 2.5 }: { r: number; n?: number; major?: number; long?: number; short?: number; w?: number }) {
  const d = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2, l = k % major ? short : long
    return `M${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}L${(Math.sin(a) * (r - l)).toFixed(1)} ${(-Math.cos(a) * (r - l)).toFixed(1)}`
  }).join('')
  return <path d={d} stroke="#0f0f0f" strokeWidth={w} strokeLinecap="round" />
}
/** text that follows the clock without re-rendering the room */
function Live({ sec, render, ...rest }: { sec: MotionValue<number>; render: (s: number) => string } & React.SVGProps<SVGTextElement>) {
  const [txt, setTxt] = useState(() => render(sec.get()))
  const [was, setWas] = useState(() => render)
  if (was !== render) { setWas(() => render); setTxt(render(sec.get())) } // a new format (12/24-hour) shows at once
  useMotionValueEvent(sec, 'change', (s) => setTxt(render(s)))
  return <text {...rest}>{txt}</text>
}
function Face({ r, eyes = true }: { r: number; eyes?: boolean }) {
  return eyes ? <g><rect x={-r * 0.36} y={-r * 0.3} width={r * 0.2} height={r * 0.5} rx={r * 0.1} fill="#0f0f0f" /><rect x={r * 0.16} y={-r * 0.3} width={r * 0.2} height={r * 0.5} rx={r * 0.1} fill="#0f0f0f" /></g> : null
}

/* ------------------------------------------------------------------ the pieces */

function WallClock({ sec, clock }: { sec: MotionValue<number>; clock: Clock }) {
  const { hour, minute, second } = useHands(sec)
  const render = useMemo(() => (s: number) => fmt(s, clock, true), [clock])
  return (
    <g transform="translate(800 330)">
      <path d="M-8 -210L0 -196L8 -210" className="ink" fill="#0f0f0f" />
      <circle r="182" className="ck-shadow" cx="10" cy="12" />
      <circle r="182" fill="#0f0f0f" />
      <circle r="164" className="ck-face ink" />
      <Ticks r={150} />
      {ROLES.map((role, k) => {
        const a = (k / 4) * Math.PI * 2
        return <g key={role} transform={`translate(${(Math.sin(a) * 112).toFixed(1)} ${(-Math.cos(a) * 112).toFixed(1)})`} className="ck-agent" style={{ ['--k' as string]: k }}>
          <circle r="21" fill={AG[role]} className="ink" /><Face r={21} />
        </g>
      })}
      <Hand rotate={hour} len={70} w={12} r={164} />
      <Hand rotate={minute} len={112} w={8} r={164} />
      <Hand rotate={second} len={128} w={3} tail={26} color={AG.tester} r={164} />
      <circle r="9" fill="#0f0f0f" />
      <g transform="translate(0 230)">
        <rect x="-118" y="-30" width="236" height="74" rx="18" className="ck-plaque ink" />
        <text y="-6" className="ck-small" textAnchor="middle">YOU · {cityOf(localTz).toUpperCase()}</text>
        <Live sec={sec} render={render} y="30" className="ck-digits" textAnchor="middle" />
      </g>
    </g>
  )
}

function WorldClock({ sec, clock, city, x, k }: { sec: MotionValue<number>; clock: Clock; city: City; x: number; k: number }) {
  const { hour, minute, second } = useHands(sec, city.off)
  const rim = [AG.coder, AG.triager, AG.reviewer, AG.tester, '#ffd2f0', AG.coder][k]
  const render = useMemo(() => (s: number) => {
    const d = Math.floor((s + city.off) / 86400) - Math.floor(s / 86400)
    return fmt(s + city.off, clock) + (d > 0 ? ' · tomorrow' : d < 0 ? ' · yesterday' : '')
  }, [city.off, clock])
  const night = (() => { const h = Math.floor((((sec.get() + city.off) % 86400) + 86400) % 86400 / 3600); return h < 6 || h >= 20 })()
  return (
    <g transform={`translate(${x} 170)`}>
      <path d="M-40 -84L0 -120L40 -84" fill="none" stroke="#0f0f0f" strokeWidth="2.5" />
      <circle cy="-120" r="6" fill="#0f0f0f" />
      <circle r="76" cx="6" cy="8" className="ck-shadow" />
      <circle r="76" fill={rim} className="ink" />
      <circle r="62" className={`ck-face ink ${night ? 'is-night' : ''}`} />
      <Ticks r={56} n={12} major={3} long={10} short={6} w={3} />
      <Hand rotate={hour} len={28} w={8} r={62} />
      <Hand rotate={minute} len={44} w={5} r={62} />
      <Hand rotate={second} len={50} w={2} tail={12} color={AG.tester} r={62} />
      <circle r="5" fill="#0f0f0f" />
      <text y="112" className="ck-city" textAnchor="middle">{city.name}</text>
      <Live sec={sec} render={render} y="140" className="ck-small" textAnchor="middle" />
    </g>
  )
}

/** the triager's cuckoo: the doors swing open as you arrive and the bird calls out what needs you */
function Cuckoo({ p, sec, win: [a, b], needs }: { p: MotionValue<number>; sec: MotionValue<number>; win: [number, number]; needs: number }) {
  const open = useTransform(p, [a - 0.03, a + 0.005, b - 0.02, b + 0.01], [0, 1, 1, 0])
  const door = useTransform(open, (v) => 1 - v * 0.92)
  const bird = useTransform(open, [0.3, 1], [0, 1])
  const birdY = useTransform(bird, (v) => (1 - v) * 16)
  const bubble = useTransform(p, [a, a + 0.02, b - 0.03, b - 0.005], [0, 1, 1, 0])
  const bubbleS = useTransform(bubble, (v) => 0.6 + v * 0.4)
  const { hour, minute } = useHands(sec)
  return (
    <g transform="translate(235 360)">
      {/* roof and house */}
      <path d="M-128 60L0 -40L128 60Z" className="ck-roof ink" />
      <path d="M-104 40h208v200h-208z" className="ck-house ink" />
      <path d="M-128 60L0 -40L128 60" fill="none" stroke="#0f0f0f" strokeWidth="5" strokeLinejoin="round" />
      {/* the little doorway */}
      <rect x="-30" y="38" width="60" height="62" rx="4" fill="#0f0f0f" />
      <motion.g style={{ scale: bird, y: birdY }}>
        <circle r="60" cy="70" fill="none" />
        <g transform="translate(0 70)" className="ck-bird">
          <circle r="24" fill={AG.triager} className="ink" />
          <path d="M20 -2l20 6l-20 6z" fill="#ff9b3d" className="ink" />
          <circle cx="8" cy="-6" r="3.6" fill="#0f0f0f" />
          <path d="M-18 4q-12 10 -2 18" fill="none" stroke="#0f0f0f" strokeWidth="3" strokeLinecap="round" />
        </g>
      </motion.g>
      <motion.rect x="-30" y="38" width="30" height="62" className="ck-door ink" style={{ scaleX: door, originX: 0 }} />
      <motion.rect x="0" y="38" width="30" height="62" className="ck-door ink" style={{ scaleX: door, originX: 1 }} />
      {/* its clock */}
      <circle cy="170" r="50" className="ck-face ink" />
      <g transform="translate(0 170)">
        <Ticks r={44} n={12} major={3} long={8} short={5} w={3} />
        <Hand rotate={hour} len={22} w={7} r={50} />
        <Hand rotate={minute} len={36} w={4} r={50} />
        <circle r="4" fill="#0f0f0f" />
      </g>
      {/* pendulum and weights */}
      <g className="ck-swing"><line x1="0" y1="240" x2="0" y2="320" stroke="#0f0f0f" strokeWidth="4" /><circle cy="330" r="16" fill={AG.triager} className="ink" /></g>
      {[-54, 54].map((x, k) => <g key={x}><line x1={x} y1="240" x2={x} y2={290 + k * 30} stroke="#0f0f0f" strokeWidth="2.5" /><path d={`M${x - 12} ${290 + k * 30}h24l-4 44h-16z`} className="ck-cone ink" /></g>)}
      {/* what it calls out */}
      <motion.g style={{ opacity: bubble, scale: bubbleS }}>
        <circle r="130" cx="200" cy="30" fill="none" />
        <path d="M110 -20h190a18 18 0 0118 18v54a18 18 0 01-18 18h-150l-22 24v-24h-18a18 18 0 01-18 -18v-54a18 18 0 0118 -18z" className="ck-bubble ink" />
        <text x="205" y="18" textAnchor="middle" className="ck-bubble-t">{needs ? 'Cuckoo!' : 'Cuckoo.'}</text>
        <text x="205" y="48" textAnchor="middle" className="ck-small">{needs ? `${needs} ${needs === 1 ? 'task needs' : 'tasks need'} you` : 'nothing needs you'}</text>
      </motion.g>
    </g>
  )
}

/* four gears, one per agent, meshed in a chain: each turns because the one before it does */
const M = 16
const TEETH = [12, 10, 12, 10]
const DIRS = [0, 100, 20]
const GEARS = (() => {
  const g: { x: number; y: number; t: number; R: number; phase: number; speed: number }[] = []
  TEETH.forEach((t, k) => {
    const R = (t * M) / 2
    if (!k) { g.push({ x: 0, y: 0, t, R, phase: 0, speed: 1 }); return }
    const prev = g[k - 1], th = DIRS[k - 1], d = prev.R + R, rad = (th * Math.PI) / 180
    const phase = th + 180 + 180 / t + (prev.t / t) * (th - prev.phase)
    g.push({ x: prev.x + Math.cos(rad) * d, y: prev.y + Math.sin(rad) * d, t, R, phase, speed: -prev.speed * (prev.t / t) })
  })
  const xs = g.flatMap((q) => [q.x - q.R - M, q.x + q.R + M]), ys = g.flatMap((q) => [q.y - q.R - M, q.y + q.R + M])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return g.map((q) => ({ ...q, x: q.x - cx, y: q.y - cy }))
})()
function gearPath(t: number, R: number) {
  const tip = R + M, root = R - 1.25 * M, step = (Math.PI * 2) / t
  const pt = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`
  let d = ''
  for (let k = 0; k < t; k++) {
    const c = k * step
    d += `${k ? 'L' : 'M'}${pt(root, c - 0.5 * step)}L${pt(root, c - 0.28 * step)}L${pt(tip, c - 0.14 * step)}L${pt(tip, c + 0.14 * step)}L${pt(root, c + 0.28 * step)}`
  }
  return d + 'Z'
}
function Watch({ p }: { p: MotionValue<number> }) {
  const turn = useTransform(p, [0, 1], [0, 1440])
  return (
    <g transform="translate(860 840)">
      {/* the strap, lying open on the counter */}
      <rect x="-250" y="-46" width="500" height="92" rx="26" className="ck-strap ink" />
      {[-210, -180, -150].map((x) => <circle key={x} cx={x} cy="0" r="7" className="ck-hole" />)}
      <rect x="160" y="-34" width="60" height="68" rx="8" fill="none" stroke="#0f0f0f" strokeWidth="4" />
      <circle r="144" cx="10" cy="12" className="ck-shadow" />
      <circle r="144" className="ck-case ink" />
      <rect x="138" y="-18" width="26" height="36" rx="6" className="ck-case ink" />
      <circle r="120" className="ck-back ink" />
      <g clipPath="url(#ck-case)">
        <g transform="scale(0.36)">
          {GEARS.map((g, k) => <Gear key={k} g={g} turn={turn} role={ROLES[k]} />)}
        </g>
      </g>
      <circle r="120" fill="none" className="ink" />
      <circle r="112" className="ck-glass" />
    </g>
  )
}
function Gear({ g, turn, role }: { g: (typeof GEARS)[number]; turn: MotionValue<number>; role: (typeof ROLES)[number] }) {
  const rotate = useTransform(turn, (a) => g.phase + a * g.speed)
  const d = useMemo(() => gearPath(g.t, g.R), [g.t, g.R])
  return (
    <g transform={`translate(${g.x.toFixed(1)} ${g.y.toFixed(1)})`}>
      <motion.g style={{ rotate }}>
        <circle r={g.R + M + 2} fill="none" />
        <path d={d} fill={AG[role]} stroke="#0f0f0f" strokeWidth="7" strokeLinejoin="round" />
        {[0, 1, 2, 3].map((k) => <circle key={k} cx={Math.cos((k * Math.PI) / 2) * g.R * 0.55} cy={Math.sin((k * Math.PI) / 2) * g.R * 0.55} r={g.R * 0.13} className="ck-gear-hole" />)}
      </motion.g>
      <circle r={g.R * 0.36} fill={AG[role]} stroke="#0f0f0f" strokeWidth="7" />
      <Face r={g.R * 0.36} />
    </g>
  )
}

const GLASS = 'M-78 -104C-78 -30 -10 -16 -10 0C-10 16 -78 30 -78 104H78C78 30 10 16 10 0C10 -16 78 -30 78 -104Z'
/** the tester's hourglass drains through 24 runs as you scroll past it */
function Hourglass({ p, win: [a, b] }: { p: MotionValue<number>; win: [number, number] }) {
  const t = useTransform(p, [a + 0.005, b - 0.025], [0, 1], { clamp: true })
  // the top level falls from just under the rim to the neck; the bottom pile rises from the floor
  const topY = useTransform(t, [0, 1], [0, 96])
  const bottomY = useTransform(t, [0, 1], [124, 0])
  const stream = useTransform(t, [0, 0.03, 0.96, 1], [0, 1, 1, 0])
  const [runs, setRuns] = useState(0)
  useMotionValueEvent(t, 'change', (v) => setRuns(Math.round(v * 24)))
  return (
    <g transform="translate(470 800)">
      <defs>
        <clipPath id="ck-sand-top"><path d="M-78 -104C-78 -30 -10 -16 -10 0H10C10 -16 78 -30 78 -104Z" /></clipPath>
        <clipPath id="ck-sand-bottom"><path d="M-10 0C-10 16 -78 30 -78 104H78C78 30 10 16 10 0Z" /></clipPath>
      </defs>
      <ellipse cx="6" cy="132" rx="120" ry="16" className="ck-shadow" />
      <path d={GLASS} className="ck-glass-body" />
      <g clipPath="url(#ck-sand-top)"><motion.path d="M-90 -86Q0 -80 90 -86V0H-90Z" fill={AG.tester} style={{ y: topY }} /></g>
      <g clipPath="url(#ck-sand-bottom)">
        <motion.path d="M-90 104V38Q0 -10 90 38V104Z" fill={AG.tester} style={{ y: bottomY }} />
        <motion.line x1="0" y1="0" x2="0" y2="104" stroke={AG.tester} strokeWidth="5" strokeDasharray="6 5" className="ck-stream" style={{ opacity: stream }} />
      </g>
      <path d={GLASS} fill="none" className="ink" />
      {/* the frame */}
      <rect x="-104" y="-128" width="208" height="26" rx="8" className="ck-wood ink" />
      <rect x="-104" y="102" width="208" height="26" rx="8" className="ck-wood ink" />
      {[-92, 92].map((x) => <rect key={x} x={x - 7} y="-104" width="14" height="208" rx="5" className="ck-wood ink" />)}
      {/* 24 notches that fill as the runs go by */}
      {Array.from({ length: 24 }, (_, k) => <rect key={k} x="112" y={96 - k * 8.4} width="22" height="5" rx="2.5" fill={k < runs ? AG.tester : '#e6e1d4'} className="ck-notch" />)}
      <text x="160" y="-110" className="ck-digits" textAnchor="middle">{runs}/24</text>
    </g>
  )
}

/** the reviewer's stopwatch: counts down to your next Weekly Rewind, and winds as you scroll past */
function Stopwatch({ p, sec, win: [a, b], next, on }: { p: MotionValue<number>; sec: MotionValue<number>; win: [number, number]; next: Date; on: boolean }) {
  const spin = useTransform(p, [a - 0.02, b], [0, 1080])
  const press = useTransform(p, [a - 0.01, a + 0.005, a + 0.02], [0, 8, 0])
  const render = useMemo(() => () => {
    if (!on) return 'OFF'
    const left = Math.max(0, Math.floor((next.getTime() - Date.now()) / 1000))
    const d = Math.floor(left / 86400), h = Math.floor(left / 3600) % 24, m = Math.floor(left / 60) % 60, s = left % 60
    return `${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, [next, on])
  return (
    <g transform="translate(1290 830)">
      <ellipse cx="8" cy="118" rx="112" ry="14" className="ck-shadow" />
      <motion.g style={{ y: press }}>
        <rect x="-16" y="-150" width="32" height="30" rx="6" className="ck-case ink" />
        <rect x="-30" y="-162" width="60" height="16" rx="8" fill={AG.reviewer} className="ink" />
      </motion.g>
      <rect x="-12" y="-128" width="24" height="24" className="ck-case ink" />
      <rect x="70" y="-110" width="26" height="18" rx="6" transform="rotate(45 83 -101)" className="ck-case ink" />
      <circle r="112" fill={AG.reviewer} className="ink" />
      <circle r="94" className="ck-face ink" />
      <Ticks r={88} />
      <motion.g style={{ rotate: spin }}>
        <circle r="94" fill="none" />
        <line x1="0" y1="18" x2="0" y2="-80" stroke={AG.tester} strokeWidth="4" strokeLinecap="round" />
      </motion.g>
      <circle r="7" fill="#0f0f0f" />
      <rect x="-78" y="24" width="156" height="36" rx="10" className="ck-plaque ink" />
      <Live sec={sec} render={render} y="50" className="ck-digits ck-digits--sm" textAnchor="middle" />
      <text y="-40" className="ck-small ck-small--xs" textAnchor="middle">NEXT REWIND</text>
    </g>
  )
}

/** your quiet hours on a 24-hour dial; a sun sweeps round it as you scroll */
function DayDial({ p, sec, clock, win: [a, b], today }: { p: MotionValue<number>; sec: MotionValue<number>; clock: Clock; win: [number, number]; today: boolean[] | null }) {
  const nowH = sec.get() / 3600
  const sweep = useTransform(p, [a + 0.005, b - 0.02], [0, 24], { clamp: true })
  const rotate = useTransform(sweep, (v) => (nowH + v) * 15)
  const [at, setAt] = useState(Math.floor(nowH))
  useMotionValueEvent(sweep, 'change', (v) => setAt(Math.floor(nowH + v) % 24))
  const on = (h: number) => (today ? today[h] : true)
  const R = 150, r = 104
  const seg = (h: number) => {
    const a0 = ((h * 15 - 90) * Math.PI) / 180, a1 = (((h + 1) * 15 - 90) * Math.PI) / 180
    const P = (rad: number, a: number) => `${(Math.cos(a) * rad).toFixed(1)} ${(Math.sin(a) * rad).toFixed(1)}`
    return `M${P(R, a0)}A${R} ${R} 0 0 1 ${P(R, a1)}L${P(r, a1)}A${r} ${r} 0 0 0 ${P(r, a0)}Z`
  }
  return (
    <g transform="translate(1330 470)">
      <circle r="170" cx="10" cy="12" className="ck-shadow" />
      <circle r="170" fill="#0f0f0f" />
      <circle r={R + 4} className="ck-face ink" />
      {Array.from({ length: 24 }, (_, h) => <path key={h} d={seg(h)} fill={on(h) ? AG.reviewer : '#e6e1d4'} stroke="#0f0f0f" strokeWidth="2.5" className={h === at ? 'ck-seg is-on' : 'ck-seg'} />)}
      {[0, 6, 12, 18].map((h) => {
        const ang = ((h * 15 - 90) * Math.PI) / 180
        return <text key={h} x={Math.cos(ang) * 80} y={Math.sin(ang) * 80 + 7} textAnchor="middle" className="ck-small">{hourName(h, clock)}</text>
      })}
      <motion.g style={{ rotate }}>
        <circle r={R + 30} fill="none" />
        <line x1="0" y1="0" x2="0" y2={-R + 6} stroke="#0f0f0f" strokeWidth="5" strokeLinecap="round" />
        <g transform={`translate(0 ${-R - 16})`}>
          <circle r="16" fill={on(at) ? AG.triager : '#c9d4ff'} className="ink" />
        </g>
      </motion.g>
      <circle r="44" className="ck-face ink" />
      <text y="-2" textAnchor="middle" className="ck-digits ck-digits--sm">{hourName(at, clock)}</text>
      <text y="22" textAnchor="middle" className="ck-small">{on(at) ? 'may work' : 'quiet'}</text>
    </g>
  )
}
