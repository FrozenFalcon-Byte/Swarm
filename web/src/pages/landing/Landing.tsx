import { AnimatePresence, animate, motion, useInView, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AgentDots } from '../../components/AgentDots'
import { Logo, Mark } from '../../components/Logo'
import { Reveal, SplitWords } from '../../components/Reveal'
import { SmoothScroll } from '../../components/SmoothScroll'
import { useAuth } from '../../lib/auth'
import { finishBoot } from '../../lib/boot'
import { easeInOut, easeOut } from '../../lib/motion'
import { Glyph, type GlyphName } from './glyphs'
import './landing.css'
import { Roll } from '../../components/Roll'
import { HeroWorld } from './HeroWorld'
import { Security } from './Security'

let introPlayed = false // module state: resets on reload, survives in-app navigation

export default function Landing() {
  const { hash } = useLocation()
  // intro → lifting (the curtain rises and the logo flies into the headline) → done.
  // It plays on every fresh page load, not when you come back to this page inside the app.
  const [phase, setPhase] = useState<'intro' | 'lifting' | 'done'>(() => (introPlayed ? 'done' : 'intro'))
  const [fromIntro] = useState(phase === 'intro')
  useEffect(() => {
    if (phase === 'done') return
    // iOS ignores overflow on <html> alone, so hold the body and touch scrolling too
    const html = document.documentElement, body = document.body
    html.style.overflow = body.style.overflow = 'hidden'
    body.style.touchAction = 'none'
    return () => { html.style.overflow = body.style.overflow = ''; body.style.touchAction = '' }
  }, [phase])
  useEffect(() => {
    if (!hash || phase !== 'done') return
    const id = window.setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }), 700)
    return () => window.clearTimeout(id)
  }, [hash, phase])
  useLayoutEffect(() => { void finishBoot(true) }, []) // the intro is the loader here
  const lift = useCallback(() => setPhase('lifting'), [])
  const landed = useCallback(() => { introPlayed = true; setPhase('done') }, [])
  return (
    <div className="landing">
      {phase !== 'done' && <Intro lifting={phase === 'lifting'} onLift={lift} onLanded={landed} />}
      <SmoothScroll />
      <Nav />
      <Hero ready={phase !== 'intro'} tileShown={phase === 'done'} fromIntro={fromIntro} />
      <AppScreens />
      <PatternSearch />
      <VerticalList />
      <StatGrid />
      <Security />
      <Faq />
      <Footer />
    </div>
  )
}

/* ============================================================ intro loader */

/** The mark assembles itself (one agent at a time) while a counter runs to 100. Then the curtain lifts
 *  and the mark flies, above everything, to the exact place and size of the mark in the headline, which
 *  only appears once it has landed. Nothing is swapped mid-flight, so the hand-off is seamless. */
function Intro({ lifting, onLift, onLanded }: { lifting: boolean; onLift: () => void; onLanded: () => void }) {
  const [phase, setPhase] = useState(0)
  const odo = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const [started, setStarted] = useState(false) // counts from the mark's first frame, so a slow first load can't outrun it
  const tile = useRef<HTMLSpanElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  // sit exactly over the slot in the centred column, before the first paint and on resize
  useLayoutEffect(() => {
    const place = () => {
      const r = slot.current?.getBoundingClientRect()
      if (r && tile.current) { tile.current.style.left = `${r.left}px`; tile.current.style.top = `${r.top}px` }
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [])
  useEffect(() => { const id = window.setTimeout(() => setStarted(true), 600); return () => window.clearTimeout(id) }, []) // never wait on it forever
  useEffect(() => {
    if (!started) return
    let raf = 0, fonts = false, finished = false
    const start = performance.now(), min = 1900
    if (document.fonts) document.fonts.ready.then(() => { fonts = true }); else fonts = true
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / min)
      // smootherstep: slow start, glide through the middle, settle softly on 100
      const v = p * p * p * (p * (p * 6 - 15) + 10) * 100
      rollTo(odo.current, v)
      if (bar.current) bar.current.style.transform = `scaleX(${v / 100})`
      setPhase(v < 35 ? 0 : v < 60 ? 1 : v < 85 ? 2 : 3)
      if (p < 1 || !fonts) { raf = requestAnimationFrame(tick); return }
      if (finished) return
      finished = true
      const from = tile.current?.getBoundingClientRect()
      const to = document.querySelector('.hero-tile')?.getBoundingClientRect()
      onLift()
      if (!tile.current || !from || !to || !to.width) { onLanded(); return }
      // transform only (GPU): move the tile's top-left corner onto the target's and scale to its size
      animate(tile.current, { x: to.left - from.left, y: to.top - from.top, scale: to.width / from.width },
        { duration: 1.05, ease: [0.76, 0, 0.24, 1] }).then(onLanded)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [started, onLift, onLanded])
  return (
    <>
      <motion.div className="intro" initial={false}
        animate={lifting ? { clipPath: 'inset(0% 0% 100% 0% round 0px 0px 56px 56px)' } : { clipPath: 'inset(0% 0% 0% 0% round 0px 0px 0px 0px)' }}
        transition={{ duration: 0.95, ease: easeInOut }}>
        <div className="intro-center">
          <div className="intro-slot" ref={slot} />
          <p className="intro-word" aria-label="Swarm">
            {'Swarm'.split('').map((c, i) => (
              <span key={i} className="word-mask"><motion.span className="word" initial={{ y: '110%' }} animate={{ y: lifting ? '-110%' : '0%' }}
                transition={{ duration: 0.7, ease: easeOut, delay: lifting ? i * 0.025 : 0.75 + i * 0.05 }}>{c}</motion.span></span>
            ))}
          </p>
        </div>
        <div className="intro-foot mono">
          <span className="intro-phase">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={phase} initial={{ y: '100%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} exit={{ y: '-100%', opacity: 0 }} transition={{ duration: 0.45, ease: easeOut }}>
                {PHASES[phase]}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="intro-pct" ref={odo} aria-label="Loading">
            {[0, 1, 2].map((c) => <span key={c} className="odo-col"><span className="odo-strip">{ODO_DIGITS.map((d, i) => <span key={i}>{d}</span>)}</span></span>)}
          </span>
        </div>
        <div className="intro-bar"><span ref={bar} /></div>
      </motion.div>
      {/* outside the curtain, so it stays visible while the curtain lifts */}
      <span ref={tile} className="intro-tile"><IntroMark onStart={() => setStarted(true)} /></span>
    </>
  )
}

const PHASES = ['Waking the triager', 'Briefing the coder', 'Warming up the sandbox', 'Reviewer on duty']
const ODO_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]

/** An odometer: every column rolls continuously, and a column only turns over while the one to its
 *  right passes from 9 to 0, like a mechanical counter. Written straight to the DOM each frame. */
function rollTo(el: HTMLElement | null, v: number) {
  if (!el) return
  const cols = el.querySelectorAll<HTMLElement>('.odo-strip')
  const carry = (x: number) => Math.min(1, Math.max(0, x))
  const ones = v % 10
  const tens = (Math.floor(v / 10) % 10) + carry(ones - 9)
  const hundreds = Math.floor(v / 100) + carry((v % 100) - 99)
  ;[hundreds, tens, ones].forEach((pos, i) => { if (cols[i]) cols[i].style.transform = `translate3d(0, ${-pos / 11 * 100}%, 0)` })
}

function IntroMark({ onStart }: { onStart: () => void }) {
  const dots = [[11, 11, 'var(--triager)'], [21, 11, 'var(--coder)'], [11, 21, 'var(--tester)'], [21, 21, 'var(--reviewer)']] as const
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
      <motion.rect width="32" height="32" rx="8" fill="var(--ink)" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onAnimationStart={onStart}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }} style={{ transformOrigin: '16px 16px' }} />
      {dots.map(([cx, cy, fill], i) => (
        <motion.circle key={i} cx={cx} cy={cy} r="4" fill={fill} initial={{ y: -26, opacity: 0, scale: 0.4 }} animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 15, delay: 0.25 + i * 0.16 }} style={{ transformOrigin: `${cx}px ${cy}px` }} />
      ))}
    </svg>
  )
}

/** Ctrl's section label: a coloured dot and a short word. */
function Surtitle({ children, dot = 'var(--green)' }: { children: ReactNode; dot?: string }) {
  return <p className="surtitle"><span style={{ background: dot }} />{children}</p>
}

/* ============================================================ nav */

export function Nav() {
  const { user } = useAuth()
  const path = useLocation().pathname
  const { scrollY } = useScroll()
  const [hidden, setHidden] = useState(false)
  const [menu, setMenu] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setHidden(y > (scrollY.getPrevious() ?? 0) && y > 300 && !menu))
  // separate pages only; sections of the landing page are reached by scrolling it
  const links = [['/playground', 'Playground'], ['/cost', 'Cost calculator'], ['/docs/mcp', 'MCP docs']]
  return (
    <motion.header className="nav" animate={{ y: hidden ? -120 : 0 }} transition={{ duration: 0.5, ease: easeOut }}>
      <div className="nav-inner">
        <Logo />
        <nav className="nav-pill" aria-label="Sections">
          {links.map(([href, label], i) => <span key={href} className="nav-pill-item">{i > 0 && <i />}<Link to={href} className={path === href ? 'on' : ''} aria-current={path === href ? 'page' : undefined}>{label}</Link></span>)}
        </nav>
        <div className="nav-cta">
          {user ? <Link to="/app" className="btn btn-dark"><Roll>Dashboard</Roll></Link> : (
            <><Link to="/signin" className="nav-signin">Sign in</Link><Link to="/signup" className="btn btn-dark"><Roll>Get started</Roll></Link></>
          )}
          <button className="nav-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <motion.span animate={menu ? { rotate: 45, y: 4 } : { rotate: 0, y: 0 }} /><motion.span animate={menu ? { rotate: -45, y: -4 } : { rotate: 0, y: 0 }} />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {menu && (
          <motion.nav className="nav-sheet" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.4, ease: easeOut }}>
            {path !== '/' && <Link to="/" onClick={() => setMenu(false)}>Home</Link>}
            {links.map(([href, label]) => <Link key={href} to={href} onClick={() => setMenu(false)}>{label}</Link>)}
            {!user && <Link to="/signin">Sign in</Link>}
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  )
}

/* ============================================================ hero */

function Hero({ ready, tileShown, fromIntro }: { ready: boolean; tileShown: boolean; fromIntro: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const titleY = useTransform(scrollYProgress, [0, 1], [0, -140])
  const titleOpacity = useTransform(scrollYProgress, [0.2, 0.75], [1, 0])
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const show = ready ? 'show' : 'hidden'
  const rise = (d: number) => ({ variants: { hidden: { y: '105%' }, show: { y: '0%', transition: { duration: 1.1, ease: easeOut, delay: d } } }, initial: 'hidden', animate: show })
  return (
    <section className="hero" ref={ref} onPointerMove={move}>
      <div className="hero-grid" aria-hidden="true" />
      <HeroWorld ready={ready} />
      <motion.div className="hero-inner" style={{ y: titleY, opacity: titleOpacity }}>
        <motion.p className="hero-kicker" initial="hidden" animate={show} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: easeOut, delay: 0.15 } } }}>
          Four AI agents for<br />tests that fail at random
        </motion.p>
        <h1 className="hero-title" aria-label="Green builds.">
          <span className="word-mask"><motion.span className="word" {...rise(0.2)}>Green</motion.span></span>
          {fromIntro
            ? <span className="hero-tile" aria-hidden="true" style={{ visibility: tileShown ? 'visible' : 'hidden' }}><Mark size={120} animated={tileShown} /></span>
            : <motion.span className="hero-tile" aria-hidden="true" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 160, damping: 16, delay: 0.45 }}><Mark size={120} animated /></motion.span>}
          <span className="word-mask"><motion.span className="word" {...rise(0.32)}>builds.</motion.span></span>
        </h1>
        <motion.div initial="hidden" animate={show} variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: easeOut, delay: 0.7 } } }}>
          <Link to="/signup" className="btn btn-green btn-xl"><AgentDots size={22} /> <Roll>Connect a repo</Roll></Link>
        </motion.div>
      </motion.div>
      <Ticker ready={ready} />
    </section>
  )
}

const EVENTS = [
  ['triager', '#101 labeled · random failure · high'], ['coder', 'task-001 · patch v1 · +1 −1'], ['tester', 'hashseed_sweep_v1 · 10/12 → 0/12'],
  ['reviewer', 'task-001 approved · 6 checks'], ['triager', '#104 duplicate of task-001'], ['coder', 'task-002 · bound the jitter'],
  ['tester', 'repeat_run_v1 · 3/12 → 0/12'], ['reviewer', 'task-003 touches auth · waiting for you'],
] as const

/** A slow marquee of what the agents are doing, along the bottom of the hero. */
function Ticker({ ready }: { ready: boolean }) {
  const row = EVENTS.map(([a, t], i) => <span key={i} className="tick"><i style={{ background: `var(--${a})` }} /><b>{a}</b><span className="mono">{t}</span></span>)
  return (
    <motion.div className="ticker" aria-hidden="true" initial={{ opacity: 0, y: 20 }} animate={ready ? { opacity: 1, y: 0 } : {}} transition={{ delay: 1.1, duration: 0.9, ease: easeOut }}>
      <div className="ticker-track">{row}{row}</div>
    </motion.div>
  )
}

/* ============================================================ sticky app screens */

const SCREENS: { tag: string; glyph: GlyphName; color: string; title: string; text: string; agent: string; role: string; stats: [string, string][]; to: string; says: string; state: string }[] = [
  { tag: 'Triage', glyph: 'sort', color: 'var(--coder)', title: 'Every issue sorted in seconds.', text: 'Tests that fail at random get a label and a priority. Duplicates get closed. Anything unclear goes to you instead of being guessed at.',
    agent: 'triager', role: 'Reads every new issue', stats: [['7', 'issues read'], ['1', 'duplicate closed'], ['1', 'asked you']],
    to: 'coder', says: 'task-001 is a random failure, high priority. Please write a fix.', state: 'completed' },
  { tag: 'Patch', glyph: 'patch', color: 'var(--triager)', title: 'Fix the cause, not the symptom.', text: 'The coder reads the failing test and the code behind it, then writes the smallest diff that removes the cause of the randomness.',
    agent: 'coder', role: 'Writes the smallest fix', stats: [['1', 'line changed'], ['0', 'tests skipped'], ['1st', 'attempt']],
    to: 'tester', says: 'Patch ready for task-001 (sort-set-result). Please verify it.', state: 'completed' },
  { tag: 'Prove', glyph: 'flask', color: 'var(--pink)', title: 'One green run proves nothing.', text: 'The tester runs the test dozens of times in a sandbox, before and after the patch, until the numbers settle it.',
    agent: 'tester', role: 'Proves it, many times over', stats: [['24', 'sandboxed runs'], ['10→0', 'failures'], ['1×', 'harness reused']],
    to: 'reviewer', says: 'task-001 passes: 10/12 failing before, 0/12 after. Please review it.', state: 'completed' },
  { tag: 'Review', glyph: 'shield', color: 'var(--mint-strong)', title: 'A second agent says no.', text: 'Seeded RNGs, sleeps, retries and skipped tests get sent back. Anything that touches auth waits for a human.',
    agent: 'reviewer', role: 'Looks for reasons to say no', stats: [['6', 'checks passed'], ['0', 'shortcuts'], ['you', 'click merge']],
    to: 'you', says: 'task-001 is approved and waiting for you to merge it.', state: 'input-required' },
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
        <div className="screens-head">
          <div className="screens-head-copy">
            <p className="screens-kicker mono">How a fix gets made</p>
            <p className="screens-sub">Four agents, each its own A2A service. When one finishes, it messages the next.</p>
          </div>
          <HandoffRail i={i} />
        </div>
        <div className="screens-box screens-title-box" style={{ background: s.color }}>
          <div className="screens-steps">
            <span className="screens-count mono"><AnimatePresence mode="popLayout" initial={false}><motion.span key={i} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ duration: 0.4, ease: easeOut }}>0{i + 1}</motion.span></AnimatePresence>&nbsp;/ 0{SCREENS.length}</span>
            <div className="screens-segs">{SCREENS.map((_, k) => <Seg key={k} k={k} n={SCREENS.length} progress={scrollYProgress} />)}</div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={i} className="wire-msg" initial={{ opacity: 0, y: 18, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.1 }}>
              <div className="wire-head mono">
                <span className="wire-env" aria-hidden="true">✉</span>
                <span>{s.agent} → {s.to}</span>
                <span className={`wire-state s-${s.state}`}>{s.state}</span>
              </div>
              <p>{s.says}</p>
              <code className="mono">{'{ "task_id": "task-001", "from": "' + s.agent + '" }'}</code>
            </motion.div>
          </AnimatePresence>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={i} className="screens-box-inner" initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-60%', opacity: 0 }} transition={{ duration: 0.6, ease: easeOut }}>
              <h2 className="screens-title">{s.title}</h2>
              <div className="screens-tagrow"><span className="tag">{s.tag}</span><Glyph name={s.glyph} size={60} /></div>
            </motion.div>
          </AnimatePresence>
        </div>
        <motion.div className="app-frame screens-frame" style={{ scale: frameScale }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={i} className="screen" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.55, ease: easeOut }}>
              {[<ScreenTriage key={0} />, <ScreenPatch key={1} />, <ScreenProve key={2} />, <ScreenReview key={3} />][i]}
            </motion.div>
          </AnimatePresence>
          <div className="screen-status">
            <motion.span className="screen-status-dot" animate={{ background: `var(--${s.agent})` }} transition={{ duration: 0.5 }} />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
                <b>{s.agent}</b> is working<span className="typing"><i /><i /><i /></span>
              </motion.span>
            </AnimatePresence>
            <div className="screen-dots" aria-hidden="true">{SCREENS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
          </div>
        </motion.div>
        <div className="screens-box screens-text-box">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p key={i} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.08 }}>{s.text}</motion.p>
          </AnimatePresence>
          <AnimatePresence mode="wait">
            <motion.div key={i} className="agent-card" initial={{ opacity: 0, y: 30, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.12 }}>
              <div className="agent-card-head">
                <span className="agent-card-av" style={{ background: `var(--${s.agent})` }}>{s.agent[0].toUpperCase()}</span>
                <div><b>{s.agent}</b><span>{s.role}</span></div>
              </div>
              <div className="agent-card-stats">
                {s.stats.map(([v, l], k) => (
                  <motion.div key={l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + k * 0.08, duration: 0.5, ease: easeOut }}><b>{v}</b><span>{l}</span></motion.div>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

const RAIL = ['triager', 'coder', 'tester', 'reviewer', 'you'] as const

/** The pipeline as a rail of agents; an envelope travels from whoever is working to whoever gets the task next. */
function HandoffRail({ i }: { i: number }) {
  const pos = (k: number) => `${(k / (RAIL.length - 1)) * 100}%`
  return (
    <div className="rail" aria-hidden="true">
      <div className="rail-line"><motion.i animate={{ width: pos(i + 1) }} transition={{ duration: 0.8, ease: easeOut }} /></div>
      {RAIL.map((a, k) => (
        <motion.span key={a} className={`rail-node ${k <= i + 1 ? 'on' : ''}`} style={{ left: pos(k), background: a === 'you' ? 'var(--white)' : `var(--${a})` }}
          animate={{ scale: k === i || k === i + 1 ? 1.15 : 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
          <b>{a === 'you' ? 'You' : a[0].toUpperCase() + a.slice(1)}</b>
        </motion.span>
      ))}
      <span key={i} className="rail-env" style={{ ['--a' as string]: pos(i), ['--b' as string]: pos(i + 1) }}>✉</span>
    </div>
  )
}

/** One step's progress bar: fills as you scroll through that step. */
function Seg({ k, n, progress }: { k: number; n: number; progress: MotionValue<number> }) {
  const scaleX = useTransform(progress, [k / n, (k + 1) / n], [0, 1])
  return <span className="screens-seg"><motion.i style={{ scaleX }} /></span>
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
      <ScreenRow c="var(--coder)" a={<><b>test_normalize_tags fails in CI</b><span>#101 · random failure</span></>} b={<em className="chip hot">high</em>} />
      <ScreenRow c="var(--coder)" a={<><b>test_backoff_is_increasing fails at random</b><span>#102 · random failure</span></>} b={<em className="chip">medium</em>} d={0.08} />
      <ScreenRow c="var(--ink-3)" a={<><b>normalize_tags failing again</b><span>#104 · duplicate of #101</span></>} b={<em className="chip">closed</em>} d={0.16} />
      <ScreenRow c="var(--triager)" a={<><b>“broken”</b><span>#107 · confidence 0.5</span></>} b={<em className="chip warn">asks you</em>} d={0.24} />
      <ScreenRow c="var(--coder)" a={<><b>test_admin_scopes fails on CI</b><span>#103 · random failure</span></>} b={<em className="chip hot">high</em>} d={0.32} />
      <ScreenRow c="var(--ink-3)" a={<><b>How do I use a custom separator?</b><span>#106 · question</span></>} b={<em className="chip">answered</em>} d={0.4} />
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
      <div className="scr-extra">
      <p className="scr-head scr-head-2">Before handing it on</p>
      {[['Applies cleanly to main', 'git apply'], ['Rest of the suite still passes', '41 / 41'], ['No test skipped or retried', '0 changes'], ['Public API unchanged', 'same signature']].map(([a, b], k) => (
        <motion.div key={a} className="scr-check" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + k * 0.08 }}>
          <span className="ok" style={{ background: 'var(--triager)' }}>✓</span><span>{a}</span><span className="mono scr-check-side">{b}</span>
        </motion.div>
      ))}
      </div>
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
      <div className="scr-extra">
      <p className="scr-head scr-head-2">Inside the sandbox</p>
      <div className="scr-limits">
        {[['no', 'network'], ['1', 'CPU'], ['1 GB', 'memory'], ['read-only', 'filesystem']].map(([v, l], k) => (
          <motion.div key={l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 + k * 0.07 }}><b>{v}</b><span>{l}</span></motion.div>
        ))}
      </div>
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
  const pickQuery = (w: string) => { setTouched(true); setQ(w) }
  return (
    <section className="patterns" id="patterns" ref={ref}>
      <div className="patterns-head">
        <Surtitle dot="var(--coder)">Pattern library</Surtitle>
        <SplitWords text="Every kind of random failure. One swarm." className="title-6" />
        <Reveal delay={0.1}><p className="text-grey">Type a failing test. Swarm matches it to a known cause and the harness that proves the fix, or writes a new one.</p></Reveal>
      </div>
      <Reveal delay={0.15} className="pconsole">
        <div className="psearch">
          <Glyph name="search" size={30} />
          <input value={q} placeholder="test_name" aria-label="Try a test name" spellCheck={false} autoComplete="off"
            onFocus={() => { if (!touched) { setTouched(true); setQ('') } }} onChange={(e) => { setTouched(true); setQ(e.target.value) }} />
          {!touched ? <span className="psearch-demo" aria-hidden="true">demo</span>
            : q && <button className="psearch-clear" onClick={() => setQ('')} aria-label="Clear">✕</button>}
        </div>
        <div className="pconsole-body">
          <div className="ptry">
            <span>Try</span>
            {QUERIES.map((w) => (
              <motion.button key={w} className={`ptry-chip mono ${q === w ? 'on' : ''}`} onClick={() => pickQuery(w)} whileTap={{ scale: 0.94 }}>{w}</motion.button>
            ))}
          </div>
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
                  <p>The tester writes a harness for this one, proves it catches the failure, and adds it to the library.</p>
                </motion.div>
              ) : (
                <motion.div key="idle" className="presult-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <span className="presult-dots" aria-hidden="true"><i /><i /><i /><i /></span>Matches appear here, with the before-and-after runs.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Reveal>
      <div className="pgrid">
        {PATTERNS.map((p, k) => (
          <motion.article key={p.id} className={`pcard ${hit?.id === p.id ? 'on' : ''} ${hit && hit.id !== p.id ? 'dim' : ''}`} style={{ ['--c' as string]: p.color }}
            initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-8% 0px' }}
            transition={{ duration: 0.7, ease: easeOut, delay: (k % 4) * 0.07 }}>
            <div className="pcard-top">
              <span className="pcard-icon" style={{ background: p.color }}><Glyph name={p.glyph as GlyphName} size={24} /></span>
              <AnimatePresence>{hit?.id === p.id && <motion.span className="pcard-match" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>match</motion.span>}</AnimatePresence>
            </div>
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
    { title: 'Tools that outlive the task', text: 'When no test can prove a fix, the tester writes one, checks it catches the bug, and saves it for the next task.', visual: <VisualHarness />,
      stats: [['12×', 'runs to check each tool'], ['4', 'kinds of tool it can write']],
      agent: 'tester', points: ['Checked against the bug before it’s trusted', 'Kept in your repo’s tool shelf', 'Reused by the next task that needs it'] },
    { title: 'Reviews that say no', text: 'The reviewer never sees the coder’s reasoning. Its only job is to find a reason not to merge.', visual: <VisualReview />,
      stats: [['6', 'checks on every patch'], ['0', 'merges without you']],
      agent: 'reviewer', points: ['Seeded RNGs, sleeps and retries sent back', 'Skipped tests are never a fix', 'Anything touching auth waits for you'] },
    { title: 'Duplicates closed before you see them', text: 'The triager matches new issues against the board by text and by test name, and links the duplicate.', visual: <VisualDupes />,
      stats: [['2', 'signals: text and test name'], ['0', 'duplicates you have to read']],
      agent: 'triager', points: ['Compared with every open card', 'Linked to the original, with a comment', 'Anything new becomes its own task'] },
  ]
  return (
    <section className="vlist">
      <div className="vlist-head">
        <Surtitle>Level up</Surtitle>
        <h2 className="title-2">
          <SplitWords as="p" text="Prove the fix," className="inline-split" />
          <span className="title-icon"><Glyph name="flask" size={72} /></span>
          <SplitWords as="p" text="don’t hope." className="inline-split" delay={0.2} />
        </h2>
      </div>
      <div className="vlist-cards">
        {cards.map((c, k) => (
          <div key={c.title} className="vcard-sticky" style={{ top: `calc(110px + ${k * 28}px)` }}>
            <Reveal className="vcard">
              <div className="vcard-copy">
                <div className="vcard-kicker">
                  <span className="vcard-agent" style={{ background: `var(--${c.agent})` }}>{c.agent}</span>
                  <span className="mono">0{k + 1} / 0{cards.length}</span>
                </div>
                <h3 className="title-8">{c.title}</h3>
                <p className="text-grey">{c.text}</p>
                <ul className="vcard-points">
                  {c.points.map((pt, j) => (
                    <motion.li key={pt} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: '-10% 0px' }}
                      transition={{ delay: 0.25 + j * 0.1, duration: 0.6, ease: easeOut }}>
                      <i style={{ background: `var(--${c.agent})` }} />{pt}
                    </motion.li>
                  ))}
                </ul>
                <div className="vcard-stats">
                  {c.stats.map(([big, small]) => <div key={small}><b>{big}</b><span>{small}</span></div>)}
                </div>
              </div>
              <div className="vcard-visual" style={{ ['--c' as string]: `var(--${c.agent})` }}>{c.visual}</div>
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

const BOARD = [
  { id: 'task-001', title: 'normalize_tags fails at random', test: 'test_normalize_tags', linked: 2 },
  { id: 'task-002', title: 'retry backoff times out in CI', test: 'test_backoff_window', linked: 0 },
  { id: 'task-003', title: 'session expiry off by a second', test: 'test_session_expiry', linked: 1 },
]
const INCOMING = [
  { n: '#118', title: 'normalize_tags broke again on main', test: 'test_normalize_tags', match: 0, score: 86 },
  { n: '#121', title: 'CI red: backoff window test timing out', test: 'test_backoff_window', match: 1, score: 79 },
  { n: '#124', title: 'export_csv drops the header row', test: 'test_export_header', match: -1, score: 12 },
  { n: '#127', title: 'session test fails just before midnight', test: 'test_session_expiry', match: 2, score: 74 },
]

/** The triager at work: a new issue comes in, gets read, is compared against every card on the board
 *  (by its text and by the test it names), and is either linked and closed or becomes a new task. */
function VisualDupes() {
  const ref = useRef<HTMLDivElement>(null)
  const live = useInView(ref, { margin: '-10% 0px' })
  const [k, setK] = useState(0) // which incoming issue
  const [stage, setStage] = useState(0) // 0 reading · 1 comparing · 2 verdict
  const [scan, setScan] = useState(-1)
  const [linked, setLinked] = useState(() => BOARD.map((t) => t.linked))
  const [closed, setClosed] = useState(3)
  const [made, setMade] = useState(0)
  const it = INCOMING[k % INCOMING.length]
  useEffect(() => {
    if (!live) return
    let alive = true
    const at = (ms: number) => new Promise((r) => window.setTimeout(r, ms))
    ;(async () => {
      await at(900); if (!alive) return
      setStage(1)
      for (let r = 0; r < BOARD.length && alive; r++) { setScan(r); await at(380) }
      if (!alive) return
      setScan(-1); setStage(2)
      if (it.match >= 0) { setLinked((l) => l.map((v, j) => (j === it.match ? v + 1 : v))); setClosed((c) => c + 1) } else setMade((m) => m + 1)
      await at(2300); if (!alive) return
      setStage(0); setK((v) => v + 1)
    })()
    return () => { alive = false }
  }, [live, k, it])
  const dup = it.match >= 0
  const newId = `task-${String(BOARD.length + made).padStart(3, '0')}`
  return (
    <div className="app-frame vis dupes" ref={ref}>
      <div className="vis-top">
        <span className="dupes-live"><i />triager · new issues</span>
        <span className="mono dupes-count"><b>{closed}</b> duplicates closed</span>
      </div>
      <div className="dupes-in">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={k} className={`dupes-issue ${stage === 2 ? (dup ? 'is-dup' : 'is-new') : ''}`}
            initial={{ opacity: 0, y: -26, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.94, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 240, damping: 26 }}>
            <div className="dupes-issue-head"><span className="mono">{it.n}</span><b>{it.title}</b></div>
            <div className="dupes-issue-foot">
              <span className="mono dupes-test">{it.test}</span>
              <AnimatePresence mode="wait" initial={false}>
                {stage === 0 && <motion.span key="r" className="dupes-state" {...fade}>reading<span className="dupes-dots"><i /><i /><i /></span></motion.span>}
                {stage === 1 && <motion.span key="c" className="dupes-state" {...fade}>comparing with the board</motion.span>}
                {stage === 2 && (dup
                  ? <motion.em key="d" className="chip ok" {...pop}>duplicate of {BOARD[it.match].id} · closed</motion.em>
                  : <motion.em key="n" className="chip dupes-newchip" {...pop}>new · {newId} → coder</motion.em>)}
              </AnimatePresence>
            </div>
            <div className="dupes-meters">
              <Meter label="text" value={stage === 2 ? it.score : stage === 1 ? Math.min(it.score, 20 + scan * 20) : 0} good={it.score > 50} />
              <span className={`dupes-same ${stage === 2 ? (dup ? 'yes' : 'no') : ''}`}>{stage === 2 ? (dup ? '✓ same test' : '✗ no test in common') : 'same test?'}</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="dupes-board">
        <p className="dupes-label">On the board</p>
        {BOARD.map((t, j) => (
          <div key={t.id} className={`dupes-row ${scan === j ? 'scan' : ''} ${stage === 2 && it.match === j ? 'hit' : ''}`}>
            <span className="mono">{t.id}</span>
            <span className="dupes-row-title">{t.title}</span>
            <motion.span key={linked[j]} className="dupes-linked" initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
              {linked[j] ? `+${linked[j]} linked` : '—'}
            </motion.span>
          </div>
        ))}
      </div>
    </div>
  )
}

const fade = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.2 } }
const pop = { initial: { opacity: 0, scale: 0.7 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0 }, transition: { type: 'spring' as const, stiffness: 500, damping: 22 } }

function Meter({ label, value, good }: { label: string; value: number; good: boolean }) {
  return (
    <span className="dupes-meter">
      <span>{label}</span>
      <span className="dupes-bar"><motion.i animate={{ width: `${value}%` }} transition={{ duration: 0.45, ease: easeOut }} className={good ? 'good' : ''} /></span>
      <b className="mono">{value}%</b>
    </span>
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

/** Loops `steps` (ms per phase) while the element is on screen; returns the current phase. */
function usePhases(ref: RefObject<Element | null>, steps: number[]) {
  const inView = useInView(ref, { margin: '-15% 0px' })
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    if (!inView) return
    const t = window.setTimeout(() => setPhase((p) => (p + 1) % steps.length), steps[phase])
    return () => window.clearTimeout(t)
  }, [inView, phase, steps])
  return phase
}

// 36 runs, 30 of them failing before the patch (83%), in a fixed but scattered order
const RUNS = Array.from({ length: 36 }, (_, k) => ((k * 7 + 3) % 36) >= 6)
const RUN_STEPS = [700, 2600, 900, 3200]

function RunsCard() {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(ref, RUN_STEPS) // 0 idle, 1 before, 2 patching, 3 after
  const after = phase === 3
  return (
    <div ref={ref} className="stat-card-inner stat-runs" style={{ background: 'var(--sky-card)' }}>
      <div className="stat-top">
        <span className="stat-kicker">36 sandboxed runs</span>
        <div className="stat-big">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={after ? 'after' : 'before'} initial={{ y: '60%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-60%', opacity: 0 }} transition={{ duration: 0.5, ease: easeOut }}>
              {after ? '0%' : '83%'}
            </motion.span>
          </AnimatePresence>
          <small>{after ? 'failing after' : 'failing before'}</small>
        </div>
      </div>
      <div className="srun-grid" aria-hidden="true">
        {RUNS.map((fails, k) => {
          const state = phase === 0 ? 'idle' : phase === 1 ? (fails ? 'fail' : 'pass') : phase === 2 ? 'patch' : 'pass'
          return <i key={k} className={`srun srun--${state}`} style={{ transitionDelay: `${phase === 0 ? 0 : k * 28}ms` }} />
        })}
      </div>
      <p>of runs failing, before and after the patches.</p>
    </div>
  )
}

const MERGE_STEPS = [1400, 1100, 500, 2600]

function MergeCard() {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(ref, MERGE_STEPS) // 0 approved, 1 cursor travels, 2 press, 3 merged
  return (
    <div ref={ref} className="stat-card-inner stat-merge" style={{ background: 'var(--pink-card)' }}>
      <div className="stat-top">
        <span className="stat-kicker">Automatic merges</span>
        <b className="stat-big"><CountUp to={0} /></b>
      </div>
      <div className="mergebox" aria-hidden="true">
        <div className="mergebox-row"><span className="mdot" style={{ background: 'var(--reviewer)' }} />Reviewer approved <em>fix: seed the shuffle</em></div>
        <div className={`mergebox-btn ${phase === 3 ? 'is-done' : ''} ${phase === 2 ? 'is-press' : ''}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={phase === 3 ? 'd' : 'w'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
              {phase === 3 ? '✓ Merged by you' : 'Merge · waiting for you'}
            </motion.span>
          </AnimatePresence>
        </div>
        <motion.svg className="mergebox-cursor" width="22" height="22" viewBox="0 0 24 24"
          animate={phase === 0 ? { x: 150, y: -60, opacity: 0 } : phase === 3 ? { x: 150, y: 40, opacity: 0 } : { x: 60, y: 10, opacity: 1, scale: phase === 2 ? 0.85 : 1 }}
          transition={{ duration: phase === 2 ? 0.15 : 0.9, ease: easeInOut }}>
          <path d="M4 2l16 9-7 2-3 7z" fill="var(--ink)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </motion.svg>
      </div>
      <p>A maintainer clicks merge, every single time.</p>
    </div>
  )
}

const TRAIL = [
  { who: 'Triager', c: 'var(--triager)', did: 'labelled it a timing failure' },
  { who: 'Coder', c: 'var(--coder)', did: 'replaced sleep(2) with a wait' },
  { who: 'Tester', c: 'var(--tester)', did: 'passed 12 of 12 runs' },
  { who: 'Reviewer', c: 'var(--reviewer)', did: 'approved the patch' },
]
const TRAIL_STEPS = [900, 900, 900, 900, 2800]

function TrailCard() {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(ref, TRAIL_STEPS) // how many entries are on the trail
  return (
    <div ref={ref} className="stat-card-inner stat-trail" style={{ background: 'var(--yellow-card)' }}>
      <div className="stat-top">
        <span className="stat-kicker">Agents on one board</span>
        <b className="stat-big"><CountUp to={4} /></b>
        <p>agents, with a full audit trail on every card.</p>
      </div>
      <ol className="trail" aria-hidden="true">
        {TRAIL.map((t, k) => (
          <li key={t.who} className={k < phase ? 'on' : ''} style={{ ['--c' as string]: t.c }}>
            <span className="trail-dot" />
            <b>{t.who}</b>
            <span>{t.did}</span>
            <time className="mono">{['09:12', '09:14', '09:21', '09:22'][k]}</time>
          </li>
        ))}
      </ol>
    </div>
  )
}

function StatGrid() {
  return (
    <section className="grid-sec">
      <div className="grid-head">
        <SplitWords text="Take the pager off." className="title-2" />
        <p>Three numbers we hold ourselves to, played out the way they happen on the board.</p>
      </div>
      <div className="stat-grid">
        <Reveal className="stat-card stat-a"><RunsCard /></Reveal>
        <Reveal delay={0.1} className="stat-card stat-b"><MergeCard /></Reveal>
        <Reveal delay={0.2} className="stat-card stat-c"><TrailCard /></Reveal>
      </div>
    </section>
  )
}

/* ============================================================ horizontal list */

/* ============================================================ faq */

const FAQS: [string, string, string][] = [
  ['Basics', 'What does “a test that fails at random” mean?', 'A test that passes on one run and fails on the next with no code change, because of things like set ordering, unseeded randomness or timing. Engineers call these “flaky tests”. They waste hours: nobody can tell a real bug from noise, so people rerun CI until it goes green. Swarm finds the cause and proves the fix.'],
  ['Safety', 'Does Swarm merge anything on its own?', 'No. The best a task can reach on its own is Approved. A maintainer clicks Merge, which opens a pull request on GitHub. Security-sensitive paths need your approval even before that.'],
  ['Safety', 'Where does the code run?', 'In a disposable copy of your repository. With Docker it runs in a container with no network access and memory, CPU and process limits. Without Docker it falls back to a local sandbox with CPU, file-size and time limits.'],
  ['Setup', 'Which models does it use?', 'Free model APIs by default: Groq first, then Gemini and OpenRouter, with Anthropic or a local Ollama model as options. With no model at all, the agents use built-in fix strategies.'],
  ['Basics', 'What kind of issues does it handle?', 'Version 1 focuses on tests that fail at random: ordering, randomness and timing. Everything else is triaged and handed to you with a label, not guessed at.'],
  ['Basics', 'What is a “tool” in Swarm?', 'A small harness the tester writes when existing tests can’t prove a fix, for example running a test under 12 hash seeds. It must catch the bug on the old code before it is trusted and saved for reuse.'],
  ['Setup', 'Can I talk to Swarm from Claude?', 'Yes. Swarm is also an MCP server: add `swarm mcp` to Claude Desktop, Claude Code or any MCP client and ask what the agents did overnight, read a diff or a harness, start a run, or send a patch back with feedback. Merging still happens only in the dashboard.'],
  ['Setup', 'Can I use it on a private repository?', 'Yes. Connect GitHub (or paste a fine-grained token) in Settings. It is stored in your private user record and only the worker reads it, to clone, read issues and open pull requests. New issues are picked up automatically every few minutes.'],
  ['Cost', 'What does it cost to run?', 'Nothing to start: Firebase’s free plan and the free tiers of Groq and Gemini cover a small team, within their rate limits.'],
]
const TOPICS = ['All', 'Basics', 'Safety', 'Setup', 'Cost']

/** Wraps each match of `q` in <mark>, so a search shows where it hit. */
function Hit({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>
}

function Faq() {
  const [open, setOpen] = useState<string | null>(FAQS[0][1])
  const [topic, setTopic] = useState('All')
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = FAQS.filter(([t, qq, a]) => (topic === 'All' || t === topic) && (!needle || `${qq} ${a}`.toLowerCase().includes(needle)))
  return (
    <section className="faq" id="faq">
      <div className="faq-side">
        <SplitWords text="Any questions ?" className="title-2" />
        <label className="faq-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the answers" aria-label="Search questions" />
          <AnimatePresence>{q && <motion.button type="button" className="faq-search-x" onClick={() => setQ('')} aria-label="Clear search" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>×</motion.button>}</AnimatePresence>
        </label>
        <div className="faq-topics" role="tablist" aria-label="Topics">
          {TOPICS.map((t) => (
            <button key={t} role="tab" aria-selected={topic === t} className={`faq-topic ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}>
              {topic === t && <motion.span layoutId="faq-topic-on" className="faq-topic-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span>{t}</span><small>{t === 'All' ? FAQS.length : FAQS.filter((f) => f[0] === t).length}</small>
            </button>
          ))}
        </div>
        <div className="faq-help">
          <AgentDots size={14} />
          <b>Still unsure?</b>
          <p>Paste one of your tests into the playground, or read how Swarm plugs into Claude.</p>
          <div><Link to="/playground" className="btn btn-dark btn-sm"><Roll>Playground</Roll></Link><Link to="/docs/mcp" className="btn btn-line btn-sm"><Roll>MCP docs</Roll></Link></div>
        </div>
      </div>
      <motion.div className="faq-list" layout>
        <AnimatePresence initial={false} mode="popLayout">
          {list.map(([t, qq, a], k) => {
            const isOpen = open === qq || (!!needle && list.length <= 2)
            return (
              <motion.div key={qq} layout className={`faq-item ${isOpen ? 'is-open' : ''}`} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }} transition={{ duration: 0.5, ease: easeInOut }}>
                <button className="faq-q" aria-expanded={isOpen} onClick={() => setOpen(open === qq ? null : qq)}>
                  <span className="faq-n mono">{String(k + 1).padStart(2, '0')}</span>
                  <span className="faq-q-text"><Hit text={qq} q={q.trim()} /><small>{t}</small></span>
                  <motion.span className="faq-btn" animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.4, ease: easeOut }} aria-hidden="true">+</motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.5, ease: easeInOut }}>
                      <p><Hit text={a} q={q.trim()} /></p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {list.length === 0 && (
          <motion.div className="faq-none" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <b>Nothing about “{q}” yet.</b>
            <span>Try another word, or <button className="link" onClick={() => { setQ(''); setTopic('All') }}>see every question</button>.</span>
          </motion.div>
        )}
      </motion.div>
    </section>
  )
}

/* ============================================================ footer */

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <Surtitle>Level up</Surtitle>
        <h2 className="footer-giant" aria-label="Green builds.">
          <SplitWords as="p" text="Green" className="inline-split" />
          <span className="footer-tile"><Mark size={140} /></span>
          <SplitWords as="p" text="builds." className="inline-split" delay={0.15} />
        </h2>
        <Link to="/signup" className="btn btn-green btn-xl"><AgentDots size={22} /> <Roll>Get started free</Roll></Link>
      </div>
      <div className="footer-cols">
        <div><b>Product</b><Link to="/#how">How it works</Link><Link to="/#patterns">Patterns</Link><Link to="/playground">Playground</Link><Link to="/cost">Cost calculator</Link></div>
        <div><b>Security</b><Link to="/#security">Sandbox</Link><Link to="/#faq">Merge policy</Link></div>
        <div><b>Support</b><Link to="/#faq">FAQ</Link><Link to="/docs/mcp">MCP docs</Link><Link to="/signin">Sign in</Link></div>
        <div><b>Start</b><Link to="/signup">Get started</Link><a href="https://github.com/FrozenFalcon-Byte/Swarm" target="_blank" rel="noreferrer">GitHub</a><span>Made for maintainers</span></div>
      </div>
      <div className="footer-bottom"><Logo /><span>© {new Date().getFullYear()} Swarm</span></div>
    </footer>
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
