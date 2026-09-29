import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { TaskState } from '../../lib/types'
import { useWinHeight } from '../../lib/winHeight'
import './garden.css'

/*
 * The Garden, in two parts, like the Island.
 * First a film you scroll through: your swarm's real history as a time-lapse. Every repository is a plant; the
 * camera starts down in the soil and pulls back as the days fly past (the sun and moon racing over), issues crawl
 * in as bugs, the agents' work opens as buds and every fix blooms, in the order it really happened.
 * Then the harvest, another film: your crew of agent-bees fly in with what each of them did, every fix drops into
 * a basket, each repository flips up as a seed packet, and the sun rises on whatever still needs you.
 */

type Item = { id: string; title: string; state: TaskState; born: number; bloom: number; repoId: string; demo: boolean }
type Bed = { id: string; name: string; items: Item[] }
type Kind = 'flower' | 'bud' | 'wilt'
type Sky = 'day' | 'dusk' | 'night'
type Spot = { x: number; y: number; id: string }

const W = 1000, H = 560, GROUND = 468
const BLOOM: TaskState[] = ['Approved', 'Merged', 'Closed']
const BUD: TaskState[] = ['Triaged', 'In Progress', 'Awaiting Tests', 'In Review']
const ROLES = ['triager', 'coder', 'tester', 'reviewer'] as const
const STEPS = 200
const MAX_SLOTS = 14
const DAYS = 3 // days the film's sky races through
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}
const kindOf = (s: TaskState): Kind | null => (BLOOM.includes(s) ? 'flower' : BUD.includes(s) ? 'bud' : s === 'Rejected' ? 'wilt' : null)
const plantXs = (n: number) => Array.from({ length: n }, (_, k) => (n === 1 ? W / 2 : 150 + (k * (W - 300)) / (n - 1)))

type View = { x: number; y: number; w: number; h: number }
const BASE: View = { x: 0, y: 0, w: W, h: H }
/** A viewBox shaped like the stage, so the whole garden always shows: a taller stage gets more sky, a wider one more hills. */
function useView(ref: RefObject<HTMLElement | null>): View {
  const [v, setV] = useState(BASE)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const a = el.clientWidth / Math.max(1, el.clientHeight)
      if (!a) return
      const next = a >= W / H ? { w: H * a, h: H } : { w: W, h: W / a }
      setV({ x: (W - next.w) / 2, y: H - next.h, w: next.w, h: next.h })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return v
}
const box = (v: View) => `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`

/* ------------------------------------------------------------------ the page */

export default function Garden() {
  const winH = useWinHeight()
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const [now] = useState(() => Date.now())

  const beds = useMemo<Bed[]>(() => {
    if (!repos.length) return demoBeds(now)
    return repos.slice(0, 6).map((r) => ({
      id: r.id, name: r.displayName || r.fullName.split('/').pop() || r.fullName,
      items: tasks.filter((t) => t.repoId === r.id).map((t): Item => ({
        id: t.task_id, title: t.title, state: t.state, repoId: r.id, demo: false,
        born: Date.parse(t.created_at) || now, bloom: Date.parse(t.updated_at) || now,
      })),
    }))
  }, [repos, tasks, now])
  const demo = !repos.length && !loading

  return (
    <div className="page gd-page" style={winH}>
      <Film beds={beds} demo={demo} now={now} />
      <Harvest beds={beds} demo={demo} name={(user?.displayName || '').split(' ')[0]} />
    </div>
  )
}

function demoBeds(now: number): Bed[] {
  const day = 86_400_000
  const mk = (repo: string, n: number, mix: TaskState[]) => Array.from({ length: n }, (_, k): Item => {
    const born = now - (40 - k * (36 / n)) * day
    return { id: `${repo}-${k + 1}`, title: `Sample issue ${k + 1}`, state: mix[k % mix.length], born, bloom: born + 2 * day, repoId: repo, demo: true }
  })
  return [
    { id: 'web', name: 'your-app', items: mk('web', 11, ['Merged', 'Approved', 'Merged', 'In Progress', 'Merged', 'New Issue', 'Rejected', 'Merged', 'In Review', 'Needs Human', 'New Issue']) },
    { id: 'api', name: 'api', items: mk('api', 8, ['Merged', 'Merged', 'Triaged', 'Approved', 'New Issue', 'Merged', 'Awaiting Tests', 'Merged']) },
    { id: 'docs', name: 'docs', items: mk('docs', 5, ['Merged', 'In Progress', 'Merged', 'New Issue', 'Closed']) },
  ]
}

/* ------------------------------------------------------------------ part one: the film */

const CAPTIONS = [
  { k: 'Plant', t: 'Every repo is a seed.', b: 'Each repository you watch grows as one plant. Scroll, and time starts running from your very first issue.' },
  { k: 'Bugs', t: 'Issues crawl in at the roots.', b: 'A new issue is a bug in the soil. The triager reads it and decides who takes it.' },
  { k: 'Buds', t: 'The agents get to work.', b: 'While a fix is written, tested and reviewed it waits on the stem as a bud, in the colour of one of the crew.' },
  { k: 'Bloom', t: 'Every fix blooms.', b: 'Approved, merged or closed: the bud opens. Rejected tries droop. The flower at the top is the newest.' },
  { k: 'Flags', t: 'Some things wait for you.', b: 'A red flag in the soil means the agents stopped and need a person to decide.' },
  { k: 'Today', t: 'Your garden, today.', b: 'Every day so far, grown in a few seconds. Keep scrolling for the harvest: what the crew brought in.' },
]

function Film({ beds, demo, now }: { beds: Bed[]; demo: boolean; now: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const cam = useRef<SVGGElement>(null)
  const stageEl = useRef<HTMLDivElement>(null)
  const view = useView(stageEl)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 })
  const flowers = useRef<Spot[]>([])
  const [step, setStep] = useState(0)
  const [cap, setCap] = useState(0)
  const [sky, setSky] = useState<Sky>('day')

  const all = useMemo(() => beds.flatMap((b) => b.items), [beds])
  const t0 = all.length ? Math.min(...all.map((i) => i.born)) - 86_400_000 : now - 7 * 86_400_000
  // time runs from 8% to 84% of the film; before that the seeds sit, after it it's today
  const grow = useTransform(p, [0.08, 0.84], [0, 1], { clamp: true })
  const phase = useTransform(p, (v) => (v * DAYS + 0.12) % 1)
  const hint = useTransform(p, [0, 0.05], [1, 0])
  const xs = plantXs(beds.length)

  const frame = (v: number) => {
    setStep(Math.round(grow.get() * STEPS))
    setCap(Math.min(CAPTIONS.length - 1, Math.floor(v * CAPTIONS.length * 0.999)))
    const ph = phase.get()
    setSky(ph < 0.46 ? 'day' : ph < 0.57 ? 'dusk' : ph < 0.95 ? 'night' : 'dusk')
    // the camera: close on the first seed, pulling back to the whole garden
    const z = Math.max(0, Math.min(1, (v - 0.04) / 0.72)), e = 1 - (1 - z) ** 3
    const s = 2.6 - 1.6 * e
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2
    const fx = xs[0] + (cx - xs[0]) * e, fy = GROUND - 40 + (cy - (GROUND - 40)) * e
    cam.current?.setAttribute('transform', `translate(${cx} ${cy}) scale(${s}) translate(${-fx} ${-fy})`)
  }
  useMotionValueEvent(p, 'change', frame)
  useEffect(() => { frame(p.get()) }) // eslint-disable-line react-hooks/exhaustive-deps

  const T = step >= STEPS ? Infinity : t0 + (step / STEPS) * (now - t0)
  const c = CAPTIONS[cap]

  return (
    <section ref={ref} className="gd-film">
      <div className="gd-film-pin">
        <div ref={stageEl} className={`gd-stage is-${sky}`}>
          <svg viewBox={box(view)} className="gd-svg" preserveAspectRatio="xMidYMax slice">
            <MovingSky phase={phase} />
            <g ref={cam}>
              <Hills />
              <Soil />
              {beds.map((b, k) => <Plant key={b.id} bed={b} x={xs[k]} T={T} index={k} total={beds.length} flowers={flowers} bugs />)}
              <Bees flowers={flowers} />
              {sky === 'night' && <Fireflies />}
            </g>
          </svg>
          <div className="gd-title">
            <h1>The Garden</h1>
            <Link to="/app/fun" className="btn btn-line btn-sm fun-back">← Just for fun</Link>
          </div>
          <motion.div className="gd-clock" initial={false} animate={{ opacity: step > 0 ? 1 : 0, y: step > 0 ? 0 : -8 }}>
            <span>{step >= STEPS ? 'Today' : 'Growing'}</span>
            <b>{new Date(Math.min(T, now)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</b>
            <i style={{ width: `${(step / STEPS) * 100}%` }} />
          </motion.div>
          {demo && <div className="gd-demo">A sample garden. <Link to="/app/repos">Add a repo</Link> and yours grows here.</div>}
          <AnimatePresence mode="wait">
            <motion.div key={cap} className="gd-caption" initial={{ opacity: 0, y: 24, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.45, ease: easeOut }}>
              <span className="gd-caption-k">{String(cap + 1).padStart(2, '0')} · {c.k}</span>
              <b>{c.t}</b>
              <p>{c.b}</p>
            </motion.div>
          </AnimatePresence>
          <motion.div className="gd-scrollhint" style={{ opacity: hint }} aria-hidden="true"><span>Scroll to grow</span><i /></motion.div>
          <div className="gd-dots" aria-hidden="true">{CAPTIONS.map((_, k) => <i key={k} className={k === cap ? 'on' : ''} />)}</div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ part two: the harvest */

const HARVEST = [
  { k: 'Crew', t: (n: string) => (n ? `${n}, meet your crew.` : 'Meet your crew.'), b: 'Four agents looked after this garden. Here is how much each one carried.' },
  { k: 'Harvest', t: () => 'The harvest is in.', b: 'Every fix that was approved, merged or closed drops into the basket.' },
  { k: 'Beds', t: () => 'Seed packets, one per repo.', b: 'What each repository grew: blooms that shipped, buds still on the stem.' },
  { k: 'Today', t: () => 'And the sun comes up again.', b: '' },
]
const CREW: Record<(typeof ROLES)[number], { name: string; did: string; of: TaskState[] }> = {
  triager: { name: 'Triager', did: 'issues read', of: ['Triaged', 'In Progress', 'Awaiting Tests', 'In Review', 'Approved', 'Merged', 'Closed', 'Rejected', 'Needs Human'] },
  coder: { name: 'Coder', did: 'fixes written', of: ['In Progress', 'Awaiting Tests', 'In Review', 'Approved', 'Merged', 'Closed', 'Rejected'] },
  tester: { name: 'Tester', did: 'fixes tested', of: ['Awaiting Tests', 'In Review', 'Approved', 'Merged', 'Closed', 'Rejected'] },
  reviewer: { name: 'Reviewer', did: 'reviews done', of: ['Approved', 'Merged', 'Closed', 'Rejected'] },
}
const BASKET = { x: W / 2, y: GROUND - 6 }

function Harvest({ beds, name, demo }: { beds: Bed[]; name: string; demo: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const stageEl = useRef<HTMLDivElement>(null)
  const view = useView(stageEl)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 })
  const [cap, setCap] = useState(0)
  useMotionValueEvent(p, 'change', (v) => setCap(Math.min(HARVEST.length - 1, Math.floor(v * HARVEST.length * 0.999))))

  const all = useMemo(() => beds.flatMap((b) => b.items), [beds])
  const blooms = all.filter((i) => BLOOM.includes(i.state))
  const waiting = all.filter((i) => i.state === 'Needs Human')
  const dusk = useTransform(p, [0.3, 0.6, 0.75], [0, 1, 0])
  const night = useTransform(p, [0.45, 0.62, 0.72, 0.8], [0, 1, 1, 0])
  const sunY = useTransform(p, [0.74, 0.95], [620, 150])
  const hint = useTransform(p, [0, 0.04], [1, 0])
  const c = HARVEST[cap]
  const today = waiting.length
    ? `${waiting.length} ${waiting.length === 1 ? 'thing waits' : 'things wait'} for you, flagged in the soil. The rest of the garden is looking after itself.`
    : 'Nothing is waiting for you. The crew has it; go enjoy the sun.'

  return (
    <section ref={ref} className="gd-harvest">
      <div className="gd-film-pin">
        <div ref={stageEl} className="gd-stage">
          <svg viewBox={box(view)} className="gd-svg" preserveAspectRatio="xMidYMax slice">
            <Gradients />
            <rect {...SKYBOX} fill="url(#gd-day)" />
            <motion.rect {...SKYBOX} fill="url(#gd-dusk)" style={{ opacity: dusk }} />
            <motion.rect {...SKYBOX} fill="url(#gd-night)" style={{ opacity: night }} />
            <motion.g style={{ opacity: night }}>{STARS.map(([x, y, r], k) => <circle key={k} cx={x} cy={y} r={r} fill="#fff" className="gd-star" style={{ animationDelay: `${(k % 7) * 0.4}s` }} />)}</motion.g>
            <motion.g style={{ x: 780, y: sunY }}><Sun /></motion.g>
            <Clouds tone="#fff" />
            <Hills />
            <Soil />
            {ROLES.map((r, k) => <CrewBee key={r} p={p} k={k} role={r} count={all.filter((i) => CREW[r].of.includes(i.state)).length} />)}
            <Basket p={p} total={blooms.length} />
            {blooms.slice(-24).map((f, k, list) => <Falling key={f.id} p={p} k={k} n={list.length} id={f.id} />)}
            {beds.slice(0, 6).map((b, k, list) => <Packet key={b.id} p={p} k={k} n={list.length} bed={b} />)}
            {waiting.slice(0, 6).map((w, k, list) => <HarvestFlag key={w.id} p={p} k={k} n={list.length} />)}
          </svg>
          <div className="gd-title">
            <h1>The harvest</h1>
          </div>
          {demo && <div className="gd-demo">A sample garden. <Link to="/app/repos">Add a repo</Link> and yours grows here.</div>}
          <AnimatePresence mode="wait">
            <motion.div key={cap} className="gd-caption" initial={{ opacity: 0, y: 24, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.45, ease: easeOut }}>
              <span className="gd-caption-k">{String(cap + 1).padStart(2, '0')} · {c.k}</span>
              <b>{c.t(name)}</b>
              <p>{c.b || today}</p>
              {cap === HARVEST.length - 1 && (
                <div className="gd-caption-go">
                  <Link to="/app" className="btn btn-dark btn-sm">{waiting.length ? 'See what needs you' : 'Back to the overview'}</Link>
                  <Link to="/app/fun" className="btn btn-line btn-sm">Just for fun</Link>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          <motion.div className="gd-scrollhint" style={{ opacity: hint }} aria-hidden="true"><span>Keep scrolling</span><i /></motion.div>
          <div className="gd-dots" aria-hidden="true">{HARVEST.map((_, k) => <i key={k} className={k === cap ? 'on' : ''} />)}</div>
        </div>
      </div>
    </section>
  )
}

/** One of the crew: flies in from a corner, lands on its spot and counts up what it did, then buzzes off. */
function CrewBee({ p, k, role, count }: { p: MotionValue<number>; k: number; role: (typeof ROLES)[number]; count: number }) {
  const from = [{ x: -120, y: -80 }, { x: W + 120, y: -60 }, { x: -120, y: 300 }, { x: W + 120, y: 320 }][k]
  const to = { x: 200 + k * 200, y: 250 + (k % 2) * 40 }
  const s = 0.01 + k * 0.02
  const x = useTransform(p, [s, s + 0.06, 0.22, 0.27], [from.x, to.x, to.x, to.x + (k < 2 ? -1 : 1) * 700])
  const y = useTransform(p, [s, s + 0.06, 0.22, 0.27], [from.y, to.y, to.y, to.y - 260])
  const n = useTransform(p, [s + 0.05, s + 0.11], [0, count], { clamp: true })
  const shown = useTransform(n, (v) => String(Math.round(v)))
  const tag = useTransform(p, [s + 0.04, s + 0.06, 0.21, 0.23], [0, 1, 1, 0])
  const c = CREW[role]
  return (
    <motion.g style={{ x, y }}>
      <g className="gd-hover" style={{ animationDelay: `${-k * 0.4}s` }}>
        <g transform="scale(2.2)">
          <ellipse className="gd-wing" cx="-3" cy="-10" rx="6" ry="9" fill="#fff" fillOpacity=".85" stroke="#0f0f0f" strokeWidth="1.4" />
          <ellipse className="gd-wing gd-wing--b" cx="5" cy="-10" rx="5" ry="8" fill="#fff" fillOpacity=".85" stroke="#0f0f0f" strokeWidth="1.4" />
          <ellipse cx="0" cy="0" rx="13" ry="10" fill={`var(--${role})`} stroke="#0f0f0f" strokeWidth="1.8" />
          <path d="M-4 -9.5v19M3 -9.5v19" stroke="#0f0f0f" strokeWidth="2.2" />
          <circle cx="8" cy="-2" r="1.6" fill="#0f0f0f" />
          <path d="M-13 0l-5 0" stroke="#0f0f0f" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </g>
      <motion.g style={{ opacity: tag }}>
        <rect x="-62" y="38" width="124" height="66" rx="14" fill="#0f0f0f" transform="translate(4 4)" />
        <rect x="-62" y="38" width="124" height="66" rx="14" fill="#fff" stroke="#0f0f0f" strokeWidth="2.5" />
        <motion.text x="0" y="78" textAnchor="middle" className="gd-count">{shown}</motion.text>
        <text x="0" y="96" textAnchor="middle" className="gd-count-l">{c.did}</text>
        <text x="0" y="56" textAnchor="middle" className="gd-count-l gd-count-n">{c.name}</text>
      </motion.g>
    </motion.g>
  )
}

function Basket({ p, total }: { p: MotionValue<number>; total: number }) {
  const y = useTransform(p, [0.24, 0.3, 0.48, 0.53], [260, 0, 0, 260])
  const n = useTransform(p, [0.28, 0.46], [0, total], { clamp: true })
  const shown = useTransform(n, (v) => `${Math.round(v)} ${Math.round(v) === 1 ? 'bloom' : 'blooms'}`)
  return (
    <motion.g style={{ y }}>
      <g transform={`translate(${BASKET.x} ${BASKET.y})`}>
        <path d="M-120 -70 Q 0 -190 120 -70" fill="none" stroke="#0f0f0f" strokeWidth="14" strokeLinecap="round" />
        <path d="M-120 -70 Q 0 -190 120 -70" fill="none" stroke="#d9a35f" strokeWidth="8" strokeLinecap="round" />
        <path d="M-135 -72 L 135 -72 L 105 20 L -105 20 Z" fill="#0f0f0f" transform="translate(5 5)" />
        <path d="M-135 -72 L 135 -72 L 105 20 L -105 20 Z" fill="#e6b574" stroke="#0f0f0f" strokeWidth="3" strokeLinejoin="round" />
        {[-40, -10, 20].map((yy) => <path key={yy} d={`M${-128 + (yy + 72) * 0.3} ${yy} L ${128 - (yy + 72) * 0.3} ${yy}`} stroke="#b9854a" strokeWidth="3" />)}
        {[-90, -45, 0, 45, 90].map((xx) => <path key={xx} d={`M${xx * 1.05} -72 L ${xx * 0.8} 20`} stroke="#b9854a" strokeWidth="3" />)}
        <rect x="-150" y="-80" width="300" height="16" rx="8" fill="#d9a35f" stroke="#0f0f0f" strokeWidth="3" />
        <rect x="-78" y="-28" width="156" height="36" rx="18" fill="#fff" stroke="#0f0f0f" strokeWidth="2.5" />
        <motion.text x="0" y="-4" textAnchor="middle" className="gd-count gd-count--sm">{shown}</motion.text>
      </g>
    </motion.g>
  )
}

/** A bloom dropping into the basket, spinning as it falls, at its own moment in the scroll. */
function Falling({ p, k, n, id }: { p: MotionValue<number>; k: number; n: number; id: string }) {
  const s = 0.28 + (k / Math.max(1, n)) * 0.16
  const dx = (hash(id) - 0.5) * 180
  const x = useTransform(p, [s, s + 0.04], [BASKET.x + dx * 1.8, BASKET.x + dx], { clamp: true })
  const y = useTransform(p, [s, s + 0.04, 0.48, 0.53], [-80, BASKET.y - 92 - (k % 3) * 10, BASKET.y - 92 - (k % 3) * 10, BASKET.y + 170])
  const rotate = useTransform(p, [s, s + 0.04], [-200, 0], { clamp: true })
  const opacity = useTransform(p, [s - 0.005, s], [0, 1])
  return (
    <motion.g style={{ x, y, rotate, opacity }}>
      <Petals id={id} />
    </motion.g>
  )
}

function Petals({ id, r = 13 }: { id: string; r?: number }) {
  const role = ROLES[Math.floor(hash(id + 'c') * 4)]
  const petals = 5 + Math.floor(hash(id + 'p') * 3)
  return (
    <g>
      {Array.from({ length: petals }, (_, k) => {
        const a = (k / petals) * Math.PI * 2, px = Math.cos(a) * r, py = Math.sin(a) * r
        return <ellipse key={k} cx={px} cy={py} rx={r * 0.75} ry={r * 0.55} transform={`rotate(${(a * 180) / Math.PI} ${px} ${py})`} fill={`var(--${role})`} stroke="#0f0f0f" strokeWidth="2.2" />
      })}
      <circle r={r * 0.62} fill="#ffd85a" stroke="#0f0f0f" strokeWidth="2.2" />
    </g>
  )
}

/** A seed packet for one repository, flipping up out of the soil into a fan. */
function Packet({ p, k, n, bed }: { p: MotionValue<number>; k: number; n: number; bed: Bed }) {
  const mid = (n - 1) / 2
  const gap = Math.min(150, 760 / Math.max(1, n))
  const tx = W / 2 + (k - mid) * gap
  const s = 0.52 + (k / Math.max(1, n)) * 0.08
  const y = useTransform(p, [s, s + 0.05, 0.72, 0.77], [700, 250 + Math.abs(k - mid) * 14, 250 + Math.abs(k - mid) * 14, 720])
  const rotate = useTransform(p, [s, s + 0.05], [(k - mid) * 30 + 40, (k - mid) * 5], { clamp: true })
  const flip = useTransform(p, [s + 0.02, s + 0.06], [0, 1], { clamp: true })
  const scaleX = useTransform(flip, (v) => Math.abs(Math.cos(v * Math.PI)) * 0.98 + 0.02)
  const front = useTransform(flip, (v) => (v > 0.5 ? 1 : 0))
  const back = useTransform(flip, (v) => (v > 0.5 ? 0 : 1))
  const bl = bed.items.filter((i) => BLOOM.includes(i.state)).length
  const bu = bed.items.filter((i) => BUD.includes(i.state)).length
  const role = ROLES[k % 4]
  const label = bed.name.length > 13 ? bed.name.slice(0, 12) + '…' : bed.name
  return (
    <motion.g style={{ x: tx, y, rotate }}>
      <motion.g style={{ scaleX }}>
        <rect x="-62" y="-90" width="124" height="180" rx="12" fill="#0f0f0f" transform="translate(5 5)" />
        <motion.g style={{ opacity: back }}>
          <rect x="-62" y="-90" width="124" height="180" rx="12" fill="#f4e3c1" stroke="#0f0f0f" strokeWidth="2.5" />
          <path d="M-62 -60 h124" stroke="#0f0f0f" strokeWidth="2" strokeDasharray="6 5" />
          <circle cx="0" cy="10" r="26" fill={`var(--${role})`} stroke="#0f0f0f" strokeWidth="2.5" />
        </motion.g>
        <motion.g style={{ opacity: front }}>
          <rect x="-62" y="-90" width="124" height="180" rx="12" fill="#fff" stroke="#0f0f0f" strokeWidth="2.5" />
          <rect x="-62" y="-90" width="124" height="70" rx="12" fill={`var(--${role})`} stroke="#0f0f0f" strokeWidth="2.5" />
          <g transform="translate(0 -55)"><Petals id={bed.id} r={11} /></g>
          <text x="0" y="-2" textAnchor="middle" className="gd-count-l gd-count-n">{label}</text>
          <text x="0" y="38" textAnchor="middle" className="gd-count">{bl}</text>
          <text x="0" y="54" textAnchor="middle" className="gd-count-l">{bl === 1 ? 'bloom' : 'blooms'}</text>
          <text x="0" y="76" textAnchor="middle" className="gd-count-l">{bu} {bu === 1 ? 'bud' : 'buds'} growing</text>
        </motion.g>
      </motion.g>
    </motion.g>
  )
}

function HarvestFlag({ p, k, n }: { p: MotionValue<number>; k: number; n: number }) {
  const s = 0.8 + (k / Math.max(1, n)) * 0.06
  const y = useTransform(p, [s, s + 0.03], [60, 0], { clamp: true })
  const opacity = useTransform(p, [s, s + 0.02], [0, 1], { clamp: true })
  return <motion.g style={{ y, opacity }}><Flag x={W / 2 - ((n - 1) / 2) * 60 + k * 60} y={GROUND + 4} /></motion.g>
}

/* ------------------------------------------------------------------ one plant per repo */

function Plant({ bed, x, T, index, total, flowers, eaten, onItem, bugs }: {
  bed: Bed; x: number; T: number; index: number; total: number; flowers: RefObject<Spot[]>
  eaten?: Set<string>; onItem?: (e: ReactMouseEvent, i: Item, bed: string) => void; bugs?: boolean
}) {
  const slots = bed.items.filter((i) => kindOf(i.state)).sort((a, b) => a.born - b.born).slice(-MAX_SLOTS)
  const crawlers = bugs ? bed.items.filter((i) => i.state === 'New Issue').slice(-5) : []
  const flags = bed.items.filter((i) => i.state === 'Needs Human').slice(-3)
  const n = Math.max(slots.length, 1)
  const height = Math.min(300, 110 + n * 15)
  const lean = (hash(bed.id) - 0.5) * 60
  const top = { x: x + lean, y: GROUND - height }
  const c1 = { x: x - lean * 0.9, y: GROUND - height * 0.45 }
  const at = (u: number) => ({ x: (1 - u) ** 2 * x + 2 * (1 - u) * u * c1.x + u * u * top.x, y: (1 - u) ** 2 * GROUND + 2 * (1 - u) * u * c1.y + u * u * top.y })
  const shown = slots.filter((s) => s.born <= T)
  const grown = slots.length ? shown.length / slots.length : T === Infinity ? 1 : 0
  const nameW = Math.min(150, bed.name.length * 7.4 + 20)

  const pts = slots.map((s, k) => {
    const u = n === 1 ? 1 : 0.28 + (0.72 * (k + 1)) / n
    const p = at(u), side = k === n - 1 ? 0 : k % 2 ? 1 : -1
    return { s, p, side, end: { x: p.x + side * (30 + hash(s.id) * 16), y: p.y - 12 - hash(s.id + 'y') * 10 } }
  })
  // tell the bees (and the bugs) where the open flowers are
  useEffect(() => {
    const list = flowers.current!
    const mine = new Set(slots.map((s) => s.id))
    for (let i = list.length - 1; i >= 0; i--) if (mine.has(list[i].id)) list.splice(i, 1)
    list.push(...pts.filter((q) => q.s.born <= T && kindOf(q.s.state) !== 'wilt' && !eaten?.has(q.s.id)).map((q) => ({ ...q.end, id: q.s.id })))
  })

  return (
    <g>
      <g className="gd-plant" style={{ animationDelay: `${-index * 0.7}s`, animationDuration: `${4.5 + hash(bed.id) * 2}s` }}>
        <motion.path d={`M${x} ${GROUND} Q ${c1.x} ${c1.y} ${top.x} ${top.y}`} fill="none" stroke="#0f0f0f" strokeWidth="11" strokeLinecap="round"
          initial={false} animate={{ pathLength: Math.max(0.05, grown) }} transition={{ type: 'spring', stiffness: 60, damping: 16 }} />
        <motion.path d={`M${x} ${GROUND} Q ${c1.x} ${c1.y} ${top.x} ${top.y}`} fill="none" stroke="#5dd36a" strokeWidth="6" strokeLinecap="round"
          initial={false} animate={{ pathLength: Math.max(0.05, grown) }} transition={{ type: 'spring', stiffness: 60, damping: 16 }} />
        {!slots.length && grown > 0.5 && (
          <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.3 }}>
            <Leaf x={top.x} y={top.y + 4} flip={-1} k={0} /><Leaf x={top.x} y={top.y + 4} flip={1} k={1} />
          </motion.g>
        )}
        {pts.map(({ s, p, side, end }, k) => {
          const kind = kindOf(s.state)!
          const open = kind === 'flower' && s.bloom <= T
          const gone = eaten?.has(s.id)
          return (
            <AnimatePresence key={s.id}>
              {s.born <= T && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {side !== 0 && <motion.path d={`M${p.x} ${p.y} Q ${(p.x + end.x) / 2} ${p.y + 4} ${end.x} ${end.y}`} fill="none" stroke="#0f0f0f" strokeWidth="4.5" strokeLinecap="round"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: easeOut }} />}
                  {side !== 0 && <Leaf x={(p.x + end.x) / 2} y={p.y + 2} flip={side} k={k} />}
                  <g className={onItem ? 'gd-hit' : undefined} onClick={onItem && ((e) => onItem(e, s, bed.name))} role={onItem ? 'button' : undefined} aria-label={onItem ? `${s.id}: ${s.title} (${s.state})` : undefined}>
                    <circle cx={end.x} cy={end.y} r="20" fill="transparent" />
                    {kind === 'wilt' || gone ? <Wilt key="w" x={end.x} y={end.y} /> : open ? <Flower key="f" x={end.x} y={end.y} id={s.id} big={k === n - 1} /> : <Bud key="b" x={end.x} y={end.y} id={s.id} />}
                  </g>
                </motion.g>
              )}
            </AnimatePresence>
          )
        })}
      </g>
      <g transform={`translate(${x - nameW / 2 + (index === 0 && total > 1 ? 20 : 0)} ${GROUND + 18})`} className="gd-sign">
        <rect x="2" y="3" width={nameW} height="24" rx="6" fill="#0f0f0f" />
        <rect width={nameW} height="24" rx="6" fill="#f4e3c1" stroke="#0f0f0f" strokeWidth="2.5" />
        <text x={nameW / 2} y="16.5" textAnchor="middle">{bed.name.length > 18 ? bed.name.slice(0, 17) + '…' : bed.name}</text>
      </g>
      {flags.filter((f) => f.born <= T).map((f, k) => (
        <motion.g key={f.id} className={onItem ? 'gd-hit' : undefined} onClick={onItem && ((e) => onItem(e, f, bed.name))} role={onItem ? 'button' : undefined} aria-label={onItem ? `${f.id} needs you: ${f.title}` : undefined}
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>
          <Flag x={x + 46 + k * 22} y={GROUND + 2} />
        </motion.g>
      ))}
      <AnimatePresence>
        {crawlers.filter((b) => b.born <= T).map((b, k) => <Crawler key={b.id} id={b.id} x={x - 60 - k * 26 + hash(b.id) * 20} />)}
      </AnimatePresence>
    </g>
  )
}

function Flower({ x, y, id, big }: { x: number; y: number; id: string; big: boolean }) {
  const role = ROLES[Math.floor(hash(id + 'c') * 4)]
  const petals = 5 + Math.floor(hash(id + 'p') * 3)
  const r = big ? 11 : 8
  return (
    <motion.g initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 11 }}>
      <g className="gd-spin" style={{ transformOrigin: `${x}px ${y}px`, animationDuration: `${14 + hash(id) * 10}s` }}>
        {Array.from({ length: petals }, (_, k) => {
          const a = (k / petals) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r
          return <ellipse key={k} cx={px} cy={py} rx={r * 0.75} ry={r * 0.55} transform={`rotate(${(a * 180) / Math.PI} ${px} ${py})`} fill={`var(--${role})`} stroke="#0f0f0f" strokeWidth="2.2" />
        })}
      </g>
      <circle cx={x} cy={y} r={r * 0.62} fill="#ffd85a" stroke="#0f0f0f" strokeWidth="2.2" />
      {big && <><circle cx={x - 2.6} cy={y - 1} r="1.3" fill="#0f0f0f" /><circle cx={x + 2.6} cy={y - 1} r="1.3" fill="#0f0f0f" /></>}
    </motion.g>
  )
}

function Bud({ x, y, id }: { x: number; y: number; id: string }) {
  const role = ROLES[Math.floor(hash(id + 'c') * 4)]
  return (
    <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
      <g className="gd-bud">
        <path d={`M${x} ${y - 13} C ${x + 9} ${y - 6}, ${x + 8} ${y + 6}, ${x} ${y + 7} C ${x - 8} ${y + 6}, ${x - 9} ${y - 6}, ${x} ${y - 13}z`} fill={`var(--${role})`} stroke="#0f0f0f" strokeWidth="2.2" />
        <path d={`M${x - 7} ${y + 1} Q ${x} ${y + 12} ${x + 7} ${y + 1} L ${x + 5} ${y + 8} Q ${x} ${y + 11} ${x - 5} ${y + 8}z`} fill="#5dd36a" stroke="#0f0f0f" strokeWidth="2" />
      </g>
    </motion.g>
  )
}

function Wilt({ x, y }: { x: number; y: number }) {
  return (
    <motion.g initial={{ scale: 0, rotate: 40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 12 }}>
      <path d={`M${x - 3} ${y - 6} q 10 -2 12 10 q -2 8 -8 10 q 2 -8 -4 -20z`} fill="#c9a36b" stroke="#0f0f0f" strokeWidth="2" />
      <circle cx={x - 3} cy={y - 6} r="3.5" fill="#a88452" stroke="#0f0f0f" strokeWidth="2" />
    </motion.g>
  )
}

function Leaf({ x, y, flip, k }: { x: number; y: number; flip: number; k: number }) {
  return (
    <motion.path d={`M${x} ${y} q ${flip * 6} ${-14} ${flip * 18} ${-10} q ${-flip * 4} ${10} ${-flip * 18} ${10}z`} fill="#8be08f" stroke="#0f0f0f" strokeWidth="2"
      initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 12, delay: 0.2 + (k % 3) * 0.05 }} />
  )
}

function Flag({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 40} stroke="#0f0f0f" strokeWidth="3" strokeLinecap="round" />
      <path className="gd-flag" d={`M${x} ${y - 40} l 22 6 l -22 7z`} fill="var(--tester)" stroke="#0f0f0f" strokeWidth="2.2" strokeLinejoin="round" style={{ transformOrigin: `${x}px ${y - 34}px` }} />
      <text x={x + 7} y={y - 30.5} fontSize="9" fontWeight="900" fill="#0f0f0f">!</text>
    </g>
  )
}

function BugBody() {
  return (
    <>
      <g className="gd-legs"><path d="M-6 -2l-6 -4M-6 2l-7 1M-5 5l-5 5M6 -2l6 -4M6 2l7 1M5 5l5 5" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" /></g>
      <ellipse rx="9" ry="7" fill="#0f0f0f" />
      <path d="M0 -7v14" stroke="#ff8a7a" strokeWidth="1.5" />
      <circle cx="8" cy="-3" r="4.5" fill="#0f0f0f" />
      <circle cx="9.5" cy="-4" r="1.4" fill="#fff" />
    </>
  )
}

function Crawler({ id, x }: { id: string; x: number }) {
  const span = 20 + hash(id) * 30
  return (
    <motion.g initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0 }}>
      <motion.g animate={{ x: [0, span, span, 0, 0], scaleX: [1, 1, -1, -1, 1] }} transition={{ repeat: Infinity, duration: 5 + hash(id + 'd') * 4, times: [0, 0.45, 0.5, 0.95, 1], ease: 'easeInOut' }}>
        <g transform={`translate(${x} ${GROUND + 6})`}><BugBody /></g>
      </motion.g>
    </motion.g>
  )
}

/* ------------------------------------------------------------------ the bees */

type Where = () => { x: number; y: number } | null
type BeeApi = { fetch: (job: number, where: Where) => void }
type BeeState = { x: number; y: number; vx: number; vy: number; tx: number; ty: number; rest: number; job: number | null; where: Where | null; carry: boolean; face: number }

function Bees({ api, flowers, onCaught }: { api?: RefObject<BeeApi | null>; flowers: RefObject<Spot[]>; onCaught?: (job: number) => void }) {
  const els = useRef<(SVGGElement | null)[]>([])
  const caught = useRef(onCaught)
  useEffect(() => { caught.current = onCaught }, [onCaught])

  useEffect(() => {
    const bees: BeeState[] = ROLES.map((_, k) => ({ x: 120 + k * 240, y: 120 + (k % 2) * 60, vx: 0, vy: 0, tx: 500, ty: 200, rest: 0, job: null, where: null, carry: false, face: 1 }))
    const pick = (b: BeeState) => {
      const list = flowers.current!
      if (list.length && Math.random() < 0.8) { const f = list[Math.floor(Math.random() * list.length)]; b.tx = f.x; b.ty = f.y - 12 }
      else { b.tx = 80 + Math.random() * 840; b.ty = 80 + Math.random() * 220 }
    }
    bees.forEach(pick)
    const handle: BeeApi = {
      fetch: (job, where) => {
        if (bees.some((b) => b.job === job)) return
        const at = where()
        if (!at) return
        const free = bees.filter((b) => b.job === null && !b.carry)
        if (!free.length) return
        const b = free.reduce((a, c) => (Math.hypot(c.x - at.x, c.y - at.y) < Math.hypot(a.x - at.x, a.y - at.y) ? c : a))
        b.job = job; b.where = where; b.rest = 0
      },
    }
    if (api) api.current = handle
    let raf = 0, last = performance.now()
    const still = calm()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      bees.forEach((b, k) => {
        if (b.where) {
          const at = b.where()
          if (!at) { b.job = null; b.where = null; pick(b) } else { b.tx = at.x; b.ty = at.y - 4 }
        }
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy)
        const speed = b.where ? 700 : b.carry ? 520 : 170
        if (b.where && d > 14) {
          // on a job: fly straight in, no drifting round it
          const step = Math.min(d, speed * dt)
          b.x += (dx / d) * step; b.y += (dy / d) * step
          b.vx = b.vy = 0; b.face = dx < 0 ? -1 : 1
        } else if (!b.where && d > 6) {
          b.vx += (dx / d) * speed * 5 * dt; b.vy += (dy / d) * speed * 5 * dt
        } else if (b.where && b.job !== null) {
          caught.current?.(b.job)
          b.job = null; b.where = null; b.carry = true
          b.tx = b.x < W / 2 ? -80 : W + 80; b.ty = -60
        } else if (b.carry) {
          b.carry = false; b.x = Math.random() < 0.5 ? -40 : W + 40; b.y = 60 + Math.random() * 150; b.vx = b.vy = 0; pick(b)
        } else if ((b.rest += dt) > 1.2 + (k % 3) * 0.6) { b.rest = 0; pick(b) }
        const sp = Math.hypot(b.vx, b.vy)
        if (sp > speed) { b.vx *= speed / sp; b.vy *= speed / sp }
        b.vx *= 0.92; b.vy *= 0.92
        b.x += b.vx * dt; b.y += b.vy * dt
        if (Math.abs(b.vx) > 4) b.face = b.vx < 0 ? -1 : 1
        const bob = still ? 0 : Math.sin(now / 180 + k) * 3
        const el = els.current[k]
        if (el) {
          el.setAttribute('transform', `translate(${b.x.toFixed(1)} ${(b.y + bob).toFixed(1)}) scale(${b.face} 1)`)
          el.dataset.carry = b.carry ? '1' : ''
        }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [api, flowers])

  return (
    <g>
      {ROLES.map((r, k) => (
        <g key={r} ref={(el) => { els.current[k] = el }} className="gd-bee" aria-hidden="true" transform="translate(-100 -100)">
          <g className="gd-carry"><g transform="translate(0 17)"><BugBody /></g></g>
          <ellipse className="gd-wing" cx="-3" cy="-10" rx="6" ry="9" fill="#fff" fillOpacity=".85" stroke="#0f0f0f" strokeWidth="1.8" />
          <ellipse className="gd-wing gd-wing--b" cx="5" cy="-10" rx="5" ry="8" fill="#fff" fillOpacity=".85" stroke="#0f0f0f" strokeWidth="1.8" />
          <ellipse cx="0" cy="0" rx="13" ry="10" fill={`var(--${r})`} stroke="#0f0f0f" strokeWidth="2.2" />
          <path d="M-4 -9.5v19M3 -9.5v19" stroke="#0f0f0f" strokeWidth="2.6" />
          <circle cx="8" cy="-2" r="1.8" fill="#0f0f0f" />
          <path d="M-13 0l-5 0" stroke="#0f0f0f" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ))}
    </g>
  )
}

/* ------------------------------------------------------------------ sky, hills, soil */

function Gradients() {
  return (
    <defs>
      <linearGradient id="gd-day" gradientUnits="userSpaceOnUse" x1="0" y1="-160" x2="0" y2={GROUND}><stop offset="0" stopColor="#7cc6ff" /><stop offset="1" stopColor="#dff2ff" /></linearGradient>
      <linearGradient id="gd-dusk" gradientUnits="userSpaceOnUse" x1="0" y1="-160" x2="0" y2={GROUND}><stop offset="0" stopColor="#6d4fa0" /><stop offset=".55" stopColor="#ff8f7a" /><stop offset="1" stopColor="#ffd59a" /></linearGradient>
      <linearGradient id="gd-night" gradientUnits="userSpaceOnUse" x1="0" y1="-160" x2="0" y2={GROUND}><stop offset="0" stopColor="#0f1433" /><stop offset="1" stopColor="#2c2a66" /></linearGradient>
      <radialGradient id="gd-glow"><stop offset="0" stopColor="#fff7b0" /><stop offset="1" stopColor="#fff7b0" stopOpacity="0" /></radialGradient>
    </defs>
  )
}

/** The film's sky: one turn of `phase` is a whole day, dawn at 0, dusk at a half. */
function MovingSky({ phase }: { phase: MotionValue<number> }) {
  const dusk = useTransform(phase, [0, 0.07, 0.4, 0.5, 0.6, 0.92, 1], [1, 0, 0, 1, 0, 0, 1])
  const night = useTransform(phase, [0, 0.5, 0.6, 0.92, 1], [0, 0, 1, 1, 0])
  const sunX = useTransform(phase, (v) => 60 + (Math.min(v, 0.55) / 0.55) * 880)
  const sunY = useTransform(phase, (v) => 400 - Math.sin((Math.min(v, 0.55) / 0.55) * Math.PI) * 300)
  const moonX = useTransform(phase, (v) => 60 + (Math.max(0, v - 0.5) / 0.5) * 880)
  const moonY = useTransform(phase, (v) => 400 - Math.sin((Math.max(0, v - 0.5) / 0.5) * Math.PI) * 280)
  const sunO = useTransform(phase, [0, 0.02, 0.52, 0.56], [0, 1, 1, 0])
  const moonO = useTransform(phase, [0.5, 0.56, 0.96, 1], [0, 1, 1, 0])
  return (
    <>
      <Gradients />
      <rect {...SKYBOX} fill="url(#gd-day)" />
      <motion.rect {...SKYBOX} fill="url(#gd-dusk)" style={{ opacity: dusk }} />
      <motion.rect {...SKYBOX} fill="url(#gd-night)" style={{ opacity: night }} />
      <motion.g style={{ opacity: night }}>{STARS.map(([x, y, r], k) => <circle key={k} cx={x} cy={y} r={r} fill="#fff" className="gd-star" style={{ animationDelay: `${(k % 7) * 0.4}s` }} />)}</motion.g>
      <motion.g style={{ x: sunX, y: sunY, opacity: sunO }}><Sun /></motion.g>
      <motion.g style={{ x: moonX, y: moonY, opacity: moonO }}><Moon /></motion.g>
      <Clouds tone="#fff" />
    </>
  )
}

function Sun({ dusk }: { dusk?: boolean }) {
  return (
    <g>
      <circle r="90" fill="url(#gd-glow)" opacity="0.6" />
      <g className="gd-rays">{Array.from({ length: 10 }, (_, k) => <rect key={k} x="-4" y="-58" width="8" height="15" rx="4" fill="#ffd85a" stroke="#0f0f0f" strokeWidth="2.4" transform={`rotate(${k * 36})`} />)}</g>
      <circle r="34" fill={dusk ? '#ffb057' : '#ffd85a'} stroke="#0f0f0f" strokeWidth="3" />
      <circle cx="-11" cy="-4" r="3" fill="#0f0f0f" /><circle cx="11" cy="-4" r="3" fill="#0f0f0f" />
      <path d="M-10 8q10 8 20 0" fill="none" stroke="#0f0f0f" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

function Moon() {
  return (
    <g>
      <circle r="80" fill="url(#gd-glow)" opacity="0.25" />
      <circle r="34" fill="#f4f1e6" stroke="#0f0f0f" strokeWidth="3" />
      <circle cx="-10" cy="-8" r="5" fill="#dcd6c2" /><circle cx="9" cy="10" r="7" fill="#dcd6c2" />
      <path d="M-12 4q4 3 8 0M4 4q4 3 8 0" fill="none" stroke="#0f0f0f" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  )
}

function Clouds({ tone }: { tone: string }) {
  return (
    <g>
      {CLOUDS.map(([x, y, s, d], k) => (
        <g key={k} className="gd-cloud" style={{ animationDuration: `${d}s`, animationDelay: `${-k * 13}s` }}>
          <g transform={`translate(${x} ${y}) scale(${s})`}>
            <path d="M0 30a22 22 0 0138-18 30 30 0 0154 4 18 18 0 0118 30H8A16 16 0 010 30z" fill={tone} stroke="#0f0f0f" strokeWidth="3" style={{ transition: 'fill 1s' }} />
          </g>
        </g>
      ))}
    </g>
  )
}

function Hills() {
  return (
    <>
      <path d={`M-300 ${GROUND - 80} C 120 ${GROUND - 170}, 260 ${GROUND - 120}, 400 ${GROUND - 140} S 700 ${GROUND - 190}, 1300 ${GROUND - 110} V${H + 300} H-300z`} className="gd-hill gd-hill--far" />
      <path d={`M-300 ${GROUND - 30} C 160 ${GROUND - 90}, 340 ${GROUND - 40}, 520 ${GROUND - 70} S 860 ${GROUND - 100}, 1300 ${GROUND - 40} V${H + 300} H-300z`} className="gd-hill gd-hill--mid" />
    </>
  )
}

function Soil() {
  return (
    <>
      <path d={`M-300 ${GROUND} C 200 ${GROUND - 14}, 420 ${GROUND + 8}, 600 ${GROUND - 4} S 900 ${GROUND - 10}, 1300 ${GROUND} V${H + 300} H-300z`} className="gd-ground" />
      {TUFTS.map(([x, s], k) => <path key={k} d={`M${x} ${GROUND + 6}l-4 -12m4 12l1 -15m-1 15l6 -11`} stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" fill="none" transform={`scale(${s})`} style={{ transformOrigin: `${x}px ${GROUND}px` }} />)}
    </>
  )
}

function Fireflies() {
  return (
    <g>
      {Array.from({ length: 16 }, (_, k) => {
        const x = 40 + ((k * 61) % 920), y = 250 + ((k * 43) % 190)
        return (
          <motion.circle key={k} r="3.2" fill="#fff38a" className="gd-fly" initial={{ opacity: 0, x, y }}
            animate={{ x: [x, x + 30, x - 20, x], y: [y, y - 25, y - 10, y], opacity: [0, 1, 0.2, 0] }}
            transition={{ repeat: Infinity, duration: 5 + (k % 5), delay: k * 0.3, ease: 'easeInOut' }} />
        )
      })}
    </g>
  )
}

const SKYBOX = { x: -1200, y: -1600, width: 3400, height: H + 1800 }
const STARS: [number, number, number][] = Array.from({ length: 70 }, (_, k) => [((k * 97 + 31) % 1600) - 300, ((k * 53 + 17) % 760) - 500, 1 + (k % 3) * 0.6])
const CLOUDS: [number, number, number, number][] = [[80, 60, 1.1, 70], [420, 30, 0.8, 90], [700, 110, 1.3, 80], [260, 150, 0.7, 110]]
const TUFTS: [number, number][] = Array.from({ length: 22 }, (_, k) => [20 + k * 46 + (k % 3) * 9, 0.8 + (k % 4) * 0.15])
