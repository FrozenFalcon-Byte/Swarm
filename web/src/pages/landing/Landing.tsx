import { AnimatePresence, animate, motion, useInView, useMotionValueEvent, useScroll, useTransform } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AgentDots } from '../../components/AgentDots'
import { Logo, Mark } from '../../components/Logo'
import { Reveal, SplitWords } from '../../components/Reveal'
import { SmoothScroll } from '../../components/SmoothScroll'
import { useAuth } from '../../lib/auth'
import { easeInOut, easeOut } from '../../lib/motion'
import { Glyph, type GlyphName } from './glyphs'
import './landing.css'

export default function Landing() {
  return (
    <div className="landing">
      <SmoothScroll />
      <Nav />
      <Hero />
      <AppScreens />
      <PatternSearch />
      <VerticalList />
      <StatGrid />
      <HorizontalList />
      <Faq />
      <Footer />
    </div>
  )
}

/** Ctrl's section label: a coloured dot and a short word. */
function Surtitle({ children, dot = 'var(--green)' }: { children: ReactNode; dot?: string }) {
  return <p className="surtitle"><span style={{ background: dot }} />{children}</p>
}

/* ============================================================ nav */

function Nav() {
  const { user } = useAuth()
  const { scrollY } = useScroll()
  const [hidden, setHidden] = useState(false)
  const [menu, setMenu] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setHidden(y > (scrollY.getPrevious() ?? 0) && y > 300 && !menu))
  const links = [['#how', 'How it works'], ['#patterns', 'Patterns'], ['#security', 'Security'], ['#faq', 'FAQ']]
  return (
    <motion.header className="nav" animate={{ y: hidden ? -120 : 0 }} transition={{ duration: 0.5, ease: easeOut }}>
      <div className="nav-inner">
        <Logo />
        <nav className="nav-pill" aria-label="Sections">
          {links.map(([href, label], i) => <span key={href} className="nav-pill-item">{i > 0 && <i />}<a href={href}>{label}</a></span>)}
        </nav>
        <div className="nav-cta">
          {user ? <Link to="/app" className="btn btn-dark">Dashboard</Link> : (
            <><Link to="/signin" className="nav-signin">Sign in</Link><Link to="/signup" className="btn btn-dark">Get started</Link></>
          )}
          <button className="nav-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <motion.span animate={menu ? { rotate: 45, y: 4 } : { rotate: 0, y: 0 }} /><motion.span animate={menu ? { rotate: -45, y: -4 } : { rotate: 0, y: 0 }} />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {menu && (
          <motion.nav className="nav-sheet" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.4, ease: easeOut }}>
            {links.map(([href, label]) => <a key={href} href={href} onClick={() => setMenu(false)}>{label}</a>)}
            {!user && <Link to="/signin">Sign in</Link>}
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  )
}

/* ============================================================ hero */

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const titleY = useTransform(scrollYProgress, [0, 1], [0, -140])
  const titleOpacity = useTransform(scrollYProgress, [0.2, 0.75], [1, 0])
  const rise = (d: number) => ({ initial: { y: '105%' }, animate: { y: '0%' }, transition: { duration: 1.1, ease: easeOut, delay: d } })
  return (
    <section className="hero" ref={ref}>
      <motion.div className="hero-inner" style={{ y: titleY, opacity: titleOpacity }}>
        <motion.p className="hero-kicker" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: easeOut, delay: 0.1 }}>
          Four AI agents<br />for every flaky test
        </motion.p>
        <h1 className="hero-title" aria-label="Green builds.">
          <span className="word-mask"><motion.span className="word" {...rise(0.2)}>Green</motion.span></span>
          <motion.span className="hero-tile" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 160, damping: 16, delay: 0.45 }} aria-hidden="true"><Mark size={120} animated /></motion.span>
          <span className="word-mask"><motion.span className="word" {...rise(0.32)}>builds.</motion.span></span>
        </h1>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.75 }}>
          <Link to="/signup" className="btn btn-green btn-xl"><AgentDots size={22} /> Connect a repo</Link>
        </motion.div>
      </motion.div>
    </section>
  )
}

/* ============================================================ sticky app screens */

const SCREENS: { tag: string; glyph: GlyphName; color: string; title: string; text: string }[] = [
  { tag: 'Triage', glyph: 'sort', color: 'var(--coder)', title: 'Every issue sorted in seconds.', text: 'Flaky tests get a label and a priority. Duplicates get closed. Anything unclear goes to you instead of being guessed at.' },
  { tag: 'Patch', glyph: 'patch', color: 'var(--triager)', title: 'Fix the cause, not the symptom.', text: 'The coder reads the failing test and the code behind it, then writes the smallest diff that removes the nondeterminism.' },
  { tag: 'Prove', glyph: 'flask', color: 'var(--pink)', title: 'One green run proves nothing.', text: 'The tester runs the test dozens of times in a sandbox, before and after the patch, until the numbers settle it.' },
  { tag: 'Review', glyph: 'shield', color: 'var(--mint-strong)', title: 'A second agent says no.', text: 'Seeded RNGs, sleeps, retries and skipped tests get sent back. Anything that touches auth waits for a human.' },
]

function AppScreens() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [i, setI] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (p) => setI(Math.min(SCREENS.length - 1, Math.max(0, Math.floor(p * SCREENS.length * 0.999)))))
  const frameScale = useTransform(scrollYProgress, [0, 0.08], [0.9, 1])
  const s = SCREENS[i]
  return (
    <section className="screens" id="how" ref={ref} style={{ height: `${SCREENS.length * 100 + 40}vh` }}>
      <div className="screens-sticky">
        <div className="screens-box screens-title-box" style={{ background: s.color }}>
          <AnimatePresence mode="wait">
            <motion.div key={i} className="screens-box-inner" initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-60%', opacity: 0 }} transition={{ duration: 0.6, ease: easeOut }}>
              <h2 className="screens-title">{s.title}</h2>
              <div className="screens-tagrow"><span className="tag">{s.tag}</span><Glyph name={s.glyph} size={60} /></div>
            </motion.div>
          </AnimatePresence>
        </div>
        <motion.div className="app-frame screens-frame" style={{ scale: frameScale }}>
          <AnimatePresence mode="wait">
            <motion.div key={i} className="screen" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.55, ease: easeOut }}>
              {[<ScreenTriage key={0} />, <ScreenPatch key={1} />, <ScreenProve key={2} />, <ScreenReview key={3} />][i]}
            </motion.div>
          </AnimatePresence>
          <div className="screen-dots" aria-hidden="true">{SCREENS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        </motion.div>
        <div className="screens-box screens-text-box">
          <AnimatePresence mode="wait">
            <motion.p key={i} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.08 }}>{s.text}</motion.p>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

function ScreenRow({ c, a, b, d = 0 }: { c: string; a: ReactNode; b: ReactNode; d?: number }) {
  return (
    <motion.div className="srow" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + d, duration: 0.5, ease: easeOut }}>
      <span className="srow-dot" style={{ background: c }} /><div className="srow-main">{a}</div><div className="srow-side">{b}</div>
    </motion.div>
  )
}

function ScreenTriage() {
  return (
    <div className="scr">
      <p className="scr-head">Incoming · 7 issues</p>
      <ScreenRow c="var(--coder)" a={<><b>test_normalize_tags fails in CI</b><span>#101 · flaky-test</span></>} b={<em className="chip hot">high</em>} />
      <ScreenRow c="var(--coder)" a={<><b>test_backoff_is_increasing flaky</b><span>#102 · flaky-test</span></>} b={<em className="chip">medium</em>} d={0.08} />
      <ScreenRow c="var(--ink-3)" a={<><b>normalize_tags test flaky again</b><span>#104 · duplicate of #101</span></>} b={<em className="chip">closed</em>} d={0.16} />
      <ScreenRow c="var(--triager)" a={<><b>“broken”</b><span>#107 · confidence 0.5</span></>} b={<em className="chip warn">asks you</em>} d={0.24} />
    </div>
  )
}

function ScreenPatch() {
  return (
    <div className="scr">
      <p className="scr-head">tagkit/tags.py · patch v1</p>
      <div className="scr-diff mono">
        <span> def normalize_tags(tags):</span>
        <span>     cleaned = [t.strip().lower() for t in tags]</span>
        <motion.span className="del" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>-    return list(set(cleaned))</motion.span>
        <motion.span className="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>+    return sorted(set(cleaned))</motion.span>
      </div>
      <p className="scr-note">Set order depended on <b>PYTHONHASHSEED</b>. Sorting makes it deterministic. One line changed.</p>
    </div>
  )
}

function ScreenProve() {
  return (
    <div className="scr">
      <p className="scr-head">hashseed_sweep_v1 · 12 runs each</p>
      {[['Before', 10, 'var(--tester)'], ['After', 0, 'var(--reviewer)']].map(([l, v, c], k) => (
        <div key={l as string} className="scr-bar">
          <div className="scr-bar-top"><b>{l}</b><span className="mono">{v}/12 fail</span></div>
          <div className="scr-bar-track"><motion.div style={{ background: c as string }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, ((v as number) / 12) * 100)}%` }} transition={{ duration: 1, ease: easeOut, delay: 0.3 + k * 0.3 }} /></div>
        </div>
      ))}
      <div className="scr-seeds" aria-hidden="true">
        {Array.from({ length: 12 }, (_, k) => <motion.span key={k} className={k < 10 ? 'bad' : ''} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 + k * 0.04, type: 'spring', stiffness: 300 }} />)}
      </div>
    </div>
  )
}

function ScreenReview() {
  const checks = [['matches-issue', true], ['minimal', true], ['fixes-root-cause', true], ['style-and-syntax', true], ['test-evidence', true]] as const
  return (
    <div className="scr">
      <p className="scr-head">Review · task-001</p>
      {checks.map(([n], k) => (
        <motion.div key={n} className="scr-check" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + k * 0.08 }}>
          <span className="ok">✓</span><span className="mono">{n}</span>
        </motion.div>
      ))}
      <motion.div className="scr-approve" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.65, type: 'spring', stiffness: 220, damping: 16 }}>Approved · waiting for you to merge</motion.div>
    </div>
  )
}

/* ============================================================ pattern search */

const PATTERNS = [
  { id: 'hash', label: 'Hash order', glyph: 'hash', color: 'var(--coder)', symptom: 'Sets and dicts come back in a different order each run.', harness: 'hash_seed_sweep', before: 5, keys: ['tag', 'normalize', 'set', 'dict', 'dedupe', 'unique', 'hash'] },
  { id: 'rng', label: 'Random seeds', glyph: 'dice', color: 'var(--triager)', symptom: 'Jitter, shuffles and sampling with no seed.', harness: 'rng_seed_sweep', before: 4, keys: ['backoff', 'retry', 'jitter', 'random', 'shuffle', 'sample'] },
  { id: 'timing', label: 'Timing', glyph: 'clock', color: 'var(--pink)', symptom: 'Sleeps and timeouts racing a busy machine.', harness: 'clock_skew_runner', before: 3, keys: ['timeout', 'sleep', 'cache', 'evict', 'ttl', 'expire', 'slow'] },
  { id: 'order', label: 'Test order', glyph: 'sort', color: 'var(--mint-strong)', symptom: 'Passes alone, fails when run with the others.', harness: 'order_shuffle_runner', before: 6, keys: ['admin', 'scope', 'order', 'fixture', 'setup', 'teardown'] },
  { id: 'tz', label: 'Time zones', glyph: 'globe', color: 'var(--coder)', symptom: 'Dates that break at midnight or in another zone.', harness: 'tz_matrix', before: 2, keys: ['date', 'time', 'tz', 'iso', 'parse', 'midnight', 'utc'] },
  { id: 'async', label: 'Async races', glyph: 'bolt', color: 'var(--triager)', symptom: 'Awaits and threads that finish in any order.', harness: 'race_amplifier', before: 5, keys: ['async', 'await', 'thread', 'concurrent', 'race', 'socket', 'reconnect'] },
  { id: 'float', label: 'Floating point', glyph: 'dot', color: 'var(--pink)', symptom: 'Exact comparisons on numbers that round.', harness: 'float_tolerance_probe', before: 3, keys: ['float', 'round', 'sum', 'average', 'ratio', 'decimal', 'total'] },
  { id: 'state', label: 'Shared state', glyph: 'patch', color: 'var(--mint-strong)', symptom: 'Module-level state leaking between tests.', harness: 'state_leak_detector', before: 4, keys: ['state', 'global', 'singleton', 'env', 'leak', 'registry', 'config'] },
] as const
type Pattern = (typeof PATTERNS)[number]
const QUERIES = ['test_normalize_tags', 'test_backoff_is_increasing', 'test_parse_iso_date', 'test_websocket_reconnect', 'test_invoice_total', 'test_render_markdown']

function matchPattern(q: string): Pattern | null {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return PATTERNS.find((p) => words.some((w) => p.keys.some((k) => w.startsWith(k) || (w.length > 3 && k.startsWith(w))))) ?? null
}

function PatternSearch() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { margin: '-25% 0px' })
  const [q, setQ] = useState('')
  const [touched, setTouched] = useState(false)
  // Until someone types, the box demos itself: it types a test name, holds, and clears.
  useEffect(() => {
    if (!inView || touched) return
    let alive = true
    ;(async () => {
      for (let n = 0; alive; n++) {
        const word = QUERIES[n % QUERIES.length]
        for (let k = 1; k <= word.length && alive; k++) { setQ(word.slice(0, k)); await sleep(48) }
        await sleep(2600)
        for (let k = word.length; k >= 0 && alive; k--) { setQ(word.slice(0, k)); await sleep(16) }
        await sleep(300)
      }
    })()
    return () => { alive = false }
  }, [inView, touched])

  const hit = q.length > 4 ? matchPattern(q) : null
  const unknown = q.length > 8 && !hit
  return (
    <section className="patterns" id="patterns" ref={ref}>
      <div className="patterns-side">
        <Surtitle dot="var(--coder)">Pattern library</Surtitle>
        <SplitWords text="Every kind of flaky. One swarm." className="title-6" />
        <Reveal delay={0.1}><p className="text-grey">Type a failing test. Swarm matches it to a known cause and the harness that proves the fix, or writes a new one.</p></Reveal>
        <Reveal delay={0.2} className="psearch">
          <Glyph name="search" size={30} />
          <input value={q} placeholder="test_name" aria-label="Try a test name" spellCheck={false} autoComplete="off"
            onFocus={() => { if (!touched) { setTouched(true); setQ('') } }} onChange={(e) => { setTouched(true); setQ(e.target.value) }} />
          {!touched && <span className="psearch-demo" aria-hidden="true">demo</span>}
        </Reveal>
        <div className="presult" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {hit ? (
              <motion.div key={hit.id} className="presult-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: easeOut }}>
                <div className="presult-head"><span className="presult-icon" style={{ background: hit.color }}><Glyph name={hit.glyph as GlyphName} size={22} /></span><b>{hit.label}</b><span className="mono">{hit.harness}</span></div>
                <RunStrip before={hit.before} />
              </motion.div>
            ) : unknown ? (
              <motion.div key="new" className="presult-card presult-new" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: easeOut }}>
                <div className="presult-head"><span className="presult-icon" style={{ background: 'var(--white)' }}><Glyph name="flask" size={22} /></span><b>Nothing on file</b></div>
                <p>The tester writes a harness for this one, proves it catches the flake, and adds it to the library.</p>
              </motion.div>
            ) : (
              <motion.p key="idle" className="presult-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Matches appear here.</motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="pgrid">
        {PATTERNS.map((p, k) => (
          <motion.article key={p.id} className={`pcard ${hit?.id === p.id ? 'on' : ''} ${hit && hit.id !== p.id ? 'dim' : ''}`}
            initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.8, ease: easeOut, delay: (k % 2) * 0.08 }}>
            <span className="pcard-icon" style={{ background: p.color }}><Glyph name={p.glyph as GlyphName} size={28} /></span>
            <h3>{p.label}</h3>
            <p>{p.symptom}</p>
            <span className="pcard-tool mono">{p.harness}</span>
          </motion.article>
        ))}
      </div>
    </section>
  )
}

/** Twelve sandboxed runs: the failures before the patch, then the same runs after it. */
function RunStrip({ before }: { before: number }) {
  const runs = 12
  return (
    <div className="runstrip">
      {(['before', 'after'] as const).map((phase, row) => (
        <div className="runstrip-row" key={phase}>
          <span className="runstrip-label">{phase === 'before' ? 'Before' : 'After'}</span>
          <div className="runstrip-cells">
            {Array.from({ length: runs }, (_, i) => {
              const fail = phase === 'before' && Math.floor(((i + 1) * before) / runs) > Math.floor((i * before) / runs) // spread evenly
              return <motion.i key={i} className={fail ? 'fail' : 'pass'} initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: row * 0.5 + i * 0.035, duration: 0.35, ease: easeOut }} />
            })}
          </div>
          <span className="runstrip-count tabnum">{phase === 'before' ? before : 0}/{runs}</span>
        </div>
      ))}
    </div>
  )
}

/* ============================================================ vertical list (stacked cards) */

function VerticalList() {
  const cards = [
    { title: 'Tools that outlive the task', text: 'When no test can prove a fix, the tester writes one, checks it catches the bug, and saves it for the next task.', visual: <VisualHarness /> },
    { title: 'Reviews that say no', text: 'The reviewer never sees the coder’s reasoning. Its only job is to find a reason not to merge.', visual: <VisualReview /> },
    { title: 'Duplicates closed before you see them', text: 'The triager matches new issues against the board by text and by test name, and links the duplicate.', visual: <VisualDupes /> },
  ]
  return (
    <section className="vlist">
      <div className="vlist-head">
        <Surtitle>Level up</Surtitle>
        <h2 className="title-2">
          <SplitWords as="p" text="Fix the flake," className="inline-split" />
          <span className="title-icon"><Glyph name="flask" size={72} /></span>
          <SplitWords as="p" text="not the symptom." className="inline-split" delay={0.2} />
        </h2>
      </div>
      <div className="vlist-cards">
        {cards.map((c, k) => (
          <div key={c.title} className="vcard-sticky" style={{ top: `calc(110px + ${k * 28}px)` }}>
            <Reveal className="vcard">
              <div className="vcard-copy"><h3 className="title-8">{c.title}</h3><p className="text-grey">{c.text}</p></div>
              <div className="vcard-visual">{c.visual}</div>
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  )
}

const HARNESS = `for i in range(runs):
    env["PYTHONHASHSEED"] = str(i)
    results.append(run_once(test, env))`

function VisualHarness() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-15% 0px' })
  const [n, setN] = useState(0)
  useEffect(() => { if (!inView) return; const c = animate(0, HARNESS.length, { duration: 1.8, ease: 'linear', onUpdate: (v) => setN(Math.round(v)) }); return () => c.stop() }, [inView])
  return (
    <div className="app-frame vis" ref={ref}>
      <div className="vis-top"><span className="mono">hashseed_sweep_v1.py</span><span className="chip ok">validated</span></div>
      <pre className="mono vis-code">{HARNESS.slice(0, n)}<span className="caret" /></pre>
      <div className="vis-meta"><span>used by task-001, task-003</span><b>reused 1×</b></div>
    </div>
  )
}

function VisualReview() {
  return (
    <div className="app-frame vis">
      <div className="vis-top"><span className="mono">task-002 · patch v1</span><span className="chip bad">changes requested</span></div>
      <div className="vis-diff mono"><span className="add">+    random.seed(0)</span></div>
      <p className="vis-quote">“Seeds the RNG in the test instead of fixing the nondeterminism.”</p>
      <div className="vis-meta"><span>patch v2 · bound-jitter</span><b className="okt">approved</b></div>
    </div>
  )
}

function VisualDupes() {
  return (
    <div className="app-frame vis vis-stack">
      {[['#101', 'test_normalize_tags fails intermittently in CI', 'task-001'], ['#104', 'normalize_tags test flaky again', 'duplicate of task-001']].map(([n, t, s], k) => (
        <motion.div key={n} className="vis-issue" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: k * 0.2, ease: easeOut, duration: 0.6 }}>
          <span className="mono">{n}</span><b>{t}</b><em className={`chip ${k ? '' : 'ok'}`}>{s}</em>
        </motion.div>
      ))}
    </div>
  )
}

/* ============================================================ stat grid (tall pastel cards) */

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [v, setV] = useState(0)
  useEffect(() => { if (!inView) return; const c = animate(0, to, { duration: 1.6, ease: easeOut, onUpdate: setV }); return () => c.stop() }, [inView, to])
  return <span ref={ref}>{Math.round(v)}{suffix}</span>
}

function StatGrid() {
  const items = [
    { color: 'var(--sky-card)', big: <><CountUp to={83} suffix="%" /> → <CountUp to={0} suffix="%" /></>, text: 'of runs failing, before and after the patches, across 36 sandboxed runs.' },
    { color: 'var(--pink-card)', big: <CountUp to={0} />, text: 'automatic merges. A maintainer clicks merge, every single time.' },
    { color: 'var(--yellow-card)', big: <CountUp to={4} />, text: 'agents on one board, with a full audit trail on every card.' },
  ]
  return (
    <section className="grid-sec">
      <SplitWords text="Take the pager off." className="title-2 grid-title" />
      <div className="stat-grid">
        {items.map((it, k) => (
          <Reveal key={k} delay={k * 0.1} className="stat-card">
            <div className="stat-card-inner" style={{ background: it.color }}>
              <b className="stat-big">{it.big}</b>
              <p>{it.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ============================================================ horizontal list */

const FEATURES: { title: string; text: string; glyph: GlyphName; color: string }[] = [
  { title: 'Sandboxed', text: 'Every patch and every agent-written tool runs in a throwaway copy of your repo, with no network.', glyph: 'box', color: 'var(--coder)' },
  { title: 'Never auto-merges', text: 'Approved means ready for you. Auth and security paths always wait for a maintainer.', glyph: 'shield', color: 'var(--mint-strong)' },
  { title: 'Your models', text: 'Free Groq and Gemini APIs out of the box, falling back from one to the next. Bring Anthropic or a local model if you prefer.', glyph: 'chip', color: 'var(--triager)' },
  { title: 'Remembers', text: 'Validated tools are saved per repository, so the swarm gets faster the longer it works there.', glyph: 'hash', color: 'var(--pink)' },
  { title: 'Audit trail', text: 'Every card records who moved it, when and why, from triage to merge.', glyph: 'sort', color: 'var(--coder)' },
]

function HorizontalList() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const x = useTransform(scrollYProgress, [0.05, 0.95], ['0%', '-58%'])
  return (
    <section className="hlist" id="security" ref={ref}>
      <div className="hlist-sticky">
        <div className="hlist-head"><Surtitle dot="var(--coder)">Secure and private</Surtitle></div>
        <motion.div className="hlist-track" style={{ x }}>
          {FEATURES.map((f) => (
            <article key={f.title} className="hcard">
              <span className="hcard-icon" style={{ background: f.color }}><Glyph name={f.glyph} size={44} /></span>
              <div><h3>{f.title}</h3><p className="text-grey">{f.text}</p></div>
            </article>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ============================================================ faq */

const FAQS = [
  ['Does Swarm merge anything on its own?', 'No. The best a task can reach on its own is Approved. A maintainer clicks Merge, which opens a pull request on GitHub. Security-sensitive paths need your approval even before that.'],
  ['Where does the code run?', 'In a disposable copy of your repository. With Docker it runs in a container with no network access and memory, CPU and process limits. Without Docker it falls back to a local sandbox with CPU, file-size and time limits.'],
  ['Which models does it use?', 'Free model APIs by default: Groq first, then Gemini and OpenRouter, with Anthropic or a local Ollama model as options. With no model at all, the agents use built-in fix strategies.'],
  ['What kind of issues does it handle?', 'Version 1 focuses on flaky tests: ordering, randomness and timing. Everything else is triaged and handed to you with a label, not guessed at.'],
  ['What is a “tool” in Swarm?', 'A small harness the tester writes when existing tests can’t prove a fix, for example running a test under 12 hash seeds. It must catch the bug on the old code before it is trusted and saved for reuse.'],
  ['Can I talk to Swarm from Claude?', 'Yes. Swarm is also an MCP server: add `swarm mcp` to Claude Desktop, Claude Code or any MCP client and ask what the agents did overnight, read a diff or a harness, start a run, or send a patch back with feedback. Merging still happens only in the dashboard.'],
  ['Can I use it on a private repository?', 'Yes. Connect GitHub (or paste a fine-grained token) in Settings. It is stored in your private user record and only the worker reads it, to clone, read issues and open pull requests. New issues are picked up automatically every few minutes.'],
  ['What does it cost to run?', 'Nothing to start: Firebase’s free plan and the free tiers of Groq and Gemini cover a small team, within their rate limits.'],
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  const [all, setAll] = useState(false)
  const list = all ? FAQS : FAQS.slice(0, 4)
  return (
    <section className="faq" id="faq">
      <div className="faq-head"><SplitWords text="Any questions ?" className="title-2" /></div>
      <div className="faq-list">
        {list.map(([q, a], k) => (
          <motion.div key={q} layout className={`faq-item ${open === k ? 'is-open' : ''}`} transition={{ duration: 0.5, ease: easeInOut }}>
            <button className="faq-q" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
              <span>{q}</span>
              <motion.span className="faq-btn" animate={{ rotate: open === k ? 45 : 0 }} transition={{ duration: 0.4, ease: easeOut }} aria-hidden="true">+</motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open === k && (
                <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.6, ease: easeInOut }}>
                  <p>{a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
        {!all && <button className="btn btn-line faq-more" onClick={() => setAll(true)}>Show all questions</button>}
      </div>
    </section>
  )
}

/* ============================================================ footer */

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <Surtitle>Level up</Surtitle>
        <h2 className="footer-giant" aria-label="Green builds.">
          <SplitWords as="p" text="Green" className="inline-split" />
          <span className="footer-tile"><Mark size={140} /></span>
          <SplitWords as="p" text="builds." className="inline-split" delay={0.15} />
        </h2>
        <Link to="/signup" className="btn btn-green btn-xl"><AgentDots size={22} /> Get started free</Link>
      </div>
      <div className="footer-cols">
        <div><b>Product</b><a href="#how">How it works</a><a href="#patterns">Patterns</a><Link to="/signup">Get started</Link></div>
        <div><b>Security</b><a href="#security">Sandbox</a><a href="#faq">Merge policy</a></div>
        <div><b>Support</b><a href="#faq">FAQ</a><Link to="/signin">Sign in</Link></div>
        <div><b>Company</b><span>Swarm</span><span>Made for maintainers</span></div>
      </div>
      <div className="footer-bottom"><Logo /><span>© {new Date().getFullYear()} Swarm</span></div>
    </footer>
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
