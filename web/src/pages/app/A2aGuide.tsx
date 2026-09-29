import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CodeWindow } from '../../components/CodeWindow'
import { SplitWords } from '../../components/Reveal'
import { easeOut } from '../../lib/motion'
import './a2a.css'

/* A2A, explained: a guide to the Agent2Agent protocol and how Swarm uses it, written for the owner.
   Chapters in reading order, each with something that moves or something to poke. Two of them are short
   films driven by the scroll (the wire, the relay), the rest animate as they come into view. */

const CH = [
  ['what', 'What A2A is'], ['pieces', 'The four pieces'], ['life', 'A task’s life'], ['wire', 'On the wire'],
  ['install', 'Installing it'], ['relay', 'How Swarm uses it'], ['backend', 'Inside the backend'],
  ['gateway', 'The front door'], ['outside', 'Second opinions'], ['deploy', 'Where it runs'],
  ['tests', 'How we know it works'], ['quiz', 'Check yourself'], ['words', 'Cheat sheet'],
] as const
const IDS = CH.map(([id]) => id)
type Agent = 'triager' | 'coder' | 'tester' | 'reviewer'
const AGENTS: Agent[] = ['triager', 'coder', 'tester', 'reviewer']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const inView = { initial: { opacity: 0, y: 26 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '0px 0px -12% 0px' } } as const

export default function A2aGuide() {
  const active = useSpy(IDS)
  const { scrollYProgress } = useScroll()
  const bar = useSpring(scrollYProgress, { stiffness: 200, damping: 30, mass: 0.3 })
  return (
    <div className="page a2a">
      <motion.div className="a2a-progress" style={{ scaleX: bar }} aria-hidden="true" />
      <Hero />
      <div className="a2a-body">
        <nav className="a2a-toc" aria-label="Chapters">
          <LayoutGroup id="a2a-toc">
            {CH.map(([id, label], i) => (
              <a key={id} href={`#${id}`} className={active === id ? 'on' : ''}
                onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                {active === id && <motion.span layoutId="a2a-toc-on" className="a2a-toc-on" transition={{ duration: 0.45, ease: easeOut }} />}
                <span className="a2a-toc-n mono">{String(i + 1).padStart(2, '0')}</span><span>{label}</span>
              </a>
            ))}
          </LayoutGroup>
        </nav>
        <div className="a2a-main">
          <What />
          <Pieces />
          <Life />
          <Wire />
          <Install />
          <Relay />
          <Backend />
          <Gateway />
          <Outside />
          <Deploy />
          <Tests />
          <Quiz />
          <Words />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ shared bits */

function useSpy(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.isIntersecting))
      const first = ids.find((id) => seen.get(id))
      if (first) setActive(first)
    }, { rootMargin: '-25% 0px -60% 0px' })
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [ids])
  return active
}

function Chapter({ id, kicker, title, lede, children, tint = 'var(--accent-soft)' }: { id: string; kicker: string; title: string; lede?: ReactNode; children: ReactNode; tint?: string }) {
  const n = IDS.indexOf(id as (typeof IDS)[number]) + 1
  return (
    <section id={id} className="a2a-ch" style={{ ['--tint' as string]: tint }}>
      <header className="a2a-ch-head">
        <motion.span className="a2a-ch-n mono" initial={{ scale: 0, rotate: -30 }} whileInView={{ scale: 1, rotate: -6 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 380, damping: 16 }}>{String(n).padStart(2, '0')}</motion.span>
        <p className="a2a-kicker mono">{kicker}</p>
        <SplitWords as="h2" text={title} className="a2a-h2" />
        {lede && <motion.p className="a2a-lede" {...inView} transition={{ duration: 0.8, ease: easeOut, delay: 0.15 }}>{lede}</motion.p>}
      </header>
      {children}
    </section>
  )
}

/** A pastel agent: a round body, two eyes that blink now and then, and a name underneath if asked. */
function Buddy({ a, size = 56, label, talk }: { a: Agent | 'you' | 'outside'; size?: number; label?: boolean; talk?: boolean }) {
  const fill = a === 'you' ? 'var(--white)' : a === 'outside' ? '#c9b8ff' : `var(--${a})`
  return (
    <span className="a2a-buddy" style={{ width: size }}>
      <motion.svg viewBox="0 0 60 60" width={size} height={size} animate={talk ? { y: [0, -5, 0] } : { y: 0 }} transition={talk ? { repeat: Infinity, duration: 0.6 } : undefined}>
        <circle cx="32" cy="33" r="25" fill="var(--ink)" />
        <circle cx="29" cy="30" r="25" fill={fill} stroke="var(--ink)" strokeWidth="3" />
        <motion.g animate={{ scaleY: [1, 1, 0.1, 1] }} transition={{ repeat: Infinity, duration: 4, times: [0, 0.92, 0.96, 1], delay: AGENTS.indexOf(a as Agent) * 0.7 }} style={{ originY: '27px' }}>
          <circle cx="21" cy="27" r="3.4" fill="#0f0f0f" /><circle cx="37" cy="27" r="3.4" fill="#0f0f0f" />
        </motion.g>
        {a === 'you'
          ? <path d="M21 37q8 7 16 0" fill="none" stroke="#0f0f0f" strokeWidth="3" strokeLinecap="round" />
          : <motion.ellipse cx="29" cy="39" rx="5" fill="#0f0f0f" animate={{ ry: talk ? [1.5, 4, 1.5] : 1.8 }} transition={talk ? { repeat: Infinity, duration: 0.3 } : undefined} />}
      </motion.svg>
      {label && <span className="a2a-buddy-name">{a === 'you' ? 'You' : a === 'outside' ? 'Outside agent' : cap(a)}</span>}
    </span>
  )
}

function Note({ kind = 'tip', title, children }: { kind?: 'tip' | 'why' | 'warn'; title: string; children: ReactNode }) {
  return (
    <motion.aside className={`a2a-note a2a-note--${kind}`} {...inView} transition={{ duration: 0.7, ease: easeOut }}>
      <b>{title}</b><div>{children}</div>
    </motion.aside>
  )
}

/** Small sticker icons for the rule cards. */
function Glyph({ k, c }: { k: string; c: string }) {
  const d: Record<string, string> = {
    board: 'M9 11h22v18H9z M9 17h22 M16 11v18 M24 11v18',
    thread: 'M8 20c4-8 8 8 12 0s8 8 12 0',
    lock: 'M12 19h16v11H12z M15 19v-4a5 5 0 0110 0v4 M20 23v3',
    nudge: 'M12 11v9a8 8 0 0016 0v-9 M12 15h5 M23 15h5',
  }
  return (
    <svg className="a2a-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="3" y="4" width="36" height="36" rx="11" fill="var(--ink)" />
      <rect x="1" y="1" width="36" height="36" rx="11" fill={c} stroke="var(--ink)" strokeWidth="2.5" />
      <path d={d[k]} fill="none" stroke="#0f0f0f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(-1 -1)" />
    </svg>
  )
}

/** A scroll-driven film: a tall track with a sticky stage; `render` gets the progress (0 to 1). */
function Film({ screens, className, children }: { screens: number; className?: string; children: (p: MotionValue<number>) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  return (
    <div ref={ref} className={`a2a-film ${className || ''}`} style={{ height: `${screens * 100}svh` }}>
      <div className="a2a-film-stage">{children(scrollYProgress)}</div>
    </div>
  )
}

function useStep(p: MotionValue<number>, n: number) {
  const [step, setStep] = useState(0)
  useMotionValueEvent(p, 'change', (v) => setStep(Math.max(0, Math.min(n - 1, Math.floor(v * n * 0.999)))))
  return step
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <header className="a2a-hero">
      <div className="a2a-hero-copy">
        <motion.p className="a2a-kicker mono" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut }}>
          <span className="a2a-dot" /> Made for you · 13 short chapters
        </motion.p>
        <SplitWords as="h1" text="A2A, in plain words." className="a2a-h1" />
        <motion.p className="a2a-hero-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
          How four agents pass a bug from hand to hand without anyone in charge: what the Agent2Agent protocol is, how it works, and exactly how Swarm uses it, from the code to the servers it runs on.
        </motion.p>
        <motion.div className="a2a-hero-chips" initial="h" animate="s" variants={{ h: {}, s: { transition: { staggerChildren: 0.07, delayChildren: 0.5 } } }}>
          {['Scroll to play the films', 'Tap anything that glows', 'Quiz at the end'].map((t) => (
            <motion.span key={t} className="a2a-chip" variants={{ h: { opacity: 0, y: 10, scale: 0.9 }, s: { opacity: 1, y: 0, scale: 1 } }}>{t}</motion.span>
          ))}
        </motion.div>
      </div>
      <HeroArt />
    </header>
  )
}

/** Four agents in a ring pass a glowing envelope round and round; each one says what it did as it lets go. */
function HeroArt() {
  const [at, setAt] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setAt((k) => (k + 1) % 4), 1600); return () => window.clearInterval(id) }, [])
  const spots = [{ x: 22, y: 26 }, { x: 78, y: 26 }, { x: 78, y: 76 }, { x: 22, y: 76 }]
  const said = ['triaged it', 'wrote a fix', 'ran it 8×', 'approved it']
  return (
    <motion.div className="a2a-hero-art" initial={{ opacity: 0, scale: 0.92, rotate: 2 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 1, ease: easeOut, delay: 0.2 }} aria-hidden="true">
      <svg className="a2a-hero-ring" viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect x="22" y="26" width="56" height="50" rx="8" fill="none" stroke="var(--ink)" strokeWidth="0.5" strokeDasharray="1.6 1.8" opacity="0.4" />
      </svg>
      {AGENTS.map((a, k) => (
        <div key={a} className="a2a-hero-spot" style={{ left: `${spots[k].x}%`, top: `${spots[k].y}%` }}>
          <Buddy a={a} size={64} label talk={at === k} />
          <AnimatePresence>
            {at === k && <motion.span className="a2a-hero-say" initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>{said[k]}</motion.span>}
          </AnimatePresence>
        </div>
      ))}
      <motion.div className="a2a-envelope" animate={{ left: `${spots[(at + 1) % 4].x}%`, top: `${spots[(at + 1) % 4].y}%`, rotate: [0, 12, -8, 0] }} transition={{ duration: 0.9, ease: easeOut }}>
        <svg viewBox="0 0 40 28" width="40" height="28"><rect x="1.5" y="1.5" width="37" height="25" rx="4" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5" /><path d="M3 4l17 12L37 4" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" /></svg>
        <span className="mono">A2A</span>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ 1. what */

function What() {
  const [mode, setMode] = useState<'mcp' | 'a2a'>('a2a')
  return (
    <Chapter id="what" kicker="The idea" title="A common language for agents" tint="var(--triager)"
      lede={<>A2A (Agent2Agent) is an open protocol that lets one AI agent find another, ask it to do something, and follow along while it works, even when the two were built by different people, in different languages, on different servers.</>}>
      <div className="a2a-analogy">
        {[
          ['card', 'A business card', 'Every agent publishes a card at a well-known address saying who it is and what it can do.'],
          ['msg', 'A letter', 'You send it a message. Text, data or files, in parts.'],
          ['task', 'A ticket', 'The work gets a task with a status you can check any time: working, done, needs you.'],
          ['art', 'A parcel back', 'Results come back as artifacts attached to that task.'],
        ].map(([e, t, p], i) => (
          <motion.div key={t} className="a2a-analogy-card" {...inView} transition={{ duration: 0.7, ease: easeOut, delay: i * 0.08 }} whileHover={{ y: -4, rotate: i % 2 ? 1 : -1 }}>
            <span style={{ ['--c' as string]: PIECES.find((x) => x.k === e)!.c }}><PieceIcon k={e} /></span><b>{t}</b><p>{p}</p>
          </motion.div>
        ))}
      </div>

      <div className="a2a-vs">
        <div className="a2a-vs-head">
          <b>A2A or MCP?</b>
          <div className="a2a-switch" role="tablist" aria-label="Compare">
            {(['mcp', 'a2a'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {mode === m && <motion.span layoutId="a2a-vs-on" className="a2a-switch-on" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
                <span>{m === 'mcp' ? 'MCP: agent ↔ tools' : 'A2A: agent ↔ agent'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="a2a-vs-body">
          <VsArt mode={mode} />
          <AnimatePresence mode="wait">
            <motion.div key={mode} className="a2a-vs-text" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.35, ease: easeOut }}>
              {mode === 'mcp' ? <>
                <h3>MCP gives an agent hands</h3>
                <p>The Model Context Protocol connects one agent to <b>tools and data</b>: read a file, query a database, call an API. The tool does exactly what it’s told and answers at once. It doesn’t think.</p>
                <p>Swarm has an MCP server too: it’s how Claude or Cursor reads your board.</p>
              </> : <>
                <h3>A2A gives an agent colleagues</h3>
                <p>A2A connects an agent to <b>other agents</b>, each with its own brain. You don’t call a function; you hand over a job. The other side may take minutes, stream progress, ask you a question, or say no.</p>
                <p>Swarm’s four agents use it to hand each bug along, and outside agents use it to talk to Swarm.</p>
              </>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="a2a-timeline">
        {[['Apr 2025', 'Google announces A2A with dozens of partners'], ['Jun 2025', 'Handed to the Linux Foundation as an open project'], ['1.0', 'The spec Swarm speaks, through the Python a2a-sdk 1.x']].map(([d, t], i) => (
          <motion.div key={d} className="a2a-tl" initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easeOut, delay: i * 0.12 }}>
            <span className="a2a-tl-dot" /><b className="mono">{d}</b><span>{t}</span>
          </motion.div>
        ))}
      </div>
    </Chapter>
  )
}

function VsArt({ mode }: { mode: 'mcp' | 'a2a' }) {
  const around = [{ x: 60, y: 50 }, { x: 240, y: 40 }, { x: 250, y: 170 }, { x: 70, y: 180 }]
  const tools = ['GitHub', 'Files', 'Database', 'Web']
  return (
    <svg viewBox="0 0 310 220" className="a2a-vs-art" aria-hidden="true">
      {around.map((p, k) => (
        <g key={k}>
          <motion.line x1="155" y1="112" x2={p.x} y2={p.y} stroke="var(--ink)" strokeWidth="2.5" strokeDasharray={mode === 'a2a' ? '0' : '5 6'}
            initial={false} animate={{ pathLength: 1, opacity: 0.7 }} />
          {mode === 'a2a' && <motion.circle r="5" fill={`var(--${AGENTS[k]})`} stroke="var(--ink)" strokeWidth="2"
            animate={{ cx: [155, p.x, 155], cy: [112, p.y, 112] }} transition={{ repeat: Infinity, duration: 2.4, delay: k * 0.6, ease: 'easeInOut' }} />}
        </g>
      ))}
      <AnimatePresence mode="popLayout">
        {around.map((p, k) => mode === 'a2a'
          ? <motion.g key={`a${k}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: k * 0.05 }} style={{ originX: `${p.x}px`, originY: `${p.y}px` }}>
              <circle cx={p.x + 2} cy={p.y + 3} r="20" fill="var(--ink)" /><circle cx={p.x} cy={p.y} r="20" fill={`var(--${AGENTS[k]})`} stroke="var(--ink)" strokeWidth="2.5" />
              <circle cx={p.x - 6} cy={p.y - 3} r="2.6" fill="#0f0f0f" /><circle cx={p.x + 6} cy={p.y - 3} r="2.6" fill="#0f0f0f" />
            </motion.g>
          : <motion.g key={`t${k}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: k * 0.05 }} style={{ originX: `${p.x}px`, originY: `${p.y}px` }}>
              <rect x={p.x - 34} y={p.y - 15} width="68" height="30" rx="8" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5" />
              <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">{tools[k]}</text>
            </motion.g>)}
      </AnimatePresence>
      <circle cx="157" cy="115" r="28" fill="var(--ink)" />
      <circle cx="155" cy="112" r="28" fill="var(--accent)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="147" cy="108" r="3.4" fill="#0f0f0f" /><circle cx="163" cy="108" r="3.4" fill="#0f0f0f" />
      <path d="M147 120q8 6 16 0" fill="none" stroke="#0f0f0f" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ 2. the four pieces */

const PIECES = [
  { k: 'card', t: 'Agent card', c: 'var(--triager)', short: 'Who I am and what I can do', long: 'A JSON file every agent serves at /.well-known/agent-card.json: its name, its address, how to sign in, and a list of skills. Other agents read it to decide who to ask.',
    code: `{
  "name": "coder",
  "description": "Finds the code behind a failing test…",
  "supportedInterfaces": [{
    "url": "http://swarm.agents/agents/coder/a2a",
    "protocolBinding": "JSONRPC"
  }],
  "capabilities": { "streaming": true },
  "skills": [{
    "id": "write_fix",
    "name": "Write a fix",
    "tags": ["code", "patch", "fix"]
  }]
}` },
  { k: 'msg', t: 'Message', c: 'var(--coder)', short: 'One turn of the conversation', long: 'What one side says to the other. A message has a role (user or agent) and parts: plain text for people, data for programs. Swarm always sends both.',
    code: `{
  "messageId": "7f3a…",
  "contextId": "swarm-task-004",
  "role": "ROLE_USER",
  "parts": [
    { "text": "Patch ready for task-004 (sort-set-result). Please verify it." },
    { "data": { "task_id": "task-004", "from": "coder", "state": "Awaiting Tests" } }
  ],
  "referenceTaskIds": ["a2a-task-of-the-coder"]
}` },
  { k: 'task', t: 'Task', c: 'var(--tester)', short: 'The job, with a status', long: 'Sending a message starts a task. It has an id and a status (submitted, working, completed, input-required…) that moves as the work goes. You can ask about it later or cancel it.',
    code: `{
  "id": "c1d2…",
  "contextId": "swarm-task-004",
  "status": {
    "state": "TASK_STATE_WORKING",
    "message": { "parts": [{ "text": "tester picked up task-004" }] }
  }
}` },
  { k: 'art', t: 'Artifact', c: 'var(--reviewer)', short: 'What the work produced', long: 'The output, attached to the task. Swarm’s agents attach a small summary of what they did; the full record stays on the board.',
    code: `{
  "name": "tester-result",
  "parts": [{ "data": {
    "task_id": "task-004",
    "state": "In Review",
    "harness": "tool-sort-order",
    "evidence": { "test_tags": { "before": "5/8", "after": "0/8" } }
  } }]
}` },
]

function Pieces() {
  const [flip, setFlip] = useState<string | null>(null)
  return (
    <Chapter id="pieces" kicker="The nouns" title="Four things, that’s the whole vocabulary" tint="var(--coder)"
      lede="Almost everything in A2A is one of these four. Tap a card to turn it over and see the real JSON Swarm sends.">
      <div className="a2a-pieces">
        {PIECES.map((p, i) => (
          <motion.button key={p.k} className={`a2a-piece ${flip === p.k ? 'is-flipped' : ''}`} style={{ ['--c' as string]: p.c }}
            onClick={() => setFlip(flip === p.k ? null : p.k)} aria-pressed={flip === p.k}
            initial={{ opacity: 0, y: 40, rotate: i % 2 ? 3 : -3 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 120, damping: 16, delay: i * 0.08 }}>
            <motion.div className="a2a-piece-inner" animate={{ rotateY: flip === p.k ? 180 : 0 }} transition={{ type: 'spring', stiffness: 160, damping: 20 }}>
              <div className="a2a-piece-face">
                <PieceIcon k={p.k} />
                <b>{p.t}</b><span className="a2a-piece-short">{p.short}</span><p>{p.long}</p>
                <span className="a2a-piece-turn mono">tap to see the JSON ↻</span>
              </div>
              <div className="a2a-piece-back"><pre className="mono">{p.code}</pre></div>
            </motion.div>
          </motion.button>
        ))}
      </div>
      <Note kind="why" title="Why a context id?">Every message about the same bug shares one <code>contextId</code> (Swarm uses <code>swarm-task-004</code>), so the whole conversation, across four agents, reads as one thread.</Note>
    </Chapter>
  )
}

function PieceIcon({ k }: { k: string }) {
  return (
    <svg className="a2a-piece-icon" viewBox="0 0 64 48" aria-hidden="true">
      <rect x="4" y="5" width="56" height="40" rx="8" fill="var(--ink)" />
      <rect x="2" y="2" width="56" height="40" rx="8" fill="var(--c)" stroke="var(--ink)" strokeWidth="2.5" />
      {k === 'card' && <><circle cx="17" cy="20" r="7" fill="var(--white)" stroke="var(--ink)" strokeWidth="2" /><path d="M29 16h20M29 24h14M10 33h38" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" /></>}
      {k === 'msg' && <path d="M6 8l24 17L54 8" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />}
      {k === 'task' && <><circle cx="30" cy="22" r="11" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5" /><motion.path d="M30 22V15" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 3, ease: 'linear' }} style={{ originX: '30px', originY: '22px' }} /></>}
      {k === 'art' && <><rect x="18" y="12" width="24" height="20" rx="3" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5" /><path d="M18 19h24M30 12v7" stroke="var(--ink)" strokeWidth="2.5" /></>}
    </svg>
  )
}

/* ------------------------------------------------------------------ 3. a task's life */

const STATES: Record<string, { x: number; y: number; c: string; t: string }> = {
  submitted: { x: 75, y: 120, c: 'var(--grey-6)', t: 'submitted' },
  working: { x: 250, y: 120, c: 'var(--triager)', t: 'working' },
  completed: { x: 445, y: 40, c: 'var(--reviewer)', t: 'completed' },
  'input-required': { x: 470, y: 120, c: 'var(--coder)', t: 'input-required' },
  failed: { x: 445, y: 200, c: 'var(--tester)', t: 'failed' },
  rejected: { x: 250, y: 215, c: '#ffd2cb', t: 'rejected' },
}
const STORIES = [
  { id: 'hand', t: 'Handed on', path: ['submitted', 'working', 'completed'], lines: ['coder receives “Please write a fix.”', 'coder picked up task-004: Tag order changes between runs', 'task-004 is Awaiting Tests; handed to tester.'] },
  { id: 'you', t: 'Needs you', path: ['submitted', 'working', 'input-required'], lines: ['reviewer receives “Please review it.”', 'reviewer picked up task-004…', 'task-004 is approved and waiting for a person to merge it.'] },
  { id: 'no', t: 'Wrong desk', path: ['submitted', 'rejected'], lines: ['tester receives task-004…', 'task-004 is Approved; I work on Awaiting Tests.'] },
  { id: 'err', t: 'It crashed', path: ['submitted', 'working', 'failed'], lines: ['coder receives task-007', 'coder picked up task-007…', 'coder hit an error on task-007: TimeoutError'] },
]

function Life() {
  const [story, setStory] = useState(0)
  const [step, setStep] = useState(0)
  const s = STORIES[story]
  useEffect(() => {
    const id = window.setInterval(() => setStep((k) => (k + 1 > s.path.length + 1 ? 0 : k + 1)), 1300)
    return () => window.clearInterval(id)
  }, [s.path.length])
  const at = STATES[s.path[Math.min(step, s.path.length - 1)]]
  const edges: [string, string][] = [['submitted', 'working'], ['working', 'completed'], ['working', 'input-required'], ['working', 'failed'], ['submitted', 'rejected']]
  return (
    <Chapter id="life" kicker="The verbs" title="Every task goes on a little journey" tint="var(--tester)"
      lede="A task’s status only ever moves forward, and it ends in one of a few places. Pick a story and watch one of Swarm’s real tasks travel.">
      <div className="a2a-life">
        <div className="a2a-stories" role="tablist">
          {STORIES.map((x, i) => (
            <button key={x.id} role="tab" aria-selected={story === i} className={story === i ? 'on' : ''} onClick={() => { setStory(i); setStep(0) }}>
              {story === i && <motion.span layoutId="a2a-story-on" className="a2a-switch-on" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
              <span>{x.t}</span>
            </button>
          ))}
        </div>
        <div className="a2a-life-stage">
          <svg viewBox="0 0 580 250" className="a2a-life-svg" aria-hidden="true">
            {edges.map(([a, b]) => {
              const on = s.path.includes(a) && s.path.includes(b) && s.path.indexOf(b) <= step
              return <motion.path key={a + b} d={`M${STATES[a].x} ${STATES[a].y}L${STATES[b].x} ${STATES[b].y}`} stroke="var(--ink)" strokeWidth={on ? 4 : 2} strokeDasharray={on ? '0' : '4 6'} animate={{ opacity: on ? 1 : 0.28 }} fill="none" />
            })}
            {Object.entries(STATES).map(([k, v]) => {
              const on = s.path.includes(k) && s.path.indexOf(k) <= step
              return (
                <motion.g key={k} animate={{ scale: on ? 1 : 0.9, opacity: on ? 1 : 0.45 }} style={{ originX: `${v.x}px`, originY: `${v.y}px` }}>
                  <rect x={v.x - 62 + 3} y={v.y - 17 + 4} width="124" height="34" rx="17" fill="var(--ink)" />
                  <rect x={v.x - 62} y={v.y - 17} width="124" height="34" rx="17" fill={on ? v.c : 'var(--white)'} stroke="var(--ink)" strokeWidth="2.5" />
                  <text x={v.x} y={v.y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill={on ? '#0f0f0f' : 'var(--ink)'} className="mono">{v.t}</text>
                </motion.g>
              )
            })}
            <motion.g animate={{ x: at.x, y: at.y - 34 }} transition={{ type: 'spring', stiffness: 140, damping: 16 }}>
              <path d="M-9 -12h18v18l-9 7-9-7z" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
              <text y="2" textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--ink)">04</text>
            </motion.g>
          </svg>
          <div className="a2a-life-log mono" aria-live="polite">
            <AnimatePresence initial={false}>
              {s.lines.slice(0, Math.min(step + 1, s.lines.length)).map((l, i) => (
                <motion.div key={s.id + i} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                  <span>{s.path[Math.min(i, s.path.length - 1)]}</span>{l}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <Note title="Two more states you’ll meet">
        <b>canceled</b>: someone asked it to stop (Swarm keeps whatever was already written to the board). <b>auth-required</b>: the gateway uses it when a request arrives without an access token.
      </Note>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 4. on the wire (scroll film) */

const WIRE = [
  { who: 'req', t: 'The request', j: `POST /agents/tester/a2a
{ "jsonrpc": "2.0", "id": 1,
  "method": "SendStreamingMessage",
  "params": { "message": { … "Patch ready for task-004" … } } }` },
  { who: 'res', t: 'A task is born', j: `data: { "task": { "id": "c1d2…", "status": { "state": "TASK_STATE_SUBMITTED" } } }` },
  { who: 'res', t: 'Work starts', j: `data: { "statusUpdate": { "status": { "state": "TASK_STATE_WORKING",
  "message": "tester picked up task-004: Tag order changes between runs" } } }` },
  { who: 'res', t: 'It thinks out loud', j: `data: { "statusUpdate": { "status": { "state": "TASK_STATE_WORKING",
  "message": "baseline: 5/8 runs fail" } } }` },
  { who: 'res', t: 'The result', j: `data: { "artifactUpdate": { "artifact": { "name": "tester-result",
  "parts": [{ "data": { "evidence": { "before": "5/8", "after": "0/8" } } }] } } }` },
  { who: 'res', t: 'Done, and passed on', j: `data: { "statusUpdate": { "status": { "state": "TASK_STATE_COMPLETED",
  "message": "task-004 is In Review; handed to reviewer." } } }` },
]

function Wire() {
  return (
    <Chapter id="wire" kicker="Under the hood" title="It’s just JSON over HTTP" tint="var(--reviewer)"
      lede={<>A2A rides on things the web already has: an HTTP <b>POST</b> carrying a JSON-RPC request, and for long jobs a <b>stream</b> of Server-Sent Events coming back. Keep scrolling to watch one hand-off go over the wire.</>}>
      <Film screens={3.2} className="a2a-wire-film">
        {(p) => <WireStage p={p} />}
      </Film>
      <div className="a2a-methods">
        <p className="a2a-small">The methods an A2A server answers (in the 1.0 spec, named like gRPC methods):</p>
        <div className="a2a-method-list">
          {[['SendMessage', 'send, wait for the answer'], ['SendStreamingMessage', 'send, get a live stream'], ['GetTask', 'how is it going?'], ['ListTasks', 'everything you asked for'],
            ['CancelTask', 'please stop'], ['SubscribeToTask', 'rejoin a stream'], ['Create/Get/List/DeleteTaskPushNotificationConfig', 'call my webhook when it changes'], ['GetExtendedAgentCard', 'the card for signed-in callers']].map(([m, d], i) => (
            <motion.span key={m} className="a2a-method" initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 20 }}>
              <b className="mono">{m}</b><span>{d}</span>
            </motion.span>
          ))}
        </div>
      </div>
    </Chapter>
  )
}

function WireStage({ p }: { p: MotionValue<number> }) {
  const step = useStep(p, WIRE.length)
  const packetX = useTransform(p, [0, 0.14, 0.16, 1], ['0%', '100%', '100%', '100%'])
  return (
    <div className="a2a-wire">
      <div className="a2a-wire-ends">
        <div className="a2a-wire-end"><Buddy a="coder" size={70} talk={step === 0} /><b>coder</b><span className="mono">the client</span></div>
        <div className="a2a-wire-pipe">
          <motion.span className="a2a-wire-packet" style={{ left: packetX }} />
          <AnimatePresence>
            {step > 0 && <motion.span key={step} className="a2a-wire-back" initial={{ left: '100%', opacity: 1 }} animate={{ left: '0%', opacity: [1, 1, 0] }} transition={{ duration: 0.9, ease: easeOut }} style={{ background: step === WIRE.length - 1 ? 'var(--reviewer)' : 'var(--triager)' }} />}
          </AnimatePresence>
          <span className="a2a-wire-label mono">{step === 0 ? 'POST →' : '← text/event-stream'}</span>
        </div>
        <div className="a2a-wire-end"><Buddy a="tester" size={70} talk={step > 0 && step < WIRE.length - 1} /><b>tester</b><span className="mono">the server</span></div>
      </div>
      <div className="a2a-wire-log">
        {WIRE.map((w, i) => (
          <motion.div key={i} className={`a2a-wire-row ${w.who}`} animate={{ opacity: i <= step ? 1 : 0.12, y: i <= step ? 0 : 12, scale: i === step ? 1 : 0.98 }} transition={{ duration: 0.45, ease: easeOut }}>
            <span className="a2a-wire-t">{i === 0 ? '→' : '←'} {w.t}</span>
            <pre className="mono">{w.j}</pre>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 5. installing it */

const HELLO = `from a2a.helpers.proto_helpers import new_data_part, new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers.default_request_handler_v2 import DefaultRequestHandlerV2
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types.a2a_pb2 import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from starlette.applications import Starlette


class Echo(AgentExecutor):
    async def execute(self, context: RequestContext, queue: EventQueue) -> None:
        task = context.current_task or new_task_from_user_message(context.message)
        await queue.enqueue_event(task)
        up = TaskUpdater(queue, task.id, task.context_id)
        await up.start_work()
        await up.add_artifact([new_data_part({"echo": "hello"})], name="reply")
        await up.complete()

    async def cancel(self, context, queue) -> None:
        pass


card = AgentCard(name="echo", description="Says hello back", version="1.0.0",
                 supported_interfaces=[AgentInterface(url="http://localhost:9000/a2a", protocol_binding="JSONRPC")],
                 capabilities=AgentCapabilities(streaming=True),
                 skills=[AgentSkill(id="echo", name="Echo", description="Says hello back")])
handler = DefaultRequestHandlerV2(agent_executor=Echo(), task_store=InMemoryTaskStore(), agent_card=card)
app = Starlette(routes=create_jsonrpc_routes(handler, "/a2a") + create_agent_card_routes(card))
# uvicorn hello:app --port 9000`

function Install() {
  const steps = [
    ['Add the SDK', 'It’s one line in pyproject.toml. The [http-server] extra brings the web-server pieces (routes and streaming).', `dependencies = [..., "a2a-sdk[http-server]>=1.1,<2"]`],
    ['Install the project', 'From the project folder, into the virtual environment.', `python -m venv .venv && .venv/bin/pip install -e ".[server]"`],
    ['Run the four agents', 'Serves every agent over real HTTP, with its card, on the local board.', `swarm agents --port 9100`],
    ['Say hello', 'Any A2A client can now read a card.', `curl localhost:9100/agents/coder/.well-known/agent-card.json`],
  ]
  return (
    <Chapter id="install" kicker="Setting up" title="One package, four lines" tint="var(--triager)"
      lede={<>Swarm uses Google’s official Python SDK, <code>a2a-sdk</code>, version 1.x. It gives you the types (as protobuf messages), a server that speaks JSON-RPC, and a client that can talk to any A2A agent.</>}>
      <ol className="a2a-steps">
        {steps.map(([t, p, c], i) => (
          <motion.li key={t} {...inView} transition={{ duration: 0.7, ease: easeOut, delay: i * 0.08 }}>
            <span className="a2a-step-n">{i + 1}</span>
            <div><b>{t}</b><p>{p}</p><pre className="a2a-cmd mono">{c}</pre></div>
          </motion.li>
        ))}
      </ol>
      <p className="a2a-small">The smallest A2A agent you can write with the same SDK Swarm uses. Everything Swarm does is this, plus real work in <code>execute</code>:</p>
      <motion.div {...inView} transition={{ duration: 0.8, ease: easeOut }}><CodeWindow paper title="hello.py" code={HELLO} lang="python" maxHeight="440px" /></motion.div>
      <div className="a2a-imports">
        {[['AgentExecutor', 'your agent: execute() does the work'], ['TaskUpdater', 'say “working”, attach results, say “done”'], ['DefaultRequestHandlerV2', 'turns JSON-RPC calls into execute() calls'],
          ['create_jsonrpc_routes', 'mounts it at a URL'], ['create_agent_card_routes', 'serves the card at /.well-known'], ['create_client', 'the other side: talk to any agent from its card']].map(([n, d], i) => (
          <motion.div key={n} className="a2a-import" {...inView} transition={{ duration: 0.6, ease: easeOut, delay: i * 0.05 }}><code>{n}</code><span>{d}</span></motion.div>
        ))}
      </div>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 6. the relay (scroll film) */

const HOPS: { from: Agent | 'intake'; to: Agent | 'you'; skill: string; col: string; text: string }[] = [
  { from: 'intake', to: 'triager', skill: 'triage_issue', col: 'New Issue', text: 'New issue #12: Tag order changes between runs. Please triage it.' },
  { from: 'triager', to: 'coder', skill: 'write_fix', col: 'Triaged', text: 'task-004 (#12) is a test that fails at random, medium priority. Please write a fix.' },
  { from: 'coder', to: 'tester', skill: 'verify_fix', col: 'Awaiting Tests', text: 'Patch ready for task-004 (sort-set-result). Please verify it.' },
  { from: 'tester', to: 'reviewer', skill: 'review_fix', col: 'In Review', text: 'task-004 passes its tests (5/8 failing before, 0/8 after). Please review it.' },
  { from: 'reviewer', to: 'you', skill: '—', col: 'Approved', text: 'task-004 is approved and waiting for a person to merge it.' },
]

function Relay() {
  return (
    <Chapter id="relay" kicker="Swarm’s way" title="Nobody’s in charge, and that’s the point" tint="var(--coder)"
      lede={<>In Swarm, each of the four agents is <b>its own A2A server</b> with its own card. There’s no boss deciding who works next. When an agent finishes, it looks at the task’s column on the board, works out which <b>skill</b> is needed next, finds the agent whose card offers it, and sends that agent a message. Scroll to follow one bug all the way.</>}>
      <Film screens={3.6} className="a2a-relay-film">
        {(p) => <RelayStage p={p} />}
      </Film>
      <SkillFinder />
      <div className="a2a-rules">
        {[['board', 'The board is the truth', 'A2A carries the conversation; the board keeps the record. Each agent reads the task from the board and writes its result back, so the dashboard, MCP and people all see the same thing.'],
          ['thread', 'One thread per bug', 'Every message about task-004 uses context swarm-task-004, and each hand-off points at the one before it (referenceTaskIds), so you can replay the chain.'],
          ['lock', 'One job at a time', 'Each agent holds a lock (a “slot”) while it works. Different agents work in parallel; one agent never juggles two tasks.'],
          ['nudge', 'A gentle nudge', 'pump() only starts work nobody is carrying: new issues, tasks a person sent back, and anything the last run left half-way. After that, the agents pass it along themselves.']].map(([e, t, p], i) => (
          <motion.div key={t} className="a2a-rule" {...inView} transition={{ duration: 0.7, ease: easeOut, delay: i * 0.07 }}>
            <Glyph k={e} c={['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)'][i]} /><b>{t}</b><p>{p}</p>
          </motion.div>
        ))}
      </div>
    </Chapter>
  )
}

function RelayStage({ p }: { p: MotionValue<number> }) {
  const step = useStep(p, HOPS.length)
  const hop = HOPS[step]
  const cast: (Agent | 'you')[] = ['triager', 'coder', 'tester', 'reviewer', 'you']
  const holder = cast.indexOf(hop.to)
  return (
    <div className="a2a-relay">
      <div className="a2a-relay-track">
        <div className="a2a-relay-line"><motion.i animate={{ scaleX: holder / (cast.length - 1) }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} /></div>
        {cast.map((a, i) => (
          <div key={a} className={`a2a-relay-stop ${i === holder ? 'on' : ''} ${i < holder ? 'done' : ''}`}>
            <Buddy a={a} size={62} label talk={i === holder} />
          </div>
        ))}
        <div className="a2a-relay-rail">
          <motion.div className="a2a-relay-ticket" animate={{ left: `${(holder / (cast.length - 1)) * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 16 }}>
            <motion.span key={step} initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>#12</motion.span>
          </motion.div>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} className="a2a-relay-msg" initial={{ opacity: 0, y: 24, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.45, ease: easeOut }}>
          <div className="a2a-relay-meta mono">
            <span>{hop.from} → {hop.to === 'you' ? 'a person' : hop.to}</span>
            <span>column: <b>{hop.col}</b></span>
            {hop.skill !== '—' ? <span>needs skill <b>{hop.skill}</b> → find() says <b>{hop.to}</b></span> : <span>no agent offers “merge”: <b>input-required</b></span>}
          </div>
          <p>“{hop.text}”</p>
        </motion.div>
      </AnimatePresence>
      <div className="a2a-relay-dots">{HOPS.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
    </div>
  )
}

const NEXT: [string, string | null][] = [['New Issue', 'triage_issue'], ['Triaged', 'write_fix'], ['Rejected', 'write_fix'], ['Awaiting Tests', 'verify_fix'], ['In Review', 'review_fix'], ['Approved', null], ['Needs Human', null], ['Merged', null]]
const OWNER: Record<string, Agent> = { triage_issue: 'triager', write_fix: 'coder', verify_fix: 'tester', review_fix: 'reviewer' }

function SkillFinder() {
  const [col, setCol] = useState('Triaged')
  const skill = NEXT.find(([c]) => c === col)?.[1] ?? null
  const who = skill ? OWNER[skill] : null
  return (
    <motion.div className="a2a-finder" {...inView} transition={{ duration: 0.8, ease: easeOut }}>
      <p className="a2a-finder-title"><b>Try the lookup.</b> Pick a board column; this is <code>NEXT_SKILL</code> and <code>find()</code> in <code>cards.py</code> and <code>network.py</code>.</p>
      <div className="a2a-finder-cols">
        {NEXT.map(([c]) => <button key={c} className={col === c ? 'on' : ''} onClick={() => setCol(c)}>{c}</button>)}
      </div>
      <div className="a2a-finder-flow">
        <span className="a2a-finder-box">{col}</span>
        <motion.span className="a2a-finder-arrow" key={col + 'a'} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.4 }} />
        <AnimatePresence mode="wait">
          <motion.span key={col} className={`a2a-finder-box mono ${skill ? '' : 'none'}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>{skill ?? 'no skill: a person decides'}</motion.span>
        </AnimatePresence>
        <motion.span className="a2a-finder-arrow" key={col + 'b'} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.4, delay: 0.2 }} />
        <AnimatePresence mode="wait">
          <motion.span key={col + 'w'} initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.3 }}>
            <Buddy a={who ?? 'you'} size={58} label />
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ 7. inside the backend */

const FILES = [
  { f: 'cards.py', c: 'var(--triager)', what: 'Who everyone is', body: 'Builds each agent’s card with its skills, the NEXT_SKILL table (board column → skill), and the bearer-token scheme the public gateway advertises.',
    code: `NEXT_SKILL: dict[TaskState, str] = {
    TaskState.NEW: "triage_issue",
    TaskState.TRIAGED: "write_fix",
    TaskState.REJECTED: "write_fix",
    TaskState.AWAITING_TESTS: "verify_fix",
    TaskState.IN_REVIEW: "review_fix",
}
NEEDS_PERSON = {TaskState.APPROVED, TaskState.HUMAN_REVIEW}

def agent_card(name, base_url, secured=False) -> AgentCard:
    a = AGENTS[name]
    return AgentCard(
        name=name, description=a["description"], version=VERSION,
        supported_interfaces=[AgentInterface(
            url=f"{base_url}/agents/{name}/a2a", protocol_binding="JSONRPC")],
        capabilities=AgentCapabilities(streaming=True),
        skills=a["skills"])` },
  { f: 'executor.py', c: 'var(--coder)', what: 'One agent at work', body: 'BoardAgentExecutor wraps a Swarm agent as an A2A AgentExecutor. It reads the task from the board, refuses work that isn’t in its column, runs the agent in a thread while streaming what it says, attaches a result, then hands the task on.',
    code: `async def execute(self, context, event_queue):
    board_id = request_data(msg).get("task_id")
    card = self.network.board.get(board_id)
    if card.state not in self.accepts:
        await up.reject(say(f"{card.task_id} is {card.state.value}; I work on …"))
        return
    async with self.network.slot(self.agent.name):   # one job at a time
        await up.start_work(say(f"{self.agent.name} picked up {card.task_id}"))
        await self._handle(card, up)                   # the real work, streamed
    after = self.network.board.get(card.task_id)
    await up.add_artifact([new_data_part(result_of(self.agent.name, after))])
    peer = self.network.hand_off(self.agent.name, after, task.id)
    if peer:
        await up.complete(say(f"{after.task_id} is {after.state.value}; handed to {peer}."))
    elif after.state in NEEDS_PERSON:
        await up.requires_input(say(waiting_for(after)))` },
  { f: 'network.py', c: 'var(--tester)', what: 'The phone lines', body: 'AgentNetwork builds all four servers, the clients they use to call each other, and a log of every event on the wire (that log is what the Agent traffic tab shows). hand_off, pump and find live here.',
    code: `def hand_off(self, sender, t, a2a_task):
    skill = NEXT_SKILL.get(t.state)
    peer = self.find(skill) if skill else None
    if not peer:
        return None
    self.dispatch(sender, peer, t, handoff_text(sender, t), reference=a2a_task)
    return peer

def find(self, skill):
    """The agent whose card offers \`skill\`. This is how agents discover each other."""
    for name, card in self.cards.items():
        if any(s.id == skill for s in card.skills):
            return name` },
  { f: 'gateway.py', c: 'var(--reviewer)', what: 'The front door', body: 'One public agent called “Swarm” at /a2a, for agents outside. A token gate checks the swm_ access token; the executor picks a skill from the request and acts as the token’s owner.',
    code: `class TokenGate:
    """POST /a2a needs a valid Swarm access token."""
    async def __call__(self, scope, receive, send):
        if scope["path"].rstrip("/") == "/a2a" and scope["method"] == "POST":
            tok = await self.verify(bearer_from(scope))
            if not tok:
                return await JSONResponse({... "code": -32001 ...}, 401)(scope, receive, send)
            scope = {**scope, "swarm_user": (tok.subject, tok.client_id)}
        return await self.app(scope, receive, send)` },
]

function Backend() {
  const [open, setOpen] = useState(0)
  const f = FILES[open]
  return (
    <Chapter id="backend" kicker="The code" title="Four files do it all" tint="var(--tester)"
      lede={<>Everything A2A lives in <code>swarm/a2a/</code>, about a thousand lines. Pick a file.</>}>
      <div className="a2a-files">
        <div className="a2a-tree" role="tablist" aria-label="Files">
          <span className="a2a-tree-dir mono">swarm/a2a/</span>
          {FILES.map((x, i) => (
            <button key={x.f} role="tab" aria-selected={open === i} className={open === i ? 'on' : ''} onClick={() => setOpen(i)} style={{ ['--c' as string]: x.c }}>
              {open === i && <motion.span layoutId="a2a-file-on" className="a2a-tree-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <i /><span className="mono">{x.f}</span><em>{x.what}</em>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={open} className="a2a-file" initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }} transition={{ duration: 0.35, ease: easeOut }}>
            <p>{f.body}</p>
            <CodeWindow paper title={f.f} code={f.code} lang="python" maxHeight="380px" />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="a2a-tricks">
        <motion.div className="a2a-trick" {...inView} transition={{ duration: 0.8, ease: easeOut }}>
          <h3>No ports needed</h3>
          <p>On a scheduled run there’s no reason to open real network ports. The four servers are mounted in one app, and the clients reach them through <code>httpx.ASGITransport</code>: real A2A requests and responses, passed in memory. <code>swarm agents</code> serves the very same app over real HTTP.</p>
          <div className="a2a-asgi" aria-hidden="true">
            <span className="a2a-asgi-box">client</span>
            <span className="a2a-asgi-mid"><motion.i animate={{ x: ['0%', '100%'] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut', repeatType: 'reverse' }} /><em className="mono">ASGITransport · in memory</em></span>
            <span className="a2a-asgi-box">4 agent servers</span>
          </div>
        </motion.div>
        <motion.div className="a2a-trick" {...inView} transition={{ duration: 0.8, ease: easeOut, delay: 0.08 }}>
          <h3>Talking while it works</h3>
          <p>The agents themselves are ordinary blocking Python, so each runs in a worker thread. Whatever it says goes into a queue through a <code>tap</code>, and the async side turns each note into a <b>working</b> status update, live on the stream.</p>
          <div className="a2a-tap" aria-hidden="true">
            {['agent.handle()', 'tap → queue', 'update_status(working)'].map((t, i) => (
              <motion.span key={t} className="mono" animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.25 }}>{t}</motion.span>
            ))}
          </div>
        </motion.div>
        <motion.div className="a2a-trick" {...inView} transition={{ duration: 0.8, ease: easeOut, delay: 0.16 }}>
          <h3>When an agent crashes</h3>
          <p>The first error leaves the card where it is with a note saying what went wrong, and it gets one more go. A second error in a row sends it to a person (<b>Needs Human</b>), because trying again would only crash again.</p>
          <div className="a2a-crash" aria-hidden="true"><span>1st error: one more go</span><span>2nd error: <b>Needs Human</b></span></div>
        </motion.div>
      </div>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 8. the gateway */

const GW_SKILLS = [
  ['board_status', 'Board status', 'Counts per column, and what waits for you'],
  ['task_details', 'Task details', 'One task in full: patch, evidence, review'],
  ['fix_issues', 'Fix new issues', 'Queue a run and stream the hand-offs live'],
  ['request_changes', 'Send a fix back', 'Back to the coder with your comment'],
  ['list_repos', 'List repositories', 'What this token can see'],
] as const

/** The same rules as pick_skill in gateway.py. */
function pickSkill(text: string): string {
  try {
    const d = JSON.parse(text)
    if (d && typeof d === 'object') {
      if (GW_SKILLS.some(([id]) => id === d.skill)) return d.skill
      if (d.comment) return 'request_changes'
      if (d.task_id) return 'task_details'
    }
  } catch { /* plain words */ }
  const t = text.toLowerCase()
  if (/\b(send (it )?back|request changes|reject)\b/.test(t)) return 'request_changes'
  if (/\btask-\d+\b/.test(t)) return 'task_details'
  if (/\b(run|fix|start|work on|go)\b/.test(t)) return 'fix_issues'
  if (/\b(repos|repositories)\b/.test(t)) return 'list_repos'
  return 'board_status'
}

function Gateway() {
  const [q, setQ] = useState('Run the swarm on FrozenFalcon-Byte/portfolio')
  const skill = useMemo(() => pickSkill(q), [q])
  return (
    <Chapter id="gateway" kicker="For the outside world" title="The front door: Swarm as one agent" tint="var(--reviewer)"
      lede={<>The four agents talk among themselves. For everyone else there’s one public agent, <b>Swarm</b>, served by the hub at <code>/a2a</code> with its card at <code>/.well-known/agent-card.json</code>. Another company’s agent can ask it what’s on your board, start a run and watch the hand-offs, or send a fix back. It can never approve or merge.</>}>
      <motion.div className="a2a-ask" {...inView} transition={{ duration: 0.8, ease: easeOut }}>
        <label className="a2a-ask-label" htmlFor="a2a-ask">Say something to Swarm. It picks a skill the same way the server does.</label>
        <div className="a2a-ask-row">
          <input id="a2a-ask" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        </div>
        <div className="a2a-ask-try">
          {['What’s on the board?', 'Show me task-004', 'Send it back: keep the public API', 'Which repos do you work on?', '{"skill": "board_status"}'].map((t) => <button key={t} onClick={() => setQ(t)}>{t}</button>)}
        </div>
        <LayoutGroup id="a2a-gw">
          <div className="a2a-gw-skills">
            {GW_SKILLS.map(([id, name, d]) => (
              <div key={id} className={`a2a-gw-skill ${skill === id ? 'on' : ''}`}>
                {skill === id && <motion.span layoutId="a2a-gw-on" className="a2a-gw-on" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
                <b className="mono">{id}</b><span>{name}</span><em>{d}</em>
              </div>
            ))}
          </div>
        </LayoutGroup>
      </motion.div>
      <div className="a2a-gw-two">
        <motion.div {...inView} transition={{ duration: 0.8, ease: easeOut }}>
          <h3 className="a2a-h3">Knock knock: tokens</h3>
          <p>Reading the card is public. Sending a message needs <code>Authorization: Bearer swm_…</code>, the same access tokens you make in Settings for MCP. A middleware called <code>TokenGate</code> checks it before the request reaches A2A, and the call then acts as the person who made the token, so it only sees their repositories. No token, and you get a JSON-RPC error with code −32001 and a 401.</p>
          <p>When a run ends with fixes waiting, the task ends <b>input-required</b> and says what’s waiting, so the calling agent knows it’s a person’s turn.</p>
        </motion.div>
        <motion.div {...inView} transition={{ duration: 0.8, ease: easeOut, delay: 0.1 }}>
          <CodeWindow paper title="ask-swarm.sh" lang="text" code={`# who is Swarm? (public)
curl https://<your-hub>/.well-known/agent-card.json

# ask it something (needs a token from Settings)
curl https://<your-hub>/a2a \\
  -H "Authorization: Bearer swm_…" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "method": "SendMessage",
       "params": {"message": {"messageId": "1", "role": "ROLE_USER",
         "parts": [{"text": "What\\'s on the board?"}]}}}'`} />
        </motion.div>
      </div>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 9. second opinions */

function Outside() {
  return (
    <Chapter id="outside" kicker="Friends from elsewhere" title="Asking outside agents for a second opinion" tint="#c9b8ff"
      lede={<>Because A2A is an open standard, Swarm can talk to agents it didn’t write. List their card URLs in <code>SWARM_SECOND_OPINION_AGENTS</code> and, before a fix reaches you, the reviewer sends each one the diff and asks: APPROVE or REJECT?</>}>
      <div className="a2a-outside">
        <motion.div className="a2a-outside-art" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} aria-hidden="true">
          <Buddy a="reviewer" size={76} label />
          <div className="a2a-outside-lines">
            {[0, 1].map((k) => (
              <span key={k} className="a2a-outside-line">
                <motion.i animate={{ left: ['0%', '100%', '0%'] }} transition={{ repeat: Infinity, duration: 2.6, delay: k * 1.1, ease: 'easeInOut' }} />
              </span>
            ))}
          </div>
          <div className="a2a-outside-them"><Buddy a="outside" size={60} label /><Buddy a="outside" size={60} /></div>
        </motion.div>
        <ul className="a2a-list">
          {['Their answer is attached to the task as advice. It never moves the task.', 'If an outside agent is down or slow, the swarm carries on without it.', 'The same code reads their card from /.well-known/agent-card.json and talks to them with the same client the agents use with each other.'].map((t, i) => (
            <motion.li key={i} {...inView} transition={{ duration: 0.6, ease: easeOut, delay: i * 0.08 }}>{t}</motion.li>
          ))}
        </ul>
      </div>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 10. deployment */

const NODES = [
  { id: 'web', x: 14, y: 20, t: 'Website', s: 'Firebase Hosting', c: 'var(--triager)', d: 'The dashboard you’re reading this in. scripts/deploy.sh builds it and runs firebase deploy. The Agent traffic tab on each repository reads the A2A log from Firestore.' },
  { id: 'db', x: 50, y: 20, t: 'Firestore', s: 'repos/{id}/a2a', c: 'var(--mint, #e2f2e5)', d: 'The board, and every A2A event the agents send each other (message, status, artifact), one document each, with a server timestamp.' },
  { id: 'hub', x: 86, y: 20, t: 'The hub', s: 'Render · swarm hub', c: 'var(--reviewer)', d: 'One Docker service on Render’s free plan: the Swarm gateway at /a2a and its card, every agent’s card at /agents, MCP at /mcp, passkeys, and a dispatcher that starts the worker when work is queued.' },
  { id: 'worker', x: 50, y: 78, t: 'The worker', s: 'GitHub Actions', c: 'var(--coder)', d: 'swarm worker --once, every 15 minutes or as soon as the hub dispatches it. The four A2A agents run here, in-process, and each test runs in a locked-down Docker sandbox.' },
  { id: 'other', x: 86, y: 78, t: 'Other agents', s: 'anyone with a token', c: '#c9b8ff', d: 'Any A2A client: reads the card, sends SendMessage or SendStreamingMessage to the hub’s /a2a with a swm_ token.' },
  { id: 'gh', x: 14, y: 78, t: 'GitHub', s: 'issues & PRs', c: 'var(--tester)', d: 'Where issues come from and where approved fixes go when you press Merge.' },
]
const LINKS: [string, string][] = [['web', 'db'], ['db', 'hub'], ['db', 'worker'], ['hub', 'worker'], ['other', 'hub'], ['gh', 'worker']]

function Deploy() {
  const [pick, setPick] = useState('worker')
  const n = NODES.find((x) => x.id === pick)!
  return (
    <Chapter id="deploy" kicker="In production" title="Where it all runs" tint="var(--triager)"
      lede="Three free services, one database. Tap a box to see what it does; the dots are real traffic paths.">
      <div className="a2a-map-wrap">
        <div className="a2a-map">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="a2a-map-lines" aria-hidden="true">
            {LINKS.map(([a, b], i) => {
              const A = NODES.find((x) => x.id === a)!, B = NODES.find((x) => x.id === b)!
              return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--ink)" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.45" vectorEffect="non-scaling-stroke" />
            })}
          </svg>
          {LINKS.map(([a, b], i) => {
            const A = NODES.find((x) => x.id === a)!, B = NODES.find((x) => x.id === b)!
            return <motion.i key={i} className="a2a-map-dot" style={{ background: A.c }} animate={{ left: [`${A.x}%`, `${B.x}%`], top: [`${A.y}%`, `${B.y}%`] }} transition={{ repeat: Infinity, duration: 2.2 + i * 0.3, ease: 'easeInOut', repeatType: 'reverse', delay: i * 0.4 }} />
          })}
          {NODES.map((x, i) => (
            <motion.button key={x.id} className={`a2a-node ${pick === x.id ? 'on' : ''}`} style={{ left: `${x.x}%`, top: `${x.y}%`, ['--c' as string]: x.c }} onClick={() => setPick(x.id)}
              initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 300, damping: 18, delay: i * 0.07 }}>
              <b>{x.t}</b><span className="mono">{x.s}</span>
            </motion.button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={pick} className="a2a-map-card" style={{ ['--c' as string]: n.c }} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease: easeOut }}>
            <span className="a2a-map-swatch" /><h3>{n.t}</h3><p>{n.d}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="a2a-journey">
        <p className="a2a-small"><b>A run, start to finish:</b></p>
        <ol>
          {['You press Run (or a new issue appears). A run is queued in Firestore.', 'The hub sees it and dispatches the GitHub Actions worker.', 'The worker builds the A2A network in memory and calls pump().', 'The agents hand the task along over A2A; every event is written to repos/{id}/a2a.', 'The dashboard’s Agent traffic tab shows those events live.', 'The last agent ends input-required: it’s your turn to merge.'].map((t, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, ease: easeOut, delay: i * 0.08 }}><span>{i + 1}</span>{t}</motion.li>
          ))}
        </ol>
      </div>
      <Note kind="tip" title="Settings that matter">
        <code>SWARM_PUBLIC_URL</code> is the address written into the cards. <code>SWARM_SECOND_OPINION_AGENTS</code> lists outside agents. The hub’s <code>/healthz</code> says where MCP, A2A and the card are.
      </Note>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 11. tests */

const TESTS = [
  'every column has an agent that offers its skill', 'agents hand work to each other over A2A', 'a person’s decision reaches the coder as a message', 'an agent refuses work that is not in its column',
  'reviewer asks outside agents for a second opinion', 'an outside agent being down does not block the swarm', 'gateway understands plain requests', 'gateway needs a token and acts as its owner',
]

function Tests() {
  return (
    <Chapter id="tests" kicker="Proof" title="How we know it works" tint="var(--reviewer)"
      lede={<><code>tests/test_a2a.py</code> runs the whole network in memory, with no servers and no model calls. Every promise on this page has a test:</>}>
      <ul className="a2a-tests">
        {TESTS.map((t, i) => (
          <motion.li key={t} initial={{ opacity: 0.25 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: '0px 0px -20% 0px' }} transition={{ delay: i * 0.12 }}>
            <motion.span className="a2a-tick" initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true, margin: '0px 0px -20% 0px' }} transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.2 + i * 0.12 }}>✓</motion.span>
            <span className="mono">test_{t.replace(/’/g, '').replace(/ /g, '_')}</span>
          </motion.li>
        ))}
      </ul>
      <pre className="a2a-cmd mono">.venv/bin/pytest tests/test_a2a.py -q</pre>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 12. quiz */

const QUIZ = [
  { q: 'Where does an agent publish what it can do?', a: ['In a README', 'In its agent card at /.well-known/agent-card.json', 'In the board'], ok: 1 },
  { q: 'The coder finishes a patch. How does it know to send it to the tester?', a: ['A boss tells it', 'It’s hard-coded', 'The column needs verify_fix, and the tester’s card offers it'], ok: 2 },
  { q: 'A fix is approved. How does the reviewer’s A2A task end?', a: ['completed', 'input-required', 'failed'], ok: 1 },
  { q: 'What stops an outside agent from merging your code?', a: ['There is no merge skill, and the token gate', 'A captcha', 'Nothing'], ok: 0 },
]

function Quiz() {
  const [picks, setPicks] = useState<(number | null)[]>(QUIZ.map(() => null))
  const score = picks.filter((p, i) => p === QUIZ[i].ok).length
  const done = picks.every((p) => p !== null)
  return (
    <Chapter id="quiz" kicker="Your turn" title="Check yourself" tint="var(--coder)" lede="Four quick ones. No pressure; the agents won’t tell.">
      <div className="a2a-quiz">
        {QUIZ.map((x, i) => (
          <motion.div key={i} className="a2a-q" {...inView} transition={{ duration: 0.6, ease: easeOut, delay: i * 0.06 }}>
            <b>{i + 1}. {x.q}</b>
            <div className="a2a-q-opts">
              {x.a.map((o, k) => {
                const chosen = picks[i] === k, shown = picks[i] !== null
                return (
                  <motion.button key={k} disabled={shown} className={`${chosen ? 'chosen' : ''} ${shown && k === x.ok ? 'right' : ''} ${chosen && k !== x.ok ? 'wrong' : ''}`}
                    onClick={() => setPicks((p) => p.map((v, j) => (j === i ? k : v)))}
                    animate={chosen && k !== x.ok ? { x: [0, -6, 6, -4, 4, 0] } : chosen ? { scale: [1, 1.06, 1] } : {}} transition={{ duration: 0.4 }}>
                    {o}
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        ))}
        <AnimatePresence>
          {done && (
            <motion.div className="a2a-score" initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
              <div className="a2a-score-bots">{AGENTS.map((a, k) => (
                <motion.span key={a} animate={{ y: score === QUIZ.length ? [0, -18, 0] : 0 }} transition={{ repeat: score === QUIZ.length ? Infinity : 0, duration: 0.7, delay: k * 0.1 }}><Buddy a={a} size={44} /></motion.span>
              ))}</div>
              <b>{score}/{QUIZ.length}</b>
              <span>{score === QUIZ.length ? 'Perfect. You could write the spec.' : score >= 2 ? 'Nearly there. Scroll up for the ones you missed.' : 'Have another read; it clicks on the second pass.'}</span>
              <button className="btn btn-line btn-sm" onClick={() => setPicks(QUIZ.map(() => null))}>Try again</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Chapter>
  )
}

/* ------------------------------------------------------------------ 13. cheat sheet */

const GLOSSARY = [
  ['A2A', 'Agent2Agent: an open protocol for agents to find and work with each other.'], ['Agent card', 'JSON at /.well-known/agent-card.json: name, URL, skills, sign-in.'],
  ['Skill', 'One thing an agent can do, with an id like write_fix.'], ['Message', 'One turn: a role and some parts (text, data, files).'],
  ['Task', 'A unit of work with a status that moves forward.'], ['Artifact', 'An output attached to a task.'],
  ['Context', 'The thread a task belongs to. Swarm: swarm-task-004.'], ['input-required', 'The agent is waiting for someone else, often a person.'],
  ['JSON-RPC', 'The request format: method, params, id, over an HTTP POST.'], ['SSE', 'Server-Sent Events: how a stream of updates comes back.'],
  ['Executor', 'Your agent’s code in the SDK: execute() and cancel().'], ['Gateway', 'Swarm’s one public agent at /a2a, for outside callers.'],
]

function Words() {
  return (
    <Chapter id="words" kicker="Keep this" title="The cheat sheet" tint="var(--tester)">
      <div className="a2a-words">
        {GLOSSARY.map(([w, d], i) => (
          <motion.div key={w} className="a2a-word" initial={{ opacity: 0, y: 16, rotate: i % 2 ? 1.5 : -1.5 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, ease: easeOut, delay: (i % 4) * 0.05 }}>
            <b>{w}</b><span>{d}</span>
          </motion.div>
        ))}
      </div>
      <motion.div className="a2a-end" {...inView} transition={{ duration: 0.8, ease: easeOut }}>
        <div className="a2a-end-bots">{AGENTS.map((a) => <Buddy key={a} a={a} size={48} />)}</div>
        <p>That’s A2A. Want to see it happening? Open a repository and pick <b>Agent traffic</b>: every line there is one of these messages.</p>
        <Link to="/app/repos" className="btn btn-dark btn-sm">Go to repositories</Link>
      </motion.div>
    </Chapter>
  )
}
