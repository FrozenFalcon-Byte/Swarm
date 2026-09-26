import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

/* A side menu and one panel, for pages with several sections (Profile, Settings). Switching sections is
   a "bloom": a wash of the section's own colour spreads out from the tab you clicked, and the new content
   rises through it as it fades. The page itself never changes, so it feels like one surface, not a jump. */

export type PanelItem = { id: string; label: string; hint?: string; color: string; badge?: ReactNode }

/** The open section lives in ?tab=, so it survives a refresh and can be linked to. */
export function usePanel(items: PanelItem[], fallback: string) {
  const [params, setParams] = useSearchParams()
  const want = params.get('tab')
  const active = items.some((i) => i.id === want) ? want! : fallback
  const set = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n }, { replace: true })
  return [active, set] as const
}

export function PanelLayout({ items, active, onPick, side, foot, children }: {
  items: PanelItem[]; active: string; onPick: (id: string) => void; side?: ReactNode; foot?: ReactNode; children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const item = items.find((i) => i.id === active) ?? items[0]
  const nav = useRef<HTMLElement>(null)
  // on phones the tabs scroll sideways: keep the open one in view
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('.pl-tab.on'), box = nav.current
    if (!el || !box || box.scrollWidth <= box.clientWidth) return
    box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  const pick = (id: string, e: MouseEvent<HTMLButtonElement>) => {
    if (id === active) return
    const r = e.currentTarget.getBoundingClientRect()
    const p = panel.current?.getBoundingClientRect()
    if (p) {
      setOrigin({ x: r.left + r.width / 2 - p.left, y: r.top + r.height / 2 - p.top })
      if (p.top < 0) window.scrollTo({ top: window.scrollY + p.top - 24, behavior: 'smooth' })
    }
    onPick(id)
  }

  return (
    <div className="pl">
      <aside className="pl-side">
        {side}
        <nav className="pl-nav" aria-label="Sections" ref={nav}>
          {items.map((i, k) => (
            <motion.button key={i.id} className={`pl-tab ${i.id === active ? 'on' : ''}`} style={{ ['--c' as string]: i.color }} onClick={(e) => pick(i.id, e)}
              aria-current={i.id === active ? 'page' : undefined} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: [0.165, 0.84, 0.44, 1], delay: 0.1 + k * 0.05 }}>
              {i.id === active && <motion.span layoutId="pl-pill" className="pl-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className="pl-dot" />
              <span className="pl-text"><b>{i.label}</b>{i.hint && <small>{i.hint}</small>}</span>
              {i.badge}
            </motion.button>
          ))}
        </nav>
        {foot}
      </aside>
      <div className="pl-panel" ref={panel}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={active} className="bloom" style={{ ['--c' as string]: item.color }} initial="from" animate="to" exit="out">
            <span className="bloom-clip" aria-hidden="true">
              <motion.span className="bloom-ink" style={{ left: origin.x, top: origin.y }}
                variants={{ from: { scale: 0, opacity: 1 }, to: { scale: 1, opacity: 0, transition: { scale: { duration: 0.75, ease: [0.65, 0, 0.35, 1] }, opacity: { duration: 0.55, delay: 0.4 } } }, out: { opacity: 0 } }} />
            </span>
            <motion.div className="bloom-body"
              variants={{ from: { opacity: 0 }, to: { opacity: 1, transition: { duration: 0.25, delay: 0.2 } }, out: { opacity: 0, y: -12, filter: 'blur(6px)', transition: { duration: 0.2 } } }}>
              {children}
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
