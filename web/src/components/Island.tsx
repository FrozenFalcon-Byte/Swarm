import { AnimatePresence, motion, type Variants } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HUB_WAKE_MS, onHubWake } from '../lib/api'

/*
 * Toasts as stickers. Each one arrives as its agent's dot, which rolls in from the corner, bursts open into
 * a white card with an ink outline, and presses up off its hard shadow. The words rise into place, a thin
 * fuse along the bottom burns down while it's up (hover to hold it), and on the way out the card folds
 * back into the dot, which drops away. A success throws a little confetti of agent colours; an error
 * shakes its head. Up to three stack in the corner; a "working…" note turns into whatever comes next.
 * A note with an `eta` counts down instead, and its bar fills up to the moment it expects to be done.
 */

type Tone = 'ok' | 'error' | 'info' | 'work'
type Eta = { since: number; ms: number }
export interface Toast { id: number; slot: number; tone: Tone; title: string; body?: string; duration: number; eta?: Eta }
type Push = (t: { tone?: Tone; title: string; body?: string; duration?: number; eta?: Eta }) => number
interface ToastApi { push: Push; ok(title: string, body?: string): number; error(title: string, body?: string): number; info(title: string, body?: string): number; work(title: string, body?: string): number; dismiss(id?: number): void }

const Ctx = createContext<ToastApi | null>(null)
const MAX = 3
const EASE = [0.65, 0, 0.35, 1] as const
const COLOR: Record<Tone, string> = { ok: 'var(--reviewer)', error: 'var(--tester)', info: 'var(--coder)', work: 'var(--triager)' }
const AGENTS = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)']

export function IslandProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const close = useCallback((id?: number) => setToasts((ts) => (id === undefined ? ts.slice(0, -1) : ts.filter((t) => t.id !== id))), [])

  const push = useCallback<Push>(({ tone = 'info', title, body, duration, eta }) => {
    const id = ++seq.current
    const t: Toast = { id, slot: id, tone, title, body, eta, duration: duration ?? (tone === 'work' ? 0 : tone === 'error' ? 7000 : 3600) }
    setToasts((ts) => {
      // a "working on it" note becomes the answer, in the same card, rather than a second card
      const w = ts.findIndex((x) => x.tone === 'work')
      if (w >= 0) { const next = [...ts]; next[w] = { ...t, slot: ts[w].slot }; return next }
      return [...ts, t].slice(-MAX)
    })
    return id
  }, [])

  const api = useMemo<ToastApi>(() => ({
    push,
    ok: (title, body) => push({ tone: 'ok', title, body }),
    error: (title, body) => push({ tone: 'error', title, body }),
    info: (title, body) => push({ tone: 'info', title, body }),
    work: (title, body) => push({ tone: 'work', title, body }),
    dismiss: (id) => close(id),
  }), [push, close])

  // Swarm's server napping on a free host: say how long it takes to wake, and say so the moment it's up
  useEffect(() => onHubWake((w) => {
    if (w.phase === 'waking') push({ tone: 'work', title: 'Waking Swarm’s server', body: 'It naps after 15 quiet minutes.', eta: { since: w.since, ms: HUB_WAKE_MS } })
    else if (w.phase === 'awake') push({ tone: 'ok', title: 'Server is awake', body: `Up in ${Math.max(1, Math.round(w.took / 1000))}s. The agents take it from here.`, duration: 4200 })
    else push({ tone: 'error', title: 'The server didn’t wake up', body: w.error, duration: 9000 })
  }), [push])

  return (
    <Ctx.Provider value={api}>
      {children}
      <ol className="toasts" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t, i) => <Sticker key={t.slot} t={t} depth={toasts.length - 1 - i} onClose={() => close(t.id)} />)}
        </AnimatePresence>
      </ol>
    </Ctx.Provider>
  )
}

const card: Variants = {
  // the card is the dot, opened up: a circle over the glyph that grows past the corners
  hidden: { clipPath: 'circle(21px at 33px 50%)' },
  show: { clipPath: 'circle(160% at 33px 50%)', transition: { delay: 0.32, duration: 0.6, ease: [0.76, 0, 0.24, 1] } },
  gone: { clipPath: 'circle(21px at 33px 50%)', transition: { duration: 0.34, ease: EASE } },
}
const wrap: Variants = {
  hidden: { x: 140, y: 30, rotate: 14, opacity: 0 },
  show: { x: 0, y: 0, rotate: 0, opacity: 1, transition: { type: 'spring', stiffness: 320, damping: 24, mass: 0.9 } },
  gone: { y: 70, x: 20, rotate: -30, scale: 0.4, opacity: 0, transition: { when: 'afterChildren', duration: 0.38, ease: [0.5, 0, 0.75, 0] } },
}

function Sticker({ t, depth, onClose }: { t: Toast; depth: number; onClose: () => void }) {
  const [held, setHeld] = useState(false)
  const words = t.title.split(' ')
  return (
    <motion.li layout className={`toast toast--${t.tone}`} variants={wrap} initial="hidden" animate="show" exit="gone"
      style={{ zIndex: 10 - depth }} transition={{ layout: { type: 'spring', stiffness: 380, damping: 32 } }}
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} role="status">
      <motion.span className="toast-shadow" aria-hidden="true" initial={{ x: 0, y: 0, opacity: 0 }} animate={{ x: 6, y: 6, opacity: 1 }}
        exit={{ x: 0, y: 0, opacity: 0, transition: { duration: 0.15 } }} transition={{ delay: 0.72, type: 'spring', stiffness: 500, damping: 20 }} />
      <motion.div className="toast-card" variants={card} onClick={onClose}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={t.id} className="toast-in" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.35, ease: EASE }}>
            <Glyph tone={t.tone} />
            <div className="toast-text">
              <b aria-label={t.title}>
                {words.map((w, k) => (
                  <span key={k} className="toast-mask" aria-hidden="true">
                    <motion.span initial={{ y: '110%', rotate: 8 }} animate={{ y: '0%', rotate: 0 }} transition={{ delay: 0.5 + k * 0.05, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}>{w}</motion.span>
                  </span>
                ))}
              </b>
              {(t.body || t.eta) && (
                <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.62 + words.length * 0.04, duration: 0.45 }}>
                  {t.body}{t.eta && <>{t.body && ' '}<Countdown eta={t.eta} /></>}
                </motion.span>
              )}
            </div>
            <button className="toast-x" onClick={(e) => { e.stopPropagation(); onClose() }} aria-label="Dismiss">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </motion.div>
        </AnimatePresence>
        {t.duration > 0
          ? <i key={`fuse-${t.id}`} className="toast-fuse" style={{ animationDuration: `${t.duration}ms`, animationPlayState: held ? 'paused' : 'running', background: COLOR[t.tone] }} onAnimationEnd={onClose} />
          : t.eta
            ? <i key={`eta-${t.id}`} className="toast-fuse toast-fuse--work toast-fuse--eta" style={{ ['--eta' as string]: `${t.eta.ms}ms`, ['--gone' as string]: `${t.eta.since - Date.now()}ms` }} />
            : <i className="toast-fuse toast-fuse--work" />}
      </motion.div>
      {t.tone === 'ok' && <Confetti key={`c-${t.id}`} />}
    </motion.li>
  )
}

/** "About 42s to go", the number rolling down a second at a time; past the estimate, "any moment now". */
function Countdown({ eta }: { eta: Eta }) {
  const left = () => Math.ceil((eta.since + eta.ms - Date.now()) / 1000)
  const [s, setS] = useState(left)
  useEffect(() => { const id = window.setInterval(() => setS(left()), 250); return () => window.clearInterval(id) })
  if (s <= 0) return <span className="toast-eta">Any moment now…</span>
  return (
    <span className="toast-eta">
      About{' '}
      <span className="toast-eta-n tabnum">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.b key={s} initial={{ y: '-100%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} exit={{ y: '100%', opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>{s}</motion.b>
        </AnimatePresence>
      </span>
      s to go
    </span>
  )
}

/** Eight dots in the agents' colours, thrown out of the glyph as the card opens. */
function Confetti() {
  const bits = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const a = (-150 + i * (300 / 7)) * (Math.PI / 180) - Math.PI / 2
    const d = 46 + Math.random() * 30
    return { x: Math.cos(a) * d * 1.3, y: Math.sin(a) * d, c: AGENTS[i % 4], s: 6 + Math.random() * 5, r: Math.random() * 360 }
  }), [])
  return (
    <span className="toast-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.i key={i} style={{ background: b.c, width: b.s, height: b.s, borderRadius: i % 3 ? '50%' : 3 }}
          initial={{ x: 0, y: 0, scale: 0, rotate: 0 }} animate={{ x: [0, b.x, b.x * 1.1], y: [0, b.y, b.y + 40], scale: [0, 1.2, 0], rotate: b.r }}
          transition={{ delay: 0.36, duration: 1.1, times: [0, 0.4, 1], ease: 'easeOut' }} />
      ))}
    </span>
  )
}

function Glyph({ tone }: { tone: Tone }) {
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay: 0.55, duration: 0.45, ease: [0.165, 0.84, 0.44, 1] as const } }
  const shake = tone === 'error' ? { rotate: [0, -16, 13, -9, 6, 0] } : { rotate: 0 }
  return (
    <motion.span className="toast-glyph" style={{ background: COLOR[tone] }} initial={{ scale: 0.3, rotate: -200 }} animate={{ scale: 1, ...shake }}
      transition={tone === 'error' ? { scale: { type: 'spring', stiffness: 400, damping: 16 }, rotate: { delay: 0.7, duration: 0.6 } } : { type: 'spring', stiffness: 300, damping: 14 }}>
      {tone === 'work'
        ? <span className="toast-orbit">{AGENTS.map((c, i) => <i key={i} style={{ background: c, animationDelay: `${-i * 0.25}s` }} />)}</span>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {tone === 'ok' && <motion.path d="M5 12.5l4.5 4.5L19 7.5" {...draw} />}
            {tone === 'error' && <><motion.path d="M12 6v8" {...draw} /><motion.path d="M12 18.5v.01" {...draw} /></>}
            {tone === 'info' && <><motion.path d="M12 11v7" {...draw} /><motion.path d="M12 6.5v.01" {...draw} /></>}
          </svg>}
    </motion.span>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside IslandProvider')
  return ctx
}
