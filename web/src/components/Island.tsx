import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/*
 * Notifications that behave like the iPhone's Dynamic Island: a small black pill drops in at the top,
 * springs open to show the message, then folds back into a pill and slips away. A new message while
 * one is showing morphs the open island to the new content instead of stacking.
 */

type Tone = 'ok' | 'error' | 'info' | 'work'
export interface Toast { id: number; tone: Tone; title: string; body?: string; duration: number }
type Push = (t: { tone?: Tone; title: string; body?: string; duration?: number }) => number
interface ToastApi { push: Push; ok(title: string, body?: string): number; error(title: string, body?: string): number; info(title: string, body?: string): number; work(title: string, body?: string): number; dismiss(id?: number): void }

const Ctx = createContext<ToastApi | null>(null)
const spring = { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 } as const

export function IslandProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [phase, setPhase] = useState<'pill' | 'open' | 'fold'>('pill')
  const timers = useRef<number[]>([])
  const paused = useRef(false)
  const seq = useRef(0)
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))

  const current = useRef<Toast | null>(null)

  const close = useCallback(() => {
    clear()
    setPhase('fold')
    later(260, () => { current.current = null; setToast(null) })
  }, [])

  const schedule = useCallback((t: Toast) => {
    clear()
    if (t.duration > 0) later(t.duration, function tick() { if (paused.current) later(600, tick); else close() })
  }, [close])

  const push = useCallback<Push>(({ tone = 'info', title, body, duration }) => {
    const t: Toast = { id: ++seq.current, tone, title, body, duration: duration ?? (tone === 'work' ? 0 : tone === 'error' ? 5200 : 3200) }
    const wasShowing = !!current.current
    current.current = t
    setToast(t)
    schedule(t)
    if (wasShowing) setPhase('open') // already there: morph to the new message
    else { setPhase('pill'); later(170, () => setPhase('open')) } // drop in as a pill, then open
    return t.id
  }, [schedule])

  const api: ToastApi = {
    push,
    ok: (title, body) => push({ tone: 'ok', title, body }),
    error: (title, body) => push({ tone: 'error', title, body }),
    info: (title, body) => push({ tone: 'info', title, body }),
    work: (title, body) => push({ tone: 'work', title, body }),
    dismiss: (id) => { if (current.current && (id === undefined || current.current.id === id)) close() },
  }
  useEffect(() => () => clear(), [])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="island-wrap" aria-live="polite" aria-atomic="true">
        <AnimatePresence>
          {toast && (
            <motion.div key="island" className={`island island--${toast.tone}`} layout transition={spring}
              initial={{ opacity: 0, y: -22, scale: 0.5 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -18, scale: 0.55, transition: { duration: 0.28, ease: [0.65, 0, 0.35, 1] } }}
              style={{ borderRadius: 999 }}
              onMouseEnter={() => { paused.current = true }} onMouseLeave={() => { paused.current = false }}
              onClick={() => close()} role="status">
              {phase === 'open' ? (
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div key={toast.id} className="island-body" layout="position"
                    initial={{ opacity: 0, filter: 'blur(6px)', y: 6 }} animate={{ opacity: 1, filter: 'blur(0px)', y: 0, transition: { delay: 0.08, duration: 0.3 } }}
                    exit={{ opacity: 0, filter: 'blur(6px)', y: -6, transition: { duration: 0.15 } }}>
                    <Glyph tone={toast.tone} />
                    <div className="island-text"><b>{toast.title}</b>{toast.body && <span>{toast.body}</span>}</div>
                    {toast.tone === 'work' ? <span className="island-wave" aria-hidden="true"><i /><i /><i /><i /></span> : null}
                  </motion.div>
                </AnimatePresence>
              ) : (
                <motion.div key="pill" className="island-pill" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <span className="island-cam" />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}

function Glyph({ tone }: { tone: Tone }) {
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay: 0.18, duration: 0.45, ease: [0.165, 0.84, 0.44, 1] as const } }
  return (
    <motion.span className={`island-glyph g-${tone}`} initial={{ scale: 0.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...spring, delay: 0.05 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {tone === 'ok' && <motion.path d="M5 12.5l4.5 4.5L19 7.5" {...draw} />}
        {tone === 'error' && <><motion.path d="M12 6v8" {...draw} /><motion.path d="M12 18.5v.01" {...draw} /></>}
        {tone === 'info' && <><motion.path d="M12 11v7" {...draw} /><motion.path d="M12 6.5v.01" {...draw} /></>}
        {tone === 'work' && <motion.circle cx="12" cy="12" r="7" strokeDasharray="30 14" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }} style={{ originX: '50%', originY: '50%' }} />}
      </svg>
    </motion.span>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside IslandProvider')
  return ctx
}
