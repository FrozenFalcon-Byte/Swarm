import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { easeOut } from '../../lib/motion'
import { Glyph, type GlyphName } from './glyphs'

/* "Secure and private": the section pins while you scroll through five promises. The list on the left
   fills in as you go; on the right, each promise plays out as a small live scene. */

const FEATURES: { title: string; text: string; glyph: GlyphName; color: string; scene: () => ReactElement }[] = [
  { title: 'Sandboxed', text: 'Every patch and every agent-written tool runs in a throwaway copy of your repo, with no network.', glyph: 'box', color: 'var(--coder)', scene: () => <Sandbox /> },
  { title: 'Never auto-merges', text: 'Approved means ready for you. Auth and security paths always wait for a maintainer.', glyph: 'shield', color: 'var(--mint-strong)', scene: () => <NoMerge /> },
  { title: 'Your models', text: 'Free Groq and Gemini APIs out of the box, falling back from one to the next. Bring Anthropic or a local model if you prefer.', glyph: 'chip', color: 'var(--triager)', scene: () => <Models /> },
  { title: 'Remembers', text: 'Validated tools are saved per repository, so the swarm gets faster the longer it works there.', glyph: 'hash', color: 'var(--pink)', scene: () => <Shelf /> },
  { title: 'Audit trail', text: 'Every card records who moved it, when and why, from triage to merge.', glyph: 'sort', color: 'var(--coder)', scene: () => <Audit /> },
]

export function Security() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [i, setI] = useState(0)
  const n = FEATURES.length
  useMotionValueEvent(scrollYProgress, 'change', (p) => setI(Math.min(n - 1, Math.max(0, Math.floor(p * n * 0.9999)))))
  const f = FEATURES[i]
  const jump = (k: number) => {
    const el = ref.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top + ((k + 0.5) / n) * (el.offsetHeight - window.innerHeight), behavior: 'smooth' })
  }
  return (
    <section className="sec" id="security" ref={ref} style={{ height: `${n * 75 + 40}vh` }}>
      <div className="sec-sticky">
        <div className="sec-side">
          <p className="surtitle"><span style={{ background: 'var(--coder)' }} />Secure and private</p>
          <h2 className="sec-title">Safe by default.<br /><span>You stay in charge.</span></h2>
          <ol className="sec-list">
            {FEATURES.map((x, k) => (
              <li key={x.title} className={k === i ? 'on' : k < i ? 'past' : ''}>
                <button onClick={() => jump(k)}>
                  <span className="sec-ic" style={{ background: x.color }}><Glyph name={x.glyph} size={22} /></span>
                  <span className="sec-name">{x.title}</span>
                  <Bar p={scrollYProgress} k={k} n={n} />
                </button>
                <AnimatePresence initial={false}>
                  {k === i && (
                    <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: [0.65, 0, 0.35, 1] }}>
                      <span>{x.text}</span>
                    </motion.p>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ol>
        </div>
        <div className="sec-stage" style={{ ['--c' as string]: f.color }}>
          <span className="sec-count mono">{String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={i} className="sec-scene" initial={{ opacity: 0, y: 60, rotate: -3, scale: 0.9 }} animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, rotate: 2, scale: 0.94, filter: 'blur(6px)' }} transition={{ type: 'spring', stiffness: 170, damping: 22 }}>
              {f.scene()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

function Bar({ p, k, n }: { p: MotionValue<number>; k: number; n: number }) {
  const fill = useTransform(p, [k / n, (k + 1) / n], [0, 1], { clamp: true })
  return <span className="sec-bar"><motion.i style={{ scaleX: fill }} /></span>
}

/* ------------------------------------------------------------------ the five scenes */

function Sandbox() {
  return (
    <div className="scn scn-box">
      <div className="scn-net"><Glyph name="globe" size={30} /><span>internet</span></div>
      <div className="scn-wire">
        <motion.i className="scn-packet" animate={{ x: [0, 110, 96, 110], opacity: [0, 1, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6, times: [0, 0.55, 0.7, 1] }} />
        <motion.b className="scn-cut" animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6, times: [0.5, 0.62, 0.8] }}>✕</motion.b>
      </div>
      <div className="scn-container">
        <div className="scn-tag mono">throwaway copy · network: none</div>
        {['tagkit/normalize.py', 'tests/test_tags.py', 'tools/hashseed_sweep.py'].map((f, k) => (
          <motion.div key={f} className="scn-file mono" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + k * 0.15 }}>{f}</motion.div>
        ))}
        <div className="scn-limits">{['cpu 1', 'mem 512m', 'pids 64', '60s'].map((l, k) => <motion.span key={l} className="chip" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 + k * 0.08, type: 'spring', stiffness: 500, damping: 20 }}>{l}</motion.span>)}</div>
      </div>
    </div>
  )
}

function NoMerge() {
  return (
    <div className="scn scn-merge">
      <div className="scn-card">
        <div className="scn-card-top mono"><span>task-014</span><span className="chip ok">approved</span></div>
        <b>test_session_expiry fails near midnight</b>
        <div className="scn-diff mono"><span className="del">- if now() &gt; exp:</span><span className="add">+ if now() &gt;= exp:</span></div>
        <div className="scn-merge-row">
          <motion.span className="scn-merge-btn" animate={{ x: [0, 0, -7, 7, -5, 5, 0, 0] }} transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.38, 0.42, 0.46, 0.5, 0.54, 0.58, 1] }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
            Merge
          </motion.span>
          <motion.span className="scn-tip" animate={{ opacity: [0, 0, 1, 1, 0], y: [6, 6, 0, 0, -4] }} transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.4, 0.46, 0.85, 1] }}>only you can merge</motion.span>
        </div>
      </div>
      <motion.span className="scn-cursor" animate={{ x: [150, 40, 40, 150], y: [70, 10, 10, 70] }} transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.36, 0.7, 1], ease: 'easeInOut' }}>
        <svg width="22" height="24" viewBox="0 0 22 24"><path d="M2 2l17 8.5-7.2 2.2L8.5 21z" fill="var(--coder)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" /></svg>
        <span style={{ background: 'var(--coder)' }}>coder</span>
      </motion.span>
    </div>
  )
}

const MODELS = ['Groq', 'Gemini', 'OpenRouter', 'Anthropic', 'Local (Ollama)']
function Models() {
  const [step, setStep] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setStep((s) => (s + 1) % 6), 900); return () => window.clearInterval(id) }, [])
  // 0: ask Groq · 1: Groq is rate limited · 2: ask Gemini · 3: Gemini answers · 4-5: hold
  const state = (k: number) => k === 0 ? (step === 0 ? 'ask' : step >= 1 ? 'limited' : '') : k === 1 ? (step === 2 ? 'ask' : step >= 3 ? 'ok' : '') : ''
  return (
    <div className="scn scn-models">
      {MODELS.map((m, k) => (
        <motion.div key={m} className={`scn-model ${state(k)}`} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.07 }}>
          <span className="scn-model-dot" />
          <b>{m}</b>
          <AnimatePresence mode="wait">
            {state(k) === 'ask' && <motion.em key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>asking…</motion.em>}
            {state(k) === 'limited' && <motion.em key="l" className="bad" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>429 · next one</motion.em>}
            {state(k) === 'ok' && <motion.em key="o" className="okay" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>answered</motion.em>}
            {k > 2 && !state(k) && <motion.em key="s" className="dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>optional</motion.em>}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  )
}

const TOOLS = ['hashseed_sweep', 'repeat_run', 'timing_stress', 'order_shuffle', 'tz_matrix', 'race_amplifier', 'float_probe', 'state_leak']
function Shelf() {
  const [count, setCount] = useState(3)
  useEffect(() => { const id = window.setInterval(() => setCount((c) => (c >= TOOLS.length ? 3 : c + 1)), 1300); return () => window.clearInterval(id) }, [])
  return (
    <div className="scn scn-shelf">
      <div className="scn-shelf-head"><b>tool shelf</b><span className="mono">tagkit</span></div>
      <div className="scn-tools">
        <AnimatePresence>
          {TOOLS.slice(0, count).map((t) => (
            <motion.span key={t} layout className="scn-tool mono" initial={{ opacity: 0, y: -40, rotate: -8 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18 }}>{t}</motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div className="scn-speed">
        <span>time to prove a fix</span>
        <div className="scn-speed-bar"><motion.i animate={{ width: `${Math.max(18, 100 - (count - 3) * 15)}%` }} transition={{ duration: 0.6, ease: easeOut }} /></div>
      </div>
    </div>
  )
}

const TRAIL = [
  ['triager', 'labeled #214 · high', '09:12'], ['coder', 'patch v1 · +1 −1', '09:14'], ['tester', '10/12 → 0/12 failing', '09:16'],
  ['reviewer', 'approved · 6 checks', '09:17'], ['you', 'merged · PR #88', '09:40'],
] as const
function Audit() {
  const [shown, setShown] = useState(1)
  useEffect(() => { const id = window.setInterval(() => setShown((s) => (s >= TRAIL.length ? 1 : s + 1)), 1000); return () => window.clearInterval(id) }, [])
  return (
    <div className="scn scn-audit">
      <div className="scn-card-top mono"><span>task-001 · history</span><span>{shown}/{TRAIL.length}</span></div>
      <ol>
        <AnimatePresence initial={false}>
          {TRAIL.slice(0, shown).map(([who, what, at]) => (
            <motion.li key={who + at} layout initial={{ opacity: 0, x: -20, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
              <i style={{ background: who === 'you' ? 'var(--white)' : `var(--${who})` }} />
              <b>{who}</b><span>{what}</span><time className="mono">{at}</time>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}
