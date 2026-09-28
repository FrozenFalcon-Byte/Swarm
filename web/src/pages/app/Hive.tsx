import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { PageHead } from './Overview'
import { rise } from './repoDraft'

/*
 * The Hive: a swarm of agents you can play with. They flock after the pointer, and holding the button down
 * pulls them in like a magnet. Click to drop a bug; the agents fix it the way they fix real ones, in order:
 * the triager reads it, the coder patches it, the tester runs it, the reviewer signs it off. Each touch fills a
 * quarter of the bug's ring, and the fourth pops it. Bugs are named after tests from your own fixes when there
 * are any. Scores stay in this browser.
 */

const ROLES = ['triager', 'coder', 'tester', 'reviewer'] as const
const SIZES = [{ n: 40, label: 'Small' }, { n: 90, label: 'Medium' }, { n: 160, label: 'Big' }]
const KEY = 'swarm.hive'
const TRAINING = ['test_unique_tags', 'test_backoff_stays_short', 'test_tokens_are_unique', 'test_cache_starts_empty', 'test_header',
  'test_quick_job', 'test_picks_primary', 'test_default_mode', 'test_retry_budget', 'test_sorted_export', 'test_session_expiry', 'test_upload_race']
const COMBO_MS = 3000
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')

type Agent = { x: number; y: number; vx: number; vy: number; role: number; wait: number; pop: number; dying: number; trail: number[] }
type Bug = { id: number; x: number; y: number; vx: number; vy: number; stage: number; cool: number; pulse: number; name: string; land: number; fromY: number; toY: number }
type Bit = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; c: number; life: number; max: number }
type Ring = { x: number; y: number; t: number; big: boolean }
type Float = { id: number; x: number; y: number; name: string }
type Score = { fixed: number; best: number }

function loadScore(): Score {
  try { return { fixed: 0, best: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { fixed: 0, best: 0 } }
}

export default function Hive() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const names = useMemo(() => {
    const mine = [...new Set(tasks.flatMap((t) => (t.artifacts.test_ids || []).map((id) => id.split('::').pop() || id)))]
    return mine.length >= 4 ? mine : [...mine, ...TRAINING]
  }, [tasks])
  return (
    <div className="page hv-page">
      <PageHead title="The Hive" sub="Your agents, off the clock. Drop bugs and watch them fix each one in order: read, patch, test, sign off." />
      <HiveGame names={names} />
    </div>
  )
}

export function HiveGame({ names }: { names: string[] }) {
  const [size, setSize] = useState(1)
  const [score, setScore] = useState<Score>(loadScore)
  const [session, setSession] = useState(0)
  const [combo, setCombo] = useState(0)
  const [slam, setSlam] = useState(0)
  const [night, setNight] = useState(false)
  const [wipe, setWipe] = useState<{ x: number; y: number; to: boolean; r: number } | null>(null)
  const [floats, setFloats] = useState<Float[]>([])
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const namesRef = useRef(names)
  useEffect(() => { namesRef.current = names }, [names])

  // everything the frame loop touches lives here, so React only re-renders for the score and the overlays
  const sim = useRef({
    agents: [] as Agent[], bugs: [] as Bug[], bits: [] as Bit[], rings: [] as Ring[], w: 0, h: 0, night: false,
    ptr: { x: 0, y: 0, in: false, down: 0, sx: 0, sy: 0, held: false }, vortex: 0, scatter: false, nextId: 1, nameAt: 0,
    lastFix: 0, combo: 0, colors: ['#fbe74e', '#9dc4f5', '#ff8a7a', '#5dd36a'], ink: '#0f0f0f',
    onFix: (_b: Bug) => {},
  })

  const flock = (n: number, hatch: boolean) => {
    const s = sim.current
    const alive = s.agents.filter((a) => !a.dying)
    if (alive.length > n) alive.slice(n).forEach((a) => { a.dying = 0.001 })
    for (let i = alive.length; i < n; i++) {
      const ang = i * 2.39996, sp = 1.2 + (i % 7) * 0.25
      s.agents.push({
        x: s.w / 2, y: s.h / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, role: i % 4,
        wait: hatch ? 0.45 + (i - alive.length) * 0.006 : 0, pop: 0, dying: 0, trail: [],
      })
    }
  }

  const dropBug = (x: number, y: number, fromY?: number) => {
    const s = sim.current
    if (s.bugs.length >= 24) return
    const list = namesRef.current
    s.bugs.push({
      id: s.nextId++, x, y: fromY ?? y, vx: 0, vy: 0, stage: 0, cool: 0, pulse: 1, name: list[s.nameAt++ % list.length],
      land: fromY === undefined ? 0 : 0.6 + Math.random() * 0.5, fromY: fromY ?? y, toY: y,
    })
  }

  // fixing a bug: score, combo, and every third in a row sets the swarm spinning
  const onFix = (b: Bug) => {
    const s = sim.current, now = performance.now()
    s.combo = now - s.lastFix < COMBO_MS ? s.combo + 1 : 1
    s.lastFix = now
    const c = s.combo
    setCombo(c)
    setSession((k) => k + 1)
    setScore((old) => {
      const next = { fixed: old.fixed + 1, best: Math.max(old.best, c) }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private window: this visit only */ }
      return next
    })
    setFloats((f) => [...f.slice(-5), { id: b.id, x: b.x, y: b.y, name: b.name }])
    if (c >= 3 && c % 3 === 0) {
      setSlam((k) => k + 1)
      if (!calm()) { s.vortex = 1.6; s.rings.push({ x: s.w / 2, y: s.h / 2, t: 0, big: true }) }
    }
  }
  useEffect(() => { sim.current.onFix = onFix })

  useEffect(() => {
    if (!combo) return
    const id = window.setTimeout(() => setCombo(0), COMBO_MS)
    return () => window.clearTimeout(id)
  }, [combo, session])

  // canvas size follows the stage, crisp on any screen
  useEffect(() => {
    const el = canvas.current!, stage = scope.current!
    const fit = () => {
      const r = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1)
      const s = sim.current, first = !s.w
      s.w = r.width; s.h = r.height
      el.width = r.width * dpr; el.height = r.height * dpr
      el.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cs = getComputedStyle(stage)
      s.colors = ROLES.map((ro) => cs.getPropertyValue(`--${ro}`).trim() || s.colors[0])
      s.ink = cs.getPropertyValue('--ink').trim() || '#0f0f0f'
      if (first) { flock(SIZES[size].n, !calm()); for (let i = 0; i < 3; i++) dropBug(r.width * (0.25 + i * 0.25), r.height * (0.3 + (i % 2) * 0.35)) }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (sim.current.w) flock(SIZES[size].n, !calm()) }, [size]) // eslint-disable-line react-hooks/exhaustive-deps

  // the frame loop
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!
    let raf = 0, last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000), k = dt * 60
      last = now
      step(sim.current, dt, k, now)
      draw(ctx, sim.current, now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = scope.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const scatter = () => { sim.current.scatter = true }
  const storm = () => {
    const s = sim.current
    for (let i = 0; i < 8; i++) dropBug(40 + Math.random() * (s.w - 80), 50 + Math.random() * (s.h - 100), -30 - Math.random() * 120)
    if (!calm() && scope.current) animate(scope.current, { x: [0, -9, 8, -6, 5, -2, 0], rotate: [0, -0.6, 0.5, -0.3, 0.2, 0] }, { duration: 0.55, delay: 0.55 })
  }
  const flip = (from?: { x: number; y: number }) => {
    const to = !sim.current.night
    if (calm()) { sim.current.night = to; setNight(to); return }
    const s = sim.current, p = from || { x: s.w - 60, y: 30 }
    setWipe({ ...p, to, r: Math.hypot(Math.max(p.x, s.w - p.x), Math.max(p.y, s.h - p.y)) + 20 })
  }
  const reset = () => {
    const s = sim.current
    s.bugs = []; s.combo = 0; setCombo(0); setSession(0)
    s.agents.forEach((a) => { a.dying = 0.001 })
    s.agents = s.agents.filter((a) => a.dying)
    flock(SIZES[size].n, !calm())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); scatter() }
      else if (e.key === 'b') storm()
      else if (e.key === 'n') flip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bound each render so the handlers see the current state

  return (
    <>
      <motion.div className="hv-bar" {...rise(0)}>
        <div className="hv-hud">
          <Stat label="Fixed here" value={session} />
          <Stat label="All time" value={score.fixed} />
          <Stat label="Best combo" value={score.best} />
          <AnimatePresence>
            {combo > 1 && (
              <motion.span key="combo" className="hv-combo" initial={{ scale: 0.4, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.6, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                <motion.b key={combo} initial={{ y: -10 }} animate={{ y: 0 }}>×{combo}</motion.b> combo
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="hv-tools">
          <div className="seg" role="radiogroup" aria-label="Swarm size">
            {SIZES.map((s, i) => (
              <button key={s.n} role="radio" aria-checked={size === i} className={`seg-btn ${size === i ? 'on' : ''}`} onClick={() => setSize(i)}>
                {size === i && <motion.span layoutId="hv-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-line btn-sm" onClick={storm}>Bug storm <kbd>B</kbd></button>
          <button className="btn btn-line btn-sm" onClick={scatter}>Scatter <kbd>Space</kbd></button>
          <button className="btn btn-dark btn-sm" onClick={(e) => { const r = scope.current!.getBoundingClientRect(); const b = e.currentTarget.getBoundingClientRect(); flip({ x: b.left + b.width / 2 - r.left, y: Math.max(0, b.bottom - r.top) }) }}>
            {night ? 'Day shift' : 'Night shift'} <kbd>N</kbd>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Start over</button>
        </div>
      </motion.div>

      <motion.div className="hv-wrap" {...rise(1)}>
        <div ref={scope} className={`hv-stage ${night ? 'is-night' : ''}`}
          onPointerEnter={(e) => { const p = local(e); Object.assign(sim.current.ptr, p, { in: true }) }}
          onPointerLeave={() => { Object.assign(sim.current.ptr, { in: false, down: 0, held: false }) }}
          onPointerMove={(e) => {
            const p = local(e), ptr = sim.current.ptr
            Object.assign(ptr, p, { in: true })
            if (ptr.down && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 8) ptr.held = true
          }}
          onPointerDown={(e) => {
            const p = local(e)
            e.currentTarget.setPointerCapture(e.pointerId)
            Object.assign(sim.current.ptr, p, { in: true, down: performance.now(), sx: p.x, sy: p.y, held: false })
          }}
          onPointerUp={(e) => {
            const ptr = sim.current.ptr, p = local(e)
            if (ptr.down && !ptr.held && performance.now() - ptr.down < 260) dropBug(p.x, p.y)
            Object.assign(ptr, { down: 0, held: false, in: e.pointerType === 'mouse' })
          }}>
          <AnimatePresence>
            {wipe && (
              <motion.div key={String(wipe.to)} className={`hv-wipe ${wipe.to ? 'is-night' : ''}`}
                initial={{ clipPath: `circle(0px at ${wipe.x}px ${wipe.y}px)` }} animate={{ clipPath: `circle(${wipe.r}px at ${wipe.x}px ${wipe.y}px)` }}
                transition={{ duration: 0.75, ease: [0.7, 0, 0.2, 1] }}
                onAnimationComplete={() => { sim.current.night = wipe.to; setNight(wipe.to); setWipe(null) }} />
            )}
          </AnimatePresence>
          <canvas ref={canvas} className="hv-canvas" aria-label="A swarm of agents. Click to drop a bug for them to fix." role="img" />
          <Hatch />
          <AnimatePresence>
            {floats.map((f) => (
              <motion.span key={f.id} className="hv-float mono" style={{ left: f.x, top: f.y }}
                initial={{ opacity: 0, y: 0, scale: 0.6 }} animate={{ opacity: [0, 1, 1, 0], y: -64, scale: 1 }} transition={{ duration: 1.5, ease: 'easeOut' }}
                onAnimationComplete={() => setFloats((l) => l.filter((x) => x.id !== f.id))}>
                ✓ {f.name}
              </motion.span>
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {slam > 0 && (
              <motion.div key={slam} className="hv-slam" initial={{ scale: 3.2, opacity: 0, rotate: -14 }}
                animate={{ scale: [3.2, 0.9, 1.05, 1], opacity: [0, 1, 1, 1], rotate: [-14, 3, -2, -4] }} exit={{ scale: 0.4, opacity: 0, rotate: 10 }}
                transition={{ duration: 0.55, ease: 'easeOut' }} onAnimationComplete={() => window.setTimeout(() => setSlam(0), 700)}>
                Combo ×{combo || 3}!
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="hv-legend">
          <span className="hv-order">{ROLES.map((r, i) => <span key={r}><i style={{ background: `var(--${r})` }} />{r}{i < 3 && <em>→</em>}</span>)}</span>
          <span className="muted">Click to drop a bug · Hold and drag to pull the swarm · Three fixes in a row starts a whirl</span>
        </div>
      </motion.div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="hv-stat">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.b key={value} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>{value}</motion.b>
      </AnimatePresence>
      <span>{label}</span>
    </span>
  )
}

/** The hive cracking open on arrival: a honeycomb cell that spins up and bursts as the agents fly out. */
function Hatch() {
  const [on, setOn] = useState(() => !calm())
  if (!on) return null
  return (
    <motion.svg className="hv-hatch" viewBox="-50 -50 100 100" aria-hidden
      initial={{ scale: 0, rotate: -120, opacity: 1 }} animate={{ scale: [0, 1, 1.1, 4], rotate: [-120, 0, 0, 40], opacity: [1, 1, 1, 0] }}
      transition={{ duration: 1.2, times: [0, 0.35, 0.45, 1], ease: 'easeOut' }} onAnimationComplete={() => setOn(false)}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const a = (i - 1) * (Math.PI / 3), d = i ? 17.5 : 0
        return <polygon key={i} points={hex(9.5)} transform={`translate(${Math.cos(a + Math.PI / 6) * d} ${Math.sin(a + Math.PI / 6) * d})`}
          fill={i ? `var(--${ROLES[(i - 1) % 4]})` : 'var(--mint-strong)'} stroke="var(--ink)" strokeWidth="1.6" />
      })}
    </motion.svg>
  )
}
const hex = (r: number) => Array.from({ length: 6 }, (_, i) => `${(Math.cos((i * Math.PI) / 3) * r).toFixed(2)},${(Math.sin((i * Math.PI) / 3) * r).toFixed(2)}`).join(' ')

/* ---------- the simulation */

type Sim = {
  agents: Agent[]; bugs: Bug[]; bits: Bit[]; rings: Ring[]; w: number; h: number; night: boolean
  ptr: { x: number; y: number; in: boolean; down: number; held: boolean }; vortex: number; scatter: boolean
  colors: string[]; ink: string; onFix: (b: Bug) => void
}

const R_BUG = 12
// things grow a little on a wide stage so a big screen doesn't turn them into specks
const unit = (w: number) => clamp(w / 1000, 0.85, 1.4)
const agentR = (n: number, w: number) => (n > 120 ? 5 : n > 60 ? 6 : 7.5) * unit(w)

function step(s: Sim, dt: number, k: number, now: number) {
  const { agents, bugs, w, h, ptr } = s
  const r = agentR(agents.length, w), rb = R_BUG * unit(w), near = (52 * unit(w)) ** 2, room = r * 3.4
  const magnet = ptr.down > 0 && (ptr.held || now - ptr.down > 260)
  if (s.vortex > 0) s.vortex -= dt

  for (const b of bugs) {
    if (b.land > 0) { b.land = Math.max(0, b.land - dt); const t = 1 - b.land / 0.6; b.y = b.fromY + (b.toY - b.fromY) * Math.min(1, backOut(Math.max(0, t))); if (b.land === 0) s.rings.push({ x: b.x, y: b.y, t: 0, big: false }); continue }
    b.vx += (Math.random() - 0.5) * 0.08 * k; b.vy += (Math.random() - 0.5) * 0.08 * k
    const sp = Math.hypot(b.vx, b.vy); if (sp > 0.45) { b.vx *= 0.45 / sp; b.vy *= 0.45 / sp }
    b.x += b.vx * k; b.y += b.vy * k
    if (b.x < 24 || b.x > w - 24) b.vx *= -1
    if (b.y < 24 || b.y > h - 24) b.vy *= -1
    b.x = clamp(b.x, 24, w - 24); b.y = clamp(b.y, 24, h - 24)
    b.cool = Math.max(0, b.cool - dt); b.pulse = Math.max(0, b.pulse - dt * 2.5)
  }

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]
    if (a.wait > 0) { a.wait -= dt; continue }
    if (a.dying) { a.dying += dt * 3; continue }
    let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0
    for (let j = 0; j < agents.length; j++) {
      if (i === j) continue
      const o = agents[j]
      if (o.wait > 0 || o.dying) continue
      const dx = a.x - o.x, dy = a.y - o.y, d2 = dx * dx + dy * dy
      if (d2 > near) continue
      n++; ax += o.vx; ay += o.vy; cx += o.x; cy += o.y
      if (d2 < room * room && d2 > 0.01) { const d = Math.sqrt(d2), p = 1 - d / room; sx += (dx / d) * p; sy += (dy / d) * p }
    }
    let fx = sx * 0.55, fy = sy * 0.55
    if (n) { fx += (ax / n - a.vx) * 0.06 + (cx / n - a.x) * 0.002; fy += (ay / n - a.vy) * 0.06 + (cy / n - a.y) * 0.002 }

    // the nearest bug waiting on this agent's role pulls it in
    let target: Bug | null = null, best = 1e9
    for (const b of bugs) {
      if (b.land > 0 || b.stage !== a.role || b.cool > 0) continue
      const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
      if (d < best) { best = d; target = b }
    }
    let max = 2.4
    if (s.vortex > 0) {
      const dx = a.x - w / 2, dy = a.y - h / 2, d = Math.hypot(dx, dy) || 1
      fx += (-dy / d) * 0.55 - (dx / d) * (d > 70 ? 0.18 : -0.1); fy += (dx / d) * 0.55 - (dy / d) * (d > 70 ? 0.18 : -0.1); max = 5.2
    } else if (magnet) {
      const dx = ptr.x - a.x, dy = ptr.y - a.y, d = Math.hypot(dx, dy) || 1
      fx += (dx / d) * 0.32; fy += (dy / d) * 0.32; max = 4.4
    } else if (target) {
      const dx = target.x - a.x, dy = target.y - a.y, d = Math.hypot(dx, dy) || 1
      fx += (dx / d) * 0.16; fy += (dy / d) * 0.16; max = 3.2
      if (d < rb + r + 1) {
        target.stage++; target.cool = 0.22; target.pulse = 1; a.pop = 1; a.vx = -a.vx * 0.9; a.vy = -a.vy * 0.9
        burst(s, target.x, target.y, [a.role], 7, 2.2)
        if (target.stage >= 4) fix(s, target)
      }
    } else if (ptr.in) {
      const dx = ptr.x - a.x, dy = ptr.y - a.y, d = Math.hypot(dx, dy) || 1
      if (d > 60) { fx += (dx / d) * 0.035; fy += (dy / d) * 0.035 }
    }
    if (s.scatter) {
      const ox = ptr.in ? ptr.x : w / 2, oy = ptr.in ? ptr.y : h / 2, dx = a.x - ox, dy = a.y - oy, d = Math.hypot(dx, dy) || 1
      a.vx += (dx / d) * 7; a.vy += (dy / d) * 7
    }
    fx += (Math.random() - 0.5) * 0.12; fy += (Math.random() - 0.5) * 0.12
    // the walls push back harder the closer it gets, so the swarm turns before it piles up on an edge
    const m = 70
    if (a.x < m) fx += ((m - a.x) / m) ** 2 * 0.6; if (a.x > w - m) fx -= ((a.x - w + m) / m) ** 2 * 0.6
    if (a.y < m) fy += ((m - a.y) / m) ** 2 * 0.6; if (a.y > h - m) fy -= ((a.y - h + m) / m) ** 2 * 0.6
    a.vx += fx * k; a.vy += fy * k
    const sp = Math.hypot(a.vx, a.vy)
    const cap = s.scatter ? 9 : Math.max(max, sp * 0.94) // a kick fades out instead of snapping back
    if (sp > cap) { a.vx *= cap / sp; a.vy *= cap / sp }
    a.x += a.vx * k; a.y += a.vy * k
    if (a.x < r) { a.x = r; a.vx = Math.abs(a.vx) } else if (a.x > w - r) { a.x = w - r; a.vx = -Math.abs(a.vx) }
    if (a.y < r) { a.y = r; a.vy = Math.abs(a.vy) } else if (a.y > h - r) { a.y = h - r; a.vy = -Math.abs(a.vy) }
    a.pop = Math.max(0, a.pop - dt * 3)
    if (s.night) { a.trail.push(a.x, a.y); if (a.trail.length > 16) a.trail.splice(0, 2) } else if (a.trail.length) a.trail.length = 0
  }
  s.scatter = false
  s.agents = agents.filter((a) => a.dying < 1)

  for (const p of s.bits) { p.vy += 0.12 * k; p.vx *= 0.99; p.x += p.vx * k; p.y += p.vy * k; p.rot += p.vr * k; p.life -= dt }
  s.bits = s.bits.filter((p) => p.life > 0)
  for (const g of s.rings) g.t += dt
  s.rings = s.rings.filter((g) => g.t < (g.big ? 0.9 : 0.6))
}

function fix(s: Sim, b: Bug) {
  s.bugs = s.bugs.filter((x) => x !== b)
  s.rings.push({ x: b.x, y: b.y, t: 0, big: false }, { x: b.x, y: b.y, t: -0.12, big: false })
  burst(s, b.x, b.y, [0, 1, 2, 3], 30, 5)
  s.onFix(b)
}

function burst(s: Sim, x: number, y: number, cs: number[], n: number, v: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = v * (0.4 + Math.random())
    s.bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - v * 0.5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cs[i % cs.length], life: 0.9 + Math.random() * 0.6, max: 1.5 })
  }
}

function draw(ctx: CanvasRenderingContext2D, s: Sim, now: number) {
  const { w, h, colors } = s
  const ink = s.night ? '#f3f0e7' : s.ink
  const r = agentR(s.agents.length, w)
  ctx.clearRect(0, 0, w, h)

  for (const g of s.rings) {
    if (g.t < 0) continue
    const p = g.t / (g.big ? 0.9 : 0.6)
    ctx.globalAlpha = 1 - p; ctx.strokeStyle = g.big ? colors[3] : ink; ctx.lineWidth = g.big ? 5 * (1 - p) + 1 : 2.5
    ctx.beginPath(); ctx.arc(g.x, g.y, (g.big ? 40 + 380 * easeOut(p) : 14 + 60 * easeOut(p)), 0, Math.PI * 2); ctx.stroke()
  }
  ctx.globalAlpha = 1

  for (const b of s.bugs) drawBug(ctx, b, now, ink, colors, s.night, unit(w))

  if (s.night) {
    ctx.lineCap = 'round'
    for (const a of s.agents) {
      if (a.trail.length < 4) continue
      ctx.strokeStyle = colors[a.role]; ctx.lineWidth = r * 0.9; ctx.globalAlpha = 0.28
      ctx.beginPath(); ctx.moveTo(a.trail[0], a.trail[1])
      for (let i = 2; i < a.trail.length; i += 2) ctx.lineTo(a.trail[i], a.trail[i + 1])
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  for (const a of s.agents) {
    if (a.wait > 0) continue
    const rr = r * (1 + a.pop * 0.6) * (a.dying ? Math.max(0, 1 - a.dying) : 1)
    if (rr <= 0.2) continue
    if (!s.night) { ctx.fillStyle = s.ink; ctx.beginPath(); ctx.arc(a.x + 1.3, a.y + 1.8, rr, 0, Math.PI * 2); ctx.fill() }
    else { ctx.fillStyle = colors[a.role]; ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(a.x, a.y, rr * 2.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1 }
    ctx.fillStyle = colors[a.role]; ctx.strokeStyle = s.night ? '#0f0f0f' : s.ink; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(a.x, a.y, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    // eyes look where it's going
    const sp = Math.hypot(a.vx, a.vy) || 1, ex = (a.vx / sp) * rr * 0.35, ey = (a.vy / sp) * rr * 0.35
    ctx.fillStyle = '#0f0f0f'
    if (rr > 4.5) for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(a.x + ex + (-a.vy / sp) * side * rr * 0.32, a.y + ey + (a.vx / sp) * side * rr * 0.32, rr * 0.16, 0, Math.PI * 2); ctx.fill() }
  }

  for (const p of s.bits) {
    ctx.save(); ctx.globalAlpha = Math.min(1, p.life / 0.4); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
    ctx.fillStyle = colors[p.c]; ctx.strokeStyle = ink; ctx.lineWidth = 1
    ctx.fillRect(-3.5, -2, 7, 4); ctx.strokeRect(-3.5, -2, 7, 4); ctx.restore()
  }
  ctx.globalAlpha = 1
}

function drawBug(ctx: CanvasRenderingContext2D, b: Bug, now: number, ink: string, colors: string[], night: boolean, u: number) {
  const t = now / 1000, ang = Math.atan2(b.vy, b.vx) + Math.PI / 2, falling = b.land > 0
  ctx.save(); ctx.translate(b.x, b.y); ctx.scale(u, u)
  const pz = 1 + b.pulse * 0.25
  // the ring: four quarters, one per agent, filled as each one does its part
  for (let i = 0; i < 4; i++) {
    const a0 = -Math.PI / 2 + i * (Math.PI / 2) + 0.12, a1 = a0 + Math.PI / 2 - 0.24
    ctx.beginPath(); ctx.arc(0, 0, (R_BUG + 7) * pz, a0, a1)
    if (i < b.stage) { ctx.strokeStyle = colors[i]; ctx.lineWidth = 5; ctx.setLineDash([]) }
    else { ctx.strokeStyle = ink; ctx.globalAlpha = i === b.stage ? 0.55 + Math.sin(t * 6) * 0.25 : 0.25; ctx.lineWidth = 2; ctx.setLineDash([3, 4]) }
    ctx.stroke(); ctx.globalAlpha = 1
  }
  ctx.setLineDash([])
  ctx.rotate(falling ? Math.sin(t * 20) * 0.4 : ang)
  // legs
  ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
    const y = -4 + i * 4, wig = Math.sin(t * 14 + i * 2 + (side > 0 ? Math.PI : 0)) * 2.2
    ctx.beginPath(); ctx.moveTo(side * 4, y); ctx.lineTo(side * 10, y - 2 + wig); ctx.stroke()
  }
  // antennae, body and head
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 2, -8); ctx.quadraticCurveTo(side * 5, -13, side * 7 + Math.sin(t * 5) * side, -14); ctx.stroke() }
  ctx.fillStyle = night ? '#2a2d36' : '#ffffff'
  ctx.beginPath(); ctx.ellipse(0, 1.5, 6.5, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 9); ctx.stroke()
  ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(0, -7.5, 3.6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = colors[2]
  for (const [x, y] of [[-3, -1], [3, 3]]) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill() }
  ctx.restore()
  // the name of the test it belongs to
  if (!falling) {
    ctx.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'center'
    ctx.fillStyle = ink; ctx.globalAlpha = 0.72; ctx.fillText(short(b.name), b.x, b.y + (R_BUG + 22) * u); ctx.globalAlpha = 1
  }
}

const short = (s: string) => (s.length > 22 ? s.slice(0, 21) + '…' : s)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const backOut = (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2 }
