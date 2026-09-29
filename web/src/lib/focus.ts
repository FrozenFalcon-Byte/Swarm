/* Hover focus for the few actions that matter most, handled once from the document like lib/buttons.ts.
   Opt in with data-focus and keep it rare. Pointing at (or tabbing to) one lifts it onto a bigger hard
   ink shadow while everything around it, up to the nearest data-focus-scope (or its grandparent), softens
   and blurs a touch, so that one button is the thing in focus.
   It runs on the Web Animations API, so it never touches an element's own transition or transform and
   hands every property back exactly as it was when the focus moves on. */

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('less-motion')
const hoverable = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches

const EASE = 'cubic-bezier(0.165, 0.84, 0.44, 1)'
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

// One map per effect, so an element's soften and lift never reverse each other.
const softened = new Map<Element, Animation>()
const raised = new Map<Element, Animation>()
let lit: HTMLElement | null = null
let clearTimer = 0

const focusOf = (t: EventTarget | null) =>
  t instanceof Element ? t.closest<HTMLElement>('[data-focus]:not([disabled]):not([aria-disabled="true"])') : null

/** Everything in the scope that isn't on the path down to the button. */
function around(el: HTMLElement) {
  const scope = el.closest<HTMLElement>('[data-focus-scope]') ?? el.parentElement?.parentElement ?? null
  const out: HTMLElement[] = []
  if (!scope) return out
  for (let a: HTMLElement = el; a !== scope && a.parentElement; a = a.parentElement) {
    for (const s of a.parentElement.children) if (s !== a && s instanceof HTMLElement && s.getClientRects().length) out.push(s)
    if (a.parentElement === scope) break
  }
  return out
}

/** Play an effect forward (on) or back (off); a reversed one lets go of the element when it lands. */
function play(anims: Map<Element, Animation>, el: Element, on: boolean, make: () => Animation) {
  let a = anims.get(el)
  if (!a) {
    if (!on) return
    a = make()
    const mine = a
    mine.onfinish = () => { if (mine.playbackRate < 0) { mine.cancel(); if (anims.get(el) === mine) anims.delete(el) } }
    anims.set(el, a)
  } else if ((a.playbackRate > 0) !== on) a.reverse()
}

function soften(el: HTMLElement, on: boolean) {
  play(softened, el, on, () => el.animate([{ filter: 'blur(1.6px) saturate(0.85)', opacity: 0.5 }], { duration: calm() ? 1 : 420, easing: EASE, fill: 'forwards' }))
}

function raise(el: HTMLElement, on: boolean) {
  play(raised, el, on, () => {
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#0f0f0f'
    return el.animate([{ translate: '-2px -2px', boxShadow: `6px 6px 0 ${ink}` }], { duration: calm() ? 1 : 480, easing: SPRING, fill: 'forwards' })
  })
}

function focusOn(next: HTMLElement | null) {
  clearTimeout(clearTimer)
  if (next === lit) return
  for (const m of [softened, raised]) for (const el of m.keys()) if (!el.isConnected) m.delete(el)
  if (lit) { raise(lit, false); for (const s of around(lit)) soften(s, false) }
  lit = next
  if (!next) return
  raise(next, true)
  for (const s of around(next)) soften(s, true)
}

/** Brushing past the edge shouldn't flash everything back, so letting go waits a beat. */
function letGo() {
  clearTimeout(clearTimer)
  clearTimer = window.setTimeout(() => focusOn(null), 90)
}

export function installFocus() {
  if (typeof document === 'undefined') return
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !hoverable()) return
    const next = focusOf(e.target)
    if (next) focusOn(next)
    else if (lit) letGo()
  }, { passive: true })
  document.documentElement.addEventListener('pointerleave', () => { if (lit) letGo() }, { passive: true })
  // A press moves on (to a new page, or a busy button), so let the room come back.
  document.addEventListener('pointerdown', () => { if (lit) focusOn(null) }, { passive: true })
  document.addEventListener('focusin', (e) => {
    const next = focusOf(e.target)
    if (next && next.matches(':focus-visible')) focusOn(next)
  })
  document.addEventListener('focusout', () => { if (lit) letGo() })
}
