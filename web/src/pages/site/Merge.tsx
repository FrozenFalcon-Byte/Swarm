import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/Island'
import { SplitWords } from '../../components/Reveal'
import { SmoothScroll } from '../../components/SmoothScroll'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import './site.css'
import './merge.css'

/* Merge: drop agents into a jar. Two of the same kind touching merge into the next one up, from a bug all the
   way to a shipped release. The jar runs a little verlet physics world in fixed steps and draws to a canvas at
   the screen's own pixel density, so everything stays sharp; React only hears about the score and the chain. */

const INK = '#0f0f0f'
const TIERS = [
  { name: 'Bug', c: '#0f0f0f', r: 15 },
  { name: 'Glitch', c: '#f5b7d0', r: 21 },
  { name: 'Issue', c: '#fbe74e', r: 28 },
  { name: 'Patch', c: '#9dc4f5', r: 36 },
  { name: 'Test', c: '#ff8a7a', r: 45 },
  { name: 'Review', c: '#5dd36a', r: 55 },
  { name: 'Approval', c: '#c9c2f5', r: 66 },
  { name: 'Merge', c: '#ffc58a', r: 78 },
  { name: 'Release', c: '#a8e6cf', r: 92 },
  { name: 'Ship it', c: '#fbe74e', r: 108 },
]
const LAST = TIERS.length - 1
const POINTS = TIERS.map((_, t) => ((t + 1) * (t + 2)) / 2)
const W = 400, H = 600, LINE = 118, DROP_Y = 58, G = 2100, STEP = 1 / 120
const SHAKES = 3

type Ball = { id: number; x: number; y: number; px: number; py: number; r: number; tier: number; a: number; age: number; squash: number; blink: number; dead?: boolean }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }
type Float = { x: number; y: number; t: string; life: number; big: boolean }
type Events = { score: (n: number) => void; queue: (cur: number, next: number, n: number) => void; reach: (t: number) => void; over: (score: number, top: number) => void; danger: (on: boolean) => void }

const roll = () => { const x = Math.random(); return x < 0.3 ? 0 : x < 0.55 ? 1 : x < 0.76 ? 2 : x < 0.91 ? 3 : 4 }

function createGame(ev: Events, start: [number, number]) {
  let balls: Ball[] = [], sparks: Spark[] = [], floats: Float[] = []
  let id = 0, drops = 0, score = 0, top = 0, cur = start[0], next = start[1], cool = 0, danger = 0, over = false, kick = 0, t = 0, warn = false
  let aim = W / 2

  const burst = (x: number, y: number, c: string, n: number, speed: number) => {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8)
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: 1, c: k % 3 === 0 ? INK : c, s: 3 + Math.random() * 4 })
    }
  }
  const merge = (a: Ball, b: Ball) => {
    a.dead = b.dead = true
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2
    const vx = ((a.x - a.px) + (b.x - b.px)) / 2, vy = ((a.y - a.py) + (b.y - b.py)) / 2
    if (a.tier === LAST) {
      score += 200; ev.score(score); kick = 14
      burst(x, y, TIERS[LAST].c, 60, 520); floats.push({ x, y, t: 'Shipped twice! +200', life: 1, big: true })
      return
    }
    const tier = a.tier + 1
    balls.push({ id: id++, x, y, px: x - vx, py: y - vy, r: TIERS[a.tier].r, tier, a: (a.a + b.a) / 2, age: 1, squash: -0.18, blink: 2 + Math.random() * 3 })
    score += POINTS[tier]; ev.score(score)
    burst(x, y, TIERS[tier].c, 10 + tier * 3, 180 + tier * 30)
    kick = Math.max(kick, tier >= 5 ? tier : 0)
    if (tier > top) { top = tier; ev.reach(tier); floats.push({ x, y: y - TIERS[tier].r - 10, t: `${TIERS[tier].name}!`, life: 1, big: true }) }
    else floats.push({ x, y, t: `+${POINTS[tier]}`, life: 1, big: false })
  }

  const step = (dt: number) => {
    t += dt
    cool = Math.max(0, cool - dt)
    for (const b of balls) {
      const vx = (b.x - b.px) * 0.996, vy = (b.y - b.py) * 0.996
      b.px = b.x; b.py = b.y
      b.x += vx; b.y += vy + G * dt * dt
      b.r += (TIERS[b.tier].r - b.r) * 0.18
      b.a += vx / b.r
      b.squash *= 0.9
      b.age += dt
      b.blink -= dt
      if (b.blink < -0.12) b.blink = 2 + Math.random() * 4
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < balls.length; i++) {
        const p = balls[i]
        if (p.dead) continue
        for (let j = i + 1; j < balls.length; j++) {
          const q = balls[j]
          if (q.dead) continue
          const dx = q.x - p.x, dy = q.y - p.y, min = p.r + q.r, d2 = dx * dx + dy * dy
          if (d2 >= min * min || d2 === 0) continue
          if (p.tier === q.tier && !over) { merge(p, q); break }
          const d = Math.sqrt(d2), o = (min - d) / d, mp = p.r * p.r, mq = q.r * q.r, s = mp + mq
          p.x -= dx * o * (mq / s) * 0.9; p.y -= dy * o * (mq / s) * 0.9
          q.x += dx * o * (mp / s) * 0.9; q.y += dy * o * (mp / s) * 0.9
        }
        if (p.dead) continue
        if (p.x < p.r) { const v = p.x - p.px; p.x = p.r; p.px = p.x + v * 0.3 }
        if (p.x > W - p.r) { const v = p.x - p.px; p.x = W - p.r; p.px = p.x + v * 0.3 }
        if (p.y > H - p.r) {
          const v = p.y - p.py
          if (v > 2.5) p.squash = Math.min(0.22, v * 0.03)
          p.y = H - p.r; p.py = p.y + v * 0.25
          p.px = p.x - (p.x - p.px) * 0.94
        }
      }
      if (balls.some((b) => b.dead)) balls = balls.filter((b) => !b.dead)
    }
    // too full? a settled agent above the line for a couple of seconds ends the game
    const high = !over && balls.some((b) => b.age > 1.4 && b.y - b.r < LINE && Math.abs(b.y - b.py) < 1.5)
    danger = high ? danger + dt : Math.max(0, danger - dt * 2)
    if (high !== warn) { warn = high; ev.danger(high) }
    if (danger > 2.4 && !over) {
      over = true
      balls.forEach((b, k) => { b.blink = 99; b.squash = 0.1 + (k % 3) * 0.04 })
      ev.over(score, top)
    }
    for (const s of sparks) { s.vy += 900 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 1.4 }
    sparks = sparks.filter((s) => s.life > 0)
    for (const f of floats) { f.y -= (f.big ? 38 : 60) * dt; f.life -= dt * (f.big ? 0.7 : 1.3) }
    floats = floats.filter((f) => f.life > 0)
    kick *= 0.9
  }

  const face = (g: CanvasRenderingContext2D, b: Ball, px: number) => {
    const { r, tier } = b, dark = tier === 0
    const er = Math.max(3.2, r * 0.19), ex = r * 0.36, ey = -r * 0.1
    // pupils look at the dropper, turned into the ball's own rolled frame
    let lx = aim - b.x, ly = DROP_Y - b.y
    const l = Math.hypot(lx, ly) || 1
    lx /= l; ly /= l
    const ca = Math.cos(-b.a), sa = Math.sin(-b.a), rx = lx * ca - ly * sa, ry = lx * sa + ly * ca
    g.lineWidth = 2.2 * px
    for (const k of [-1, 1]) {
      const cx = k * ex
      if (over) {
        g.strokeStyle = dark ? '#fff' : INK
        const m = er * 0.7
        g.beginPath(); g.moveTo(cx - m, ey - m); g.lineTo(cx + m, ey + m); g.moveTo(cx + m, ey - m); g.lineTo(cx - m, ey + m); g.stroke()
      } else if (b.blink < 0) {
        g.strokeStyle = dark ? '#fff' : INK
        g.beginPath(); g.moveTo(cx - er, ey); g.lineTo(cx + er, ey); g.stroke()
      } else {
        g.fillStyle = '#fff'; g.strokeStyle = INK
        g.beginPath(); g.arc(cx, ey, er, 0, Math.PI * 2); g.fill(); if (!dark) g.stroke()
        g.fillStyle = INK
        g.beginPath(); g.arc(cx + rx * er * 0.42, ey + ry * er * 0.42, er * 0.5, 0, Math.PI * 2); g.fill()
      }
    }
    if (tier >= 3 && !dark) {
      g.fillStyle = 'rgba(255,110,100,0.45)'
      for (const k of [-1, 1]) { g.beginPath(); g.ellipse(k * (ex + er * 0.9), ey + er * 1.5, er * 0.8, er * 0.45, 0, 0, Math.PI * 2); g.fill() }
    }
    g.strokeStyle = dark ? '#fff' : INK
    g.lineWidth = 2.4 * px
    g.lineCap = 'round'
    const my = r * 0.3, mw = r * (0.16 + tier * 0.012)
    g.beginPath()
    if (over || warn) g.arc(0, my, r * 0.08, 0, Math.PI * 2)
    else g.arc(0, my - mw * 0.5, mw, Math.PI * 0.15, Math.PI * 0.85)
    g.stroke()
    if (tier === 5) { // Review wears glasses
      g.strokeStyle = INK; g.lineWidth = 2.6 * px
      for (const k of [-1, 1]) { g.beginPath(); g.arc(k * ex, ey, er * 1.45, 0, Math.PI * 2); g.stroke() }
      g.beginPath(); g.moveTo(-ex + er * 1.45, ey); g.lineTo(ex - er * 1.45, ey); g.stroke()
    }
  }
  const hat = (g: CanvasRenderingContext2D, b: Ball, px: number) => {
    const { r, tier } = b
    g.lineWidth = 2.4 * px; g.strokeStyle = INK; g.lineJoin = 'round'
    if (tier === 0) { // antennae
      for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * r * 0.3, -r * 0.85); g.quadraticCurveTo(k * r * 0.5, -r * 1.4, k * r * 0.75, -r * 1.35); g.stroke() }
    } else if (tier === LAST) { // a crown
      const w = r * 0.55, y0 = -r * 0.9
      g.fillStyle = '#ffd33d'
      g.beginPath(); g.moveTo(-w, y0); g.lineTo(-w * 1.1, y0 - r * 0.42); g.lineTo(-w * 0.45, y0 - r * 0.2); g.lineTo(0, y0 - r * 0.5); g.lineTo(w * 0.45, y0 - r * 0.2); g.lineTo(w * 1.1, y0 - r * 0.42); g.lineTo(w, y0); g.closePath(); g.fill(); g.stroke()
    } else if (tier === 8) { // a party hat
      g.fillStyle = '#f5b7d0'
      g.beginPath(); g.moveTo(-r * 0.32, -r * 0.93); g.lineTo(r * 0.05, -r * 1.55); g.lineTo(r * 0.36, -r * 0.9); g.closePath(); g.fill(); g.stroke()
      g.fillStyle = '#fbe74e'; g.beginPath(); g.arc(r * 0.05, -r * 1.58, r * 0.08, 0, Math.PI * 2); g.fill(); g.stroke()
    } else if (tier === 2 || tier === 6) { // a sprout of hair
      g.beginPath(); g.moveTo(0, -r * 0.98); g.quadraticCurveTo(r * 0.05, -r * 1.3, r * 0.25, -r * 1.32); g.moveTo(0, -r * 0.98); g.quadraticCurveTo(-r * 0.1, -r * 1.25, -r * 0.3, -r * 1.22); g.stroke()
    }
  }

  const draw = (g: CanvasRenderingContext2D, scale: number, dpr: number) => {
    const px = dpr / scale // one css pixel in world units
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, g.canvas.width, g.canvas.height)
    const k = kick > 0.3 ? (Math.random() - 0.5) * kick : 0
    g.setTransform(scale, 0, 0, scale, k * scale * 0.4, k * scale * 0.3)

    // the fill line, dashed; it goes red and pulses when something is sitting over it
    g.save()
    g.setLineDash([8 * px, 8 * px]); g.lineWidth = 2 * px
    g.strokeStyle = warn ? `rgba(255,90,70,${0.55 + 0.45 * Math.sin(t * 12)})` : 'rgba(15,15,15,0.18)'
    g.beginPath(); g.moveTo(0, LINE); g.lineTo(W, LINE); g.stroke()
    g.restore()

    // the dropper: a guide line down and the agent waiting to fall
    if (!over) {
      const r = TIERS[cur].r, x = Math.min(W - r, Math.max(r, aim))
      g.save()
      g.strokeStyle = 'rgba(15,15,15,0.12)'; g.lineWidth = 2 * px; g.setLineDash([2 * px, 7 * px]); g.lineCap = 'round'
      g.beginPath(); g.moveTo(x, DROP_Y + r + 6); g.lineTo(x, H); g.stroke()
      g.restore()
      const ghost: Ball = { id: -1, x, y: DROP_Y, px: x, py: DROP_Y, r: r * (cool > 0 ? 1 - cool * 1.2 : 1), tier: cur, a: Math.sin(t * 2) * 0.12, age: 0, squash: 0, blink: 1 }
      if (ghost.r > 2) body(g, ghost, px, true)
    }
    for (const b of balls) { // hard sticker shadows first, so none sits over another agent
      g.fillStyle = INK
      g.beginPath(); g.ellipse(b.x + 3 * px, b.y + 4 * px, b.r * (1 + b.squash), b.r * (1 - b.squash), 0, 0, Math.PI * 2); g.fill()
    }
    for (const b of balls) body(g, b, px, false)
    for (const s of sparks) {
      g.globalAlpha = Math.max(0, s.life); g.fillStyle = s.c
      g.beginPath(); g.arc(s.x, s.y, s.s * s.life, 0, Math.PI * 2); g.fill()
    }
    g.globalAlpha = 1
    g.textAlign = 'center'; g.textBaseline = 'middle'
    for (const f of floats) {
      g.globalAlpha = Math.min(1, f.life * 2)
      g.font = `800 ${f.big ? 26 : 17}px ${font}`
      g.lineWidth = 5 * px; g.strokeStyle = '#fff'; g.lineJoin = 'round'
      g.strokeText(f.t, f.x, f.y); g.fillStyle = INK; g.fillText(f.t, f.x, f.y)
    }
    g.globalAlpha = 1
  }
  const body = (g: CanvasRenderingContext2D, b: Ball, px: number, ghost: boolean) => {
    g.save()
    g.translate(b.x, b.y + b.r * b.squash)
    g.scale(1 + b.squash, 1 - b.squash)
    g.rotate(b.a)
    hat(g, b, px)
    g.fillStyle = TIERS[b.tier].c; g.strokeStyle = INK; g.lineWidth = 2.6 * px
    g.beginPath(); g.arc(0, 0, b.r, 0, Math.PI * 2); g.fill(); g.stroke()
    if (b.tier === LAST) { // a little star on the belly
      g.fillStyle = '#fff'; g.beginPath()
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? b.r * 0.08 : b.r * 0.18; g.lineTo(Math.cos(a) * rr, b.r * 0.62 + Math.sin(a) * rr) }
      g.closePath(); g.fill(); g.lineWidth = 2 * px; g.stroke()
    }
    face(g, ghost ? { ...b, blink: 1 } : b, px)
    g.restore()
  }
  let font = 'system-ui, sans-serif'

  return {
    setFont(f: string) { font = f },
    aimAt(x: number) { aim = Math.min(W, Math.max(0, x)) },
    nudge(dx: number) { aim = Math.min(W - TIERS[cur].r, Math.max(TIERS[cur].r, aim + dx)) },
    drop() {
      if (over || cool > 0) return false
      const r = TIERS[cur].r, x = Math.min(W - r, Math.max(r, aim)) + (Math.random() - 0.5) * 0.01
      balls.push({ id: id++, x, y: DROP_Y, px: x, py: DROP_Y - 1, r, tier: cur, a: 0, age: 0, squash: 0, blink: 1 + Math.random() * 3 })
      cur = next; next = roll(); cool = 0.42
      ev.queue(cur, next, ++drops)
      return true
    },
    shake() {
      if (over) return
      for (const b of balls) { b.py = b.y + 9 + Math.random() * 7; b.px = b.x + (Math.random() - 0.5) * 12; b.squash = -0.12 }
      kick = 10
    },
    step, draw,
    reset() {
      balls = []; sparks = []; floats = []; score = 0; top = 0; cur = roll(); next = roll(); cool = 0; danger = 0; over = false; warn = false
      ev.score(0); ev.queue(cur, next, ++drops); ev.danger(false)
    },
  }
}

/** A little agent as SVG, for the chain and the next-up preview. */
function Blob({ tier, size = 40, hidden = false }: { tier: number; size?: number; hidden?: boolean }) {
  const { c } = TIERS[tier], dark = tier === 0
  return (
    <svg viewBox="-26 -30 52 56" width={size} height={size} aria-hidden="true" className="mg-blob">
      {hidden ? (
        <><circle r="21" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 5" opacity="0.35" />
          <text y="7" textAnchor="middle" fontSize="20" fontWeight="800" fill="currentColor" opacity="0.35">?</text></>
      ) : (
        <>
          {tier === 0 && <path d="M-6 -18Q-9 -26 -13 -26M6 -18Q9 -26 13 -26" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />}
          {tier === LAST && <path d="M-12 -18L-13 -28L-5 -22L0 -30L5 -22L13 -28L12 -18Z" fill="#ffd33d" stroke={INK} strokeWidth="2" strokeLinejoin="round" />}
          <circle cx="2" cy="3" r="21" fill={INK} />
          <circle r="21" fill={c} stroke={INK} strokeWidth="2.5" />
          {[-7.5, 7.5].map((x) => <g key={x}><circle cx={x} cy="-2" r="4.2" fill="#fff" stroke={dark ? 'none' : INK} strokeWidth="1.5" /><circle cx={x} cy="-1.5" r="2.1" fill={INK} /></g>)}
          <path d="M-4 6Q0 10 4 6" fill="none" stroke={dark ? '#fff' : INK} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

const bestKey = 'swarm.merge.best'
const readBest = () => { try { return Number(localStorage.getItem(bestKey)) || 0 } catch { return 0 } }

export default function Merge() {
  const toast = useToast()
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const game = useRef<ReturnType<typeof createGame> | null>(null)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(readBest)
  const [queue, setQueue] = useState<[number, number, number]>(() => [roll(), roll(), 0])
  const first = useRef(queue)
  const [reached, setReached] = useState(0)
  const [ever, setEver] = useState(() => { try { return Number(localStorage.getItem('swarm.merge.top')) || 0 } catch { return 0 } })
  const [over, setOver] = useState<{ score: number; top: number; record: boolean } | null>(null)
  const [danger, setDanger] = useState(false)
  const [shakes, setShakes] = useState(SHAKES)

  useEffect(() => {
    const g = createGame({
      score: setScore,
      queue: (a, b, n) => setQueue([a, b, n]),
      reach: (t) => {
        setReached(t)
        setEver((e) => { if (t > e) { try { localStorage.setItem('swarm.merge.top', String(t)) } catch { /* private window */ } } return Math.max(e, t) })
      },
      danger: setDanger,
      over: (s, top) => {
        const prev = readBest(), record = s > prev
        if (record) { try { localStorage.setItem(bestKey, String(s)) } catch { /* private window */ } setBest(s) }
        window.setTimeout(() => setOver({ score: s, top, record }), 700)
      },
    }, [first.current[0], first.current[1]])
    game.current = g
    g.setFont(getComputedStyle(document.body).fontFamily)

    const cv = canvas.current!, ctx = cv.getContext('2d')!
    let scale = 1, dpr = 1
    const size = () => {
      dpr = Math.min(3, window.devicePixelRatio || 1)
      const w = cv.clientWidth
      cv.width = Math.round(w * dpr); cv.height = Math.round(w * (H / W) * dpr)
      scale = cv.width / W
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(cv)
    let raf = 0, last = performance.now(), acc = 0
    const loop = (now: number) => {
      acc = Math.min(acc + (now - last) / 1000, 0.1)
      last = now
      while (acc >= STEP) { g.step(STEP); acc -= STEP }
      g.draw(ctx, scale, dpr)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  // keyboard: arrows to aim, space or enter to drop
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest?.('input, textarea, button, a, [contenteditable]')) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); game.current?.nudge(e.key === 'ArrowLeft' ? -16 : 16) }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); game.current?.drop() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const aim = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    game.current?.aimAt(((e.clientX - r.left) / r.width) * W)
  }
  const again = () => { game.current?.reset(); setOver(null); setReached(0); setShakes(SHAKES) }
  const shake = () => { if (!shakes || over) return; game.current?.shake(); setShakes((n) => n - 1) }
  const share = async () => {
    const text = `I merged my way to ${TIERS[over?.top ?? reached].name} with ${over?.score ?? score} points in Swarm's jar. ${window.location.origin}/merge`
    try { await navigator.clipboard.writeText(text); toast.ok('Copied', 'Paste it wherever you brag.') }
    catch { toast.info('Couldn’t copy', text) }
  }

  const known = Math.max(ever, reached)

  return (
    <div className="landing site mg-page">
      <SmoothScroll />
      <Nav />
      <header className="site-hero mg-hero">
        <p className="surtitle"><span style={{ background: 'var(--reviewer)' }} />Merge</p>
        <SplitWords as="h1" text="Merge until it ships." className="site-title" />
        <motion.p className="site-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
          Drop agents in the jar. Two of a kind merge into the next one up, a bug into a glitch, a patch into a test, all the way to a release. Keep the pile under the line.
        </motion.p>
      </header>

      <section className="mg-arena">
        <motion.aside className="mg-side mg-left" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5, duration: 0.7, ease: easeOut }}>
          <div className="mg-card mg-score">
            <span className="mg-k">Score</span>
            <motion.b key={score} initial={{ scale: 1.25 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>{score}</motion.b>
            <span className="mg-best">Best {Math.max(best, score)}</span>
          </div>
          <div className="mg-card mg-next">
            <span className="mg-k">Next</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={queue[2]} className="mg-next-blob" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                <Blob tier={queue[1]} size={54} />
              </motion.span>
            </AnimatePresence>
            <span className="mg-next-name">{TIERS[queue[1]].name}</span>
          </div>
          <motion.button className="mg-card mg-shake" onClick={shake} disabled={!shakes || !!over} whileTap={{ rotate: [0, -6, 6, -4, 0], scale: 0.95 }}>
            <span>Shake the jar</span>
            <span className="mg-pips">{Array.from({ length: SHAKES }, (_, i) => <i key={i} className={i < shakes ? 'on' : ''} />)}</span>
          </motion.button>
        </motion.aside>

        <motion.div ref={wrap} className={`mg-jar ${danger ? 'is-danger' : ''}`} initial={{ opacity: 0, y: 30, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.4, type: 'spring', stiffness: 80, damping: 15 }}
          onPointerMove={aim} onPointerDown={(e) => { aim(e); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not capturable */ } }}
          onPointerUp={(e) => { aim(e); game.current?.drop() }}>
          <canvas ref={canvas} className="mg-canvas" aria-label="The jar. Move to aim, click or tap to drop." />
          <AnimatePresence>
            {danger && !over && <motion.p className="mg-warn" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>Over the line!</motion.p>}
          </AnimatePresence>
          <AnimatePresence>
            {over && (
              <motion.div className="mg-over" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
                <motion.div className="mg-over-card" initial={{ y: 40, scale: 0.9, rotate: -3 }} animate={{ y: 0, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
                  <span className="mg-k">The jar is full</span>
                  <Blob tier={over.top} size={84} />
                  <b className="mg-over-score">{over.score}</b>
                  <p>{over.record ? 'A new best!' : `You got as far as ${TIERS[over.top].name}.`}</p>
                  <div className="mg-over-acts">
                    <button className="mg-btn mg-btn--dark" onClick={again}>Play again</button>
                    <button className="mg-btn" onClick={share}>Share</button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.aside className="mg-side mg-right" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55, duration: 0.7, ease: easeOut }}>
          <div className="mg-card mg-chain">
            <span className="mg-k">The chain</span>
            <ol>
              {TIERS.map((t, i) => {
                const seen = i <= Math.max(known, 4)
                return (
                  <li key={t.name} className={`${i <= reached ? 'got' : ''} ${i === reached && i > 0 ? 'now' : ''}`}>
                    <motion.span key={seen ? 'seen' : 'hidden'} initial={seen && i > 4 ? { scale: 0, rotate: -90 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
                      <Blob tier={i} size={30} hidden={!seen} />
                    </motion.span>
                    <span>{seen ? t.name : '???'}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <p className="mg-help">Move to aim, click or tap to drop. <kbd>←</kbd> <kbd>→</kbd> and <kbd>Space</kbd> work too.</p>
        </motion.aside>
      </section>
      <Footer />
    </div>
  )
}
