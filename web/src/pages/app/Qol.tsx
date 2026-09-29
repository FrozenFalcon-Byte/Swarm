import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { easeOut } from '../../lib/motion'

/* The small things that make the dashboard nicer to live in: keyboard shortcuts (and a sheet that lists
   them), the pages you visited last, the tab's title, a note when the connection drops, a way back to the
   top of a long page, and a nudge when a newer Swarm has been deployed. */

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.('[role=dialog]'))
}

/** "g" then a letter jumps to a page, the way a lot of dashboards do it. */
export const JUMPS: { key: string; to: string; label: string }[] = [
  { key: 'o', to: '/app', label: 'Overview' },
  { key: 'r', to: '/app/repos', label: 'Repositories' },
  { key: 'a', to: '/app/agents', label: 'Agents' },
  { key: 't', to: '/app/tools', label: 'Tools' },
  { key: 'h', to: '/app/rules', label: 'House rules' },
  { key: 'q', to: '/app/quiet-hours', label: 'Quiet hours' },
  { key: 'f', to: '/app/fun', label: 'Just for fun' },
  { key: 's', to: '/app/settings', label: 'Settings' },
  { key: 'p', to: '/app/profile', label: 'Your profile' },
]

export function useShortcuts({ openSearch, toggleRail, toggleSheet }: { openSearch: () => void; toggleRail: () => void; toggleSheet: () => void }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const timer = useRef(0)
  const latest = useRef({ openSearch, toggleRail, toggleSheet })
  useEffect(() => { latest.current = { openSearch, toggleRail, toggleSheet } })
  useEffect(() => {
    let armed = false
    const disarm = () => { armed = false; setPending(false); window.clearTimeout(timer.current) }
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return
      const k = e.key.toLowerCase()
      if (armed) {
        const jump = JUMPS.find((j) => j.key === k)
        disarm()
        if (jump) { e.preventDefault(); navigate(jump.to) }
        return
      }
      if (e.key === '?') { e.preventDefault(); latest.current.toggleSheet() }
      else if (e.key === '/') { e.preventDefault(); latest.current.openSearch() }
      else if (e.key === '[') { e.preventDefault(); latest.current.toggleRail() }
      else if (k === 'g') { armed = true; setPending(true); timer.current = window.setTimeout(disarm, 1200) }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); window.clearTimeout(timer.current) }
  }, [navigate])
  return pending
}

/** A small chip while "g" waits for its letter. */
export function GoChip({ on }: { on: boolean }) {
  return createPortal(
    <AnimatePresence>
      {on && (
        <motion.div className="qol-go" initial={{ opacity: 0, y: 16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 520, damping: 30 }}>
          <kbd>g</kbd><span>then</span>
          {JUMPS.slice(0, 6).map((j) => <span key={j.key} className="qol-go-opt"><kbd>{j.key}</kbd>{j.label}</span>)}
          <span className="qol-go-more">? for all</span>
        </motion.div>
      )}
    </AnimatePresence>, document.body)
}

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: 'Anywhere', rows: [[['⌘', 'K'], 'Search or jump to anything'], [['/'], 'Search'], [['['], 'Fold or unfold the sidebar'], [['?'], 'This sheet']] },
  { title: 'Go to', rows: JUMPS.map((j) => [['g', j.key], j.label] as [string[], string]) },
  { title: 'In the search', rows: [[['↑', '↓'], 'Move'], [['↵'], 'Open'], [['esc'], 'Close']] },
]

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim kbar-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div key="sheet" className="qol-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <header className="qol-sheet-head">
              <h2>Keyboard shortcuts</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </header>
            <div className="qol-sheet-cols">
              {GROUPS.map((g, gi) => (
                <section key={g.title}>
                  <p className="kbar-group">{g.title}</p>
                  {g.rows.map(([keys, what], i) => (
                    <motion.div key={what} className="qol-row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: easeOut, delay: 0.05 + gi * 0.06 + i * 0.025 }}>
                      <span>{what}</span>
                      <span className="qol-keys">{keys.map((k, j) => <span key={j}>{j > 0 && keys[0] === 'g' && <i>then</i>}<kbd>{k}</kbd></span>)}</span>
                    </motion.div>
                  ))}
                </section>
              ))}
            </div>
            <p className="qol-sheet-foot">Shortcuts wait while you're typing in a box.</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>, document.body)
}

/* --- the pages you visited last, for the search's empty state */
const RECENT = 'swarm:recent'
export interface Visit { to: string; label: string }
export function readRecent(): Visit[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.to === 'string' && typeof x.label === 'string') : [] } catch { return [] }
}
export function useRecordVisit(to: string, label: string) {
  useEffect(() => {
    if (!label) return
    const list = [{ to, label }, ...readRecent().filter((v) => v.to !== to)].slice(0, 6)
    try { localStorage.setItem(RECENT, JSON.stringify(list)) } catch { /* private window: this visit only */ }
  }, [to, label])
}

/** The tab says where you are, and how many things wait for you. */
export function useTabTitle(label: string, waiting: number) {
  useEffect(() => {
    document.title = `${waiting > 0 ? `(${waiting}) ` : ''}${label ? `${label} · ` : ''}Swarm`
  }, [label, waiting])
  useEffect(() => () => { document.title = 'Swarm' }, [])
}

/* --- online / offline */
const subscribeNet = (f: () => void) => { window.addEventListener('online', f); window.addEventListener('offline', f); return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f) } }
export function NetPill() {
  const online = useSyncExternalStore(subscribeNet, () => navigator.onLine, () => true)
  const [back, setBack] = useState(false)
  const was = useRef(online)
  useEffect(() => {
    if (online && !was.current) { setBack(true); const id = window.setTimeout(() => setBack(false), 2600); was.current = online; return () => window.clearTimeout(id) }
    was.current = online
  }, [online])
  const show = !online || back
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div className={`qol-net ${online ? 'is-back' : ''}`} role="status" layout
          initial={{ opacity: 0, y: -30, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 460, damping: 30 }}>
          <span className="qol-net-dot" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={online ? 'on' : 'off'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {online ? 'Back online · all caught up' : "You're offline · changes sync when you're back"}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>, document.body)
}

/** Back to the top of a long page, with a ring that fills as you scroll. */
export function BackToTop() {
  const [p, setP] = useState(0)
  const [show, setShow] = useState(false)
  useEffect(() => {
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        setShow(window.scrollY > Math.max(700, window.innerHeight * 1.2))
        setP(max > 0 ? Math.min(1, window.scrollY / max) : 0)
      })
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [])
  const R = 19, C = 2 * Math.PI * R
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.button className="qol-top" aria-label="Back to top" data-tip="Back to top"
          initial={{ opacity: 0, scale: 0.6, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.6, y: 20 }}
          transition={{ type: 'spring', stiffness: 480, damping: 28 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.92 }}
          onClick={() => window.scrollTo({ top: 0, behavior: document.documentElement.classList.contains('less-motion') ? 'auto' : 'smooth' })}>
          <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="3" />
            <circle cx="24" cy="24" r={R} fill="none" stroke="var(--accent, var(--green))" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 24 24)" />
            <path d="M24 31V17M18 23l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>, document.body)
}

/* --- a newer Swarm is out: the page's own script is no longer the one the server hands out */
const ownScript = () => [...document.scripts].map((s) => s.src).find((s) => /\/assets\/index-[\w-]+\.js$/.test(s))?.split('/assets/')[1]
export function NewVersion() {
  const [fresh, setFresh] = useState(false)
  const [later, setLater] = useState(false)
  useEffect(() => {
    const mine = ownScript()
    if (!mine) return // the dev server: nothing to compare
    let done = false
    const check = async () => {
      if (done || document.hidden || !navigator.onLine) return
      try {
        const html = await (await fetch('/index.html', { cache: 'no-store' })).text()
        const theirs = html.match(/\/assets\/(index-[\w-]+\.js)/)?.[1]
        if (theirs && theirs !== mine) { done = true; setFresh(true) }
      } catch { /* offline or asleep: try later */ }
    }
    const id = window.setInterval(check, 5 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check) }
  }, [])
  return createPortal(
    <AnimatePresence>
      {fresh && !later && (
        <motion.div className="qol-fresh" role="status" initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
          <motion.span className="qol-fresh-spark" animate={{ rotate: [0, 18, -12, 0], scale: [1, 1.15, 1] }} transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.4 }} aria-hidden="true">✦</motion.span>
          <span><b>A newer Swarm is out.</b> Reload to get it.</span>
          <button className="btn btn-dark btn-sm" onClick={() => window.location.reload()}>Reload</button>
          <button className="qol-fresh-x" onClick={() => setLater(true)} aria-label="Later">Later</button>
        </motion.div>
      )}
    </AnimatePresence>, document.body)
}
