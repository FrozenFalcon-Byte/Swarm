import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import { AGENTS, type Repo, type Task } from '../../lib/types'
import { PageHead } from './Overview'
import { CountUp } from './ui'
import './fun.css'

/*
 * Rewind: your swarm's week (or month, or all of it) as a short film, told like a story you tap through.
 * Each scene is one fact from your own boards drawn as motion graphics: issues raining into a pile, the four
 * agents racing each other, a wall of sandbox runs turning from red to green, a stopwatch, a heat map of when
 * the work happens, the one issue that fought back, what kept breaking, and what's waiting for you now.
 * Scenes with nothing to show are left out. Everything is drawn from the theme's tokens, so it follows the
 * look, highlight colour, corners and night mode you picked.
 */

type Period = 'week' | 'month' | 'all'
type T = Task & { repoId: string }
const PERIODS: [Period, string][] = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']]
const DAY = 24 * 3600_000
const SCENE_MS = 6500
const NAME: Record<string, string> = { triager: 'Triager', coder: 'Coder', tester: 'Tester', reviewer: 'Reviewer' }
const CAUSE: Record<string, [string, string]> = {
  'hash-order': ['Set ordering', 'Results that came out of a set in a different order each run.'],
  rng: ['Randomness', 'Random numbers drawn without a fixed seed.'],
  time: ['The clock', 'Tests that raced the clock and sometimes lost.'],
  clock: ['The clock', 'Tests that raced the clock and sometimes lost.'],
  jitter: ['Timing jitter', 'Waits that were just long enough, most of the time.'],
  'shared-state': ['Shared state', 'Tests that left something behind for the next one.'],
}
const DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')

function duration(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${Math.max(1, m)} min`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`
}
const hourWord = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'am' : 'pm'}`)

/* ------------------------------------------------------------------ the numbers */

function rewind(tasks: T[], repos: Repo[], period: Period) {
  const now = Date.now(), from = period === 'week' ? now - 7 * DAY : period === 'month' ? now - 30 * DAY : -Infinity
  const inP = (ts?: string) => { const t = ts ? Date.parse(ts) : NaN; return t >= from && t <= now + 60_000 }
  const events = tasks.flatMap((t) => t.history.filter((h) => inP(h.ts)).map((h) => ({ ...h, t })))
  const touched = tasks.filter((t) => inP(t.created_at) || t.history.some((h) => inP(h.ts)))
  const arrived = tasks.filter((t) => inP(t.created_at))
  const repoName = (id: string) => { const r = repos.find((x) => x.id === id); return r?.displayName || r?.fullName?.split('/').pop() || 'a repository' }

  const perRepo = new Map<string, number>()
  arrived.forEach((t) => perRepo.set(t.repoId, (perRepo.get(t.repoId) || 0) + 1))
  const topRepo = [...perRepo].sort((a, b) => b[1] - a[1])[0]

  const crew = AGENTS.map((a) => ({ agent: a as string, n: events.filter((e) => e.agent === a).length })).sort((a, b) => b.n - a.n)
  const moves = crew.reduce((s, c) => s + c.n, 0)

  const fixed = tasks.flatMap((t) => {
    const ok = t.history.find((h) => h.to_state === 'Approved' && inP(h.ts))
    return ok ? [{ t, ms: Date.parse(ok.ts) - Date.parse(t.created_at), first: !t.history.some((h) => h.to_state === 'Rejected') }] : []
  })
  const times = fixed.map((f) => f.ms).filter((ms) => ms >= 0).sort((a, b) => a - b)
  const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null
  const merged = tasks.filter((t) => t.history.some((h) => h.to_state === 'Merged' && inP(h.ts))).length

  let runs = 0, bRuns = 0, bFail = 0, aRuns = 0, aFail = 0
  for (const t of touched) for (const ev of Object.values(t.artifacts.test_summary?.harness?.evidence || {})) {
    runs += (ev.before?.runs || 0) + (ev.after?.runs || 0)
    bRuns += ev.before?.runs || 0; bFail += ev.before?.failures || 0
    aRuns += ev.after?.runs || 0; aFail += ev.after?.failures || 0
  }

  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
  for (const e of events) { const d = new Date(e.ts); grid[(d.getDay() + 6) % 7][d.getHours()]++ }
  let peak = { d: 0, h: 0, n: 0 }
  grid.forEach((row, d) => row.forEach((n, h) => { if (n > peak.n) peak = { d, h, n } }))
  const night = events.filter((e) => { const h = new Date(e.ts).getHours(); return h >= 22 || h < 6 }).length

  const tough = touched.map((t) => ({ t, back: t.history.filter((h) => h.to_state === 'Rejected').length, tries: t.attempts || 0 }))
    .filter((x) => x.back > 0 || x.tries > 1).sort((a, b) => b.back * 2 + b.tries - (a.back * 2 + a.tries))[0]

  const causeCount = new Map<string, number>()
  for (const t of touched) {
    const c = t.artifacts.flakiness_source || t.kind
    if (c && CAUSE[c]) causeCount.set(CAUSE[c][0], (causeCount.get(CAUSE[c][0]) || 0) + 1)
  }
  const causes = [...causeCount].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, n]) => ({ label, n, why: Object.values(CAUSE).find((c) => c[0] === label)![1] }))

  const waiting = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human')
    .sort((a, b) => (a.state === 'Approved' ? -1 : 1) - (b.state === 'Approved' ? -1 : 1))

  return {
    arrived: arrived.length, topRepo: topRepo ? { name: repoName(topRepo[0]), n: topRepo[1] } : null, repoCount: new Set(touched.map((t) => t.repoId)).size,
    crew, moves, fixed: fixed.length, merged, median, firstTry: fixed.filter((f) => f.first).length,
    runs, before: bRuns ? bFail / bRuns : null, after: aRuns ? aFail / aRuns : null,
    grid, peak, night, events: events.length,
    tough: tough ? { title: tough.t.title, repo: repoName(tough.t.repoId), back: tough.back, tries: tough.tries, state: tough.t.state } : null,
    causes, waiting: waiting.map((t) => ({ title: t.title, state: t.state, to: `/app/repos/${t.repoId}/tasks/${t.task_id}` })),
  }
}
type Stats = ReturnType<typeof rewind>

/* ------------------------------------------------------------------ the page */

export default function Rewind() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id)) as T[]
  const [period, setPeriod] = useState<Period>('week')
  const s = useMemo(() => rewind(tasks, repos, period), [tasks, repos, period])
  const first = (user?.displayName || user?.email || 'there').split(/[ @]/)[0]
  return (
    <div className="page rw-page">
      <PageHead title="Rewind" sub="Your swarm as a short film. Tap through what came in, who did what, what kept breaking and what’s waiting for you.">
        <Link to="/app/fun" className="btn btn-line btn-sm fun-back">← Just for fun</Link>
      </PageHead>
      <div className="rw-periods" role="tablist" aria-label="Period">
        <LayoutGroup id="rw-period">
          {PERIODS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={period === k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>
              {period === k && <motion.span layoutId="rw-period-on" className="rw-period-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span>{label}</span>
            </button>
          ))}
        </LayoutGroup>
      </div>
      <Player key={period} s={s} first={first} period={period} />
    </div>
  )
}

type Scene = { id: string; tint: string; render: () => ReactNode }

function Player({ s, first, period }: { s: Stats; first: string; period: Period }) {
  const toast = useToast()
  const word = period === 'week' ? 'week' : period === 'month' ? 'month' : 'time'
  const scenes = useMemo<Scene[]>(() => {
    const list: Scene[] = [{ id: 'intro', tint: 'var(--accent-soft, var(--mint))', render: () => <Intro s={s} first={first} period={period} /> }]
    if (s.arrived) list.push({ id: 'arrivals', tint: 'var(--triager)', render: () => <Arrivals s={s} /> })
    if (s.moves) list.push({ id: 'crew', tint: 'var(--coder)', render: () => <Crew s={s} /> })
    if (s.runs) list.push({ id: 'runs', tint: 'var(--tester)', render: () => <Runs s={s} /> })
    if (s.fixed) list.push({ id: 'fixes', tint: 'var(--reviewer)', render: () => <Fixes s={s} /> })
    if (s.events >= 5) list.push({ id: 'rhythm', tint: 'var(--lab)', render: () => <Rhythm s={s} /> })
    if (s.tough) list.push({ id: 'tough', tint: 'var(--tester)', render: () => <Tough s={s} /> })
    if (s.causes.length) list.push({ id: 'causes', tint: 'var(--coder)', render: () => <Causes s={s} /> })
    list.push({ id: 'waiting', tint: 'var(--triager)', render: () => <Waiting s={s} /> })
    list.push({ id: 'outro', tint: 'var(--accent-soft, var(--mint))', render: () => <Outro s={s} word={word} onAgain={() => go(0, 50, 50)} onCopy={copy} /> })
    return list
    // go and copy are stable enough for the scene closures; the list only changes with the numbers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, first, period])

  const [at, setAt] = useState({ i: 0, turn: 0, ox: 50, oy: 50 })
  const [paused, setPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const [still] = useState(calm)
  const stage = useRef<HTMLDivElement>(null)
  const down = useRef(0)
  const last = scenes.length - 1

  function go(i: number, ox = 100, oy = 50) {
    setAt((a) => (i < 0 || i > last || i === a.i ? a : { i, turn: a.turn + 1, ox, oy }))
  }
  function copy() {
    const top = s.crew[0]
    const text = [`My swarm, ${period === 'all' ? 'so far' : `this ${word}`}:`,
      `${s.arrived} issues in, ${s.fixed} fixes approved${s.merged ? `, ${s.merged} merged` : ''}.`,
      s.moves ? `${s.moves} agent moves; the ${NAME[top.agent]} did the most (${top.n}).` : '',
      s.runs ? `Tests ran ${s.runs.toLocaleString()} times in sandboxes.` : '',
      s.median !== null ? `Median time to a fix: ${duration(s.median)}.` : '',
      `${s.waiting.length} waiting for me.`].filter(Boolean).join(' ')
    navigator.clipboard.writeText(text).then(() => toast.ok('Summary copied', 'Paste it into your standup.'), () => toast.info('Couldn’t copy', text))
  }

  // arrows move between scenes, space pauses
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight') go(at.i + 1)
      else if (e.key === 'ArrowLeft') go(at.i - 1, 0)
      else if (e.key === ' ' && !(e.target as HTMLElement).closest?.('button, a')) { e.preventDefault(); setPaused((p) => !p) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const where = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }
  }
  const scene = scenes[at.i]
  return (
    <div className="rw-wrap">
      <div ref={stage} className={`rw-stage ${paused || held ? 'is-paused' : ''}`}
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; down.current = performance.now(); setHeld(true) }}
        onPointerUp={(e) => {
          if (!down.current) return
          const quick = performance.now() - down.current < 280
          down.current = 0; setHeld(false)
          if (!quick) return
          const p = where(e)
          if (p.x < 30) go(at.i - 1, p.x, p.y); else go(at.i + 1, p.x, p.y)
        }}
        onPointerCancel={() => { down.current = 0; setHeld(false) }}>
        <AnimatePresence initial={false}>
          <motion.div key={`${scene.id}-${at.turn}`} className="rw-layer" style={{ zIndex: at.turn + 1, background: `color-mix(in srgb, ${scene.tint} 30%, var(--white))` }}
            initial={still ? { opacity: 0 } : { clipPath: `circle(0% at ${at.ox}% ${at.oy}%)` }}
            animate={still ? { opacity: 1 } : { clipPath: `circle(150% at ${at.ox}% ${at.oy}%)` }}
            exit={{ opacity: 1, transition: { duration: 0.9 } }}
            transition={{ duration: 0.85, ease: [0.65, 0, 0.35, 1] }}>
            <div className="rw-grain" aria-hidden="true" />
            <div className={`rw-scene rw-${scene.id}`}>{scene.render()}</div>
          </motion.div>
        </AnimatePresence>

        <div className="rw-bars">
          {scenes.map((x, i) => (
            <button key={x.id} className={`rw-bar ${i < at.i ? 'done' : ''}`} onClick={() => go(i, i < at.i ? 0 : 100)} aria-label={`Scene ${i + 1}`}>
              {i === at.i && <i key={at.turn} className={i === last ? 'full' : ''} style={{ animationDuration: `${SCENE_MS}ms` }} onAnimationEnd={() => go(at.i + 1)} />}
            </button>
          ))}
        </div>
        <button className="rw-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'}>
          <svg viewBox="0 0 24 24" width="16" height="16">{paused ? <path d="M8 5v14l11-7z" fill="currentColor" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />}</svg>
        </button>
      </div>
      <p className="rw-hint">Tap the right side to go on, the left to go back, hold to pause. <kbd>←</kbd> <kbd>→</kbd> and <kbd>Space</kbd> work too.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces the scenes share */

const up = (delay: number) => ({ initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, ease: easeOut, delay } })

function Words({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  return (
    <span className={className}>
      {text.split(' ').map((w, k) => (
        <Fragment key={k}>
          <span className="rw-word"><motion.span initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 0.75, ease: easeOut, delay: delay + k * 0.06 }}>{w}</motion.span></span>{' '}
        </Fragment>
      ))}
    </span>
  )
}

/** One of the agents: a pastel ball with eyes that blink. */
function Bot({ agent, size = 56, mood = 'smile' }: { agent: string; size?: number; mood?: 'smile' | 'o' | 'sleep' }) {
  return (
    <svg viewBox="-26 -26 52 52" width={size} height={size} className="rw-bot" aria-hidden="true">
      <circle cx="2.5" cy="3.5" r="21.5" fill="var(--ink)" />
      <circle r="21.5" fill={`var(--${agent})`} stroke="var(--ink)" strokeWidth="2.6" />
      {mood === 'sleep'
        ? <g stroke="#0f0f0f" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M-10 -2h6M4 -2h6" /></g>
        : <g className="rw-eyes"><circle cx="-7" cy="-3" r="3.4" fill="#0f0f0f" /><circle cx="7" cy="-3" r="3.4" fill="#0f0f0f" /></g>}
      {mood === 'o' ? <circle cy="8" r="3" fill="#0f0f0f" /> : <path d="M-5 6.5Q0 11 5 6.5" fill="none" stroke="#0f0f0f" strokeWidth="2.4" strokeLinecap="round" />}
    </svg>
  )
}

function Copy({ kicker, big, label, sub, delay = 0.25 }: { kicker: string; big?: ReactNode; label?: string; sub?: ReactNode; delay?: number }) {
  return (
    <div className="rw-copy">
      <motion.span className="rw-kicker" {...up(delay)}>{kicker}</motion.span>
      {big !== undefined && <motion.b className="rw-num" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 16, delay: delay + 0.1 }}>{big}</motion.b>}
      {label && <h2 className="rw-title"><Words text={label} delay={delay + 0.25} /></h2>}
      {sub && <motion.p className="rw-sub" {...up(delay + 0.7)}>{sub}</motion.p>}
    </div>
  )
}

/* ------------------------------------------------------------------ the scenes */

function Intro({ s, first, period }: { s: Stats; first: string; period: Period }) {
  const when = period === 'week' ? 'your week' : period === 'month' ? 'your month' : 'everything so far'
  const quiet = !s.events && !s.arrived
  return (
    <>
      <div className="rw-copy">
        <motion.span className="rw-kicker" {...up(0.3)}>Rewind · {PERIODS.find((p) => p[0] === period)![1]}</motion.span>
        <h2 className="rw-hero"><Words text={`${first}, here’s ${when} with the swarm.`} delay={0.4} /></h2>
        <motion.p className="rw-sub" {...up(1.2)}>
          {quiet ? 'It was a quiet one. Try a longer stretch above, or connect a repository and let the agents at it.'
            : `${s.moves} moves across ${s.repoCount} repositor${s.repoCount === 1 ? 'y' : 'ies'}. Let’s see who did what.`}
        </motion.p>
      </div>
      <div className="rw-art rw-intro-art">
        {AGENTS.map((a, i) => (
          <motion.div key={a} className="rw-hop" initial={{ y: -420, rotate: -40 }} animate={{ y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 110, damping: 11, delay: 0.5 + i * 0.16 }}>
            <motion.div animate={{ y: [0, -22, 0], scaleY: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.1, delay: 1.8 + i * 0.16, ease: 'easeInOut' }}>
              <Bot agent={a} size={92} />
            </motion.div>
            <span>{NAME[a]}</span>
          </motion.div>
        ))}
      </div>
    </>
  )
}

function Arrivals({ s }: { s: Stats }) {
  const n = Math.min(s.arrived, 18)
  return (
    <>
      <Copy kicker="What came in" big={<CountUp value={s.arrived} />} label={`issue${s.arrived === 1 ? '' : 's'} washed up`}
        sub={s.topRepo && s.repoCount > 1 ? <>Most came from <b>{s.topRepo.name}</b> ({s.topRepo.n}).</> : s.topRepo ? <>All from <b>{s.topRepo.name}</b>.</> : null} />
      <div className="rw-art">
        <svg viewBox="0 0 400 320" className="rw-svg">
          {Array.from({ length: n }, (_, i) => {
            const col = i % 3, row = Math.floor(i / 3), x = 30 + col * 118 + ((i * 37) % 17) - 8, y = 268 - row * 38, rot = ((i * 53) % 17) - 8
            return (
              <motion.g key={i} initial={{ y: -380, rotate: rot * 3, opacity: 0 }} animate={{ y: 0, rotate: rot, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 150, damping: 15, delay: 0.35 + i * 0.09 }} style={{ originX: `${x + 55}px`, originY: `${y + 17}px` }}>
                <rect x={x + 3} y={y + 4} width="110" height="34" rx="9" fill="var(--ink)" />
                <rect x={x} y={y} width="110" height="34" rx="9" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.4" />
                <circle cx={x + 16} cy={y + 17} r="6" fill={`var(--${AGENTS[i % 4]})`} stroke="var(--ink)" strokeWidth="2" />
                <rect x={x + 30} y={y + 10} width={52 - (i % 3) * 8} height="5" rx="2.5" fill="var(--ink)" opacity="0.7" />
                <rect x={x + 30} y={y + 20} width={66 - (i % 4) * 7} height="5" rx="2.5" fill="var(--ink)" opacity="0.25" />
              </motion.g>
            )
          })}
        </svg>
      </div>
    </>
  )
}

function Crew({ s }: { s: Stats }) {
  const top = s.crew[0], max = Math.max(1, top.n)
  return (
    <>
      <Copy kicker="The crew" big={<CountUp value={top.n} />} label={`moves by the ${NAME[top.agent]}, the most of anyone`}
        sub={<>{s.moves.toLocaleString()} moves in all. The {NAME[s.crew[1].agent]} was next with {s.crew[1].n}.</>} />
      <div className="rw-art rw-race">
        {s.crew.map((c, i) => (
          <div key={c.agent} className="rw-lane">
            <span className="rw-lane-name">{NAME[c.agent]}</span>
            <div className="rw-track">
              <motion.div className="rw-fill" style={{ background: `var(--${c.agent})` }} initial={{ width: '0%' }} animate={{ width: `${Math.max(8, (c.n / max) * 100)}%` }}
                transition={{ duration: 1.6, ease: easeOut, delay: 0.5 + i * 0.12 }}>
                <span className="rw-rider">
                  {i === 0 && (
                    <motion.svg className="rw-crown" viewBox="-14 -10 28 16" initial={{ y: -90, opacity: 0, rotate: -30 }} animate={{ y: 0, opacity: 1, rotate: -8 }} transition={{ type: 'spring', stiffness: 220, damping: 12, delay: 2.2 }}>
                      <path d="M-12 5L-13 -7L-5 -1L0 -9L5 -1L13 -7L12 5Z" fill="#ffd33d" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
                    </motion.svg>
                  )}
                  <motion.span animate={{ rotate: [0, -10, 10, 0] }} transition={{ repeat: Infinity, duration: 0.5, repeatDelay: 0.2, delay: 0.5 }} style={{ display: 'grid' }}>
                    <Bot agent={c.agent} size={44} />
                  </motion.span>
                </span>
              </motion.div>
            </div>
            <motion.b className="rw-lane-n" {...up(1.6 + i * 0.1)}>{c.n}</motion.b>
          </div>
        ))}
      </div>
    </>
  )
}

function Runs({ s }: { s: Stats }) {
  const [after, setAfter] = useState(false)
  useEffect(() => { const t = window.setTimeout(() => setAfter(true), 2600); return () => window.clearTimeout(t) }, [])
  const N = 96, rate = after ? s.after ?? 0 : s.before ?? 0.5
  const red = Math.round(N * rate)
  const order = useMemo(() => Array.from({ length: N }, (_, i) => (i * 37) % N), [])
  const pct = (r: number | null) => (r === null ? '?' : `${Math.round(r * 100)}%`)
  return (
    <>
      <Copy kicker="The sandbox" big={<CountUp value={s.runs} />} label="times your tests ran so you didn’t have to"
        sub={s.before !== null ? <>Before the fixes, {pct(s.before)} of runs failed. After them, {pct(s.after)}.</> : 'Every patch was run before and after, again and again.'} />
      <div className="rw-art rw-dots-art">
        <motion.span key={after ? 'a' : 'b'} className={`rw-phase ${after ? 'is-after' : ''}`} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>{after ? 'After the fix' : 'Before the fix'}</motion.span>
        <div className="rw-dots">
          {order.map((k, i) => (
            <motion.i key={i} className={k < red ? 'fail' : 'pass'} style={{ transitionDelay: `${(i % 12) * 40}ms` }}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.4 + (i % 12) * 0.03 + Math.floor(i / 12) * 0.05 }} />
          ))}
        </div>
      </div>
    </>
  )
}

function Fixes({ s }: { s: Stats }) {
  const share = s.fixed ? s.firstTry / s.fixed : 0
  const turns = s.median === null ? 0 : Math.min(8, 1 + Math.log2(1 + s.median / 600_000))
  return (
    <>
      <Copy kicker="The fixes" big={<CountUp value={s.fixed} />} label={`fix${s.fixed === 1 ? '' : 'es'} approved${s.merged ? `, ${s.merged} merged` : ''}`}
        sub={s.median !== null ? <>A median of <b>{duration(s.median)}</b> from issue to approved fix. {s.firstTry} of {s.fixed} passed review the first time.</> : null} />
      <div className="rw-art rw-watch-art">
        <svg viewBox="-110 -125 220 240" className="rw-watch">
          <rect x="-14" y="-122" width="28" height="18" rx="5" fill="var(--white)" stroke="var(--ink)" strokeWidth="3" />
          <circle cx="5" cy="7" r="96" fill="var(--ink)" />
          <circle r="96" fill="var(--white)" stroke="var(--ink)" strokeWidth="3.5" />
          {Array.from({ length: 12 }, (_, k) => <path key={k} d="M0 -84V-74" stroke="var(--ink)" strokeWidth={k % 3 ? 2 : 4} strokeLinecap="round" transform={`rotate(${k * 30})`} />)}
          <motion.circle r="62" fill="none" stroke="var(--reviewer)" strokeWidth="14" strokeLinecap="round" transform="rotate(-90)"
            initial={{ pathLength: 0 }} animate={{ pathLength: share }} transition={{ duration: 1.6, ease: easeOut, delay: 1.2 }} />
          <motion.g initial={{ rotate: 0 }} animate={{ rotate: turns * 360 }} transition={{ duration: 2.4, ease: [0.2, 0.7, 0.2, 1], delay: 0.5 }}>
            <path d="M0 8V-70" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
          </motion.g>
          <circle r="8" fill="var(--tester)" stroke="var(--ink)" strokeWidth="3" />
        </svg>
        <motion.span className="rw-watch-tag" {...up(2.2)}><i />{Math.round(share * 100)}% first try</motion.span>
      </div>
    </>
  )
}

function Rhythm({ s }: { s: Stats }) {
  const max = Math.max(1, s.peak.n)
  return (
    <>
      <Copy kicker="The rhythm" label={`Your swarm is busiest on ${DAYS[s.peak.d]} around ${hourWord(s.peak.h)}`}
        sub={s.night ? <>And {s.night} move{s.night === 1 ? '' : 's'} happened between 10 pm and 6 am, while you slept.</> : 'Nothing happened overnight. Everyone got their sleep.'} />
      <div className="rw-art rw-heat-art">
        <div className="rw-heat">
          {s.grid.map((row, d) => (
            <div key={d} className="rw-heat-row">
              <span>{DAYS[d][0]}</span>
              {row.map((n, h) => {
                const hot = d === s.peak.d && h === s.peak.h
                return (
                  <motion.i key={h} className={hot ? 'hot' : ''} style={{ background: n ? `color-mix(in srgb, var(--accent) ${20 + (n / max) * 80}%, var(--white))` : undefined }}
                    initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: easeOut, delay: 0.4 + h * 0.035 + d * 0.02 }} />
                )
              })}
            </div>
          ))}
          <div className="rw-heat-row rw-heat-hours"><span />{Array.from({ length: 24 }, (_, h) => <em key={h}>{h % 6 === 0 ? hourWord(h).replace(' ', '') : ''}</em>)}</div>
        </div>
      </div>
    </>
  )
}

function Tough({ s }: { s: Stats }) {
  const t = s.tough!
  const tosses = Math.max(2, Math.min(5, t.back * 2 || t.tries))
  const xs: number[] = [...Array.from({ length: tosses + 1 }, (_, k) => (k % 2 ? 110 : -110)), 0]
  const ys = xs.map((_, k) => (k === xs.length - 1 ? 40 : 0))
  const mid = xs.flatMap((x, k) => (k ? [(xs[k - 1] + x) / 2, x] : [x]))
  const midY = ys.flatMap((y, k) => (k ? [-80, y] : [y]))
  const end = mid.length * 0.28
  const stamp = t.state === 'Approved' || t.state === 'Merged' ? ['Fixed', 'var(--reviewer)'] : t.state === 'Needs Human' ? ['Needs you', 'var(--triager)'] : ['Still going', 'var(--coder)']
  return (
    <>
      <Copy kicker="The one that fought back" label={t.title.length > 70 ? `${t.title.slice(0, 68)}…` : t.title}
        sub={<>In {t.repo}. {t.back ? <>Sent back {t.back} time{t.back === 1 ? '' : 's'}</> : <>{t.tries} attempts</>} before it {stamp[0] === 'Fixed' ? 'gave in' : stamp[0] === 'Needs you' ? 'went to you' : 'settles'}.</>} />
      <div className="rw-art rw-toss">
        <motion.div className="rw-toss-bot l" {...up(0.3)}><Bot agent="coder" size={80} mood="o" /><span>Coder</span></motion.div>
        <motion.div className="rw-toss-bot r" {...up(0.4)}><Bot agent="reviewer" size={80} /><span>Reviewer</span></motion.div>
        <motion.div className="rw-toss-card" initial={{ x: -110, y: 0, rotate: 0 }} animate={{ x: mid, y: midY, rotate: mid.map((_, k) => (k % 2 ? 180 : 0) * (k % 4 === 1 ? 1 : -1)) }}
          transition={{ duration: end, ease: 'easeInOut', delay: 0.7 }}>
          <i /><b /><b />
        </motion.div>
        <motion.span className="rw-stamp" style={{ background: stamp[1] }} initial={{ scale: 3, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: -8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.8 + end }}>{stamp[0]}</motion.span>
      </div>
    </>
  )
}

function Causes({ s }: { s: Stats }) {
  const max = Math.max(...s.causes.map((c) => c.n))
  const slots = [[50, 46], [22, 30], [78, 28], [26, 74], [76, 72]]
  return (
    <>
      <Copy kicker="What kept breaking" label={`Mostly ${s.causes[0].label.toLowerCase()}`} sub={s.causes[0].why} />
      <div className="rw-art rw-bubbles">
        {s.causes.map((c, i) => {
          const size = 70 + (c.n / max) * 110
          return (
            <motion.div key={c.label} className="rw-bubble" style={{ left: `${slots[i][0]}%`, top: `${slots[i][1]}%`, width: size, height: size, background: `var(--${['tester', 'coder', 'triager', 'reviewer', 'lab'][i]})` }}
              initial={{ scale: 0, x: '-50%', y: '-50%' }} animate={{ scale: 1, x: '-50%', y: '-50%' }} transition={{ type: 'spring', stiffness: 180, damping: 12, delay: 0.5 + i * 0.18 }}>
              <motion.span animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 2.4 + i * 0.3, ease: 'easeInOut', delay: i * 0.4 }}>
                <b>{c.n}</b>{c.label}
              </motion.span>
            </motion.div>
          )
        })}
      </div>
    </>
  )
}

function Waiting({ s }: { s: Stats }) {
  const n = s.waiting.length
  return (
    <>
      <Copy kicker="Right now" big={<CountUp value={n} />} label={n ? `waiting for you` : 'Nothing is waiting for you'}
        sub={n ? 'Approved fixes to merge and questions only you can answer.' : 'Every fix is merged or on its way. Enjoy it.'} />
      <div className="rw-art rw-wait-art">
        {n ? (
          <>
            <div className="rw-stack">
              {s.waiting.slice(0, 3).map((w, i) => (
                <motion.div key={w.to} className="rw-ticket" initial={{ y: 200, opacity: 0, rotate: 0 }} animate={{ y: i * 18, opacity: 1, rotate: (i - 1) * 4 }}
                  transition={{ type: 'spring', stiffness: 140, damping: 16, delay: 0.5 + i * 0.15 }} style={{ zIndex: 3 - i }}>
                  <span className={`rw-pill ${w.state === 'Approved' ? 'ok' : 'ask'}`}>{w.state === 'Approved' ? 'Ready to merge' : 'Needs you'}</span>
                  <b>{w.title}</b>
                </motion.div>
              ))}
            </div>
            <motion.div {...up(1.2)}><Link to={s.waiting[0].to} className="btn btn-dark btn-sm rw-go">Open {n === 1 ? 'it' : 'the first one'} →</Link></motion.div>
          </>
        ) : (
          <motion.div className="rw-nap" {...up(0.4)}>
            <Bot agent="reviewer" size={130} mood="sleep" />
            {[0, 1, 2].map((k) => <motion.span key={k} className="rw-z" animate={{ opacity: [0, 1, 0], x: [0, 20 + k * 8], y: [0, -60 - k * 14] }} transition={{ repeat: Infinity, duration: 2.6, delay: k * 0.8 }}>z</motion.span>)}
          </motion.div>
        )}
      </div>
    </>
  )
}

function Outro({ s, word, onAgain, onCopy }: { s: Stats; word: string; onAgain: () => void; onCopy: () => void }) {
  const tiles: [string, ReactNode, string][] = [
    ['var(--triager)', s.arrived, 'issues in'], ['var(--coder)', s.moves.toLocaleString(), 'agent moves'],
    ['var(--tester)', s.runs.toLocaleString(), 'sandbox runs'], ['var(--reviewer)', s.fixed, 'fixes approved'],
    ['var(--lab)', s.median === null ? '—' : duration(s.median), 'to a fix'], ['var(--accent)', s.moves ? NAME[s.crew[0].agent] : '—', 'hardest worker'],
  ]
  return (
    <div className="rw-outro">
      <div className="rw-copy">
        <motion.span className="rw-kicker" {...up(0.3)}>That’s a wrap</motion.span>
        <h2 className="rw-hero"><Words text={word === 'time' ? 'That’s your swarm so far.' : `That was your ${word}.`} delay={0.4} /></h2>
        <motion.div className="rw-outro-acts" {...up(1)}>
          <button className="btn btn-dark btn-sm" onClick={onAgain}>Watch again</button>
          <button className="btn btn-line btn-sm" onClick={onCopy}>Copy summary</button>
        </motion.div>
      </div>
      <div className="rw-poster">
        {tiles.map(([c, v, l], i) => (
          <motion.div key={l} className="rw-tile" style={{ ['--c' as string]: c }} initial={{ opacity: 0, y: 30, rotate: (i % 2 ? 4 : -4) }} animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 160, damping: 15, delay: 0.5 + i * 0.1 }}>
            <b>{v}</b><span>{l}</span>
          </motion.div>
        ))}
        <div className="rw-poster-crew">
          {AGENTS.map((a, i) => (
            <motion.span key={a} animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.12, ease: 'easeInOut' }} style={{ display: 'grid' }}>
              <Bot agent={a} size={40} />
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  )
}
