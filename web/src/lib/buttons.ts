/* Every .btn on the site, handled once from the document (index.css draws it):
   · the hover fill grows as a circle from where the pointer came in (--mx / --my)
   · the button leans a few pixels toward the pointer while it's over it (--tx / --ty)
   · a press sends a ripple out from the exact spot you pressed */

const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')
const btnOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.btn') : null)

function place(b: HTMLElement, e: PointerEvent) {
  const r = b.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  b.style.setProperty('--mx', `${x}px`)
  b.style.setProperty('--my', `${y}px`)
  return { r, x, y }
}

export function installButtons() {
  if (typeof document === 'undefined') return
  document.addEventListener('pointerover', (e) => {
    const b = btnOf(e.target)
    if (b && !b.contains(e.relatedTarget as Node | null)) place(b, e)
  }, { passive: true })
  document.addEventListener('pointermove', (e) => {
    const b = btnOf(e.target)
    if (!b || !fine() || calm()) return
    const { r, x, y } = place(b, e)
    b.style.setProperty('--tx', `${((x / r.width) - 0.5) * 5}px`)
    b.style.setProperty('--ty', `${((y / r.height) - 0.5) * 4}px`)
  }, { passive: true })
  document.addEventListener('pointerout', (e) => {
    const b = btnOf(e.target)
    if (!b || b.contains(e.relatedTarget as Node | null)) return
    place(b, e) // the fill drains back out the way you left
    b.style.removeProperty('--tx')
    b.style.removeProperty('--ty')
  }, { passive: true })
  document.addEventListener('pointerdown', (e) => {
    const b = btnOf(e.target)
    if (!b || calm() || b.matches('[disabled], [aria-disabled="true"]')) return
    const { r, x, y } = place(b, e)
    const ring = document.createElement('span')
    ring.className = 'btn-ripple'
    const d = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) * 2
    Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, width: `${d}px`, height: `${d}px` })
    b.appendChild(ring)
    ring.addEventListener('animationend', () => ring.remove(), { once: true })
  }, { passive: true })
}
