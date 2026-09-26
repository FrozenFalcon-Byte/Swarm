import { useEffect, useRef } from 'react'

/* Four agent dots that follow your pointer, each chasing the one ahead, so they string out behind it like a
   little swarm. Stop moving and they drift apart and fade; move again and they fall back in line. */

const COLORS = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)']

export function CursorSwarm() {
  const dots = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches || document.documentElement.classList.contains('less-motion')) return
    const target = { x: -100, y: -100 }
    const pos = COLORS.map(() => ({ x: -100, y: -100 }))
    let last = 0, raf = 0, seen = false
    const move = (e: PointerEvent) => { target.x = e.clientX + 14; target.y = e.clientY + 18; last = performance.now(); if (!seen) { seen = true; pos.forEach((p) => { p.x = target.x; p.y = target.y }) } }
    const tick = (now: number) => {
      const idle = now - last > 900
      pos.forEach((p, i) => {
        const lead = i === 0 ? target : pos[i - 1]
        // when you stop, each settles a little off to its own side instead of stacking
        const ox = idle ? Math.cos(i * 1.7 + now / 900) * 10 : 0, oy = idle ? Math.sin(i * 1.7 + now / 900) * 10 : 0
        p.x += (lead.x + ox - p.x) * (i === 0 ? 0.32 : 0.26)
        p.y += (lead.y + oy - p.y) * (i === 0 ? 0.32 : 0.26)
        const el = dots.current[i]
        if (el) { el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${idle ? 0.6 : 1 - i * 0.1})`; el.style.opacity = seen ? (idle ? '0' : '1') : '0' }
      })
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', move, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf) }
  }, [])
  return <>{COLORS.map((c, i) => <i key={i} className="cursor-dot" ref={(el) => { dots.current[i] = el }} style={{ background: c }} aria-hidden="true" />)}</>
}
