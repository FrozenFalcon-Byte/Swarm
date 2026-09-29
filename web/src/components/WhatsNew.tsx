import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { RELEASES, type ChangeAgent } from '../changelog'
import { useBooted } from '../lib/boot'

/*
 * What's new, shown once per release after a deploy. One continuous piece driven by a single clock `t` (0 to 1):
 * the card unfolds out of a dot, the heading slides in, then a baton runs down a rail and each change lights up
 * as the baton reaches it, the baton taking on that change's colour. Only transform and opacity move.
 */

const SEEN_KEY = 'swarm:seen-release'
const HEX: Record<ChangeAgent, string> = { triager: '#fbe74e', coder: '#9dc4f5', tester: '#ff8a7a', reviewer: '#5dd36a' }
const RUN = [0.3, 0.88] // the stretch of the clock the baton spends on the rail

const seen = () => { try { return localStorage.getItem(SEEN_KEY) } catch { return RELEASES[0]?.id } }
const markSeen = (id: string) => { try { localStorage.setItem(SEEN_KEY, id) } catch { /* shows again next time */ } }
const at = (i: number, n: number) => RUN[0] + ((i + 0.5) / n) * (RUN[1] - RUN[0])

export function WhatsNew() {
  const booted = useBooted()
  const release = RELEASES[0]
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!booted || !release || seen() === release.id) return
    const id = window.setTimeout(() => setOpen(true), 700)
    return () => window.clearTimeout(id)
  }, [booted, release])
  const close = () => { if (release) markSeen(release.id); setOpen(false) }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!release) return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="wn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} onClick={close}>
          <Card release={release} onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>, document.body)
}

function Card({ release, onClose }: { release: (typeof RELEASES)[number]; onClose: () => void }) {
  const reduced = useReducedMotion()
  const t = useMotionValue(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) return
    const run = animate(t, 1, { duration: 3.4, ease: 'linear' })
    return () => run.stop()
  }, [t, reduced])
  const n = release.items.length

  // the card unfolds out of a dot: wide first, then tall, eased so it reads as one motion
  const sx = useTransform(t, [0, 0.1, 0.2], [0.06, 1, 1], { ease: [ease, ease] })
  const sy = useTransform(t, [0, 0.08, 0.22], [0.06, 0.06, 1], { ease: [ease, ease] })
  const radius = useTransform(t, [0, 0.14], [60, 26])
  const head = useTransform(t, [0.14, 0.28], [0, 1], { ease: ease })
  const headY = useTransform(head, (v) => (1 - v) * 14)
  // the baton runs the whole rail at an even pace, easing only in and out, and changes colour at each stop
  const runP = useTransform(t, [at(0, n), Math.max(at(n - 1, n), at(0, n) + 0.001)], [0, 1], { ease: ease })
  const batonY = useTransform(runP, (v) => `${((0.5 + v * (n - 1)) / n) * 100}%`)
  const rail = useTransform(runP, (v) => (0.5 + v * (n - 1)) / n)
  const batonO = useTransform(t, [at(0, n) - 0.06, at(0, n), at(n - 1, n) + 0.04, at(n - 1, n) + 0.1], [0, 1, 1, 0])
  const batonC = useTransform(t, release.items.map((_, i) => at(i, n)), release.items.map((c) => HEX[c.agent]))
  const foot = useTransform(t, [0.86, 1], [0, 1])
  const footY = useTransform(foot, (v) => (1 - v) * 10)

  return (
    <motion.div className="wn-card" role="dialog" aria-modal="true" aria-labelledby="wn-title" onClick={(e) => e.stopPropagation()}
      style={{ scaleX: sx, scaleY: sy, borderRadius: radius }} exit={{ scale: 0.94, opacity: 0, transition: { duration: 0.22 } }}>
      <motion.header className="wn-head" style={{ opacity: head, y: headY }}>
        <span className="wn-tag">Just shipped · {release.date}</span>
        <h2 id="wn-title">What’s new</h2>
      </motion.header>
      <div className="wn-list" style={{ '--n': n } as CSSProperties}>
        <span className="wn-rail" aria-hidden="true"><motion.i style={{ scaleY: rail }} /></span>
        <motion.span className="wn-baton-track" style={{ y: batonY }} aria-hidden="true">
          <motion.i className="wn-baton" style={{ opacity: batonO, background: batonC }} />
        </motion.span>
        {release.items.map((c, i) => <Item key={i} t={t} when={at(i, n)} agent={c.agent} text={c.text} />)}
      </div>
      <motion.footer className="wn-foot" style={{ opacity: foot, y: footY }}>
        <button className="btn btn-dark btn-sm" onClick={onClose} autoFocus>Nice, got it</button>
      </motion.footer>
    </motion.div>
  )
}

function Item({ t, when, agent, text }: { t: MotionValue<number>; when: number; agent: ChangeAgent; text: string }) {
  const dot = useTransform(t, [when - 0.02, when + 0.02, when + 0.06], [0, 1.35, 1])
  const show = useTransform(t, [when - 0.03, when + 0.07], [0, 1], { ease: ease })
  const x = useTransform(show, (v) => (1 - v) * -16)
  return (
    <div className="wn-item">
      <motion.i className="wn-dot" style={{ scale: dot, background: HEX[agent] }} aria-hidden="true" />
      <motion.span style={{ opacity: show, x }}>{text}</motion.span>
    </div>
  )
}

function ease(v: number) { return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2 }
