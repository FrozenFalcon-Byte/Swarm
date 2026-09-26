import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

/* Our own dropdown, instead of the browser's: a pill that opens a small card of options under it.
   Arrow keys move, Enter picks, Escape closes, and a long list (time zones) gets a search box. */

export type Option<T extends string> = { value: T; label: string; hint?: string; dot?: string }

export function Select<T extends string>({ value, options, onChange, label, disabled, searchable, align = 'left', className = '' }: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; disabled?: boolean; searchable?: boolean; align?: 'left' | 'right'; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // the card sits on the page itself, so no panel with hidden overflow can clip it; below the button, or above when there's no room
  const [place, setPlace] = useState<{ style: CSSProperties; up: boolean }>({ style: {}, up: false })
  useLayoutEffect(() => {
    if (!open || !box.current) return
    const r = box.current.getBoundingClientRect()
    const up = window.innerHeight - r.bottom < 360 && r.top > window.innerHeight - r.bottom
    const style: CSSProperties = { position: 'fixed', minWidth: Math.max(r.width, 240), ...(up ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }),
      ...(align === 'right' ? { right: window.innerWidth - r.right } : { left: r.left }) }
    setPlace({ style, up })
  }, [open, align])
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const current = options.find((o) => o.value === value)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/\s+/g, '_')
    return t ? options.filter((o) => o.label.toLowerCase().replace(/\s+/g, '_').includes(t) || o.value.toLowerCase().includes(t)) : options
  }, [options, q])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false) }
    const scrolled = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', away)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', scrolled)
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', scrolled) }
  }, [open])
  // open on the current choice, scrolled into view
  useEffect(() => {
    if (!open) return
    setQ('')
    setAt(Math.max(0, options.findIndex((o) => o.value === value)))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // scroll the list only; scrollIntoView would move the page too
    const ul = list.current, el = ul?.children[at] as HTMLElement | undefined
    if (!ul || !el) return
    if (el.offsetTop < ul.scrollTop) ul.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = el.offsetTop + el.offsetHeight - ul.clientHeight
  }, [at, open, shown])

  const pick = (v: T) => { setOpen(false); if (v !== value) onChange(v) }
  const key = (e: KeyboardEvent) => {
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true) } return }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(shown.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) pick(shown[at].value) }
  }

  return (
    <div className={`sel ${open ? 'open' : ''} ${className}`} ref={box} onKeyDown={key}>
      <button type="button" className="sel-btn" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label}>
        {current?.dot && <i className="sel-dot" style={{ background: current.dot }} />}
        <span>{current?.label ?? value}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div ref={pop} className="sel-pop" initial={{ opacity: 0, y: place.up ? 6 : -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: place.up ? 6 : -6, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }} style={{ ...place.style, originY: place.up ? 1 : 0, originX: align === 'right' ? 1 : 0 }}>
            {searchable && (
              <input className="sel-search" ref={(el) => el?.focus({ preventScroll: true })} value={q} onChange={(e) => { setQ(e.target.value); setAt(0) }} placeholder="Search…" aria-label={`Search ${label}`} spellCheck={false} />
            )}
            <ul role="listbox" id={id} ref={list} aria-label={label} data-lenis-prevent>
              {shown.map((o, i) => (
                <li key={o.value} role="option" aria-selected={o.value === value} className={`${i === at ? 'at' : ''} ${o.value === value ? 'on' : ''}`}
                  onPointerEnter={() => setAt(i)} onClick={() => pick(o.value)}>
                  {o.dot && <i className="sel-dot" style={{ background: o.dot }} />}
                  <span>{o.label}{o.hint && <small>{o.hint}</small>}</span>
                  {o.value === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
                </li>
              ))}
              {shown.length === 0 && <li className="sel-none">Nothing matches.</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
