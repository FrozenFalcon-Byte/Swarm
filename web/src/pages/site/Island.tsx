import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Reveal, SplitWords } from '../../components/Reveal'
import { Roll } from '../../components/Roll'
import { SmoothScroll } from '../../components/SmoothScroll'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import './site.css'
import './island.css'

/* The Island. A paper-craft diorama of how Swarm works, in two parts.
   First a short film you scroll through: the camera flies round an empty island and each agent's building
   goes up as its part is told (lighthouse for the triager, workshop for the coder, test lab for the tester,
   review tower for the reviewer, and a windmill that keeps it all turning).
   Then the same island, empty, is yours: drag buildings onto it and issue boats start arriving. Each issue
   walks from building to building and sails off as a pull request. Leave a building out and the issue
   waits for a person, which is the point: every step is somebody's job. */

type B = 'lighthouse' | 'workshop' | 'lab' | 'tower' | 'windmill'
type K = B | 'cache' | 'library' | 'harbour' | 'bell'
const ORDER: B[] = ['lighthouse', 'workshop', 'lab', 'tower']
const ALL: B[] = ['lighthouse', 'workshop', 'lab', 'tower', 'windmill']
const SPOT: Record<B | 'dock', { x: number; y: number }> = {
  lighthouse: { x: 290, y: 330 }, windmill: { x: 470, y: 258 }, workshop: { x: 580, y: 280 },
  lab: { x: 620, y: 390 }, tower: { x: 365, y: 412 }, dock: { x: 760, y: 372 },
}
const INFO: Record<K, { name: string; agent: string; c: string; job: string }> = {
  lighthouse: { name: 'Lighthouse', agent: 'Triager', c: 'var(--triager)', job: 'spots and reads issues' },
  workshop: { name: 'Workshop', agent: 'Coder', c: 'var(--coder)', job: 'writes the patch' },
  lab: { name: 'Test lab', agent: 'Tester', c: 'var(--tester)', job: 'runs it 24 times' },
  tower: { name: 'Review tower', agent: 'Reviewer', c: 'var(--reviewer)', job: 'approves or sends back' },
  windmill: { name: 'Windmill', agent: 'Extra', c: '#ffd85a', job: 'every building works faster' },
  cache: { name: 'Cache shed', agent: 'Extra', c: 'var(--tester)', job: 'tests run twice as fast' },
  library: { name: 'Library', agent: 'Extra', c: 'var(--reviewer)', job: 'the reviewer sends back far fewer patches' },
  harbour: { name: 'Harbour office', agent: 'Extra', c: '#8ec5ff', job: 'more boats can wait at the dock' },
  bell: { name: 'Bell', agent: 'Extra', c: '#ffd2cb', job: 'calls a person faster' },
}
const VB = { w: 1000, h: 640 }

export default function Island() {
  return (
    <div className="site isl">
      <SmoothScroll />
      <Nav />


      <Film />
      <Sandbox />

      <section className="site-band">
        <div className="site-band-inner">
          <Reveal><h2 className="title-2">Your repo gets the whole island.</h2></Reveal>
          <div className="site-trio">
            {[
              ['var(--triager)', 'Every step has an owner', 'Triage, patch, test and review each belong to one agent. An issue moves on only when that step is done.'],
              ['var(--tester)', 'Missing a step? It waits for you', 'If an agent can’t finish, the issue stops and asks a person instead of guessing.'],
              ['var(--reviewer)', 'Out comes a pull request', 'Every fix leaves as a pull request with the evidence attached. You decide whether to merge it.'],
            ].map(([c, t, p], k) => (
              <Reveal key={t} delay={k * 0.08} className="site-tri"><span className="site-tri-dot" style={{ background: c }} /><b>{t}</b><p>{p}</p></Reveal>
            ))}
          </div>
          <div className="site-cta">
            <Link to="/signup" className="btn btn-dark btn-xl"><Roll>Point it at your repo</Roll></Link>
            <Link to="/jam" className="btn btn-line btn-xl"><Roll>Jam with the band</Roll></Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ the film: scroll moves the camera */

const SCENES: { at: number; k: B | null; t: string; p: string }[] = [
  { at: 0, k: null, t: 'An island in the sea', p: 'Issues wash up here every day, and nobody’s home yet.' },
  { at: 0.16, k: 'lighthouse', t: 'The lighthouse', p: 'The triager keeps watch. Every issue that washes up gets read, reproduced and labelled.' },
  { at: 0.32, k: 'workshop', t: 'The workshop', p: 'The coder writes the smallest patch that fixes the cause. No sleeps, no retries.' },
  { at: 0.48, k: 'lab', t: 'The test lab', p: 'The tester runs the test before and after the patch, 24 times each, in a sandbox.' },
  { at: 0.64, k: 'tower', t: 'The review tower', p: 'The reviewer reads the diff, then approves it or sends it back to the workshop.' },
  { at: 0.8, k: 'windmill', t: 'The windmill', p: 'The windmill keeps it all turning while you sleep, and the fix sails out as a pull request.' },
  { at: 0.93, k: null, t: 'Your turn', p: 'Build your own island just below.' },
]
const WIDE = [0, 0, VB.w, VB.h]
const focus = (b: B) => { const s = SPOT[b], w = 560, h = (w * VB.h) / VB.w; return [s.x - w / 2, s.y - h * 0.62, w, h] }
/* The opening shot is set in screen pixels: on a wide screen the island sits big to the right of the headline,
   running off the right edge; on a tall one it rises from below the text. The camera holds there until the
   headline has gone, then flies in. */
const LAND = { x: 20, y: 120, w: 960, h: 490 } // the disc and its shadow, in island units
function opening(stage?: HTMLElement | null) {
  const vw = window.innerWidth, vh = window.innerHeight
  const S = stage ? { x: stage.offsetLeft, y: stage.offsetTop, w: stage.offsetWidth, h: stage.offsetHeight } : { x: 0, y: 0, w: vw, h: vh }
  const wide = vw / vh > 1.2
  const w = wide ? Math.min(vw * 0.62, (vh * 0.6 * LAND.w) / LAND.h) : vw * 1.15
  const x = wide ? vw * 0.97 - w * 0.86 : (vw - w) / 2, y = wide ? vh * 0.42 : vh * 0.56
  const k = w / LAND.w // pixels per island unit
  return [LAND.x - (x - S.x) / k, LAND.y - (y - S.y) / k, S.w / k, S.h / k]
}
const CAM: [number, number[]][] = [[0, opening()], [0.04, opening()], [0.12, WIDE]]
SCENES.slice(1).forEach((s) => { const v = s.k ? focus(s.k) : WIDE; CAM.push([s.at, v], [Math.min(1, s.at + 0.09), v]) })

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
function camAt(p: number) {
  for (let k = 0; k < CAM.length - 1; k++) {
    const [a, va] = CAM[k], [b, vb] = CAM[k + 1]
    if (p <= b) { const t = b === a ? 1 : ease(Math.max(0, (p - a) / (b - a))); return va.map((v, i) => v + (vb[i] - v) * t) }
  }
  return CAM[CAM.length - 1][1]
}

// on a phone the picker is a row you swipe along, so the cards are tapped rather than dragged
const DOCK_NAME: Partial<Record<K, string>> = { tower: 'Review', cache: 'Cache', harbour: 'Harbour' } // the full names are in the tip

function useNarrow() {
  const q = '(max-width: 760px)'
  const [n, setN] = useState(() => window.matchMedia(q).matches)
  useEffect(() => { const m = window.matchMedia(q), on = () => setN(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [])
  return n
}

function Film() {
  const ref = useRef<HTMLElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [scene, setScene] = useState(0)
  const [p, setP] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    svg.current?.setAttribute('viewBox', camAt(v).map((n) => n.toFixed(1)).join(' '))
    let s = 0; SCENES.forEach((x, k) => { if (v >= x.at - 0.03) s = k })
    setScene(s); setP(v)
  })
  const built = new Set(SCENES.filter((s) => s.k && p >= s.at - 0.03).map((s) => s.k as B))
  const cur = SCENES[scene]
  // a phone turned sideways, or a window resized, re-frames the opening shot
  const [, reframe] = useState(0)
  useEffect(() => {
    const on = () => { CAM[0][1] = CAM[1][1] = opening(stage.current); reframe((n) => n + 1) }
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const introOpacity = useTransform(scrollYProgress, [0, 0.03], [1, 0])
  const introY = useTransform(scrollYProgress, [0, 0.03], [0, -60])
  return (
    <section id="film" ref={ref} className="isl-film">
      <div className="isl-film-pin">
        <motion.header className={`isl-intro ${p > 0.035 ? 'is-gone' : ''}`} style={{ opacity: introOpacity, y: introY }}>
          <motion.p className="isl-kicker" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut }}><i />No sign-in, just play</motion.p>
          <SplitWords as="h1" text="Build the swarm an island." className="site-title isl-title" />
          <motion.p className="site-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
            Scroll, and watch an issue get fixed one building at a time. Then build your own island below.
          </motion.p>
        </motion.header>
        <motion.div ref={stage} className="isl-film-stage" initial={{ y: 160, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25, type: 'spring', stiffness: 70, damping: 16 }}>
          <Diorama svgRef={svg} viewBox={camAt(p)} path label="The island, being built one building at a time"
            blds={ALL.filter((b) => built.has(b)).map((b) => ({ id: b, k: b, ...SPOT[b] }))} working={new Set(cur.k ? [cur.k] : [])}
            tokens={cur.k ? [{ id: 'film', n: 412, x: SPOT[cur.k].x + 58, y: SPOT[cur.k].y + 14, c: INFO[cur.k].c }] : []}
            docked={scene === 0 ? 412 : scene >= 5 ? 88 : null} />
        </motion.div>
        <div className={`isl-caption ${p < 0.1 ? 'is-hidden' : ''}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={scene} initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }} transition={{ duration: 0.4, ease: easeOut }}>
              {cur.k && <span className="isl-caption-tag" style={{ background: INFO[cur.k].c }}>{INFO[cur.k].agent}</span>}
              <b>{cur.t}</b>
              <p>{cur.p}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <ol className="isl-rail" aria-hidden="true">
          {SCENES.map((s, k) => <li key={k} className={k === scene ? 'on' : k < scene ? 'done' : ''} style={{ ['--c' as string]: s.k ? INFO[s.k].c : 'var(--ink)' }} />)}
        </ol>
        <motion.div className="isl-film-bar" style={{ scaleX: scrollYProgress }} />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ the sandbox: your island */

/* A small tycoon on nine fixed plots. Boats bring issues faster every day; each issue walks to the nearest
   free building for its next step. The four agent buildings do the work, and you can build more than one of
   each to run steps side by side. The other five each change one rule of the island, once built. Coins come
   from fixes. A missing building means the issue waits for a person; too many boats waiting and new ones turn back. */

const KINDS: K[] = ['lighthouse', 'workshop', 'lab', 'tower', 'windmill', 'cache', 'library', 'harbour', 'bell']
const AGENTS: K[] = ['lighthouse', 'workshop', 'lab', 'tower']
const COST: Record<K, number> = { lighthouse: 40, workshop: 30, lab: 30, tower: 30, windmill: 50, cache: 30, library: 30, harbour: 25, bell: 25 }
const WORK: Record<string, number> = { lighthouse: 1.2, workshop: 2.8, lab: 2.2, tower: 1.6 }
// what each extra changes, said the same way on its button, its card and its chip
const PERK: Partial<Record<K, string>> = { windmill: 'Every building ×1.4 faster', cache: 'Tests ×2 faster', library: 'Send-backs 25% → 5%', harbour: 'Dock holds 8 boats, not 4', bell: 'A person comes in 3s, not 8' }
const PLOTS = [
  { x: 330, y: 290 }, { x: 450, y: 262 }, { x: 575, y: 268 }, { x: 660, y: 320 }, { x: 285, y: 360 },
  { x: 410, y: 345 }, { x: 535, y: 340 }, { x: 430, y: 412 }, { x: 590, y: 405 },
]
const START = 150
// each building's own bounds, so every picker icon sits centred at the same height
const ICON: Record<K, string> = {
  lighthouse: '-62 -172 124 180', windmill: '-78 -166 156 174', workshop: '-62 -106 124 114', lab: '-58 -94 116 102', tower: '-56 -164 112 172',
  cache: '-52 -66 104 74', library: '-52 -74 104 82', harbour: '-50 -64 104 72', bell: '-46 -94 92 102',
}
const DOCK = { x: 748, y: 344 }

type Bld = { id: number; k: K; x: number; y: number; plot: number }
type Mode = 'boat' | 'find' | 'walk' | 'work' | 'wait' | 'home'
type Job = { id: number; n: number; x: number; y: number; step: number; mode: Mode; at: number | null; left: number; nd: number; route: { x: number; y: number }[] }
type Stats = { fixed: number; waited: number; missed: number; back: number }
type Sim = { blds: Bld[]; jobs: Job[]; coins: number; t: number; next: number; gust: number; stats: Stats; seq: number; n: number }
type Boat = { id: number; kind: 'in' | 'out' | 'pass'; n: number }
type Line = { id: number; text: string; c: string }

const fresh = (): Sim => ({ blds: [], jobs: [], coins: START, t: 0, next: 2, gust: 0, stats: { fixed: 0, waited: 0, missed: 0, back: 0 }, seq: 0, n: 430 })
const dayOf = (t: number) => 1 + Math.floor(t / 40)
const has = (s: { blds: Bld[] }, k: K) => s.blds.some((b) => b.k === k)
// the paths: where an issue stands for each plot, plus the dock, and which of those are joined.
// Issues only walk along these, so a building far down the path costs time.
const NODES = [
  { x: 388, y: 304 }, { x: 508, y: 276 }, { x: 633, y: 282 }, { x: 712, y: 332 }, { x: 343, y: 374 },
  { x: 468, y: 360 }, { x: 593, y: 356 }, { x: 488, y: 428 }, { x: 530, y: 418 }, DOCK,
]
const HOME = 9
const ROADS: [number, number][] = [[9, 3], [3, 2], [2, 1], [1, 0], [0, 4], [7, 8], [8, 3], [5, 0], [5, 1], [5, 6], [5, 4], [5, 7], [6, 2], [6, 3], [6, 8]]
function route(from: number, to: number) {
  const len = (a: number, b: number) => Math.hypot(NODES[a].x - NODES[b].x, NODES[a].y - NODES[b].y)
  const d = NODES.map(() => Infinity), prev = NODES.map(() => -1), done = new Set<number>()
  d[from] = 0
  while (done.size < NODES.length) {
    let u = -1
    d.forEach((v, i) => { if (!done.has(i) && (u < 0 || v < d[u])) u = i })
    if (u < 0 || d[u] === Infinity) break
    done.add(u)
    ROADS.forEach(([a, b]) => { const w = a === u ? b : b === u ? a : -1; if (w >= 0 && d[u] + len(u, w) < d[w]) { d[w] = d[u] + len(u, w); prev[w] = u } })
  }
  const pts: { x: number; y: number }[] = []
  for (let v = to; v !== from && v >= 0; v = prev[v]) pts.unshift(NODES[v])
  return { d: d[to], pts }
}
const pace = (s: Sim, b: Bld) => (has(s, 'windmill') ? (s.gust > 0 ? 2 : 1.4) : 1) * (b.k === 'lab' && has(s, 'cache') ? 2 : 1)
const snap = (s: Sim) => ({ blds: [...s.blds], jobs: s.jobs.map((j) => ({ ...j })), coins: s.coins, day: dayOf(s.t), gust: s.gust > 0, stats: { ...s.stats } })

function Sandbox() {
  const sim = useRef<Sim>(fresh())
  const [view, setView] = useState(() => snap(sim.current))
  const [boats, setBoats] = useState<Boat[]>([])
  const [line, setLine] = useState<Line | null>(null)
  const [plot, setPlot] = useState<number | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [pokes, setPokes] = useState<Record<string, number>>({})
  const [hover, setHover] = useState<number | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const seen = useRef(false)
  const ids = useRef(0)

  const say = (text: string, c = 'var(--white)') => setLine({ id: ++ids.current, text, c })
  const publish = () => setView(snap(sim.current))
  const addBoat = (kind: Boat['kind'], n: number) => {
    const id = ++ids.current
    setBoats((b) => [...b, { id, kind, n }])
    window.setTimeout(() => setBoats((b) => b.filter((x) => x.id !== id)), kind === 'pass' ? 6200 : 3000)
  }

  // the island's clock: ten ticks a second, only while the island is on screen
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { seen.current = e.isIntersecting })
    if (stage.current) io.observe(stage.current)
    const dt = 0.1
    const iv = window.setInterval(() => {
      const s = sim.current
      if (!seen.current || document.hidden || !s.blds.length) return
      s.t += dt; s.gust = Math.max(0, s.gust - dt)

      s.next -= dt
      if (s.next <= 0) {
        s.next = Math.max(1.8, 7.5 - dayOf(s.t) * 0.8)
        const n = ++s.n, room = has(s, 'harbour') ? 8 : 4
        if (!has(s, 'lighthouse')) { addBoat('pass', n); s.stats.missed++; say(`#${n} sailed past. No lighthouse, so nobody saw it`, '#ffd2cb') }
        else if (s.jobs.filter((j) => j.step === 0 && j.mode !== 'work').length >= room) {
          addBoat('pass', n); s.stats.missed++
          say(`#${n} turned back: ${room} boats already waiting. ${has(s, 'harbour') ? 'Build another lighthouse' : 'A harbour office or another lighthouse would help'}`, '#ffd2cb')
        } else { addBoat('in', n); s.jobs.push({ id: ++s.seq, n, x: DOCK.x, y: DOCK.y, step: 0, mode: 'boat', at: null, left: 2.3, nd: HOME, route: [] }) }
      }

      const busy = new Set(s.jobs.map((j) => j.at).filter((a) => a != null))
      for (const j of [...s.jobs]) {
        if (j.mode === 'boat') { j.left -= dt; if (j.left <= 0) j.mode = 'find'; continue }
        if (j.mode === 'find' || j.mode === 'wait') {
          if (j.step >= ORDER.length) { j.mode = 'home'; j.route = route(j.nd, HOME).pts; continue }
          const k = ORDER[j.step]
          const all = s.blds.filter((b) => b.k === k)
          if (!all.length) {
            if (j.mode !== 'wait') { j.mode = 'wait'; j.left = has(s, 'bell') ? 3 : 8; say(`#${j.n} needs a person: there’s no ${INFO[k].name.toLowerCase()}`, '#ffd2cb') }
            j.left -= dt
            if (j.left <= 0) { j.step++; j.mode = 'find'; s.stats.waited++; s.coins += 5 }
            continue
          }
          j.mode = 'find'
          const free = all.filter((b) => !busy.has(b.id)).map((b) => ({ b, r: route(j.nd, b.plot) })).sort((a, b) => a.r.d - b.r.d)[0]
          if (free) { j.at = free.b.id; busy.add(free.b.id); j.mode = 'walk'; j.route = free.r.pts }
          continue
        }
        const b = s.blds.find((o) => o.id === j.at)
        if (j.mode !== 'home' && !b) { j.mode = 'find'; j.at = null; continue } // its building was sold
        if (j.mode === 'walk' || j.mode === 'home') {
          const to = j.route[0]
          if (to) {
            const d = Math.hypot(to.x - j.x, to.y - j.y), v = 95 * dt * (s.gust > 0 ? 1.5 : 1)
            if (d > v) { j.x += ((to.x - j.x) / d) * v; j.y += ((to.y - j.y) / d) * v; continue }
            j.x = to.x; j.y = to.y; j.nd = NODES.indexOf(to); j.route.shift()
            if (j.route.length) continue
          }
          if (j.mode === 'home') {
            s.jobs = s.jobs.filter((o) => o !== j); s.stats.fixed++; s.coins += 25
            addBoat('out', j.n); say(`PR for #${j.n} sails out. +25 coins`, 'var(--reviewer)')
          } else { j.mode = 'work'; j.left = WORK[b!.k] / pace(s, b!) }
          continue
        }
        j.left -= dt
        if (j.left > 0) continue
        busy.delete(j.at!); j.at = null; j.mode = 'find'
        if (b!.k === 'tower' && Math.random() < (has(s, 'library') ? 0.05 : 0.25)) { j.step = 1; s.stats.back++; say(`Reviewer sent #${j.n} back to the workshop`, INFO.tower.c) }
        else j.step++
      }
      publish()
    }, 100)
    return () => { clearInterval(iv); io.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const taken = (i: number) => sim.current.blds.some((b) => b.plot === i)
  const why = (k: K) => {
    const s = sim.current
    if (!AGENTS.includes(k) && has(s, k)) return `You already have a ${INFO[k].name.toLowerCase()}. One is enough`
    if (s.coins < COST[k]) return `Not enough coins: the ${INFO[k].name.toLowerCase()} costs ${COST[k]}`
    if (PLOTS.every((_, i) => taken(i))) return 'Every plot is full. Sell something first'
    return null
  }
  const build = (k: K, at: number | null = plot) => {
    const s = sim.current, no = why(k)
    if (no) { say(no, '#ffd2cb'); return }
    const i = at != null && !taken(at) ? at : PLOTS.findIndex((_, p) => !taken(p))
    s.coins -= COST[k]
    s.blds = [...s.blds, { id: ++s.seq, k, plot: i, ...PLOTS[i] }]
    if (s.blds.length === 1) s.next = 2
    setPlot(null); setSel(null); publish()
    say(PERK[k] ? `${INFO[k].name} built. ${PERK[k]}` : `${INFO[k].name} built. The ${INFO[k].agent.toLowerCase()} ${INFO[k].job}`, INFO[k].c)
  }
  const sell = (id: number) => {
    const s = sim.current, b = s.blds.find((o) => o.id === id)
    if (!b) return
    s.blds = s.blds.filter((o) => o.id !== id)
    s.coins += Math.floor(COST[b.k] / 2)
    s.jobs.forEach((j) => { if (j.at === id) { j.at = null; j.mode = 'find' } })
    setSel(null); publish(); say(`Sold the ${INFO[b.k].name.toLowerCase()} for ${Math.floor(COST[b.k] / 2)}`)
  }
  const poke = (id: string | number) => {
    setPokes((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }))
    setPlot(null); setSel((v) => (v === id ? null : (id as number)))
    const b = sim.current.blds.find((o) => o.id === id)
    if (b?.k === 'windmill') { sim.current.gust = 3; say('Whoosh. Everything works twice as fast for a bit', '#ffd85a') }
  }
  const reset = () => { sim.current = fresh(); publish(); setBoats([]); setLine(null); setSel(null); setPlot(null) }
  // which empty plot is under the pointer, while dragging a building from the toolbox
  const plotAt = (cx: number, cy: number) => {
    const m = svg.current?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse())
    let best: number | null = null, d = 70
    PLOTS.forEach((q, i) => { const e = Math.hypot(q.x - p.x, (q.y - p.y) * 1.6); if (e < d && !taken(i)) { d = e; best = i } })
    return best
  }

  const s = view
  const picked = s.blds.find((b) => b.id === sel) ?? null
  const working = new Set(s.jobs.filter((j) => j.mode === 'work').map((j) => j.at as number))
  if (s.jobs.some((j) => j.mode === 'wait')) s.blds.forEach((b) => { if (b.k === 'bell') working.add(b.id) }) // the bell rings while someone waits
  const tokens = s.jobs.filter((j) => j.mode !== 'boat').map((j) => ({
    id: j.id, n: j.n, x: j.x + ((j.id * 37) % 21) - 10, y: j.y + ((j.id * 53) % 17) - 8,
    c: j.step >= ORDER.length ? 'var(--reviewer)' : INFO[ORDER[j.step]].c,
    waiting: j.mode === 'wait' ? `Needs a person · ${Math.ceil(j.left)}s` : undefined,
  }))
  const empty = !s.blds.length
  const narrow = useNarrow()
  const [tip, setTip] = useState<K | null>(null)
  const perks = KINDS.filter((k) => PERK[k] && has(s, k))

  return (
    <section id="build" className="isl-play">
      <div className="isl-play-head">
        <Reveal><p className="isl-num"><span>Your turn</span></p></Reveal>
        <Reveal delay={0.05}><h2 className="title-2">Build your own island.</h2></Reveal>
        <Reveal delay={0.1}><p className="isl-sub">Nine plots and {START} coins. Tap a building to put it on the next free plot, or drag it to the one you want. Boats come faster every day, so you’ll want two of the slow buildings, and the extras each change one rule. Every fix pays 25.</p></Reveal>
      </div>

      <div className="isl-play-deck">
      <div className={`isl-play-stage ${hover != null ? 'is-drop' : ''}`} ref={stage}>
        <Diorama svgRef={svg} roads blds={s.blds} working={working} tokens={tokens} linear boats={boats} onPoke={poke} pokes={pokes}
          sel={sel} label="Your island" spin={s.gust ? 2 : 1}
          plots={PLOTS.map((p, i) => ({ ...p, i })).filter((p) => !s.blds.some((b) => b.plot === p.i))} plotOn={hover ?? plot}
          onPlot={(i) => { setSel(null); setPlot((v) => (v === i ? null : i)) }}
          svgProps={{ onClick: () => { setSel(null); setPlot(null) } }} />

        <div className="isl-hud">
          {([['Coins', s.coins, '#ffd85a'], ['Day', s.day, 'var(--white)'], ['Fixed', s.stats.fixed, 'var(--reviewer)'], [narrow ? 'Waited' : 'Waited for a person', s.stats.waited, 'var(--triager)'], ['Missed', s.stats.missed, 'var(--tester)']] as const).map(([l, v, c]) => (
            <div key={l} className="isl-chip" style={{ ['--c' as string]: c }}>
              <i /><span>{l}</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.b key={String(v)} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>{v}</motion.b>
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* the rules your extras have changed, so their use is always in view */}
        <div className="isl-perks">
          <AnimatePresence>
            {perks.map((k) => (
              <motion.span key={k} layout className="isl-perk" style={{ ['--c' as string]: INFO[k].c }} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}>
                <b>{INFO[k].name}</b>{k === 'windmill' && s.gust ? 'Gust: ×2 for a moment' : PERK[k]}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {picked && (
            <motion.div key={picked.id} className="isl-pick" style={{ ['--c' as string]: INFO[picked.k].c }}
              initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ duration: 0.2, ease: easeOut }}>
              <span className="isl-pick-tag">{INFO[picked.k].agent}</span>
              <b>{INFO[picked.k].name}</b>
              <p>{PERK[picked.k] ?? `The ${INFO[picked.k].agent.toLowerCase()} ${INFO[picked.k].job}. Takes ${WORK[picked.k]}s an issue.`}</p>
              <div className="isl-pick-row">
                <button className="btn btn-line" onClick={() => sell(picked.id)}>Sell for {Math.floor(COST[picked.k] / 2)}</button>
                <button className="isl-pick-x" onClick={() => setSel(null)} aria-label="Close">
                  <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button className="isl-reset" onClick={reset} disabled={empty && !s.stats.missed}>Start over</button>

        <div className="isl-line" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {plot != null ? (
              <motion.p key={`plot-${plot}`} className="is-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Plot picked. Now choose what goes on it.</motion.p>
            ) : line ? (
              <motion.p key={line.id} style={{ ['--c' as string]: line.c }} initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25, ease: easeOut }}>{line.text}</motion.p>
            ) : (
              <motion.p key="empty" className="is-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{empty ? 'An empty island. Start with a lighthouse.' : 'Waiting for the first boat…'}</motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* the dock: every building in one row floating over the sea, so the island and the choice share the screen */}
        <div className="isl-dock" onMouseLeave={() => setTip(null)}>
          {/* one line that says what the building under your pointer does */}
          <div className="isl-dock-say" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={tip ?? 'hint'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}>
                {tip ? <><i style={{ background: INFO[tip].c }} /><b>{INFO[tip].name}</b><span>{PERK[tip] ?? `${INFO[tip].agent} · ${INFO[tip].job} · ${WORK[tip]}s an issue`}</span></>
                  : <span>Tap a building to place it, or drag it onto a plot</span>}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="isl-dock-row">
          {[['Agents', AGENTS], ['Extras', KINDS.filter((k) => !AGENTS.includes(k))]].map(([t, list]) => (
            <div key={t as string} className="isl-group" role="toolbar" aria-label={t as string}>
              <div className="isl-cards">
                {(list as K[]).map((k) => {
                  const n = s.blds.filter((b) => b.k === k).length, extra = !AGENTS.includes(k)
                  const done = extra && n > 0, no = done || s.coins < COST[k] || s.blds.length >= PLOTS.length
                  return (
                    <motion.button key={k} className={`isl-card ${done ? 'is-built' : ''} ${!done && s.coins < COST[k] ? 'is-poor' : ''}`} style={{ ['--c' as string]: INFO[k].c }}
                      disabled={no} onClick={() => build(k)} aria-label={`Build a ${INFO[k].name.toLowerCase()}, ${COST[k]} coins`}
                      onMouseEnter={() => setTip(k)} onFocus={() => setTip(k)} onBlur={() => setTip(null)}
                      drag={!no && !narrow} dragSnapToOrigin dragElastic={0.9} whileDrag={{ scale: 1.15, rotate: -4, zIndex: 20 }} whileHover={no ? undefined : { y: -6 }} whileTap={no ? undefined : { scale: 0.94 }}
                      onDragStart={() => setTip(null)}
                      onDrag={(e) => { const pe = e as PointerEvent; setHover(plotAt(pe.clientX, pe.clientY)) }}
                      onDragEnd={(e) => { const pe = e as PointerEvent, i = plotAt(pe.clientX, pe.clientY); setHover(null); if (i != null) build(k, i) }}>
                      <span className="isl-card-art">
                        <svg viewBox={ICON[k]} aria-hidden="true"><Building b={k} still /></svg>
                        {!extra && n > 0 && <span className="isl-card-n">×{n}</span>}
                      </span>
                      <span className="isl-card-cost">{done ? 'Built' : <><i />{COST[k]}</>}</span>
                      <b>{DOCK_NAME[k] ?? INFO[k].name}</b>
                    </motion.button>
                  )
                })}
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ the diorama itself */

type Placed = { id: string | number; k: K; x: number; y: number }
type Token = { id: string | number; n: number; x: number; y: number; c: string; waiting?: string }
type DioramaProps = {
  blds: Placed[]; working: Set<string | number>; tokens: Token[]; label: string
  boats?: Boat[]; docked?: number | null; path?: boolean; roads?: boolean; linear?: boolean; spin?: number
  onPoke?: (id: string | number) => void; pokes?: Record<string, number>; sel?: string | number | null
  plots?: { i: number; x: number; y: number }[]; plotOn?: number | null; onPlot?: (i: number) => void
  svgRef?: React.Ref<SVGSVGElement>; svgProps?: React.SVGProps<SVGSVGElement>; viewBox?: number[]
}
const TREES = [[230, 280, 1], [700, 300, 0.8], [360, 230, 0.9], [500, 440, 0.85], [690, 410, 0.7]]

function Diorama({ blds, working, tokens, label, boats = [], docked = null, path = false, roads = false, linear = false, spin = 1, onPoke, pokes = {}, sel = null, plots = [], plotOn = null, onPlot, svgRef, svgProps, viewBox = [0, 0, VB.w, VB.h] }: DioramaProps) {
  const order = [...blds].sort((a, b) => a.y - b.y)
  return (
    <svg ref={svgRef} className="isl-svg" viewBox={viewBox.join(' ')} role="img" aria-label={label} style={{ ['--speed' as string]: spin }} {...svgProps}>
      <defs>
        <linearGradient id="isl-beam" x1="0" x2="1"><stop offset="0" stopColor="#ffe27a" stopOpacity="0.85" /><stop offset="1" stopColor="#ffe27a" stopOpacity="0" /></linearGradient>
      </defs>
      {/* clouds over the diorama */}
      {[[120, 70, 1, 0], [640, 40, 0.8, 1], [860, 110, 0.65, 2]].map(([x, y, s, k]) => (
        <g key={k} transform={`translate(${x} ${y}) scale(${s})`}><path className="isl-cloud" style={{ ['--k' as string]: k }} d="M0 30a22 22 0 0144-8 28 28 0 0152 4 18 18 0 0132 22H6A16 16 0 010 30z" /></g>
      ))}
      <ellipse cx="500" cy="600" rx="430" ry="26" className="isl-shadow" />
      {/* the sea plate: a paper disc with a thick edge */}
      <path className="ink" d="M20 350v36a480 210 0 00960 0v-36z" fill="#5b9be0" />
      <path d="M40 396a470 196 0 00920 0" stroke="#0f0f0f" strokeWidth="2" fill="none" opacity=".25" />
      <ellipse className="ink" cx="500" cy="350" rx="480" ry="210" fill="#8ec5ff" />
      {WAVES.map(([x, y], k) => <path key={k} className="isl-wave" style={{ ['--k' as string]: k % 5 }} d={`M${x} ${y}q10 -7 20 0t20 0`} />)}
      {/* the island */}
      <ellipse className="ink" cx="480" cy="352" rx="300" ry="128" fill="#f3d9a4" />
      <path className="ink" d="M180 340v12a300 128 0 00600 0v-12" fill="#e6c68a" />
      <ellipse className="ink" cx="480" cy="340" rx="300" ry="128" fill="#f3d9a4" />
      <ellipse className="ink" cx="476" cy="330" rx="262" ry="104" fill="#6fd07d" />
      <path d="M300 330q20 -6 40 0M520 250q16 -5 32 0M650 330q14 -5 28 0M380 410q16 -5 32 0" stroke="#0f0f0f" strokeWidth="2" fill="none" opacity=".2" strokeLinecap="round" pointerEvents="none" />
      {/* the path an issue walks, in the film */}
      {path && <path className="isl-path" d={`M${SPOT.dock.x - 30} ${SPOT.dock.y}Q700 330 ${SPOT.workshop.x + 30} ${SPOT.workshop.y + 18}M${SPOT.lighthouse.x + 20} ${SPOT.lighthouse.y + 10}Q420 300 ${SPOT.workshop.x - 30} ${SPOT.workshop.y + 16}M${SPOT.workshop.x} ${SPOT.workshop.y + 20}Q640 340 ${SPOT.lab.x} ${SPOT.lab.y + 6}M${SPOT.lab.x - 30} ${SPOT.lab.y + 10}Q540 420 ${SPOT.tower.x + 24} ${SPOT.tower.y + 6}`} />}
      {/* the sandbox's paths: an ink edge, then sand on top, so they read as trodden ground */}
      {roads && ['isl-road-edge', 'isl-road'].map((c) => (
        <path key={c} className={c} d={ROADS.map(([a, b]) => `M${NODES[a].x} ${NODES[a].y}L${NODES[b].x} ${NODES[b].y}`).join('')} />
      ))}
      {/* trees, cleared where something is built or could be */}
      {TREES.filter(([x, y]) => ![...blds, ...plots].some((b) => Math.hypot(b.x - x, (b.y - y) * 1.6) < 64)).map(([x, y, s]) => (
        <g key={`${x}`} transform={`translate(${x} ${y}) scale(${s})`} className="isl-tree" style={{ ['--k' as string]: x % 5 }} pointerEvents="none">
          <path className="ink" d="M-3 0v-16h6v16z" fill="#6b4f3a" />
          <circle className="ink" cy="-26" r="15" fill={x % 2 ? '#4fb35f' : '#58c46a'} />
        </g>
      ))}
      {/* the dock */}
      <g transform={`translate(${SPOT.dock.x} ${SPOT.dock.y})`}>
        <path className="ink" d="M-40 -8l70 -4 8 20 -70 4z" fill="#c69a6b" />
        <path d="M-26 -9l7 20M-10 -10l7 20M6 -11l7 20" stroke="#0f0f0f" strokeWidth="2" opacity=".4" />
        <path className="ink" d="M34 10v12M-34 14v12" />
      </g>

      {/* empty plots, in the sandbox */}
      {plots.map((p) => (
        <g key={`plot-${p.i}`} className={`isl-plot ${plotOn === p.i ? 'is-on' : ''}`} transform={`translate(${p.x} ${p.y})`} role="button" aria-label={`Plot ${p.i + 1}`}
          onClick={(e) => { e.stopPropagation(); onPlot?.(p.i) }}>
          <ellipse rx="40" ry="15" />
          <path d="M-6 0h12M0 -6v12" />
        </g>
      ))}
      {sel != null && blds.filter((b) => b.id === sel).map((b) => <ellipse key="sel" className="isl-sel" cx={b.x} cy={b.y} rx="50" ry="17" />)}

      {/* buildings, back to front */}
      {order.map((b) => (
        <g key={b.id} transform={`translate(${b.x} ${b.y})`}>
          <motion.g initial={{ scale: 0, y: -60 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 15 }} style={{ originX: 0.5, originY: 1 }}>
            <motion.g key={pokes[b.id] ?? 0} animate={pokes[b.id] ? { scaleY: [1, 0.82, 1.14, 1], scaleX: [1, 1.12, 0.94, 1] } : undefined} transition={{ duration: 0.5 }} style={{ originX: 0.5, originY: 1, cursor: onPoke ? 'pointer' : undefined }}
              onClick={onPoke ? (e) => { e.stopPropagation(); onPoke(b.id) } : undefined}>
              <Building b={b.k} working={working.has(b.id)} />
            </motion.g>
          </motion.g>
          <motion.g initial={{ opacity: 1, scale: 0.4 }} animate={{ opacity: 0, scale: 1.6 }} transition={{ duration: 0.7, ease: 'easeOut' }} pointerEvents="none">
            {[-40, -14, 14, 40].map((x, k) => <circle key={k} cx={x} cy={4 - (k % 2) * 6} r={9} fill="#fff" stroke="#0f0f0f" strokeWidth={2} />)}
          </motion.g>
        </g>
      ))}

      {/* each lighthouse's beam sweeps over everything */}
      {blds.filter((b) => b.k === 'lighthouse').map((b) => (
        <g key={`beam-${b.id}`} transform={`translate(${b.x} ${b.y - 127})`} className={`isl-beam-at ${working.has(b.id) ? 'is-on' : ''}`} pointerEvents="none">
          <path className="isl-beam" d="M0 0L330 -60L330 60Z" fill="url(#isl-beam)" />
        </g>
      ))}

      {/* boats */}
      <AnimatePresence>
        {boats.map((bt) => {
          const p = bt.kind === 'in' ? { x: [1010, 900, SPOT.dock.x + 60], y: [300, 350, SPOT.dock.y + 22] }
            : bt.kind === 'out' ? { x: [SPOT.dock.x + 60, 880, 1040], y: [SPOT.dock.y + 22, 470, 520] }
            : { x: [80, 300, 500, 700, 920], y: [420, 505, 530, 505, 420] }
          return (
            <motion.g key={bt.id} initial={{ x: p.x[0], y: p.y[0], opacity: 0 }} animate={{ ...p, opacity: bt.kind === 'out' ? [1, 1, 0] : [0, 1, 1, 1, 0].slice(0, p.x.length) }}
              exit={{ opacity: 0 }} transition={{ duration: bt.kind === 'pass' ? 6 : 2.3, ease: 'easeInOut' }} pointerEvents="none">
              <Boat n={bt.n} pr={bt.kind === 'out'} />
            </motion.g>
          )
        })}
      </AnimatePresence>
      {docked && <g transform={`translate(${SPOT.dock.x + 60} ${SPOT.dock.y + 22})`}><Boat n={docked} pr={docked < 100} /></g>}

      {/* the issues themselves, walking the island */}
      <AnimatePresence>
        {tokens.map((t) => (
          <motion.g key={t.id} initial={{ x: DOCK.x, y: DOCK.y, scale: 0 }} animate={{ x: t.x, y: t.y, scale: 1 }} exit={{ scale: 0, opacity: 0 }} pointerEvents="none"
            transition={linear ? { x: { duration: 0.1, ease: 'linear' }, y: { duration: 0.1, ease: 'linear' }, scale: { type: 'spring', stiffness: 400, damping: 20 } } : { type: 'spring', stiffness: 120, damping: 16 }}>
            <g className="isl-token">
              <path className="ink" d="M-4 8l4 7 4 -7" fill="#fff" strokeWidth="2.5" />
              <rect className="ink" x="-30" y="-10" width="60" height="20" rx="10" fill="#fff" strokeWidth="2.5" />
              <circle cx="-19" r="4.5" fill={t.c} stroke="#0f0f0f" strokeWidth="1.5" />
              <text x="5" y="4.5" textAnchor="middle" className="isl-token-t">#{t.n}</text>
            </g>
            <AnimatePresence>
              {t.waiting && (
                <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
                  <rect className="ink" x="-82" y="-62" width="164" height="32" rx="12" fill="#ffd85a" />
                  <path className="ink" d="M-6 -31l6 9 6 -9" fill="#ffd85a" />
                  <text y="-41" textAnchor="middle" className="isl-wait-t">{t.waiting}</text>
                </motion.g>
              )}
            </AnimatePresence>
          </motion.g>
        ))}
      </AnimatePresence>
    </svg>
  )
}

// ripples only on open water: inside the sea plate, clear of the island
const WAVES = Array.from({ length: 60 }, (_, k) => [80 + ((k * 211) % 820), 170 + ((k * 97) % 360)])
  .filter(([x, y]) => ((x + 20 - 500) / 440) ** 2 + ((y - 350) / 185) ** 2 < 1 && ((x + 20 - 480) / 330) ** 2 + ((y - 345) / 150) ** 2 > 1).slice(0, 16)

function Boat({ n, pr }: { n: number; pr?: boolean }) {
  return (
    <g className="isl-boat">
      <path d="M-44 14q10 6 20 0t20 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".8" />
      <path className="ink" d="M-32 0h64l-10 14h-44z" fill="#fff" />
      <path d="M-29 5h58" stroke={pr ? '#6fd07d' : '#ff8a7a'} strokeWidth="4" />
      <path className="ink" d="M0 0V-48" />
      <path className="ink" d="M3 -46q22 18 22 42H3z" fill={pr ? '#6fd07d' : '#8ec5ff'} />
      <path className="ink" d="M-3 -40q-16 16 -18 36h18z" fill="#fff" />
      <path className="ink" d="M0 -48l14 5 -14 5z" fill={pr ? '#6fd07d' : '#ffd85a'} />
      <rect className="ink" x={pr ? -26 : -24} y={-78} width={pr ? 52 : 48} height="20" rx="6" fill="#fff" strokeWidth="2" />
      <text y="-63" textAnchor="middle" className="isl-boat-t">{pr ? `PR #${n}` : `#${n}`}</text>
    </g>
  )
}

/* each building is drawn standing on (0, 0) */
function Building({ b, working = false, still = false }: { b: K; working?: boolean; still?: boolean }) {
  const cls = `bd bd-${b} ${working ? 'is-working' : ''} ${still ? 'is-still' : ''}`
  if (b === 'cache') return (
    <g className={cls}>
      {/* a little shed of crates: saved results the lab doesn't have to work out again */}
      <path className="ink" d="M-30 0V-36h60V0z" fill="#fff" />
      <path className="ink" d="M-37 -34L0 -58l37 24z" fill="var(--tester)" />
      <path className="ink" d="M-20 0v-24h18V0z" fill="#6b4f3a" />
      <rect className="ink" x="6" y="-26" width="16" height="12" rx="2" fill="#fdeecf" strokeWidth="2.5" />
      <rect className="ink" x="30" y="-18" width="18" height="18" fill="#e6c68a" strokeWidth="2.5" />
      <rect className="ink" x="34" y="-32" width="14" height="14" fill="#e6c68a" strokeWidth="2.5" />
    </g>
  )
  if (b === 'harbour') return (
    <g className={cls}>
      {/* the harbour office: a hut with an anchor on the door, and a mooring post */}
      <path className="ink" d="M-28 0V-38h56V0z" fill="#fff" />
      <path className="ink" d="M-34 -36L0 -58l34 22z" fill="#8ec5ff" />
      <path className="ink" d="M-16 0v-26h18V0z" fill="#6b4f3a" />
      <path d="M-7 -20v12M-11 -16h8M-12 -10q5 5 10 0" stroke="#fdeecf" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect className="ink" x="8" y="-28" width="14" height="12" rx="2" fill="#fdeecf" strokeWidth="2.5" />
      <path className="ink" d="M36 0v-22h8V0z" fill="#c69a6b" strokeWidth="2.5" />
      <path d="M34 -14h12" stroke="#ff8a7a" strokeWidth="3" />
    </g>
  )
  if (b === 'bell') return (
    <g className={cls}>
      {/* a bell on a wooden frame, rung when an issue needs a person */}
      <path className="ink" d="M-28 0L-22 -78M28 0L22 -78" strokeWidth="5" />
      <path className="ink" d="M-32 -76h64v-10h-64z" fill="#c69a6b" />
      <g className="bd-swing">
        <path className="ink" d="M0 -76v6" />
        <path className="ink" d="M-16 -34q0 -34 16 -36q16 2 16 36z" fill="#ffd85a" />
        <path className="ink" d="M-20 -34h40" />
        <circle className="ink" cy="-28" r="4" fill="#0f0f0f" strokeWidth="2" />
      </g>
    </g>
  )
  if (b === 'library') return (
    <g className={cls}>
      {/* the library: past reviews on the shelves, so fewer patches get sent back */}
      <path className="ink" d="M-40 0v-6h80v6z" fill="#fff" />
      <path className="ink" d="M-34 -6v-38h68v38z" fill="#fff" />
      {[-24, -8, 8, 24].map((x) => <path key={x} className="ink" d={`M${x - 4} -6v-38h8v38z`} fill="#fdeecf" strokeWidth="2.5" />)}
      <path className="ink" d="M-42 -44L0 -68l42 24z" fill="var(--reviewer)" />
      <circle className="ink" cy="-52" r="5" fill="#fff" strokeWidth="2.5" />
    </g>
  )
  if (b === 'lighthouse') return (
    <g className={cls}>
      <path className="ink" d="M-22 0L-15 -110H15L22 0Z" fill="#fff" />
      <path d="M-19.6 -30L-18.2 -50H18.2L19.6 -30ZM-16.9 -70L-15.8 -88H15.8L16.9 -70Z" fill="#ff8a7a" />
      <path className="ink" d="M-22 0L-15 -110H15L22 0Z" fill="none" />
      <path className="ink" d="M-6 0v-13a6 6 0 0112 0V0z" fill="#6b4f3a" />
      <rect x="-22" y="-116" width="44" height="8" rx="2" fill="#0f0f0f" />
      <rect className="ink bd-lamp" x="-13" y="-139" width="26" height="23" fill="#ffe27a" />
      <path className="ink" d="M0 -139v23" />
      <path className="ink" d="M-17 -139L0 -157l17 18z" fill="var(--triager)" />
      <circle className="ink" cy="-160" r="3.5" fill="#fff" strokeWidth="2" />
    </g>
  )
  if (b === 'windmill') return (
    <g className={cls}>
      <path className="ink" d="M-24 0L-16 -80H16L24 0Z" fill="#fff" />
      <path className="ink" d="M-6 0v-14a6 6 0 0112 0V0z" fill="#6b4f3a" />
      <circle className="ink" cy="-46" r="7" fill="#fdeecf" strokeWidth="2.5" />
      <path className="ink" d="M-21 -80L0 -100l21 20z" fill="#ffd85a" />
      <g transform="translate(0 -88)">
        <g className="bd-sails">
          {['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)'].map((c, k) => (
            <g key={k} transform={`rotate(${k * 90})`}><path className="ink" d="M0 0V-10" /><rect className="ink" x="2" y="-72" width="17" height="60" rx="3" fill={c} strokeWidth="2.5" /></g>
          ))}
          <circle r="6" fill="#0f0f0f" />
        </g>
      </g>
    </g>
  )
  if (b === 'workshop') return (
    <g className={cls} transform={still ? undefined : 'scale(1.1)'}>
      {/* the coder's workshop: a sawtooth-roofed shed with a code screen glowing in the open bay */}
      <g className="bd-smoke">{[0, 1, 2].map((k) => <circle key={k} cx="32" cy="-92" r={6 + k * 2} style={{ ['--k' as string]: k }} />)}</g>
      <rect className="ink" x="26" y="-90" width="12" height="28" fill="#fff" />
      <path className="ink" d="M-48 -56V0h96v-56z" fill="#fff" />
      <path className="ink" d="M-52 -54l26 -24v24l26 -24v24l26 -24v24l26 -24v24z" fill="var(--coder)" />
      <rect className="ink" x="-36" y="-40" width="40" height="40" fill="#1d2a5c" />
      <g transform="translate(-29 -32)">
        <rect className="ink" width="26" height="18" rx="3" fill="#0f1330" strokeWidth="2" />
        <g className="bd-code">{[0, 1, 2].map((k) => <rect key={k} x="4" y={4 + k * 4} width={[14, 9, 17][k]} height="2" rx="1" fill={['#6fd07d', '#ffd85a', '#8ec5ff'][k]} style={{ ['--k' as string]: k }} />)}</g>
      </g>
      <g className="bd-sparks"><path d="M-22 -8l-5 -6M-16 -10v-8M-10 -8l5 -6" stroke="#ffd85a" strokeWidth="2.5" strokeLinecap="round" /></g>
      <rect className="ink bd-window" x="16" y="-38" width="22" height="16" rx="3" fill="#fdeecf" />
    </g>
  )
  if (b === 'lab') return (
    <g className={cls}>
      <g className="bd-bubbles">{[0, 1, 2, 3].map((k) => <circle key={k} cx={-14 + k * 9} cy="-80" r={3 + (k % 2)} style={{ ['--k' as string]: k }} />)}</g>
      <path className="ink" d="M-42 0V-34A42 42 0 0142 -34V0Z" fill="#fff" />
      <path d="M-42 -20h84" stroke="var(--tester)" strokeWidth="8" />
      <path className="ink" d="M-42 0V-34A42 42 0 0142 -34V0Z" fill="none" />
      <circle className="ink" cx="0" cy="-44" r="11" fill="#bde8c4" />
      <path className="ink" d="M-8 0v-12h16V0z" fill="#6b4f3a" />
      <g transform="translate(-26 -60)"><path className="ink" d="M-4 -14v8l-6 12h20l-6 -12v-8z" fill="#6fd07d" strokeWidth="2.5" /></g>
      <g transform="translate(28 -58)"><path className="ink" d="M-3 -12v8l-5 10h16l-5 -10v-8z" fill="#8ec5ff" strokeWidth="2.5" /></g>
    </g>
  )
  return (
    <g className={cls}>
      <path className="ink" d="M-18 0L-14 -112H14L18 0Z" fill="#fff" />
      <path className="ink" d="M-20 -112h40v-14h-8v6h-6v-6h-6v6h-6v-6h-6v6h-8z" fill="#fff" />
      <rect className="ink" x="-6" y="-80" width="12" height="16" rx="6" fill="#fdeecf" strokeWidth="2.5" />
      <path className="ink" d="M-6 0v-14a6 6 0 0112 0V0z" fill="#6b4f3a" />
      <path className="ink" d="M0 -126v-30" />
      <path className="ink bd-flag" d="M1 -156h26l-6 8 6 8H1z" fill="var(--reviewer)" strokeWidth="2.5" />
      <g className="bd-stamp"><circle className="ink" cx="30" cy="-96" r="14" fill="var(--reviewer)" /><path d="M23 -96l5 5 9 -10" stroke="#0f0f0f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
    </g>
  )
}
