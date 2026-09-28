import { AnimatePresence, LayoutGroup, motion, useAnimationControls } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { useToast } from '../../components/Island'
import { SplitWords } from '../../components/Reveal'
import { SmoothScroll } from '../../components/SmoothScroll'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import './site.css'
import './jam.css'
import './maker.css'

/* Agent maker: build a little agent of your own, part by part. The body morphs between shapes, the eyes follow
   your pointer, it blinks, and a poke makes it jump and say something. Download it as a picture (a profile
   picture, a sticker) or copy a link that builds the same one. Colours are plain hex so the download matches. */

const INK = '#0f0f0f'
const SPRING = { type: 'spring', stiffness: 260, damping: 20 } as const

type Shape = { id: string; label: string; w: number; h: number; r: [number, number, number, number] }
const SHAPES: Shape[] = [
  { id: 'dome', label: 'Dome', w: 200, h: 236, r: [100, 100, 24, 24] },
  { id: 'round', label: 'Round', w: 214, h: 214, r: [107, 107, 107, 107] },
  { id: 'capsule', label: 'Capsule', w: 162, h: 262, r: [81, 81, 81, 81] },
  { id: 'box', label: 'Box', w: 234, h: 196, r: [42, 42, 42, 42] },
  { id: 'bean', label: 'Bean', w: 222, h: 230, r: [111, 70, 96, 46] },
  { id: 'tall', label: 'Tower', w: 150, h: 272, r: [36, 36, 36, 36] },
]
const COLOURS = ['#fbe74e', '#9dc4f5', '#ff8a7a', '#5dd36a', '#f5b7d0', '#c9c2f5', '#ffc58a', '#ffffff']
const PATTERNS = ['Plain', 'Spots', 'Stripes', 'Belly'] as const
const BACKDROPS = ['#e2f2e5', '#e3eefc', '#fdf6c4', '#ffe3df', '#ece9fb', '#1d1d1d']
const EYES = ['Dots', 'Big', 'Sleepy', 'Cyclops', 'Specs', 'Happy'] as const
const MOUTHS = ['Smile', 'Grin', 'Oh', 'Cat', 'Flat', 'Tongue'] as const
const TOPS = ['None', 'Antenna', 'Propeller', 'Beanie', 'Crown', 'Sprout', 'Party hat', 'Headphones'] as const
const HOLDS = ['Nothing', 'Laptop', 'Magnifier', 'Mug', 'Wrench', 'Balloon', 'LGTM flag'] as const
const EXTRAS = ['None', 'Blush', 'Freckles', 'Moustache', 'Plaster', 'Scarf'] as const
const ROLES = [['Triager', '#fbe74e'], ['Coder', '#9dc4f5'], ['Tester', '#ff8a7a'], ['Reviewer', '#5dd36a']] as const
const NAMES = ['Pixel', 'Bramble', 'Nimbus', 'Widget', 'Pickle', 'Sprocket', 'Mochi', 'Tofu', 'Biscuit', 'Gizmo', 'Noodle', 'Pebble', 'Clementine', 'Waffle', 'Dumpling', 'Juniper']
const LINES = ['Hi! I fixed a test today.', 'Did you run it 24 times?', 'LGTM!', 'Beep boop, patch ready.', 'I read the logs so you don’t have to.', 'Green builds, good vibes.', 'Is it Friday yet?', 'Poke me again, I dare you.', 'I only nap between runs.', 'Ship it!']

type Look = { shape: number; colour: number; pattern: number; backdrop: number; eyes: number; mouth: number; top: number; hold: number; extra: number; role: number }
const KEYS: (keyof Look)[] = ['shape', 'colour', 'pattern', 'backdrop', 'eyes', 'mouth', 'top', 'hold', 'extra', 'role']
const SIZES: Record<keyof Look, number> = { shape: SHAPES.length, colour: COLOURS.length, pattern: PATTERNS.length, backdrop: BACKDROPS.length, eyes: EYES.length, mouth: MOUTHS.length, top: TOPS.length, hold: HOLDS.length, extra: EXTRAS.length, role: ROLES.length }
const START: Look = { shape: 0, colour: 1, pattern: 0, backdrop: 0, eyes: 0, mouth: 0, top: 1, hold: 1, extra: 1, role: 1 }
const pick = (n: number) => Math.floor(Math.random() * n)
const random = (): Look => Object.fromEntries(KEYS.map((k) => [k, k === 'backdrop' ? pick(SIZES[k] - 1) : pick(SIZES[k])])) as Look

/* ---------- the body: every shape is the same eight curves, so one can morph smoothly into another */
function body({ w, h, r: [a, b, c, d] }: Shape) {
  const k = 0.5523, x0 = -w / 2, x1 = w / 2, y0 = -h, y1 = 0
  const line = (p: number[], q: number[]) => `C${p[0] + (q[0] - p[0]) / 3} ${p[1] + (q[1] - p[1]) / 3} ${p[0] + (2 * (q[0] - p[0])) / 3} ${p[1] + (2 * (q[1] - p[1])) / 3} ${q[0]} ${q[1]}`
  return [
    `M${x0 + a} ${y0}`, line([x0 + a, y0], [x1 - b, y0]),
    `C${x1 - b + b * k} ${y0} ${x1} ${y0 + b - b * k} ${x1} ${y0 + b}`, line([x1, y0 + b], [x1, y1 - c]),
    `C${x1} ${y1 - c + c * k} ${x1 - c + c * k} ${y1} ${x1 - c} ${y1}`, line([x1 - c, y1], [x0 + d, y1]),
    `C${x0 + d - d * k} ${y1} ${x0} ${y1 - d + d * k} ${x0} ${y1 - d}`, line([x0, y1 - d], [x0, y0 + a]),
    `C${x0} ${y0 + a - a * k} ${x0 + a - a * k} ${y0} ${x0 + a} ${y0}Z`,
  ].join('')
}

/** A group that springs to its place on the big stage and simply sits there in the little previews. */
function At({ x = 0, y = 0, mini, children, className }: { x?: number; y?: number; mini?: boolean; children: ReactNode; className?: string }) {
  if (mini) return <g transform={`translate(${x} ${y})`} className={className}>{children}</g>
  return <motion.g className={className} initial={false} animate={{ x, y }} transition={SPRING}>{children}</motion.g>
}
/** The body outline: morphs on the big stage, drawn plainly in the previews. Kept outside Agent so it isn't remounted. */
function BodyPath({ d, mini, ...rest }: { d: string; mini?: boolean } & SVGProps<SVGPathElement>) {
  if (mini) return <path d={d} {...rest} />
  const { fill, stroke, strokeWidth, strokeLinejoin } = rest
  return <motion.path fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} initial={false} animate={{ d }} transition={SPRING} />
}

function NameTag({ name, role }: { name: string; role: number }) {
  const shown = name || 'Nameless', w = (shown.length + ROLES[role][0].length) * 9 + 64
  return (
    <g transform="translate(0 44)">
      <rect x={-w / 2} y="-17" width={w} height="34" rx="17" fill="#fff" stroke={INK} strokeWidth="3" />
      <circle cx={-w / 2 + 20} cy="0" r="7" fill={ROLES[role][1]} stroke={INK} strokeWidth="2.5" />
      <text x={-w / 2 + 34} y="5.5" fontFamily="system-ui, -apple-system, Segoe UI, sans-serif" fontSize="16" fill={INK}>
        <tspan fontWeight="700">{shown}</tspan><tspan fill="#6b6f6b"> · {ROLES[role][0]}</tspan>
      </text>
    </g>
  )
}

/** A part that pops in when it changes on the big stage. */
function Pop({ id, mini, children }: { id: string; mini?: boolean; children: ReactNode }) {
  if (mini) return <g>{children}</g>
  return (
    <AnimatePresence initial={false}>
      <motion.g key={id} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 420, damping: 16 }}>{children}</motion.g>
    </AnimatePresence>
  )
}

function Agent({ look, eye = [0, 0], blink = false, mini = false, id = 'a' }: { look: Look; eye?: [number, number]; blink?: boolean; mini?: boolean; id?: string }) {
  const s = SHAPES[look.shape], { w, h } = s, fill = COLOURS[look.colour], d = body(s)
  const sep = Math.min(34, w * 0.19), faceY = -h * 0.6
  const [lx, ly] = eye
  const clip = `${id}-clip`
  const pattern = PATTERNS[look.pattern]
  const eyes = EYES[look.eyes]

  const eyeball = (x: number, r: number, pr: number, shine = false) => (
    <g key={x}>
      <circle cx={x} cy={0} r={r} fill="#fff" stroke={INK} strokeWidth="3" />
      <circle cx={x + lx * (r - pr - 2)} cy={ly * (r - pr - 2)} r={pr} fill={INK} />
      {shine && <circle cx={x + lx * (r - pr - 2) - pr * 0.35} cy={ly * (r - pr - 2) - pr * 0.35} r={pr * 0.32} fill="#fff" />}
    </g>
  )
  const eyesArt = eyes === 'Happy' ? (
    <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round">{[-sep, sep].map((x) => <path key={x} d={`M${x - 11} 4Q${x} -10 ${x + 11} 4`} />)}</g>
  ) : eyes === 'Cyclops' ? eyeball(0, 23, 10, true)
    : eyes === 'Big' ? <>{eyeball(-sep, 17, 9, true)}{eyeball(sep, 17, 9, true)}</>
      : <>{eyeball(-sep, eyes === 'Specs' ? 11 : 13, 6)}{eyeball(sep, eyes === 'Specs' ? 11 : 13, 6)}</>

  const mouth = { Smile: <path d="M-14 0Q0 14 14 0" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />,
    Grin: <path d="M-18 -3Q0 26 18 -3Z" fill="#fff" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />,
    Oh: <ellipse cx="0" cy="4" rx="9" ry="11" fill={INK} />,
    Cat: <path d="M-15 0Q-7.5 9 0 0Q7.5 9 15 0" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />,
    Flat: <path d="M-12 4H12" stroke={INK} strokeWidth="4" strokeLinecap="round" />,
    Tongue: <g><path d="M-18 -3Q0 26 18 -3Z" fill={INK} /><ellipse cx="3" cy="9" rx="8" ry="6" fill="#ff8a7a" /></g> }[MOUTHS[look.mouth]]

  const top = TOPS[look.top]
  const hat = {
    None: null,
    Antenna: <g className="mk-sway"><path d="M0 2V-44" stroke={INK} strokeWidth="4" strokeLinecap="round" /><circle cy="-52" r="10" fill="#ff8a7a" stroke={INK} strokeWidth="3" /></g>,
    Propeller: <g><path d="M-22 3A22 22 0 0 1 22 3Z" fill="#9dc4f5" stroke={INK} strokeWidth="3" /><path d="M0 -19V-34" stroke={INK} strokeWidth="4" />
      <g className="mk-spin"><ellipse cy="-36" rx="36" ry="6" fill="#fbe74e" stroke={INK} strokeWidth="3" /></g><circle cy="-36" r="4" fill={INK} /></g>,
    Beanie: <g><path d="M-58 8C-58 -64 58 -64 58 8Z" fill="#ff8a7a" stroke={INK} strokeWidth="3" /><rect x="-63" y="-6" width="126" height="20" rx="10" fill="#fff" stroke={INK} strokeWidth="3" /><circle cy="-58" r="12" fill="#fbe74e" stroke={INK} strokeWidth="3" /></g>,
    Crown: <g><path d="M-40 6L-45 -38L-20 -16L0 -48L20 -16L45 -38L40 6Z" fill="#fbe74e" stroke={INK} strokeWidth="3" strokeLinejoin="round" /><circle cx="0" cy="-10" r="5" fill="#ff8a7a" stroke={INK} strokeWidth="2" /><circle cx="-24" cy="-6" r="4" fill="#9dc4f5" stroke={INK} strokeWidth="2" /><circle cx="24" cy="-6" r="4" fill="#5dd36a" stroke={INK} strokeWidth="2" /></g>,
    Sprout: <g className="mk-sway"><path d="M0 2Q3 -20 0 -36" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" /><ellipse cx="-14" cy="-38" rx="15" ry="8" transform="rotate(-25 -14 -38)" fill="#5dd36a" stroke={INK} strokeWidth="3" /><ellipse cx="14" cy="-44" rx="15" ry="8" transform="rotate(25 14 -44)" fill="#5dd36a" stroke={INK} strokeWidth="3" /></g>,
    'Party hat': <g transform="rotate(-14)"><path d="M-28 6L0 -72L28 6Z" fill="#f5b7d0" stroke={INK} strokeWidth="3" strokeLinejoin="round" /><path d="M-18 -22L14 -12M-10 -46L8 -40" stroke="#fff" strokeWidth="5" strokeLinecap="round" /><circle cy="-76" r="9" fill="#fbe74e" stroke={INK} strokeWidth="3" /></g>,
    Headphones: <g><path d={`M${-w / 2 + 8} ${h * 0.4}C${-w / 2 + 4} -48 ${w / 2 - 4} -48 ${w / 2 - 8} ${h * 0.4}`} fill="none" stroke={INK} strokeWidth="12" strokeLinecap="round" />
      <path d={`M${-w / 2 + 8} ${h * 0.4}C${-w / 2 + 4} -48 ${w / 2 - 4} -48 ${w / 2 - 8} ${h * 0.4}`} fill="none" stroke="#c9c2f5" strokeWidth="5" strokeLinecap="round" />
      {[-1, 1].map((k) => <rect key={k} x={k * (w / 2) - 13} y={h * 0.4 - 26} width="26" height="50" rx="11" fill="#c9c2f5" stroke={INK} strokeWidth="3" />)}</g>,
  }[top]

  const hold = HOLDS[look.hold]
  const item = {
    Nothing: null,
    Laptop: <g><rect x="-2" y="-44" width="52" height="36" rx="5" fill="#9dc4f5" stroke={INK} strokeWidth="3" /><path d="M6 -34h18M6 -26h30M6 -18h12" stroke={INK} strokeWidth="3" strokeLinecap="round" /><path d="M-8 -8H56L50 2H-2Z" fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" /></g>,
    Magnifier: <g><path d="M4 -10L-10 6" stroke={INK} strokeWidth="7" strokeLinecap="round" /><circle cx="16" cy="-24" r="17" fill="#e3eefc" stroke={INK} strokeWidth="4" /><path d="M8 -30a9 9 0 0 1 8 -4" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" /></g>,
    Mug: <g><path d="M26 -20a9 9 0 0 1 0 16" fill="none" stroke={INK} strokeWidth="4" /><rect x="-2" y="-30" width="30" height="32" rx="6" fill="#fff" stroke={INK} strokeWidth="3" /><path d="M4 -30h18" stroke="#ffc58a" strokeWidth="4" />
      <g className="mk-steam" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.6"><path d="M6 -38q-4 -6 0 -12t0 -12" /><path d="M18 -38q-4 -6 0 -12t0 -12" /></g></g>,
    Wrench: <g transform="rotate(-30)"><rect x="-4" y="-50" width="10" height="52" rx="5" fill="#d4d4d4" stroke={INK} strokeWidth="3" /><path d="M-13 -52a12 12 0 1 1 24 0l-6 -2v-9h-12v9z" fill="#d4d4d4" stroke={INK} strokeWidth="3" strokeLinejoin="round" /></g>,
    Balloon: <g className="mk-float"><path d={`M0 0Q-18 ${-h * 0.3} 14 ${-h * 0.6}`} fill="none" stroke={INK} strokeWidth="2" /><ellipse cx="18" cy={-h * 0.6 - 32} rx="27" ry="33" fill="#ff8a7a" stroke={INK} strokeWidth="3" /><path d={`M12 ${-h * 0.6 + 1}l6 -4l6 4z`} fill="#ff8a7a" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" /><path d={`M6 ${-h * 0.6 - 48}q4 -8 12 -8`} stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" /></g>,
    'LGTM flag': <g><path d="M0 4V-78" stroke={INK} strokeWidth="4" strokeLinecap="round" /><path d="M0 -78H58L50 -62L58 -46H0Z" fill="#5dd36a" stroke={INK} strokeWidth="3" strokeLinejoin="round" /><text x="25" y="-57" textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontWeight="800" fontSize="13" fill={INK}>LGTM</text></g>,
  }[hold]
  const extra = EXTRAS[look.extra]

  return (
    <g>
      {!mini && <rect x="-240" y="-390" width="480" height="480" fill={BACKDROPS[look.backdrop]} />}
      {!mini && <g opacity={look.backdrop === BACKDROPS.length - 1 ? 0.14 : 0.1}>{Array.from({ length: 11 }, (_, i) => Array.from({ length: 11 }, (_, j) => <circle key={`${i}-${j}`} cx={-210 + i * 42} cy={-360 + j * 42} r="2.2" fill={look.backdrop === BACKDROPS.length - 1 ? '#fff' : INK} />))}</g>}
      <At mini={mini} className="mk-shadow-g"><ellipse cx="0" cy="3" rx={w / 2 + 12} ry="10" fill={INK} opacity="0.13" /></At>
      <g className={mini ? undefined : 'mk-breathe'}>
        {/* arms: a nub each side; the right one lifts when it's holding something */}
        <At mini={mini} x={-w / 2 + 4} y={-h * 0.28}><ellipse rx="13" ry="20" transform="rotate(22)" fill={fill} stroke={INK} strokeWidth="3" /></At>
        <At mini={mini} x={w / 2 - 4} y={item ? -h * 0.36 : -h * 0.28}><ellipse rx="13" ry="20" transform={item ? 'rotate(-55)' : 'rotate(-22)'} fill={fill} stroke={INK} strokeWidth="3" /></At>
        <BodyPath mini={mini} d={d} fill={fill} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <clipPath id={clip}><BodyPath mini={mini} d={d} /></clipPath>
        <g clipPath={`url(#${clip})`}>
          {pattern === 'Spots' && [[-0.28, -0.3, 16], [0.22, -0.55, 11], [0.3, -0.18, 20], [-0.12, -0.82, 9], [-0.36, -0.62, 8]].map(([x, y, r], k) => <circle key={k} cx={x * w} cy={y * h} r={r} fill="#fff" opacity="0.45" />)}
          {pattern === 'Stripes' && [0.2, 0.4].map((y) => <rect key={y} x={-w} y={-h * y - 10} width={w * 2} height="16" fill={INK} opacity="0.12" />)}
          {pattern === 'Belly' && <ellipse cx="0" cy="0" rx={w * 0.34} ry={h * 0.34} fill="#fff" opacity="0.5" />}
          {extra === 'Scarf' && <rect x={-w} y={-h * 0.3} width={w * 2} height="24" fill="#ff8a7a" stroke={INK} strokeWidth="3" />}
        </g>
        {extra === 'Scarf' && <At mini={mini} x={w * 0.18} y={-h * 0.3 + 18}><path d="M-10 0L-14 44H6L8 0Z" fill="#ff8a7a" stroke={INK} strokeWidth="3" strokeLinejoin="round" /></At>}

        <At mini={mini} y={faceY}>
          <g className={blink && eyes !== 'Happy' ? 'mk-eyes is-blink' : 'mk-eyes'}>{eyesArt}</g>
          {eyes === 'Sleepy' && [-sep, sep].map((x) => <path key={x} d={`M${x - 14.5} 1A14.5 14.5 0 0 1 ${x + 14.5} 1Z`} fill={fill} stroke={INK} strokeWidth="3" />)}
          {eyes === 'Specs' && <g fill="none" stroke={INK} strokeWidth="4"><circle cx={-sep} r="18" /><circle cx={sep} r="18" /><path d={`M${-sep + 18} -2Q0 -10 ${sep - 18} -2`} /></g>}
          {extra === 'Blush' && [-1, 1].map((k) => <ellipse key={k} cx={k * (sep + 14)} cy="22" rx="11" ry="6" fill="#ff8a7a" opacity="0.6" />)}
          {extra === 'Freckles' && [-1, 1].map((k) => <g key={k} fill={INK} opacity="0.55">{[[0, 0], [7, 5], [-6, 6]].map(([x, y], j) => <circle key={j} cx={k * (sep + 10) + x} cy={20 + y} r="2" />)}</g>)}
          <g transform="translate(0 34)">
            <Pop id={MOUTHS[look.mouth]} mini={mini}>{mouth}</Pop>
            {extra === 'Moustache' && <path d="M0 -8C-6 -16 -22 -16 -26 -4C-18 -8 -8 -6 0 -2C8 -6 18 -8 26 -4C22 -16 6 -16 0 -8Z" fill={INK} />}
          </g>
          {extra === 'Plaster' && <g transform={`translate(${sep + 20} -34) rotate(35)`}><rect x="-16" y="-6" width="32" height="12" rx="6" fill="#ffc58a" stroke={INK} strokeWidth="2.5" /><path d="M-3 -3v6M3 -3v6" stroke={INK} strokeWidth="1.5" /></g>}
        </At>

        <At mini={mini} y={-h}><Pop id={top} mini={mini}>{hat}</Pop></At>
        {item && <At mini={mini} x={w / 2 + 14} y={-h * 0.42}><Pop id={hold} mini={mini}>{item}</Pop></At>}
      </g>
    </g>
  )
}

/* ---------- the page */
type Tab = 'shape' | 'colour' | 'eyes' | 'mouth' | 'top' | 'hold' | 'extra'
const TABS: [Tab, string][] = [['shape', 'Shape'], ['colour', 'Colour'], ['eyes', 'Eyes'], ['mouth', 'Mouth'], ['top', 'On top'], ['hold', 'Holding'], ['extra', 'Extras']]
const LABELS: Record<Exclude<Tab, 'colour'>, readonly string[]> = { shape: SHAPES.map((s) => s.label), eyes: EYES, mouth: MOUTHS, top: TOPS, hold: HOLDS, extra: EXTRAS }

function fromHash(): { look: Look; name: string } | null {
  const m = window.location.hash.match(/^#a=([\d.]+)(?:~(.*))?$/)
  if (!m) return null
  const xs = m[1].split('.').map(Number)
  if (xs.length !== KEYS.length || xs.some((x, i) => !(x >= 0 && x < SIZES[KEYS[i]]))) return null
  return { look: Object.fromEntries(KEYS.map((k, i) => [k, xs[i]])) as Look, name: decodeURIComponent(m[2] ?? '').slice(0, 18) }
}

export default function Maker() {
  const toast = useToast()
  const [first] = useState(fromHash)
  const [look, setLook] = useState<Look>(first?.look ?? START)
  const [name, setName] = useState(first?.name || 'Pixel')
  const [tab, setTab] = useState<Tab>('shape')
  const [eye, setEye] = useState<[number, number]>([0, 0])
  const [blink, setBlink] = useState(false)
  const [line, setLine] = useState<{ t: string; k: number } | null>(null)
  const [spinning, setSpinning] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const jump = useAnimationControls()

  // the eyes follow the pointer anywhere on the page
  useEffect(() => {
    const on = (e: PointerEvent) => {
      const r = svg.current?.getBoundingClientRect()
      if (!r) return
      const fx = r.left + r.width / 2, fy = r.top + r.height * ((380 - SHAPES[look.shape].h * 0.6) / 460)
      const dx = e.clientX - fx, dy = e.clientY - fy, dist = Math.max(1, Math.hypot(dx, dy)), k = Math.min(1, dist / 260)
      setEye([(dx / dist) * k, (dy / dist) * k])
    }
    window.addEventListener('pointermove', on)
    return () => window.removeEventListener('pointermove', on)
  }, [look.shape])
  // and it blinks now and then
  useEffect(() => {
    let t = 0
    const loop = () => { t = window.setTimeout(() => { setBlink(true); window.setTimeout(() => setBlink(false), 130); loop() }, 2200 + Math.random() * 2600) }
    loop()
    return () => window.clearTimeout(t)
  }, [])
  useEffect(() => { if (!line) return; const t = window.setTimeout(() => setLine(null), 2200); return () => window.clearTimeout(t) }, [line])

  const set = (k: keyof Look, v: number) => setLook((l) => ({ ...l, [k]: v }))
  const poke = () => {
    void jump.start({ y: [0, -46, 0, -10, 0], scaleY: [1, 0.86, 1.08, 0.96, 1], transition: { duration: 0.7, times: [0, 0.35, 0.6, 0.8, 1], ease: 'easeOut' } })
    setLine((l) => { let t = LINES[pick(LINES.length)]; while (l && t === l.t) t = LINES[pick(LINES.length)]; return { t, k: (l?.k ?? 0) + 1 } })
  }
  const surprise = () => {
    if (spinning) return
    setSpinning(true)
    let n = 0
    const spin = () => {
      setLook(random())
      if (++n < 9) window.setTimeout(spin, 60 + n * 14)
      else { setName(NAMES[pick(NAMES.length)]); setSpinning(false); poke() }
    }
    spin()
  }
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#a=${KEYS.map((k) => look[k]).join('.')}~${encodeURIComponent(name)}`
    window.history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url); toast.ok('Link copied', `Whoever opens it meets ${name || 'your agent'}.`) }
    catch { toast.info('Couldn’t copy', 'The link is in the address bar now.') }
  }
  const download = async () => {
    const node = svg.current?.cloneNode(true) as SVGSVGElement | undefined
    if (!node) return
    node.setAttribute('width', '1024'); node.setAttribute('height', '1024'); node.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(node))}`
    try {
      await img.decode()
      const c = document.createElement('canvas'); c.width = c.height = 1024
      c.getContext('2d')!.drawImage(img, 0, 0, 1024, 1024)
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
      if (!blob) throw new Error('no image')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${(name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`; a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      toast.ok(`${name || 'Your agent'} saved`, 'A 1024px picture, ready to be a profile photo.')
    } catch { toast.info('Couldn’t save the picture', 'Your browser blocked drawing it. Try another browser.') }
  }

  const options = tab === 'colour' ? [] : LABELS[tab]

  return (
    <div className="landing site mk-page">
      <SmoothScroll />
      <Nav />
      <header className="site-hero mk-hero">
        <p className="surtitle"><span style={{ background: 'var(--coder)' }} />Agent maker</p>
        <SplitWords as="h1" text="Make your own agent." className="site-title" />
        <motion.p className="site-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
          Pick a shape, a face and something to hold. Give it a name, poke it to say hello, and take it home as a picture.
        </motion.p>
      </header>

      <section className="mk-bench">
        <motion.div className="mk-stage" initial={{ opacity: 0, y: 24, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.45, type: 'spring', stiffness: 90, damping: 16 }}>
          <svg ref={svg} viewBox="-230 -380 460 460" className="mk-svg" role="img" aria-label={`${name}, your agent`}>
            <motion.g animate={jump} style={{ originX: 0.5, originY: 1 }} onClick={poke} className="mk-poke">
              <Agent look={look} eye={eye} blink={blink} id="stage" />
            </motion.g>
            <NameTag name={name} role={look.role} />
          </svg>
          <AnimatePresence>
            {line && (
              <motion.p key={line.k} className="mk-bubble" initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.9 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}>
                {line.t}
              </motion.p>
            )}
          </AnimatePresence>
          <p className="mk-hint">Poke it</p>
        </motion.div>

        <motion.div className="mk-panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.8, ease: easeOut }}>
          <div className="mk-id">
            <label className="mk-name"><span className="mk-k">Name</span>
              <input value={name} maxLength={18} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="Name" />
              <motion.button className="mk-dice" onClick={() => setName(NAMES[pick(NAMES.length)])} whileTap={{ rotate: 180, scale: 0.85 }} aria-label="Pick a name">⚄</motion.button>
            </label>
            <div className="mk-roles" role="radiogroup" aria-label="Job">
              {ROLES.map(([r, c], i) => (
                <button key={r} role="radio" aria-checked={look.role === i} className={look.role === i ? 'on' : ''} style={{ ['--c' as string]: c }} onClick={() => set('role', i)}><i />{r}</button>
              ))}
            </div>
          </div>

          <div className="mk-tabs" role="tablist">
            <LayoutGroup id="mk-tabs">
              {TABS.map(([k, t]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {tab === k && <motion.span layoutId="mk-tab-on" className="mk-tab-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span>{t}</span>
                </button>
              ))}
            </LayoutGroup>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className="mk-options" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: easeOut }}>
              {tab === 'colour' ? (
                <div className="mk-colours">
                  {([['colour', 'Body', COLOURS], ['backdrop', 'Backdrop', BACKDROPS]] as const).map(([k, t, list]) => (
                    <div key={k}>
                      <p className="mk-k">{t}</p>
                      <div className="mk-swatches">
                        {list.map((c, i) => (
                          <motion.button key={c} className={`mk-swatch ${look[k] === i ? 'on' : ''}`} style={{ background: c }} onClick={() => set(k, i)} whileTap={{ scale: 0.85 }} aria-label={`${t} colour ${i + 1}`} aria-pressed={look[k] === i} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <p className="mk-k">Pattern</p>
                    <div className="mk-chips">
                      {PATTERNS.map((p, i) => <button key={p} className={look.pattern === i ? 'on' : ''} onClick={() => set('pattern', i)}>{p}</button>)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mk-tiles">
                  {options.map((label, i) => {
                    const preview = { ...look, [tab]: i }
                    return (
                      <motion.button key={label} className={`mk-tile ${look[tab] === i ? 'on' : ''}`} onClick={() => set(tab, i)} whileHover={{ y: -3 }} whileTap={{ scale: 0.94 }}
                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.025, duration: 0.25 }} aria-pressed={look[tab] === i}>
                        <svg viewBox="-172 -352 344 364"><Agent look={preview} mini id={`t-${tab}-${i}`} /></svg>
                        <span>{label}</span>
                      </motion.button>
                    )
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mk-actions">
            <motion.button className="jam-act" onClick={surprise} whileTap={{ scale: 0.94 }} disabled={spinning}>Surprise me</motion.button>
            <button className="jam-act" onClick={share}>Copy link</button>
            <button className="jam-act jam-act--dark" onClick={download}>Download picture</button>
          </div>
        </motion.div>
      </section>
      <Footer />
    </div>
  )
}
