import { easeInOut, motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionStyle, type MotionValue } from 'motion/react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useWinHeight } from '../../lib/winHeight'
import './relay.css'

/*
 * The Relay: one bug, handed from agent to agent until it ships, told in a single unbroken shot you scroll.
 * There are no cuts. One shape carries the whole story: a dot becomes an issue card, the card stretches into a code
 * window, folds into a grid of tests, rounds into a green stamp and shrinks to a commit on the line. The four agents
 * are the same four sticker-dots throughout, stepping up to take the baton in turn.
 *
 * Everything is drawn on a virtual canvas in "u" units (1u = 1% of the stage's height, capped by its width), and
 * every scroll-driven value is fed to CSS as a custom property, so the geometry stays crisp at any size.
 */

const ROLES = ['triager', 'coder', 'tester', 'reviewer'] as const
const TITLE_KEY = 'swarm:relay-title'
const DEFAULT_TITLE = 'The save button ignores the second click'

const SCENES = [
  { a: 0, b: 0.1, k: 'The bug', t: 'It starts with a dot.', s: 'Somewhere in your code, something small goes wrong.' },
  { a: 0.1, b: 0.22, k: 'The issue', t: 'Someone opens an issue.', s: 'Now it has a name, a number, and four agents on the way.' },
  { a: 0.22, b: 0.36, k: 'Triage', t: 'The triager reads it first.', s: 'Is it real? How bad? Who takes it? Sorted in seconds.' },
  { a: 0.36, b: 0.5, k: 'The fix', t: 'The coder writes the fix.', s: 'Small and careful, one line at a time.' },
  { a: 0.5, b: 0.64, k: 'Tests', t: 'The tester tries to break it.', s: 'Every test runs. The one that fails gets fixed too.' },
  { a: 0.64, b: 0.78, k: 'Review', t: 'The reviewer signs off.', s: 'Nothing ships without a second look.' },
  { a: 0.78, b: 0.9, k: 'Merge', t: 'It merges.', s: 'One more dot on the line. Nobody had to lift a finger.' },
  { a: 0.9, b: 1.01, k: 'Again', t: 'That’s the relay.', s: 'Four agents, one baton, every single time.' },
]
const sceneAt = (v: number) => Math.max(0, SCENES.findIndex((s) => v >= s.a && v < s.b))

/** scroll → value, eased between every pair of keyframes so nothing ever lurches */
function useK(p: MotionValue<number>, at: number[], v: number[]) {
  return useTransform(p, at, v, { ease: at.slice(1).map(() => easeInOut) })
}
/** fades in just after `a` and out just before `b` */
function useWin(p: MotionValue<number>, a: number, b: number, f = 0.014) {
  return useTransform(p, [a - f, a, b, b + f], [0, 1, 1, 0])
}
const readTitle = () => { try { return localStorage.getItem(TITLE_KEY) || DEFAULT_TITLE } catch { return DEFAULT_TITLE } }

export default function Relay() {
  const winH = useWinHeight()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.5, restDelta: 0.0001 })
  const [scene, setScene] = useState(0)
  useMotionValueEvent(p, 'change', (v) => setScene(sceneAt(v)))
  const [title, setTitle] = useState(readTitle)

  const again = (next: string) => {
    const t = next.trim() || DEFAULT_TITLE
    setTitle(t)
    try { localStorage.setItem(TITLE_KEY, t) } catch { /* this visit only */ }
    const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY
    window.scrollTo({ top, behavior: document.documentElement.classList.contains('less-motion') ? 'auto' : 'smooth' })
  }

  const grid = useTransform(p, [0, 1], [0, -38])
  const bgy = useTransform(grid, (v) => `${v}cqh`)

  return (
    <div className="page rl-page" style={winH}>
      <section ref={ref} className="rl-film">
        <div className="rl-pin">
          <motion.div className={`rl-stage is-s${scene}`} style={{ backgroundPositionY: bgy }}>
            <Blob p={p} />
            <Line p={p} />
            <Card p={p} title={title} />
            {ROLES.map((r, k) => <Agent key={r} p={p} k={k} role={r} on={scene === k + 2} />)}
            {SCENES.map((s, k) => <Headline key={s.k} p={p} k={k} on={k === scene} />)}

            <div className="rl-top">
              <span className="rl-chip"><b>The Relay</b><Link to="/app/fun" className="rl-back">← Just for fun</Link></span>
            </div>
            <Finale p={p} title={title} onAgain={again} />
            <Progress p={p} scene={scene} />
            <motion.div className="rl-hint" style={{ opacity: useTransform(p, [0, 0.025], [1, 0]) }} aria-hidden="true"><span>Scroll</span><i /></motion.div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ the one shape */

function Card({ p, title }: { p: MotionValue<number>; title: string }) {
  const at = [0, 0.05, 0.1, 0.14, 0.36, 0.405, 0.5, 0.545, 0.64, 0.685, 0.78, 0.83, 1]
  const w = useK(p, at, [3, 18, 18, 64, 64, 104, 104, 72, 72, 38, 38, 5, 5])
  const h = useK(p, at, [3, 18, 18, 42, 42, 58, 58, 48, 48, 38, 38, 5, 5])
  const r = useK(p, at, [1.5, 9, 9, 4, 4, 3, 3, 4, 4, 19, 19, 2.5, 2.5])
  const x = useK(p, [0, 0.86, 0.97, 1], [0, 0, -48, -48])
  const rot = useK(p, [0, 0.1, 0.14, 0.2, 0.26, 0.3, 0.36, 0.64, 0.7, 0.78], [0, 0, -7, 0, 3, 0, 0, 0, -4, 0])
  const s = useK(p, [0, 0.72, 0.735, 0.755, 1], [1, 1, 1.13, 1, 1])
  const ink = useTransform(p, [0.02, 0.045], [1, 0])
  const green = useTransform(p, [0.655, 0.69], [0, 1])
  const bang = useWin(p, 0.05, 0.095, 0.01)
  const issue = useWin(p, 0.135, 0.36)
  const code = useWin(p, 0.41, 0.5)
  const tests = useWin(p, 0.55, 0.64)
  const check = useWin(p, 0.69, 0.79, 0.012)
  const draw = useTransform(p, [0.69, 0.725], [0, 1])
  return (
    <motion.div className="rl-card" style={{ '--w': w, '--h': h, '--r': r, '--x': x, '--rot': rot, '--s': s } as MotionStyle}>
      <motion.i className="rl-fill rl-fill--ink" style={{ opacity: ink }} />
      <motion.i className="rl-fill rl-fill--green" style={{ opacity: green }} />
      <motion.b className="rl-bang" style={{ opacity: bang }}>!</motion.b>
      <motion.div className="rl-layer rl-issue" style={{ opacity: issue }}><Issue p={p} title={title} /></motion.div>
      <motion.div className="rl-layer rl-code" style={{ opacity: code }}><Code p={p} /></motion.div>
      <motion.div className="rl-layer rl-tests" style={{ opacity: tests }}>{Array.from({ length: 12 }, (_, k) => <Test key={k} p={p} k={k} />)}</motion.div>
      <motion.svg className="rl-layer rl-check" viewBox="0 0 100 100" style={{ opacity: check }}>
        <motion.path d="M28 52 L44 67 L73 35" fill="none" stroke="#0f0f0f" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: draw }} />
      </motion.svg>
    </motion.div>
  )
}

function Issue({ p, title }: { p: MotionValue<number>; title: string }) {
  const scan = useK(p, [0.245, 0.33], [0, 100])
  const scanO = useWin(p, 0.245, 0.33, 0.01)
  const chips = [['bug', 'var(--tester)', 0.27], ['priority: high', 'var(--triager)', 0.29], ['→ coder', 'var(--coder)', 0.315]] as const
  return (
    <>
      <span className="rl-meta">#142 · opened just now</span>
      <b className="rl-title">{title}</b>
      <span className="rl-bars"><i style={{ width: '92%' }} /><i style={{ width: '74%' }} /><i style={{ width: '84%' }} /></span>
      <span className="rl-labels">{chips.map(([t, c, a]) => <Chip key={t} p={p} at={a} c={c}>{t}</Chip>)}</span>
      <motion.i className="rl-scan" style={{ top: useTransform(scan, (v) => `${v}%`), opacity: scanO }} />
    </>
  )
}
function Chip({ p, at, c, children }: { p: MotionValue<number>; at: number; c: string; children: string }) {
  const scale = useK(p, [at, at + 0.012], [0, 1])
  return <motion.span className="rl-label" style={{ scale, background: c }}>{children}</motion.span>
}

const DIFF: [string, string][] = [
  [' ', 'async function save(form) {'], ['-', '  if (clicks > 1) return'], ['-', '  clicks++'],
  ['+', '  if (saving) return form.pending'], ['+', '  saving = true'], ['+', '  try { await submit(form) } finally { saving = false }'], [' ', '}'],
]
function Code({ p }: { p: MotionValue<number> }) {
  return (
    <>
      <span className="rl-code-head"><i /><i /><i /><em>save.ts</em></span>
      {DIFF.map(([m, t], k) => <Row key={k} p={p} at={0.415 + k * 0.011} m={m} t={t} />)}
    </>
  )
}
function Row({ p, at, m, t }: { p: MotionValue<number>; at: number; m: string; t: string }) {
  const scaleX = useK(p, [at, at + 0.012], [0, 1])
  const opacity = useTransform(p, [at, at + 0.006], [0, 1])
  return (
    <motion.span className={`rl-row ${m === '+' ? 'is-add' : m === '-' ? 'is-del' : ''}`} style={{ opacity }}>
      <motion.i style={{ scaleX }} /><b>{m}</b><code>{t}</code>
    </motion.span>
  )
}

/** one test: waits, then passes; the seventh fails first and gets fixed */
function Test({ p, k }: { p: MotionValue<number>; k: number }) {
  const at = 0.556 + k * 0.0055
  const flaky = k === 6
  const pass = useTransform(p, flaky ? [0.607, 0.614] : [at, at + 0.004], [0, 1])
  const fail = useTransform(p, [at, at + 0.004, 0.603, 0.609], flaky ? [0, 1, 1, 0] : [0, 0, 0, 0])
  const scale = useK(p, flaky ? [0.607, 0.612, 0.618] : [at, at + 0.003, at + 0.008], [1, 1.18, 1])
  return (
    <motion.span className={`rl-test ${flaky ? 'is-shaky' : ''}`} style={{ scale }}>
      <motion.i className="rl-test-fail" style={{ opacity: fail }}>✕</motion.i>
      <motion.i className="rl-test-pass" style={{ opacity: pass }}>✓</motion.i>
    </motion.span>
  )
}

/* ------------------------------------------------------------------ the crew */

const OFF = [[-130, -30], [130, -30], [-130, 30], [130, 30]]
const ROW_Y = 40
const rowX = (k: number) => -27 + k * 18
/** each agent's path through the film: in from its corner, into the row, up to take the baton, back, and up to the finale */
function track(k: number): [number[], number[], number[]] {
  const [ox, oy] = OFF[k], rx = rowX(k), inA = 0.115 + k * 0.012, inB = inA + 0.07
  const head: [number[], number[], number[]] = [[0, inA, inB], [ox, ox, rx], [oy, oy, ROW_Y]]
  const tail: [number[], number[], number[]] = [[0.9, 0.95, 1], [rx, rx, rx], [ROW_Y, -33, -33]]
  const mid: [number[], number[], number[]][] = [
    [[0.22, 0.248, 0.34, 0.372], [rx, -48, -48, rx], [ROW_Y, -6, -6, ROW_Y]],
    [[0.37, 0.4, 0.5, 0.532], [rx, 62, 62, rx], [ROW_Y, -24, -24, ROW_Y]],
    [[0.52, 0.548, 0.556, 0.634, 0.664], [rx, -38, -38, 38, rx], [ROW_Y, 32, 32, 32, ROW_Y]],
    [[0.65, 0.678, 0.72, 0.735, 0.755, 0.785, 0.815], [rx, 0, 0, 0, 0, 0, rx], [ROW_Y, -33, -33, -23, -33, -33, ROW_Y]],
  ]
  const m = mid[k]
  return [[...head[0], ...m[0], ...tail[0]], [...head[1], ...m[1], ...tail[1]], [...head[2], ...m[2], ...tail[2]]]
}

function Agent({ p, k, role, on }: { p: MotionValue<number>; k: number; role: (typeof ROLES)[number]; on: boolean }) {
  const [at, xs, ys] = track(k)
  const x = useK(p, at, xs)
  const y = useK(p, at, ys)
  return (
    <motion.div className={`rl-agent ${on ? 'is-on' : ''}`} style={{ '--x': x, '--y': y, '--c': `var(--${role})` } as MotionStyle}>
      <span className="rl-agent-body"><i /><i /></span>
      <span className="rl-agent-name">{role}</span>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ around it */

/** a soft sticker-blob behind the action that takes on the colour of whoever holds the baton */
function Blob({ p }: { p: MotionValue<number> }) {
  const at = [0, 0.1, 0.2, 0.29, 0.43, 0.57, 0.71, 0.84, 0.95]
  const background = useTransform(p, at, ['#e9e5da', '#e9e5da', '#fbe74e', '#fbe74e', '#9dc4f5', '#ff8a7a', '#5dd36a', '#9dc4f5', '#fbe74e'])
  const scale = useK(p, [0, 0.08, 0.14, 0.4, 0.47, 0.82, 0.9, 1], [0.2, 0.6, 1, 1, 1.12, 1, 1.25, 1.1])
  const rotate = useTransform(p, [0, 1], [0, 220])
  return <motion.div className="rl-blob" style={{ background, scale, rotate }} aria-hidden="true" />
}

const COMMITS = Array.from({ length: 26 }, (_, i) => i - 18).filter((i) => i !== 0)
/** the main branch: draws across, fills with past commits, and slides along as yours joins it */
function Line({ p }: { p: MotionValue<number> }) {
  const draw = useK(p, [0.79, 0.845], [0, 1])
  const shift = useK(p, [0, 0.86, 0.97, 1], [0, 0, -48, -48])
  const ring = useTransform(p, [0.852, 0.9], [0.6, 4.2])
  const ringO = useTransform(p, [0.85, 0.856, 0.9], [0, 1, 0])
  const opacity = useTransform(p, [0.785, 0.79], [0, 1])
  return (
    <motion.div className="rl-line" style={{ opacity }} aria-hidden="true">
      <motion.i className="rl-rail" style={{ scaleX: draw }} />
      {COMMITS.map((i) => <Commit key={i} p={p} i={i} shift={shift} />)}
      <motion.i className="rl-ring" style={{ '--x': shift, scale: ring, opacity: ringO } as MotionStyle} />
    </motion.div>
  )
}
function Commit({ p, i, shift }: { p: MotionValue<number>; i: number; shift: MotionValue<number> }) {
  const at = 0.8 + ((i + 18) / 26) * 0.045
  const scale = useK(p, [at, at + 0.01], [0, 1])
  const x = useTransform(shift, (v) => v + i * 16)
  return <motion.i className="rl-commit" style={{ '--x': x, scale, '--c': `var(--${ROLES[(i + 40) % 4]})` } as MotionStyle} />
}

function Headline({ p, k, on }: { p: MotionValue<number>; k: number; on: boolean }) {
  const s = SCENES[k]
  const a = k === 0 ? -1 : s.a + 0.006, b = k === SCENES.length - 1 ? 2 : s.b - 0.006
  const opacity = useTransform(p, [a, a + 0.016, b - 0.016, b], [0, 1, 1, 0])
  const y = useTransform(p, [a, a + 0.016, b - 0.016, b], [26, 0, 0, -26])
  const blur = useTransform(p, [a, a + 0.016, b - 0.016, b], [8, 0, 0, 8])
  const filter = useTransform(blur, (v) => `blur(${v}px)`)
  return (
    <motion.div className="rl-head" style={{ opacity, y, filter }} aria-hidden={!on}>
      <span className="rl-kicker">{String(k + 1).padStart(2, '0')} · {s.k}</span>
      <h1>{s.t}</h1>
      <p>{s.s}</p>
    </motion.div>
  )
}

function Progress({ p, scene }: { p: MotionValue<number>; scene: number }) {
  return (
    <div className="rl-progress" aria-hidden="true">
      {SCENES.map((s, k) => <Seg key={s.k} p={p} a={s.a} b={Math.min(1, s.b)} on={k === scene} />)}
    </div>
  )
}
function Seg({ p, a, b, on }: { p: MotionValue<number>; a: number; b: number; on: boolean }) {
  const scaleX = useTransform(p, [a, b], [0, 1])
  return <span className={on ? 'on' : ''}><motion.i style={{ scaleX }} /></span>
}

function Finale({ p, title, onAgain }: { p: MotionValue<number>; title: string; onAgain: (t: string) => void }) {
  const opacity = useTransform(p, [0.925, 0.955], [0, 1])
  const y = useK(p, [0.925, 0.96], [40, 0])
  const [draft, setDraft] = useState(title === DEFAULT_TITLE ? '' : title)
  const [shown, setShown] = useState(false)
  useMotionValueEvent(opacity, 'change', (v) => setShown(v > 0.5))
  const submit = (e: FormEvent) => { e.preventDefault(); onAgain(draft) }
  return (
    <motion.form className="rl-final" style={{ opacity, y, pointerEvents: shown ? 'auto' : 'none' }} onSubmit={submit} aria-hidden={!shown}>
      <b>Your turn.</b>
      <p>Name a bug of your own and send it down the line.</p>
      <div className="rl-final-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={64} placeholder={DEFAULT_TITLE} aria-label="A bug to send down the line" tabIndex={shown ? 0 : -1} />
        <button className="btn btn-dark" type="submit" tabIndex={shown ? 0 : -1}>Run it ↑</button>
      </div>
    </motion.form>
  )
}
