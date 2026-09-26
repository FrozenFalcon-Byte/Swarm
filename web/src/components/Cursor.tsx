import { useEffect, useRef } from 'react'

/*
 * Swarm's own pointer: a chunky sticker arrow, white with an ink outline, sitting on a hard ink shadow.
 * The tip is always exactly where the mouse is; the rest has a little weight to it. It leans into the
 * direction you move and its shadow trails behind, like a sticker being slid across the page.
 *   · over anything you can click, it fills with your highlight colour and grows a touch
 *   · over a text field it becomes an ink caret
 *   · over a sticker you can throw, it tips back, ready to grab
 *   · pressing squashes it, and every click throws a few ink sparks
 * Only on devices with a real mouse; touch screens keep what they have. Settings → Appearance turns it off.
 */

const CLICKABLE = 'a, button, [role=button], [role=radio], [role=tab], [role=option], [role=link], label, select, summary, .rp-row, .toast-card'
const TEXT = 'input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]):not([type=file]), textarea, [contenteditable=""], [contenteditable=true]'
const GRAB = '.idc-sticker'

export function Cursor({ off = false }: { off?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const lean = useRef<HTMLDivElement>(null)
  const shade = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const html = document.documentElement
    if (off || !window.matchMedia('(pointer: fine)').matches) { html.classList.remove('sw-cursor-on'); return }
    const el = root.current!
    let x = -100, y = -100, vx = 0, vy = 0, px = -100, py = -100, tilt = 0, sx = 2.5, sy = 2.5, raf = 0, shown = false
    const calm = () => html.classList.contains('less-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const setState = (t: EventTarget | null) => {
      const e = t instanceof Element ? t : null
      const state = !e ? 'arrow' : e.closest(TEXT) ? 'text' : e.closest(GRAB) ? 'grab' : e.closest(CLICKABLE) && !e.closest(':disabled, [aria-disabled=true]') ? 'hover' : 'arrow'
      if (el.dataset.state !== state) el.dataset.state = state
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') { el.style.opacity = '0'; return }
      x = e.clientX; y = e.clientY
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      if (!shown) { shown = true; px = x; py = y; html.classList.add('sw-cursor-on') }
      el.style.opacity = '1'
    }
    const over = (e: PointerEvent) => setState(e.target)
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      el.dataset.down = '1'
      if (!calm()) spark(e.clientX, e.clientY)
    }
    const up = () => { delete el.dataset.down }
    const leave = (e: MouseEvent) => { if (!e.relatedTarget) el.style.opacity = '0' }

    const tick = () => {
      // velocity, smoothed, drives the lean and how far the shadow trails
      vx += (x - px - vx) * 0.25; vy += (y - py - vy) * 0.25
      px = x; py = y
      const still = calm()
      const targetTilt = still ? 0 : Math.max(-16, Math.min(16, vx * 0.9))
      tilt += (targetTilt - tilt) * 0.18
      const tsx = still ? 2.5 : 2.5 - Math.max(-6, Math.min(6, vx * 0.35)), tsy = still ? 2.5 : 2.5 - Math.max(-6, Math.min(6, vy * 0.35))
      sx += (tsx - sx) * 0.2; sy += (tsy - sy) * 0.2
      if (lean.current) lean.current.style.rotate = `${tilt.toFixed(2)}deg`
      if (shade.current) shade.current.style.translate = `${sx.toFixed(2)}px ${sy.toFixed(2)}px`
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    document.addEventListener('mouseout', leave)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up)
      document.removeEventListener('mouseout', leave)
      cancelAnimationFrame(raf)
      html.classList.remove('sw-cursor-on')
    }
  }, [off])

  if (off) return null
  return (
    <div ref={root} className="sw-cursor" data-state="arrow" aria-hidden="true">
      <div ref={lean} className="sw-cursor-lean">
        <div className="sw-cursor-body">
          <svg ref={shade} className="sw-cursor-shade" width="28" height="28" viewBox="0 0 24 24"><path d={ARROW} /></svg>
          <svg className="sw-cursor-arrow" width="28" height="28" viewBox="0 0 24 24"><path d={ARROW} /></svg>
        </div>
      </div>
      <span className="sw-cursor-caret" />
    </div>
  )
}

// a rounded, slightly chubby pointer; its tip is at (4.4, 2.4)
const ARROW = 'M4.3 2.9 L4.7 19.3 Q4.8 20.5 5.7 19.8 L9.3 16.5 L12.1 22 Q12.5 22.8 13.3 22.4 L15.3 21.4 Q16 21 15.7 20.3 L12.9 14.9 L17.9 14.6 Q19.1 14.5 18.3 13.7 L5.9 2.3 Q4.3 1 4.3 2.9 Z'

/** A few short ink strokes flung out from the click, like a cartoon "pop". */
function spark(x: number, y: number) {
  const box = document.createElement('div')
  box.className = 'sw-spark'
  box.style.left = `${x}px`; box.style.top = `${y}px`
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('i')
    const a = i * 60 + (Math.random() * 20 - 10)
    s.style.rotate = `${a}deg`
    box.appendChild(s)
    s.animate([{ transform: 'translateY(-6px) scaleY(0.4)', opacity: 1 }, { transform: 'translateY(-17px) scaleY(1)', opacity: 1, offset: 0.45 }, { transform: 'translateY(-22px) scaleY(0.2)', opacity: 0 }],
      { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' })
  }
  document.body.appendChild(box)
  window.setTimeout(() => box.remove(), 460)
}
