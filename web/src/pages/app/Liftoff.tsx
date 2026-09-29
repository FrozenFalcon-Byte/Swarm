import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform, useVelocity, type MotionStyle, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { savePrefs, useAllTasks, usePrefs, useProfile, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Repo, Task, TaskState } from '../../lib/types'
import { useWinHeight } from '../../lib/winHeight'
import './liftoff.css'

/*
 * Liftoff: your swarm as a rocket launch you scroll through, edge to edge.
 * The rocket is built from your repositories (one stage each) with you in the capsule. Scroll counts it down; the
 * faster you scroll the harder the engines burn. On the way up every fix your agents shipped flies past, then each
 * repository falls away with its tally, the four agents orbit you with what they did, and the fixes become stars.
 * Below the film is the observatory: light the fixes you're proudest of and they join your constellation (saved to
 * your account and shown at the end of every launch), high-five the crew, or take home a mission patch.
 */

const ROLES = ['triager', 'coder', 'tester', 'reviewer'] as const
type Role = (typeof ROLES)[number]
const SHIPPED: TaskState[] = ['Approved', 'Merged', 'Closed']
const CREW: Record<Role, { name: string; did: string; of: TaskState[]; line: string[] }> = {
  triager: { name: 'Triager', did: 'issues read', of: ['Triaged', 'In Progress', 'Awaiting Tests', 'In Review', 'Approved', 'Merged', 'Closed', 'Rejected', 'Needs Human'],
    line: ['Read every issue so you didn’t have to.', 'Sorted the whole queue before breakfast.', 'Nothing gets past me. Well, nothing important.'] },
  coder: { name: 'Coder', did: 'fixes written', of: ['In Progress', 'Awaiting Tests', 'In Review', 'Approved', 'Merged', 'Closed', 'Rejected'],
    line: ['Kept every fix small, like you asked.', 'Wrote it, rewrote it, then it was perfect.', 'Your codebase is lovely to work in, for the record.'] },
  tester: { name: 'Tester', did: 'fixes tested', of: ['Awaiting Tests', 'In Review', 'Approved', 'Merged', 'Closed', 'Rejected'],
    line: ['Ran it again. Still green. Relax.', 'I break things so you don’t have to.', 'Every test passed. I checked twice.'] },
  reviewer: { name: 'Reviewer', did: 'reviews done', of: ['Approved', 'Merged', 'Closed', 'Rejected'],
    line: ['Signed off. Looks good to me, and so do you.', 'Nothing ships without my nod. This one got it.', 'Proud of this crew. Proud of you.'] },
}

type Fix = { key: string; id: string; title: string; repoId: string; repo: string; at: number; attempts: number; crew: Role[]; role: Role }
type Stage = { id: string; name: string; shipped: number; open: number; role: Role }
type Data = { stages: Stage[]; fixes: Fix[]; counts: Record<Role, number>; waiting: number }

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}
const calm = () => typeof window !== 'undefined' && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion'))
/** a scroll-driven value in a CSS unit (cqh / cqw are the stage's height and width) */
function useU(p: MotionValue<number>, i: number[], o: number[], unit: string) {
  const v = useTransform(p, i, o)
  return useTransform(v, (x) => `${x.toFixed(2)}${unit}`)
}
const ago = (t: number) => {
  const d = Math.round((Date.now() - t) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} months ago` : 'over a year ago'
}

function build(repos: Repo[], tasks: (Task & { repoId: string })[]): Data {
  const name = (id: string) => { const r = repos.find((x) => x.id === id); return r ? r.displayName || r.fullName.split('/').pop() || r.fullName : 'repo' }
  const fixes = tasks.filter((t) => SHIPPED.includes(t.state)).map((t): Fix => {
    const crew = [...new Set((t.history || []).map((h) => h.agent).filter((a): a is Role => (ROLES as readonly string[]).includes(a)))]
    return { key: `${t.repoId}/${t.task_id}`, id: t.task_id, title: t.title, repoId: t.repoId, repo: name(t.repoId), at: Date.parse(t.updated_at) || Date.now(),
      attempts: t.attempts || 1, crew, role: ROLES[Math.floor(hash(t.task_id + t.repoId) * 4)] }
  }).sort((a, b) => a.at - b.at)
  const stages = repos.slice(0, 4).map((r, k): Stage => ({ id: r.id, name: name(r.id), role: ROLES[k % 4],
    shipped: tasks.filter((t) => t.repoId === r.id && SHIPPED.includes(t.state)).length,
    open: tasks.filter((t) => t.repoId === r.id && !SHIPPED.includes(t.state) && t.state !== 'Rejected').length }))
  const counts = Object.fromEntries(ROLES.map((r) => [r, tasks.filter((t) => CREW[r].of.includes(t.state)).length])) as Record<Role, number>
  return { stages, fixes, counts, waiting: tasks.filter((t) => t.state === 'Needs Human').length }
}

function demoData(): Data {
  const titles = ['Login button ignores the second click', 'Dates show in UTC on the invoice page', 'Search drops the last character', 'Dark mode flashes white on load',
    'CSV export misses the header row', 'Avatar upload fails over 2 MB', 'Retry storms when the API is down', 'Typo in the welcome email', 'Cart total rounds the wrong way',
    'Settings page scrolls to the top on save', 'Webhook signature check is too strict', 'Mobile menu hides behind the banner', 'Timezone picker lists Atlantis', 'Slow query on the orders page']
  const repos = ['your-app', 'api', 'docs']
  const now = Date.now()
  const fixes = titles.map((title, k): Fix => ({ key: `demo/${k}`, id: `T-${101 + k}`, title, repoId: 'demo', repo: repos[k % 3], at: now - (titles.length - k) * 2.3 * 86_400_000,
    attempts: 1 + (k % 3 === 0 ? 2 : 0), crew: [...ROLES], role: ROLES[k % 4] }))
  return { fixes, waiting: 2, counts: { triager: 22, coder: 17, tester: 16, reviewer: 15 },
    stages: repos.map((n, k) => ({ id: n, name: n, role: ROLES[k], shipped: fixes.filter((f) => f.repo === n).length, open: 2 + k })) }
}

/* ------------------------------------------------------------------ the page */

export default function Liftoff() {
  const winH = useWinHeight()
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const profile = useProfile(user?.uid)
  const prefs = usePrefs(user?.uid)
  const demo = !loading && !repos.length
  const d = useMemo(() => (demo ? demoData() : build(repos, tasks)), [demo, repos, tasks])
  const name = (profile?.displayName || user?.displayName || '').split(' ')[0]
  // the command bar can send you straight to the observatory
  const { hash: at } = useLocation()
  useEffect(() => {
    if (at !== '#observatory') return
    const id = window.setTimeout(() => document.getElementById('observatory')?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth' }), 700)
    return () => window.clearTimeout(id)
  }, [at])

  // your constellation: saved lit stars, with what you just lit applied at once
  const [mine, setMine] = useState<string[] | null>(null)
  const saved = prefs?.constellation
  const lit = useMemo(() => (mine ?? saved ?? (demo ? ['demo/3', 'demo/7', 'demo/12'] : [])).filter((k) => d.fixes.some((f) => f.key === k)), [mine, saved, demo, d.fixes])
  const setLit = (next: string[]) => {
    setMine(next)
    if (user && !demo) void savePrefs(user.uid, { constellation: next.slice(-60) }).catch(() => setMine(null))
  }

  return (
    <div className="page lf-page" style={winH}>
      <Film d={d} name={name} lit={lit} demo={demo} />
      <Observatory d={d} lit={lit} setLit={setLit} demo={demo} name={name} highFives={prefs?.highFives ?? 0} uid={user?.uid} />
    </div>
  )
}

/* ------------------------------------------------------------------ the film */

const SCENES = [
  { at: 0, k: 'On the pad' }, { at: 0.1, k: 'Countdown' }, { at: 0.22, k: 'Ascent' },
  { at: 0.42, k: 'Staging' }, { at: 0.58, k: 'Orbit' }, { at: 0.78, k: 'Deep space' },
]
const sceneAt = (v: number) => SCENES.reduce((s, x, k) => (v >= x.at ? k : s), 0)
const STARS = Array.from({ length: 140 }, (_, k) => ({ x: hash(`sx${k}`) * 100, y: hash(`sy${k}`) * 100, r: 1 + hash(`sr${k}`) * 2.2, d: hash(`sd${k}`) * 4 }))
const STREAKS = Array.from({ length: 22 }, (_, k) => ({ x: 3 + hash(`st${k}`) * 94, h: 8 + hash(`sh${k}`) * 18, d: 0.35 + hash(`sd${k}`) * 0.5, delay: -hash(`sl${k}`) }))
const CLOUDS = Array.from({ length: 10 }, (_, k) => ({ x: -8 + hash(`cx${k}`) * 90, w: 18 + hash(`cw${k}`) * 22, k }))

function Film({ d, name, lit, demo }: { d: Data; name: string; lit: string[]; demo: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress, scrollY } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.35 })
  // the faster you scroll, the harder the engines burn
  const vel = useVelocity(scrollY)
  const thrust = useSpring(useTransform(vel, (v) => Math.min(1, Math.abs(v) / 2600)), { stiffness: 180, damping: 26 })
  const [scene, setScene] = useState(0)
  const [shake, setShake] = useState(false)
  useMotionValueEvent(p, 'change', (v) => { setScene(sceneAt(v)); setShake(v > 0.13 && v < 0.27 && !calm()) })

  const n = Math.max(1, d.stages.length)
  // the sky slides down as you climb, dawn at the bottom and space at the top
  const skyY = useU(p, [0.2, 0.7], [0, 83.33], '%')
  const spaceO = useTransform(p, [0.34, 0.55], [0, 1])
  const streakO = useTransform([p, thrust] as MotionValue<number>[], ([v, t]: number[]) => (v > 0.21 && v < 0.62 ? 0.18 + t * 0.82 : 0))
  const groundY = useU(p, [0.19, 0.36], [0, 110], 'cqh')
  const hint = useTransform(p, [0, 0.03], [1, 0])
  const alt = useTransform(p, [0.19, 0.42, 0.62, 0.96], [0, 120, 408, 35786])
  const altText = useTransform(alt, (v) => `${Math.round(v).toLocaleString()} km`)
  const speed = useTransform([p, thrust] as MotionValue<number>[], ([v, t]: number[]) => (v < 0.19 ? '0 km/h' : `${Math.round(8000 + v * 20000 + t * 9000).toLocaleString()} km/h`))
  const clock = useTransform(p, (v) => {
    if (v < 0.19) { const s = Math.max(0, Math.ceil((0.19 - v) / 0.03)); return `T− 00:0${Math.min(9, s)}` }
    const s = Math.round((v - 0.19) * 3600); return `T+ ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  })
  const passed = useTransform(p, (v) => String(d.fixes.slice(-12).filter((_, k, l) => v > milestoneAt(k, l.length) + 0.04).length))

  const shipped = d.fixes.length
  const CAPS = [
    { t: name ? `Ready when you are, ${name}.` : 'Ready when you are.', b: `This rocket is your swarm: ${d.stages.length === 1 ? 'one repository' : `${d.stages.length} repositories`} stacked under a capsule, with you in it. The crew has checked everything twice.` },
    { t: 'T-minus three.', b: 'Scroll to count it down. The faster you scroll, the harder the engines burn.' },
    { t: 'Liftoff!', b: shipped ? `Every fix your agents shipped is a milestone on the way up. ${shipped === 1 ? 'One so far' : `${shipped} so far`}. Wave as they go by.` : 'No fixes shipped yet, so the sky is clear. The first one will be up here.' },
    { t: 'Stage separation.', b: 'Each repository did its part. It falls away with its tally, and you keep climbing.' },
    { t: 'In orbit with the crew.', b: 'Your four agents, circling you. Here is what each one carried.' },
    { t: 'Every star is a fix.', b: lit.length ? `The bright ones are your constellation: ${lit.length} ${lit.length === 1 ? 'star' : 'stars'} you lit. Keep going to the observatory to add more.` : 'Keep going to the observatory and light the ones you’re proudest of. They become your constellation.' },
  ]
  const c = CAPS[scene]

  return (
    <section ref={ref} className="lf-film">
      <div className="lf-pin">
        <div className={`lf-stage ${shake ? 'is-shake' : ''}`}>
          <div className="lf-world">
            <motion.div className="lf-sky" style={{ y: skyY }} />
            <motion.div className="lf-space" style={{ opacity: spaceO }}>
              {STARS.map((s, k) => <i key={k} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.r, height: s.r, animationDelay: `${-s.d}s` }} />)}
            </motion.div>
            <motion.div className="lf-streaks" style={{ opacity: streakO }} aria-hidden="true">
              {STREAKS.map((s, k) => <i key={k} style={{ left: `${s.x}%`, height: `${s.h}cqh`, animationDuration: `${s.d}s`, animationDelay: `${s.delay}s` }} />)}
            </motion.div>
            {CLOUDS.map((cl) => <Cloud key={cl.k} p={p} {...cl} />)}
            <motion.div className="lf-ground" style={{ y: groundY }}>
              <Pad p={p} />
            </motion.div>
            <Earth p={p} />
            {d.fixes.slice(-12).map((f, k, l) => <Milestone key={f.key} p={p} f={f} k={k} n={l.length} />)}
            <DeepStars p={p} fixes={d.fixes} lit={lit} />
            {ROLES.map((r, k) => <Satellite key={r} p={p} k={k} role={r} count={d.counts[r]} />)}
            <Rocket p={p} thrust={thrust} stages={d.stages} n={n} />
            <Countdown p={p} />
          </div>

          <div className="lf-hud lf-hud--l">
            <span className="lf-chip"><b>Liftoff</b><Link to="/app/fun" className="lf-back">← Just for fun</Link></span>
          </div>
          <div className="lf-hud lf-hud--r" aria-hidden="true">
            <span className="lf-chip lf-meter"><small>Mission clock</small><motion.b>{clock}</motion.b></span>
            <span className="lf-chip lf-meter"><small>Altitude</small><motion.b>{altText}</motion.b></span>
            <span className="lf-chip lf-meter"><small>Speed</small><motion.b>{speed}</motion.b></span>
            {!!d.fixes.length && <span className="lf-chip lf-meter"><small>Fixes passed</small><motion.b>{passed}</motion.b></span>}
          </div>
          {demo && <div className="lf-demo">A sample launch. <Link to="/app/repos">Add a repo</Link> and it’s your swarm up there.</div>}

          <AnimatePresence mode="wait">
            <motion.div key={scene} className="lf-caption" initial={{ opacity: 0, y: 28, rotate: -1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.45, ease: easeOut }}>
              <span className="lf-caption-k">{String(scene + 1).padStart(2, '0')} · {SCENES[scene].k}</span>
              <b>{c.t}</b>
              <p>{c.b}</p>
            </motion.div>
          </AnimatePresence>
          <div className="lf-rail" aria-hidden="true">{SCENES.map((s, k) => <i key={s.k} className={k === scene ? 'on' : k < scene ? 'done' : ''} />)}</div>
          <motion.div className="lf-hint" style={{ opacity: hint }} aria-hidden="true"><span>Scroll to launch</span><i /></motion.div>
        </div>
      </div>
    </section>
  )
}

/** the launch pad: hills, the tower, and the crew waving you off */
function Pad({ p }: { p: MotionValue<number> }) {
  const arm = useTransform(p, [0.1, 0.16], [0, -70])
  const puff = useTransform(p, [0.11, 0.2, 0.3], [0.1, 1, 1.9])
  const puffO = useTransform(p, [0.1, 0.13, 0.26, 0.34], [0, 1, 1, 0])
  return (
    <>
      <svg className="lf-hills" viewBox="0 0 1600 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d="M0 210 C 220 120 420 170 620 150 S 1000 90 1200 150 S 1480 170 1600 130 V360 H0z" fill="#a7dca9" stroke="#0f0f0f" strokeWidth="4" />
        <path d="M0 260 C 260 200 520 250 800 230 S 1300 200 1600 240 V360 H0z" fill="#86d08c" stroke="#0f0f0f" strokeWidth="4" />
        <path d="M0 300 H1600 V360 H0z" fill="#8a6242" stroke="#0f0f0f" strokeWidth="4" />
        <rect x="680" y="284" width="240" height="22" rx="6" fill="#c9c9c9" stroke="#0f0f0f" strokeWidth="4" />
      </svg>
      <div className="lf-tower" aria-hidden="true">
        <svg viewBox="0 0 80 300">
          <path d="M14 300 V20 M52 300 V20 M14 20 H52" stroke="#0f0f0f" strokeWidth="5" fill="none" />
          {Array.from({ length: 14 }, (_, k) => <path key={k} d={`M14 ${40 + k * 19} L52 ${58 + k * 19} M52 ${40 + k * 19} L14 ${58 + k * 19}`} stroke="#0f0f0f" strokeWidth="2.5" />)}
          <circle cx="33" cy="12" r="7" fill="var(--tester)" stroke="#0f0f0f" strokeWidth="3" className="lf-beacon" />
        </svg>
        <motion.div className="lf-arm" style={{ rotate: arm }} />
      </div>
      <div className="lf-crew" aria-hidden="true">
        {ROLES.map((r, k) => (
          <span key={r} className="lf-crewmate" style={{ ['--c' as string]: `var(--${r})`, animationDelay: `${-k * 0.3}s`, left: k < 2 ? `calc(50% - ${34 + k * 7}cqh)` : `calc(50% + ${22 + (k - 2) * 7}cqh)` }}>
            <i className="lf-wave" />
          </span>
        ))}
      </div>
      <motion.div className="lf-smoke" style={{ scale: puff, opacity: puffO }} aria-hidden="true">
        {Array.from({ length: 14 }, (_, k) => <i key={k} style={{ left: `${50 + (k - 6.5) * 6.2}%`, width: `${9 + (k % 3) * 3}cqh`, height: `${9 + (k % 3) * 3}cqh`, animationDelay: `${-k * 0.2}s` }} />)}
      </motion.div>
    </>
  )
}

function Cloud({ p, x, w, k }: { p: MotionValue<number>; x: number; w: number; k: number }) {
  const s = 0.2 + k * 0.024
  const y = useU(p, [s, s + 0.1], [-40, 130], 'cqh')
  const opacity = useTransform(p, [s - 0.001, s, s + 0.1, s + 0.101], [0, 1, 1, 0])
  return (
    <motion.div className="lf-cloud" style={{ left: `${x}%`, width: `${w}cqw`, y, opacity }} aria-hidden="true">
      <i /><i /><i />
    </motion.div>
  )
}

const milestoneAt = (k: number, n: number) => 0.23 + (k / Math.max(1, n)) * 0.17

/** a shipped fix flying past on the way up */
function Milestone({ p, f, k, n }: { p: MotionValue<number>; f: Fix; k: number; n: number }) {
  const s = milestoneAt(k, n)
  const y = useU(p, [s, s + 0.09], [-40, 125], 'cqh')
  const rotate = useTransform(p, [s, s + 0.09], [k % 2 ? 8 : -8, k % 2 ? -4 : 4])
  const opacity = useTransform(p, [s - 0.001, s, s + 0.09, s + 0.091], [0, 1, 1, 0])
  return (
    <motion.div className={`lf-mile ${k % 2 ? 'is-r' : 'is-l'}`} style={{ y, rotate, opacity, ['--c' as string]: `var(--${f.role})` } as MotionStyle}>
      <span className="lf-mile-k">✓ {f.id} · {f.repo}</span>
      <b>{f.title}</b>
      <span className="lf-mile-crew">{(f.crew.length ? f.crew : ROLES).map((r) => <i key={r} style={{ background: `var(--${r})` }} />)} shipped {ago(f.at)}</span>
    </motion.div>
  )
}

/** your rocket: a capsule with you in it, one stage per repository, engines that follow your scrolling */
function Rocket({ p, thrust, stages, n }: { p: MotionValue<number>; thrust: MotionValue<number>; stages: Stage[]; n: number }) {
  const segH = 9, capH = 18
  const centre = 100 - 16 - (capH + segH * n + 4) / 2
  const capCentre = 100 - 16 - (capH + segH * n + 4) + capH / 2
  const y = useU(p, [0, 0.19, 0.3, 0.42, 0.6, 0.78, 1], [0, 0, 44 - centre, 44 - centre, 48 - capCentre, 48 - capCentre, 46 - capCentre], 'cqh')
  const capScale = useTransform(p, [0.78, 0.92], [1, 0.72])
  const capFlame = useTransform([p, thrust] as MotionValue<number>[], ([v, t]: number[]) => (v > stageAt(n - 1, n) + 0.02 && v < 0.8 ? 0.35 + t * 0.9 : 0))
  return (
    <motion.div className="lf-rocket" style={{ y, ['--seg' as string]: `${segH}cqh`, ['--cap' as string]: `${capH}cqh` } as MotionStyle}>
      <motion.div className="lf-capsule" style={{ scale: capScale }}>
        <svg viewBox="0 0 100 180" className="lf-capsule-svg" aria-hidden="true">
          <path d="M50 4 C 80 40 92 90 92 176 H8 C 8 90 20 40 50 4z" fill="#fff" stroke="#0f0f0f" strokeWidth="5" />
          <path d="M50 4 C 64 20 74 36 80 52 H20 C 26 36 36 20 50 4z" fill="var(--tester)" stroke="#0f0f0f" strokeWidth="5" />
          <circle cx="50" cy="104" r="30" fill="var(--coder)" stroke="#0f0f0f" strokeWidth="5" />
        </svg>
        <span className="lf-window"><Avatar size={64} /></span>
        <motion.span className="lf-flame lf-flame--sm" style={{ scaleY: capFlame, opacity: useTransform(capFlame, (v) => (v > 0 ? 1 : 0)) }} />
      </motion.div>
      {stages.map((s, k) => <Segment key={s.id} p={p} thrust={thrust} s={s} j={stages.length - 1 - k} n={n} />)}
      {!stages.length && <div className="lf-seg" style={{ ['--c' as string]: 'var(--reviewer)' } as CSSProperties}><span className="lf-seg-name">swarm</span></div>}
    </motion.div>
  )
}

const stageAt = (j: number, n: number) => 0.43 + (j / Math.max(1, n)) * 0.13

/** one repository's stage; j counts from the bottom, which falls away first */
function Segment({ p, thrust, s, j, n }: { p: MotionValue<number>; thrust: MotionValue<number>; s: Stage; j: number; n: number }) {
  const at = stageAt(j, n), side = j % 2 ? 1 : -1
  const y = useU(p, [at, at + 0.1], [0, 75], 'cqh')
  const x = useU(p, [at, at + 0.1], [0, side * 16], 'cqw')
  const rotate = useTransform(p, [at, at + 0.1], [0, side * 38])
  const opacity = useTransform(p, [at + 0.07, at + 0.1], [1, 0])
  const tag = useTransform(p, [at - 0.005, at + 0.01, at + 0.06, at + 0.08], [0, 1, 1, 0])
  // only the lowest stage still attached burns
  const flame = useTransform([p, thrust] as MotionValue<number>[], ([v, t]: number[]) => {
    const lowest = Array.from({ length: n }, (_, i) => i).find((i) => v < stageAt(i, n) + 0.005)
    if (v < 0.11 || lowest !== j) return 0
    return v < 0.19 ? 0.25 + Math.random() * 0.15 : 0.55 + t * 1.3
  })
  return (
    <motion.div className="lf-seg" style={{ x, y, rotate, opacity, ['--c' as string]: `var(--${s.role})` } as MotionStyle}>
      <span className="lf-seg-name">{s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name}</span>
      <i className="lf-fin lf-fin--l" /><i className="lf-fin lf-fin--r" />
      <span className="lf-nozzle" />
      <motion.span className="lf-flame" style={{ scaleY: flame, opacity: useTransform(flame, (v) => (v > 0 ? 1 : 0)) }} />
      <motion.span className={`lf-tag ${side > 0 ? 'is-r' : 'is-l'}`} style={{ opacity: tag }}>
        <b>{s.name}</b> {s.shipped} shipped{s.open ? ` · ${s.open} on the go` : ''}
      </motion.span>
    </motion.div>
  )
}

function Countdown({ p }: { p: MotionValue<number> }) {
  return (
    <div className="lf-count" aria-hidden="true">
      {['3', '2', '1', 'LIFTOFF'].map((t, k) => <CountNum key={t} p={p} t={t} s={0.1 + k * 0.03} />)}
    </div>
  )
}
function CountNum({ p, t, s }: { p: MotionValue<number>; t: string; s: number }) {
  const scale = useTransform(p, [s, s + 0.012, s + 0.03], [2.6, 1, t === 'LIFTOFF' ? 1.4 : 0.7])
  const opacity = useTransform(p, [s - 0.001, s + 0.006, s + 0.022, s + 0.03], [0, 1, 1, 0])
  const rotate = useTransform(p, [s, s + 0.012], [t === 'LIFTOFF' ? -8 : 12, t === 'LIFTOFF' ? -3 : 0])
  return <motion.b className={t === 'LIFTOFF' ? 'is-go' : ''} style={{ scale, opacity, rotate }}>{t}</motion.b>
}

function Earth({ p }: { p: MotionValue<number> }) {
  const y = useU(p, [0.55, 0.65, 0.78, 0.88], [110, 64, 64, 120], 'cqh')
  const rotate = useTransform(p, [0.55, 0.88], [0, -30])
  return (
    <motion.div className="lf-earth" style={{ y }} aria-hidden="true">
      <motion.div className="lf-earth-ball" style={{ rotate }}>
        <i style={{ left: '38%', top: '6%', width: '14%', height: '7%' }} /><i style={{ left: '55%', top: '3%', width: '9%', height: '11%' }} />
        <i style={{ left: '24%', top: '10%', width: '8%', height: '5%' }} /><i style={{ left: '66%', top: '9%', width: '12%', height: '6%' }} />
      </motion.div>
    </motion.div>
  )
}

/** an agent in orbit round the capsule with what it did */
function Satellite({ p, k, role, count }: { p: MotionValue<number>; k: number; role: Role; count: number }) {
  const ang = useTransform(p, (v) => ((v - 0.58) * 1300 + k * 90) * (Math.PI / 180))
  const x = useTransform(ang, (a) => `${(Math.cos(a) * 30).toFixed(2)}cqw`)
  const y = useTransform(ang, (a) => `${(Math.sin(a) * 20).toFixed(2)}cqh`)
  const scale = useTransform(ang, (a) => 0.8 + Math.sin(a) * 0.2)
  const opacity = useTransform(p, [0.575, 0.61, 0.76, 0.79], [0, 1, 1, 0])
  const shown = useTransform(p, [0.6, 0.68], [0, count])
  const num = useTransform(shown, (v) => String(Math.round(v)))
  const c = CREW[role]
  return (
    <motion.div className="lf-sat" style={{ x, y, scale, opacity, ['--c' as string]: `var(--${role})` } as MotionStyle}>
      <span className="lf-sat-body"><i className="lf-panel lf-panel--l" /><i className="lf-sat-core" /><i className="lf-panel lf-panel--r" /></span>
      <span className="lf-sat-tag"><small>{c.name}</small><motion.b>{num}</motion.b><small>{c.did}</small></span>
    </motion.div>
  )
}

/** the end of the film: every shipped fix as a star, your lit ones joined up */
function DeepStars({ p, fixes, lit }: { p: MotionValue<number>; fixes: Fix[]; lit: string[] }) {
  const opacity = useTransform(p, [0.78, 0.84], [0, 1])
  const draw = useTransform(p, [0.88, 0.97], [0, 1])
  const pts = starPoints(fixes.slice(-48))
  const litPts = lit.map((k) => pts.find((q) => q.f.key === k)).filter(Boolean) as typeof pts
  return (
    <motion.div className="lf-deep" style={{ opacity }} aria-hidden="true">
      <svg aria-hidden="true">
        {litPts.slice(1).map((q, k) => <motion.line key={q.f.key} x1={`${litPts[k].x}%`} y1={`${litPts[k].y}%`} x2={`${q.x}%`} y2={`${q.y}%`} stroke="#fff6b0" strokeWidth="2" strokeLinecap="round" style={{ pathLength: draw }} />)}
      </svg>
      {pts.map((q) => {
        const on = lit.includes(q.f.key)
        return <DeepStar key={q.f.key} p={p} x={q.x} y={q.y} on={on} role={q.f.role} at={0.8 + hash(q.f.key) * 0.08} />
      })}
    </motion.div>
  )
}
function DeepStar({ p, x, y, on, role, at }: { p: MotionValue<number>; x: number; y: number; on: boolean; role: Role; at: number }) {
  const scale = useTransform(p, [at, at + 0.02], [0, 1])
  return <motion.i className={on ? 'on' : ''} style={{ left: `${x}%`, top: `${y}%`, scale, ['--c' as string]: `var(--${role})` } as MotionStyle} />
}
/** where each fix sits in the sky: spread out, the same place every time */
function starPoints(fixes: Fix[]) {
  return fixes.map((f, k) => {
    const col = k % 8, row = Math.floor(k / 8)
    return { f, x: 8 + ((col + hash(f.key) * 0.8) / 8) * 84, y: 10 + ((row + hash(f.key + 'y') * 0.8) / Math.max(1, Math.ceil(fixes.length / 8))) * 72 }
  })
}

/* ------------------------------------------------------------------ the observatory */

function cheer(f: Fix) {
  const who = f.crew.length ? f.crew : [...ROLES]
  const r = who[Math.floor(hash(f.key + 'w') * who.length)]
  const lines = [
    f.attempts > 1 ? `Took ${f.attempts} tries. Nobody gave up on it.` : 'Right the first time. The reviewer barely had to look.',
    `${who.length === 4 ? 'All four agents' : `${who.length} ${who.length === 1 ? 'agent' : 'agents'}`} touched this one before it shipped.`,
    `The ${CREW[r].name.toLowerCase()} still talks about this one.`,
    'One less thing for you to think about. Ever.',
    `Shipped ${ago(f.at)} and still holding up.`,
  ]
  return lines[Math.floor(hash(f.key) * lines.length)]
}

type Burst = { id: number; x: number; y: number }

function Observatory({ d, lit, setLit, demo, name, highFives, uid }: {
  d: Data; lit: string[]; setLit: (n: string[]) => void; demo: boolean; name: string; highFives: number; uid?: string
}) {
  const toast = useToast()
  const pts = useMemo(() => starPoints(d.fixes.slice(-48)), [d.fixes])
  const [sel, setSel] = useState<string | null>(null)
  const [pop, setPop] = useState<string | null>(null)
  const [bursts, setBursts] = useState<Burst[]>([])
  const [fives, setFives] = useState(0)
  const saveT = useRef(0)
  const f = pts.find((q) => q.f.key === sel)?.f
  const litPts = lit.map((k) => pts.find((q) => q.f.key === k)).filter(Boolean) as typeof pts
  const total = highFives + fives

  const tap = (key: string) => {
    setSel(key)
    if (!lit.includes(key)) { setLit([...lit, key]); setPop(key); window.setTimeout(() => setPop((x) => (x === key ? null : x)), 900) }
  }
  const highFive = (e: ReactMouseEvent) => {
    const id = Date.now() + Math.random()
    setBursts((b) => [...b, { id, x: e.clientX, y: e.clientY }])
    window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1700)
    const n = total + 1
    setFives((x) => x + 1)
    const r = ROLES[n % 4], lines = CREW[r].line
    toast.ok(`High five from the ${CREW[r].name}`, lines[Math.floor(hash(`${n}`) * lines.length)])
    if (uid && !demo) {
      window.clearTimeout(saveT.current)
      saveT.current = window.setTimeout(() => { void savePrefs(uid, { highFives: n }).then(() => setFives(0)).catch(() => {}) }, 700)
    }
  }
  useEffect(() => () => window.clearTimeout(saveT.current), [])

  return (
    <section className="lf-obs" id="observatory">
      <div className="lf-obs-sky" aria-hidden="true">{STARS.slice(0, 90).map((s, k) => <i key={k} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.r, height: s.r, animationDelay: `${-s.d}s` }} />)}</div>
      <div className="lf-field">
        <svg aria-hidden="true">
          {litPts.slice(1).map((q, k) => (
            <motion.line key={`${litPts[k].f.key}>${q.f.key}`} x1={`${litPts[k].x}%`} y1={`${litPts[k].y}%`} x2={`${q.x}%`} y2={`${q.y}%`} stroke="#fff6b0" strokeWidth="2.2" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.9 }} transition={{ duration: 0.7, ease: easeOut }} />
          ))}
        </svg>
        {pts.map((q, k) => {
          const on = lit.includes(q.f.key)
          return (
            <motion.button key={q.f.key} className={`lf-star ${on ? 'on' : ''} ${sel === q.f.key ? 'sel' : ''}`} style={{ left: `${q.x}%`, top: `${q.y}%`, ['--c' as string]: `var(--${q.f.role})` } as MotionStyle}
              initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: (k % 12) * 0.03 }}
              onClick={() => tap(q.f.key)} aria-pressed={on} aria-label={`${q.f.title}${on ? ', lit' : ''}`}>
              <i />
              <span className="lf-star-name">{q.f.title}</span>
              <AnimatePresence>{pop === q.f.key && <motion.em className="lf-star-ring" initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 3.4, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.8, ease: easeOut }} />}</AnimatePresence>
            </motion.button>
          )
        })}
        {!pts.length && <p className="lf-empty">No stars yet. When your swarm ships its first fix, a star appears right here.</p>}
      </div>

      <div className="lf-obs-card">
        <span className="lf-caption-k">The observatory</span>
        <AnimatePresence mode="wait" initial={false}>
          {f ? (
            <motion.div key={f.key} className="lf-obs-body" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.3, ease: easeOut }}>
              <span className="lf-mile-k">✓ {f.id} · {f.repo} · {ago(f.at)}</span>
              <h2>{f.title}</h2>
              <p className="lf-cheer">“{cheer(f)}”</p>
              <span className="lf-mile-crew">{(f.crew.length ? f.crew : ROLES).map((r) => <i key={r} style={{ background: `var(--${r})` }} title={CREW[r].name} />)} the crew on this one</span>
              <div className="lf-obs-go">
                {lit.includes(f.key)
                  ? <button className="btn btn-line btn-sm" onClick={() => { setLit(lit.filter((k) => k !== f.key)); setSel(null) }}>Put it out</button>
                  : <button className="btn btn-dark btn-sm" onClick={() => tap(f.key)}>Light it</button>}
                {!demo && <Link className="btn btn-line btn-sm" to={`/app/repos/${f.repoId}/tasks/${f.id}`}>Open the task</Link>}
              </div>
            </motion.div>
          ) : (
            <motion.div key="intro" className="lf-obs-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <h2>{name ? `${name}’s constellation` : 'Your constellation'}</h2>
              <p>Every star is a fix your swarm shipped. Tap the ones you’re proudest of to light them. They join up into your constellation, it’s saved to your account, and it shines at the end of every launch.</p>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="lf-obs-stats">
          <span><b>{lit.length}</b> lit</span><span><b>{d.fixes.length}</b> {d.fixes.length === 1 ? 'star' : 'stars'}</span><span><b>{total}</b> high fives</span>
        </div>
      </div>

      <div className="lf-dock">
        <motion.button className="btn btn-green lf-five" onClick={highFive} whileTap={{ scale: 0.9, rotate: -6 }}>
          <span aria-hidden="true" className="lf-hand">✋</span> High-five the crew
        </motion.button>
        <button className="btn btn-line" onClick={() => void downloadPatch({ name, shipped: d.fixes.length, repos: d.stages.length, lit: litPts.map((q) => ({ x: q.x, y: q.y })) }).then(() => toast.ok('Mission patch saved', 'Sew it on something.'), () => toast.error('Couldn’t make the patch'))}>
          Mission patch
        </button>
        <button className="btn btn-line" onClick={() => window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' })}>Launch again ↑</button>
      </div>

      {bursts.map((b) => <Confetti key={b.id} x={b.x} y={b.y} seed={b.id} />)}
    </section>
  )
}

function Confetti({ x, y, seed }: { x: number; y: number; seed: number }) {
  const bits = useMemo(() => Array.from({ length: 42 }, (_, k) => {
    const a = hash(`${seed}a${k}`) * Math.PI * 2, sp = 90 + hash(`${seed}s${k}`) * 260
    return { dx: Math.cos(a) * sp, dy: Math.sin(a) * sp - 140, r: hash(`${seed}r${k}`) * 720 - 360, c: ROLES[k % 4], w: 7 + (k % 3) * 3, round: k % 5 === 0 }
  }), [seed])
  return (
    <div className="lf-confetti" style={{ left: x, top: y }} aria-hidden="true">
      {bits.map((b, k) => (
        <motion.i key={k} style={{ background: `var(--${b.c})`, width: b.w, height: b.round ? b.w : b.w * 0.55, borderRadius: b.round ? '50%' : 2 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }} animate={{ x: b.dx, y: [0, b.dy, b.dy + 260], rotate: b.r, opacity: [1, 1, 0] }}
          transition={{ duration: 1.5, ease: [0.2, 0.7, 0.4, 1], times: [0, 0.45, 1] }} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ the mission patch */

async function downloadPatch({ name, shipped, repos, lit }: { name: string; shipped: number; repos: number; lit: { x: number; y: number }[] }) {
  const S = 900, c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const css = getComputedStyle(document.documentElement)
  const col = (v: string, f: string) => css.getPropertyValue(v).trim() || f
  const agents = [col('--triager', '#fbe74e'), col('--coder', '#9dc4f5'), col('--tester', '#ff8a7a'), col('--reviewer', '#5dd36a')]
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const cx = S / 2, cy = S / 2
  // the badge: a hard shadow, a navy disc, a gold rim
  g.fillStyle = '#0f0f0f'; g.beginPath(); g.arc(cx + 14, cy + 16, 420, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#f5c542'; g.beginPath(); g.arc(cx, cy, 420, 0, Math.PI * 2); g.fill()
  g.lineWidth = 12; g.strokeStyle = '#0f0f0f'; g.stroke()
  g.fillStyle = '#141a4a'; g.beginPath(); g.arc(cx, cy, 330, 0, Math.PI * 2); g.fill(); g.stroke()
  // stars, and your constellation joined up
  for (let k = 0; k < 70; k++) { g.fillStyle = 'rgba(255,255,255,.8)'; const a = hash(`pa${k}`) * Math.PI * 2, r = Math.sqrt(hash(`pr${k}`)) * 310; g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 3) }
  if (lit.length) {
    const map = (q: { x: number; y: number }) => [cx - 230 + (q.x / 100) * 460, cy - 250 + (q.y / 100) * 200] as const
    g.strokeStyle = '#fff6b0'; g.lineWidth = 4; g.beginPath(); lit.forEach((q, k) => { const [x, y] = map(q); if (k) g.lineTo(x, y); else g.moveTo(x, y) }); g.stroke()
    lit.forEach((q) => { const [x, y] = map(q); g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill() })
  }
  // the rocket
  g.save(); g.translate(cx, cy + 40); g.rotate(-0.35)
  g.lineWidth = 8; g.strokeStyle = '#0f0f0f'
  g.fillStyle = agents[2]; g.beginPath(); g.moveTo(-40, 90); g.lineTo(-80, 150); g.lineTo(-40, 140); g.closePath(); g.fill(); g.stroke()
  g.beginPath(); g.moveTo(40, 90); g.lineTo(80, 150); g.lineTo(40, 140); g.closePath(); g.fill(); g.stroke()
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -170); g.bezierCurveTo(50, -110, 48, -20, 44, 150); g.lineTo(-44, 150); g.bezierCurveTo(-48, -20, -50, -110, 0, -170); g.closePath(); g.fill(); g.stroke()
  g.fillStyle = agents[1]; g.beginPath(); g.arc(0, -50, 26, 0, Math.PI * 2); g.fill(); g.stroke()
  g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(-30, 158); g.quadraticCurveTo(0, 290, 30, 158); g.closePath(); g.fill(); g.stroke()
  g.restore()
  // the four agents
  agents.forEach((a, k) => { const ang = Math.PI * (0.62 + k * 0.25); g.fillStyle = a; g.beginPath(); g.arc(cx + Math.cos(ang) * 250, cy + Math.sin(ang) * 250, 22, 0, Math.PI * 2); g.fill(); g.lineWidth = 6; g.stroke() })
  // lettering round the rim
  const arc = (text: string, r: number, down: boolean) => {
    g.save(); g.translate(cx, cy); g.font = `800 50px ${font}`; g.fillStyle = '#0f0f0f'; g.textAlign = 'center'; g.textBaseline = 'middle'
    const chars = [...text], step = 0.083, span = (chars.length - 1) * step
    chars.forEach((ch, k) => {
      // along the top, left to right clockwise; along the bottom, left to right anticlockwise so it reads the right way up
      const a = down ? Math.PI / 2 + span / 2 - k * step : -Math.PI / 2 - span / 2 + k * step
      g.save(); g.translate(Math.cos(a) * r, Math.sin(a) * r); g.rotate(down ? a - Math.PI / 2 : a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore()
    })
    g.restore()
  }
  arc(`MISSION ${(name || 'SWARM').toUpperCase().slice(0, 14)}`, 375, false)
  arc(`${shipped} FIXES · ${repos} ${repos === 1 ? 'REPO' : 'REPOS'}`, 375, true)
  g.font = `700 26px ${font}`; g.fillStyle = '#fff'; g.textAlign = 'center'
  g.fillText(new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase(), cx, cy + 290)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('no image')
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = `swarm-mission-patch${name ? `-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.png`
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
