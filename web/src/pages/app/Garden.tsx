import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { TaskState } from '../../lib/types'
import './garden.css'

/*
 * The Garden, in two parts, like the Island.
 * First a film you scroll through: your swarm's real history as a time-lapse. Every repository is a plant; the
 * camera starts down in the soil and pulls back as the days fly past (the sun and moon racing over), issues crawl
 * in as bugs, the agents' work opens as buds and every fix blooms, in the order it really happened.
 * Then the garden is yours to guard: Bug patrol. Bugs climb the stems for your flowers; click one and the
 * nearest agent-bee zips over and carries it off. Chain catches for a combo. Lose three flowers and it's over.
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
const KEY = 'swarm.garden'
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
    <div className="page gd-page">
      <Film beds={beds} demo={demo} now={now} />
      <Patrol beds={beds} demo={demo} />
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
  { k: 'Flags', t: 'Some things wait for you.', b: 'A red flag in the soil means the agents stopped and need a person. Click one below to see which.' },
  { k: 'Today', t: 'Your garden, today.', b: 'Every day so far, grown in a few seconds. Keep scrolling: the bugs are coming back, and the bees need you.' },
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

/* ------------------------------------------------------------------ part two: bug patrol */

type GBug = { on: boolean; x: number; y: number; tx: number; ty: number; target: string; speed: number; wob: number }
type Phase = 'idle' | 'play' | 'over'
type Pop = { item: Item; bed: string; x: number; y: number }
const POOL = 16

function loadBest() { try { return Number(JSON.parse(localStorage.getItem(KEY) || '{}').best) || 0 } catch { return 0 } }
function skyNow(): Sky { const h = new Date().getHours(); return h >= 7 && h < 17 ? 'day' : (h >= 17 && h < 20) || (h >= 5 && h < 7) ? 'dusk' : 'night' }

function Patrol({ beds, demo }: { beds: Bed[]; demo: boolean }) {
  const [sky, setSky] = useState<Sky>(skyNow)
  const [rain, setRain] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(loadBest)
  const [combo, setCombo] = useState(0)
  const [eaten, setEaten] = useState<Set<string>>(() => new Set())
  const [pop, setPop] = useState<Pop | null>(null)
  const [pings, setPings] = useState<{ id: number; x: number; y: number; n: number }[]>([])
  const stage = useRef<HTMLDivElement>(null)
  const view = useView(stage)
  const layer = useRef<SVGGElement>(null)
  const flowers = useRef<Spot[]>([])
  const bugEls = useRef<(SVGGElement | null)[]>([])
  const bees = useRef<BeeApi | null>(null)
  const xs = plantXs(beds.length)
  const lives = 3 - Math.min(3, eaten.size)
  const g = useRef({ bugs: Array.from({ length: POOL }, (): GBug => ({ on: false, x: 0, y: 0, tx: 0, ty: 0, target: '', speed: 0, wob: 0 })), t: 0, spawn: 0, last: 0, chain: 0, eaten: new Set<string>() })
  const xsRef = useRef(xs)
  useEffect(() => { xsRef.current = xs })

  // the game loop: bugs come up out of the soil and climb straight for a flower that's still standing
  useEffect(() => {
    if (phase !== 'play') return
    const s = g.current
    s.bugs.forEach((b) => (b.on = false)); s.t = 0; s.spawn = 1; s.eaten = new Set(); s.chain = 0; s.last = 0
    let raf = 0, prev = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now
      s.t += dt; s.spawn -= dt
      const level = Math.min(10, s.t / 12)
      const alive = flowers.current.filter((f) => !s.eaten.has(f.id))
      if (s.spawn <= 0 && alive.length) {
        s.spawn = Math.max(0.55, 2.1 - level * 0.16)
        const b = s.bugs.find((x) => !x.on)
        if (b) {
          const f = alive[Math.floor(Math.random() * alive.length)], cols = xsRef.current
          const from = cols[Math.floor(Math.random() * cols.length)] + (Math.random() - 0.5) * 160
          Object.assign(b, { on: true, x: from, y: GROUND + 14, tx: f.x, ty: f.y, target: f.id, speed: 24 + level * 7 + Math.random() * 10, wob: Math.random() * 6 })
        }
      }
      s.bugs.forEach((b, i) => {
        const el = bugEls.current[i]
        if (b.on && s.eaten.has(b.target)) { // another bug got there first: pick a new flower
          const f = alive[Math.floor(Math.random() * alive.length)]
          if (f) { b.target = f.id; b.tx = f.x; b.ty = f.y } else b.on = false
        }
        if (!b.on) { if (el) el.style.display = 'none'; return }
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy)
        if (d < 6) {
          b.on = false; s.eaten.add(b.target)
          setEaten(new Set(s.eaten))
          if (s.eaten.size >= 3 || alive.length <= 1) setPhase('over')
          return
        }
        b.x += (dx / d) * b.speed * dt; b.y += (dy / d) * b.speed * dt
        if (el) {
          el.style.display = ''
          const ang = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI
          el.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) scale(${dx < 0 ? -1 : 1} 1) rotate(${(ang + Math.sin(now / 90 + b.wob) * 6).toFixed(1)})`)
        }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); s.bugs.forEach((b, i) => { b.on = false; const el = bugEls.current[i]; if (el) el.style.display = 'none' }) }
  }, [phase])

  const finish = (final: number) => {
    if (final > best) { setBest(final); try { localStorage.setItem(KEY, JSON.stringify({ best: final })) } catch { /* private mode */ } }
  }
  useEffect(() => { if (phase === 'over') finish(score) }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => { setScore(0); setCombo(0); setEaten(new Set()); setPop(null); setPhase('play') }
  const swat = (i: number) => {
    if (phase !== 'play' || !g.current.bugs[i].on) return
    bees.current?.fetch(i, () => (g.current.bugs[i].on ? { x: g.current.bugs[i].x, y: g.current.bugs[i].y } : null))
  }
  const caught = (i: number) => {
    const s = g.current, b = s.bugs[i]
    if (!b.on) return
    b.on = false
    const now = performance.now()
    s.chain = now - s.last < 1600 ? s.chain + 1 : 1; s.last = now
    const n = s.chain
    setScore((v) => v + n); setCombo(n)
    const m = layer.current?.getScreenCTM(), r = stage.current?.getBoundingClientRect()
    if (m && r) {
      const q = new DOMPoint(b.x, b.y).matrixTransform(m)
      setPings((ps) => [...ps.slice(-5), { id: now, x: q.x - r.left, y: q.y - r.top, n }])
      window.setTimeout(() => setPings((ps) => ps.filter((x) => x.id !== now)), 900)
    }
  }
  const openPop = (e: ReactMouseEvent, item: Item, bed: string) => {
    if (phase === 'play') return
    e.stopPropagation()
    const r = stage.current!.getBoundingClientRect()
    setPop({ item, bed, x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
  }

  return (
    <section className="gd-play">
      <div className="gd-play-head">
        <div>
          <span className="gd-caption-k">Your turn</span>
          <h2>Bug patrol</h2>
          <p>Bugs are climbing for your flowers. Click one and the nearest bee carries it off. Catch them close together for a combo. Lose three flowers and it’s over.</p>
        </div>
        <div className="gd-bar">
          <LayoutGroup id="gd-sky">
            <div className="gd-seg" role="radiogroup" aria-label="Sky">
              {(['day', 'dusk', 'night'] as Sky[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={sky === s} className={sky === s ? 'on' : ''} onClick={() => setSky(s)}>
                  {sky === s && <motion.span layoutId="gd-sky-pill" className="gd-seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
                  <span>{s[0].toUpperCase() + s.slice(1)}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
          <button type="button" className={`btn btn-sm ${rain ? 'btn-dark' : 'btn-line'}`} onClick={() => setRain((r) => !r)} aria-pressed={rain}>{rain ? 'Stop the rain' : 'Make it rain'}</button>
        </div>
      </div>

      <div ref={stage} className={`gd-stage gd-stage--play is-${sky} ${rain ? 'is-rain' : ''} ${phase === 'play' ? 'is-playing' : ''}`} onClick={() => setPop(null)}>
        <svg viewBox={box(view)} className="gd-svg" preserveAspectRatio="xMidYMax slice">
          <FixedSky sky={sky} rain={rain} />
          <g ref={layer}>
            <Hills />
            <Soil />
            {beds.map((b, k) => <Plant key={b.id} bed={b} x={xs[k]} T={Infinity} index={k} total={beds.length} flowers={flowers} eaten={eaten} onItem={openPop} bugs={phase !== 'play'} />)}
            {Array.from({ length: POOL }, (_, i) => (
              <g key={i} ref={(el) => { bugEls.current[i] = el }} style={{ display: 'none' }} className="gd-hit gd-gbug" onPointerDown={(e) => { e.stopPropagation(); swat(i) }}>
                <circle r="24" fill="transparent" />
                <BugBody />
              </g>
            ))}
            <Bees api={bees} flowers={flowers} onCaught={caught} />
            {sky === 'night' && <Fireflies />}
          </g>
        </svg>
        {rain && <Rain />}

        <div className="gd-hud" aria-live="polite">
          <span className="gd-hud-score"><small>Score</small>
            <AnimatePresence mode="popLayout" initial={false}><motion.b key={score} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}>{score}</motion.b></AnimatePresence>
          </span>
          <span className="gd-hud-lives" aria-label={`${lives} flowers left`}>
            {[0, 1, 2].map((k) => <motion.i key={k} initial={false} animate={{ scale: k < lives ? 1 : 0.7, opacity: k < lives ? 1 : 0.25, rotate: k < lives ? 0 : -30 }} transition={{ type: 'spring', stiffness: 400, damping: 14 }} />)}
          </span>
          <span className="gd-hud-best"><small>Best</small><b>{best}</b></span>
        </div>
        <AnimatePresence>
          {combo > 1 && phase === 'play' && (
            <motion.div key={combo} className="gd-combo" initial={{ scale: 0.4, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ opacity: 0, scale: 1.4 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}>
              ×{combo} combo
            </motion.div>
          )}
        </AnimatePresence>
        {pings.map((q) => <motion.span key={q.id} className="gd-ping" style={{ left: q.x, top: q.y }} initial={{ y: 0, opacity: 1, scale: 0.6 }} animate={{ y: -46, opacity: 0, scale: 1.2 }} transition={{ duration: 0.85, ease: easeOut }}>+{q.n}</motion.span>)}

        <AnimatePresence>
          {phase !== 'play' && (
            <motion.div className="gd-start" initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: -10 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              onClick={(e) => e.stopPropagation()}>
              {phase === 'over' ? <>
                <span className="gd-caption-k">Game over</span>
                <b>{score} point{score === 1 ? '' : 's'}{score > 0 && score >= best ? ' · new best!' : ''}</b>
                <p>The bugs got three flowers. Your real ones are fine.</p>
              </> : <>
                <span className="gd-caption-k">Bug patrol</span>
                <b>Guard the garden</b>
                <p>Click a bug to send a bee.{demo ? '' : ' Before you start, click a flower to see its fix.'}</p>
              </>}
              <button type="button" className="btn btn-dark" onClick={start}>{phase === 'over' ? 'Play again' : 'Start'}</button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pop && (
            <motion.div key={pop.item.id} className={`gd-pop ${pop.x > 60 ? 'is-left' : ''} ${pop.y < 40 ? 'is-low' : ''}`} style={{ left: `${pop.x}%`, top: `${pop.y}%` }}
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }} onClick={(e) => e.stopPropagation()}>
              <span className={`gd-pop-state is-${kindOf(pop.item.state) || 'other'}`}>{pop.item.state}</span>
              <b>{pop.item.title}</b>
              <span className="gd-pop-meta mono">{pop.item.id} · {pop.bed}</span>
              {!pop.item.demo && <Link className="btn btn-dark btn-sm" to={`/app/repos/${pop.item.repoId}/tasks/${pop.item.id}`}>Open the task</Link>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
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

function FixedSky({ sky, rain }: { sky: Sky; rain: boolean }) {
  const pos = sky === 'day' ? { x: 800, y: 130 } : sky === 'dusk' ? { x: 870, y: 290 } : { x: 190, y: 140 }
  return (
    <>
      <Gradients />
      <rect {...SKYBOX} fill="url(#gd-day)" />
      <motion.rect {...SKYBOX} fill="url(#gd-dusk)" initial={false} animate={{ opacity: sky === 'dusk' ? 1 : 0 }} transition={{ duration: 1.2 }} />
      <motion.rect {...SKYBOX} fill="url(#gd-night)" initial={false} animate={{ opacity: sky === 'night' ? 1 : 0 }} transition={{ duration: 1.2 }} />
      <motion.rect {...SKYBOX} fill="#3a4658" initial={false} animate={{ opacity: rain ? (sky === 'night' ? 0.25 : 0.4) : 0 }} transition={{ duration: 1 }} />
      <motion.g initial={false} animate={{ opacity: sky === 'night' ? 1 : 0 }} transition={{ duration: 1.2 }}>
        {STARS.map(([x, y, r], k) => <circle key={k} cx={x} cy={y} r={r} fill="#fff" className="gd-star" style={{ animationDelay: `${(k % 7) * 0.4}s` }} />)}
      </motion.g>
      <motion.g initial={false} animate={{ x: pos.x, y: pos.y }} transition={{ type: 'spring', stiffness: 40, damping: 14 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.g key={sky === 'night' ? 'moon' : 'sun'} initial={{ scale: 0, rotate: -60 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}>
            {sky === 'night' ? <Moon /> : <Sun dusk={sky === 'dusk'} />}
          </motion.g>
        </AnimatePresence>
      </motion.g>
      <Clouds tone={rain ? '#9aa6b5' : sky === 'night' ? '#39406e' : '#fff'} />
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

function Rain() {
  return <div className="gd-rain" aria-hidden="true">{Array.from({ length: 70 }, (_, k) => <i key={k} style={{ left: `${(k * 37) % 100}%`, animationDelay: `${-(k % 10) * 0.09}s`, animationDuration: `${0.5 + (k % 5) * 0.08}s` }} />)}</div>
}

const SKYBOX = { x: -1200, y: -1600, width: 3400, height: H + 1800 }
const STARS: [number, number, number][] = Array.from({ length: 70 }, (_, k) => [((k * 97 + 31) % 1600) - 300, ((k * 53 + 17) % 760) - 500, 1 + (k % 3) * 0.6])
const CLOUDS: [number, number, number, number][] = [[80, 60, 1.1, 70], [420, 30, 0.8, 90], [700, 110, 1.3, 80], [260, 150, 0.7, 110]]
const TUFTS: [number, number][] = Array.from({ length: 22 }, (_, k) => [20 + k * 46 + (k % 3) * 9, 0.8 + (k % 4) * 0.15])
