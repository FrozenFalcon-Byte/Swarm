import { AnimatePresence, animate, motion, motionValue, useInView, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { easeOut } from '../../lib/motion'

/* The hero is a live board. Four agent cursors share it like teammates in a multiplayer doc, and none
   of it is scripted: the triager makes up an issue (a random function, a random symptom), draws it onto
   a free patch of the page and labels it, or spots that it repeats one already there and folds it in.
   The coder picks it up and types a patch, sometimes a lazy one. The tester runs it twelve times before
   and after. The reviewer reads it and approves it, or sends it back. Every visit plays out differently. */

type Agent = 'triager' | 'coder' | 'tester' | 'reviewer'
const AGENTS: Agent[] = ['triager', 'coder', 'tester', 'reviewer']
const HOME: Record<Agent, [number, number]> = { triager: [0.13, 0.27], coder: [0.79, 0.24], tester: [0.8, 0.68], reviewer: [0.14, 0.7] }
type Kind = 'hash-order' | 'jitter' | 'clock' | 'shared-state'

type Card = {
  id: number; n: number; name: string; kind: Kind; title: string; x: number; y: number
  stage: 'new' | 'labeled' | 'patched' | 'tested' | 'done' | 'dup'
  owner?: Agent; prio?: 'high' | 'medium' | 'low'
  patch?: [string, string]; version: number; typed: number; lazy?: string
  before?: boolean[]; after?: boolean[]; shownBefore: number; shownAfter: number
  verdict?: 'approved' | 'changes'; dupOf?: number; linked: number
  exit?: { x: number; y: number; scale: number }
}
type Ptr = { agent: Agent; x: MotionValue<number>; y: MotionValue<number>; tilt: MotionValue<number>; sx: MotionValue<number>; sy: MotionValue<number> }
type Ui = { clicks: number; note: string | null; selecting: boolean }

/* ---------------------------------------------------------------- made-up issues */

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const int = (a: number, b: number) => Math.floor(rand(a, b + 1))
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

const VERBS = ['normalize', 'parse', 'merge', 'sort', 'hash', 'retry', 'expire', 'export', 'dedupe', 'schedule', 'rank', 'sync', 'render', 'split', 'batch', 'resolve']
const NOUNS = ['tags', 'headers', 'sessions', 'tokens', 'rows', 'events', 'keys', 'jobs', 'slots', 'users', 'prices', 'routes', 'labels', 'queues', 'invoices', 'carts']
const SYMPTOMS: Record<Kind, string[]> = {
  'hash-order': ['order changes between runs', 'fails about 1 run in 4', 'passes locally, fails in CI', 'fails on some machines'],
  jitter: ['times out now and then', 'fails at random in CI', 'fails when the runner is busy', 'slow runs go red'],
  clock: ['fails near midnight', 'fails on the 1st of the month', 'red again on the nightly', 'off by one second'],
  'shared-state': ['fails only after other tests', 'passes alone, fails in the suite', 'fails on the second run', 'leaks between tests'],
}
const LAZY = [['random.seed(0)', 'seeds the RNG instead of fixing it'], ['time.sleep(0.5)', 'a sleep is not a fix'], ['@retry(times=3)', 'retries hide the failure'], ['@skip_on_ci', 'skipping the test is not a fix']] as const

function patchFor(kind: Kind, verb: string, noun: string): [string, string] {
  const one = noun.replace(/s$/, '')
  const cap = int(2, 9)
  const options: Record<Kind, [string, string][]> = {
    'hash-order': [[`return list(set(${noun}))`, `return sorted(set(${noun}))`], [`for ${one} in {*${noun}}:`, `for ${one} in sorted({*${noun}}):`], [`first = ${noun}.pop()`, `first = min(${noun})`]],
    jitter: [[`delay = random.uniform(0, ${cap})`, `delay = min(${cap}, base * 2 ** tries)`], [`wait(${one}, timeout=random.random())`, `wait(${one}, timeout=${cap}.0)`]],
    clock: [[`if now() > ${one}.expires_at:`, `if now() >= ${one}.expires_at:`], [`day = datetime.now().day`, `day = clock.today().day`], [`stamp = time.time()`, `stamp = clock.monotonic()`]],
    'shared-state': [[`def ${verb}_${noun}(${noun}=[]):`, `def ${verb}_${noun}(${noun}=None):`], [`_cache[${one}.id] = ${one}`, `cache = {${one}.id: ${one}}`], [`SEEN.add(${one})`, `seen = {${one}}`]],
  }
  return pick(options[kind])
}

let nextId = 1
function makeIssue(taken: Set<number>, like?: Card): Omit<Card, 'x' | 'y'> {
  let n = int(101, 989)
  while (taken.has(n)) n = int(101, 989)
  const kind = like?.kind ?? pick(Object.keys(SYMPTOMS) as Kind[])
  const name = like?.name ?? `${pick(VERBS)}_${pick(NOUNS)}`
  const symptom = pick(SYMPTOMS[kind].filter((s) => !like?.title.endsWith(s)))
  return { id: nextId++, n, name, kind, title: `${name} ${symptom}`, stage: 'new', owner: 'triager', version: 0, typed: 0, shownBefore: 0, shownAfter: 0, linked: 0, dupOf: like?.n }
}

/* ---------------------------------------------------------------- the board */

const CARD_W = 214
const CARD_H = 156 // tallest a card grows to, for finding room
const glide = [0.45, 0, 0.2, 1] as const

export function HeroWorld({ ready }: { ready: boolean }) {
  const layer = useRef<HTMLDivElement>(null)
  const live = useInView(layer)
  const liveRef = useRef(live)
  liveRef.current = live
  const reduce = useReducedMotion()
  const [, render] = useReducer((v: number) => v + 1, 0)
  const world = useRef<{ cards: Card[]; ui: Record<Agent, Ui> }>({
    cards: [], ui: Object.fromEntries(AGENTS.map((a) => [a, { clicks: 0, note: null, selecting: false }])) as Record<Agent, Ui>,
  })
  const [ptrs] = useState<Ptr[]>(() => AGENTS.map((agent) => ({ agent, x: motionValue(0), y: motionValue(0), tilt: motionValue(0), sx: motionValue(0), sy: motionValue(0) })))

  useEffect(() => {
    const el = layer.current
    if (!ready || reduce || !el) return
    let alive = true
    const w = world.current
    w.cards = []
    const size = () => ({ W: el.clientWidth, H: el.clientHeight })
    const { W, H } = size()
    ptrs.forEach((p) => { p.x.set(HOME[p.agent][0] * W); p.y.set(HOME[p.agent][1] * H) })
    const noteTimers: Partial<Record<Agent, number>> = {}

    const rel = (r: DOMRect) => { const o = el.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height } }
    const cardEl = (c: Card) => el.querySelector<HTMLElement>(`[data-card="${c.id}"]`)
    /** a random point inside part of a card (or the whole card) */
    const spot = (c: Card, part?: string) => {
      const box = cardEl(c)?.querySelector(part ?? ':scope') ?? cardEl(c)
      const r = box ? rel(box.getBoundingClientRect()) : { x: c.x, y: c.y, w: CARD_W, h: 60 }
      return { x: r.x + rand(0.2, 0.8) * r.w, y: r.y + rand(0.3, 0.75) * r.h }
    }
    /** somewhere on the page with room for a card: clear of the headline, the button, the ticker and other cards */
    const room = () => {
      const { W, H } = size()
      const hero = el.parentElement!
      const blocks = [...hero.querySelectorAll('.hero-kicker, .hero-title .word-mask, .hero-title .hero-tile, .hero-inner .btn, .ticker')]
        .map((b) => rel(b.getBoundingClientRect()))
      w.cards.forEach((c) => blocks.push({ x: c.x, y: c.y, w: CARD_W, h: CARD_H }))
      const pad = 22
      for (let k = 0; k < 80; k++) {
        const x = rand(20, W - CARD_W - 20), y = rand(96, H - CARD_H - 20)
        if (blocks.every((b) => x + CARD_W + pad < b.x || x > b.x + b.w + pad || y + CARD_H + pad < b.y || y > b.y + b.h + pad)) return { x, y }
      }
      return null
    }

    const ui = (a: Agent) => w.ui[a]
    const say = (a: Agent, note: string | null) => {
      ui(a).note = note; render()
      window.clearTimeout(noteTimers[a])
      if (note) noteTimers[a] = window.setTimeout(() => { if (ui(a).note === note) { ui(a).note = null; render() } }, 3200)
    }
    const P = (a: Agent) => ptrs.find((p) => p.agent === a)!
    const move = async (a: Agent, to: { x: number; y: number }, speed = 1) => {
      const p = P(a)
      const dist = Math.hypot(to.x - p.x.get(), to.y - p.y.get())
      const d = Math.min(1.7, 0.35 + dist / 950) / speed
      animate(p.tilt, [0, Math.max(-16, Math.min(16, (to.x - p.x.get()) * 0.05)), 0], { duration: d, ease: 'easeInOut' })
      await Promise.all([animate(p.x, to.x, { duration: d, ease: glide }), animate(p.y, to.y, { duration: d, ease: glide })])
    }
    const click = async (a: Agent, n = 1) => { for (let k = 0; k < n && alive; k++) { ui(a).clicks++; render(); await sleep(170) } }
    const drag = async (a: Agent, from: { x: number; y: number }, to: { x: number; y: number }) => {
      const p = P(a)
      await move(a, from)
      p.sx.set(from.x); p.sy.set(from.y)
      ui(a).selecting = true; render()
      await move(a, to, 0.7)
      await sleep(220)
      ui(a).selecting = false; render()
    }
    const wander = async (a: Agent) => {
      const { W, H } = size()
      const [hx, hy] = HOME[a]
      if (Math.random() < 0.55) await move(a, { x: Math.max(20, Math.min(W - 240, (hx + rand(-0.12, 0.12)) * W)), y: Math.max(100, Math.min(H - 170, (hy + rand(-0.12, 0.12)) * H)) }, 0.8)
      else if (Math.random() < 0.4) { const p = P(a); for (let k = 0; k < 3; k++) await move(a, { x: p.x.get() + rand(-14, 14), y: p.y.get() + rand(-10, 10) }, 2.4) }
      await sleep(rand(500, 1600))
    }
    const claim = (a: Agent, stage: Card['stage']) => {
      const open = w.cards.filter((c) => c.stage === stage && !c.owner && !c.exit)
      const c = open.find((x) => x.prio === 'high') ?? open[0]
      if (c) { c.owner = a; render() }
      return c
    }
    const release = (c: Card) => { c.owner = undefined; render() }
    const retire = async (c: Card, exit: Card['exit'], after: number) => {
      await sleep(after)
      c.exit = exit; render()
      await sleep(60)
      w.cards = w.cards.filter((x) => x !== c); render()
    }

    const minds: Record<Agent, () => Promise<void>> = {
      async triager() {
        const active = w.cards.filter((c) => c.stage !== 'dup' && c.stage !== 'done')
        const max = size().W > 1100 ? 4 : 3
        const at = active.length < max && Math.random() < 0.75 ? room() : null
        if (!at) return wander('triager')
        const like = active.length && Math.random() < 0.3 ? pick(active) : undefined
        const issue = makeIssue(new Set(w.cards.map((c) => c.n)), like)
        say('triager', `new issue #${issue.n}`)
        await drag('triager', at, { x: at.x + CARD_W * rand(0.8, 0.95), y: at.y + rand(50, 80) })
        if (!alive) return
        const c: Card = { ...issue, ...at }
        w.cards.push(c); render()
        await sleep(450)
        say('triager', `reading #${c.n}`)
        await move('triager', spot(c, '.hc-title'))
        await sleep(rand(600, 1200))
        const orig = like && w.cards.find((x) => x.n === like.n && !x.exit)
        if (orig) {
          say('triager', `same test as #${orig.n}?`)
          await move('triager', spot(orig, '.hc-title'))
          await sleep(rand(400, 700))
          await move('triager', spot(c, '.hc-title'))
          await click('triager')
          c.stage = 'dup'; c.owner = undefined; render()
          say('triager', `#${c.n} duplicates #${orig.n} · closed`)
          await sleep(1500)
          orig.linked++
          void retire(c, { x: orig.x - c.x, y: orig.y - c.y, scale: 0.35 }, 0)
          return
        }
        await click('triager')
        c.prio = pick(['high', 'high', 'medium', 'medium', 'low'] as const)
        c.stage = 'labeled'; release(c)
        say('triager', `labeled #${c.n} · ${c.prio}`)
        await sleep(rand(400, 900))
      },
      async coder() {
        const c = claim('coder', 'labeled')
        if (!c) return wander('coder')
        say('coder', `picking up #${c.n}`)
        await move('coder', spot(c, '.hc-title'))
        await click('coder')
        await sleep(rand(300, 700))
        const redo = c.verdict === 'changes'
        c.version++
        const good = patchFor(c.kind, ...(c.name.split('_') as [string, string]))
        const lazy = !redo && c.version === 1 && Math.random() < 0.25 ? pick(LAZY) : null
        c.patch = redo && c.patch ? [c.patch[0], good[1]] : lazy ? [good[0], lazy[0]] : good
        if (redo) c.patch = good
        c.lazy = lazy?.[1]
        c.verdict = undefined; c.after = undefined; c.shownAfter = 0; c.typed = 0; render()
        say('coder', redo ? `patch v${c.version}, properly this time` : `writing a patch for #${c.n}`)
        await sleep(250)
        await move('coder', spot(c, '.hc-add'))
        const text = c.patch[1]
        const p = P('coder')
        for (let k = 1; k <= text.length && alive; k++) {
          c.typed = k; render()
          if (k % 5 === 0) p.x.set(p.x.get() + 2.2) // the hand drifts along the line
          await sleep(Math.random() < 0.08 ? rand(200, 420) : rand(24, 70))
        }
        c.stage = 'patched'; release(c)
        say('coder', `patch v${c.version} · +1 −1`)
        await sleep(rand(300, 800))
      },
      async tester() {
        const c = claim('tester', 'patched')
        if (!c) return wander('tester')
        await move('tester', spot(c, '.hc-runs'))
        await click('tester', 2)
        if (!c.before) {
          const fails = int(2, 10)
          const slots = Array.from({ length: 12 }, (_, k) => k).sort(() => Math.random() - 0.5).slice(0, fails)
          c.before = Array.from({ length: 12 }, (_, k) => slots.includes(k))
          say('tester', `running #${c.n} 12× before`)
          for (let k = 1; k <= 12 && alive; k++) { c.shownBefore = k; render(); await sleep(rand(70, 150)) }
          await sleep(300)
        }
        const stillFails = !c.lazy && c.version === 1 && Math.random() < 0.15
        c.after = Array.from({ length: 12 }, () => false)
        if (stillFails) c.after[int(0, 11)] = true
        say('tester', `12× with patch v${c.version}`)
        await move('tester', spot(c, '.hc-after'), 1.6)
        for (let k = 1; k <= 12 && alive; k++) { c.shownAfter = k; render(); await sleep(rand(70, 150)) }
        const before = c.before.filter(Boolean).length
        if (stillFails) {
          say('tester', `still 1/12 failing · back to coder`)
          c.verdict = 'changes'; c.stage = 'labeled'
        } else {
          say('tester', `${before}/12 → 0/12 failing`)
          c.stage = 'tested'
        }
        release(c)
        await sleep(rand(400, 900))
      },
      async reviewer() {
        const c = claim('reviewer', 'tested')
        if (!c) return wander('reviewer')
        say('reviewer', `reviewing #${c.n}`)
        const r = cardEl(c)?.getBoundingClientRect()
        const box = r ? rel(r) : { x: c.x, y: c.y, w: CARD_W, h: 120 }
        await drag('reviewer', { x: box.x - 8, y: box.y - 8 }, { x: box.x + box.w + 8, y: box.y + box.h + 8 })
        await move('reviewer', spot(c, '.hc-diff'))
        await sleep(rand(700, 1300))
        await click('reviewer')
        if (c.lazy) {
          c.verdict = 'changes'; c.stage = 'labeled'
          say('reviewer', c.lazy)
          release(c)
          await sleep(1200)
          return
        }
        c.verdict = 'approved'; c.stage = 'done'; release(c)
        say('reviewer', `#${c.n} approved · over to you`)
        void retire(c, { x: 0, y: -40, scale: 0.92 }, 2600)
        await sleep(rand(500, 1000))
      },
    }

    AGENTS.forEach(async (a, i) => {
      await sleep(1500 + i * 500)
      while (alive) {
        if (!liveRef.current || document.hidden) { await sleep(500); continue }
        await minds[a]()
        await sleep(rand(150, 500))
      }
    })
    return () => {
      alive = false
      ptrs.forEach((p) => { p.x.stop(); p.y.stop(); p.tilt.stop() })
      Object.values(noteTimers).forEach((t) => window.clearTimeout(t))
    }
  }, [ready, reduce, ptrs])

  const { cards, ui } = world.current
  return (
    <>
      <div className="hw hw-cards" ref={layer} aria-hidden="true">
        <AnimatePresence>
          {cards.map((c) => <HeroCard key={c.id} c={c} />)}
        </AnimatePresence>
      </div>
      <div className="hw hw-ptrs" aria-hidden="true">
        {ptrs.map((p, i) => <Pointer key={p.agent} p={p} i={i} ready={ready} ui={ui[p.agent]} />)}
      </div>
    </>
  )
}

function HeroCard({ c }: { c: Card }) {
  const dots = (row: boolean[] | undefined, shown: number) => Array.from({ length: 12 }, (_, k) => (
    <i key={k} className={row && k < shown ? (row[k] ? 'f' : 'p') : ''} />
  ))
  return (
    <motion.div data-card={c.id} className={`hc s-${c.stage} ${c.owner ? 'owned' : ''}`} style={{ left: c.x, top: c.y, width: CARD_W, ['--c' as string]: `var(--${c.owner ?? 'ink'})` }}
      initial={{ opacity: 0, scale: 0.85, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={c.exit ? { opacity: 0, x: c.exit.x, y: c.exit.y, scale: c.exit.scale, transition: { duration: 0.7, ease: [0.65, 0, 0.35, 1] } } : { opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }} layout="size">
      <div className="hc-top">
        <span className="mono">#{c.n}</span>
        <AnimatePresence>
          {c.prio && <motion.em key={c.prio} className={`chip ${c.prio === 'high' ? 'hot' : c.prio === 'medium' ? 'warn' : ''}`} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>{c.prio}</motion.em>}
          {c.linked > 0 && <motion.em key={`l${c.linked}`} className="chip" initial={{ scale: 1.6 }} animate={{ scale: 1 }}>+{c.linked} dup</motion.em>}
        </AnimatePresence>
      </div>
      <b className="hc-title">{c.title}</b>
      {c.stage === 'dup' && <motion.em className="chip ok hc-dupchip" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>duplicate of #{c.dupOf}</motion.em>}
      {c.patch && (
        <motion.div className="hc-diff mono" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
          <span className="hc-del">- {c.patch[0]}</span>
          <span className="hc-add">+ {c.patch[1].slice(0, c.typed)}{c.typed < c.patch[1].length && <span className="caret" />}</span>
        </motion.div>
      )}
      {c.before && (
        <motion.div className="hc-runs" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <span className="hc-dots">{dots(c.before, c.shownBefore)}</span>
          <span className="hc-arrow">→</span>
          <span className="hc-dots hc-after">{dots(c.after, c.shownAfter)}</span>
        </motion.div>
      )}
      <AnimatePresence>
        {c.verdict && (
          <motion.span key={c.verdict} className={`hc-stamp ${c.verdict}`} initial={{ scale: 2.2, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -8 }}
            exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', stiffness: 520, damping: 20 }}>
            {c.verdict === 'approved' ? 'approved' : 'changes'}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Pointer({ p, i, ready, ui }: { p: Ptr; i: number; ready: boolean; ui: Ui }) {
  const boxX = useTransform(() => Math.min(p.sx.get(), p.x.get()))
  const boxY = useTransform(() => Math.min(p.sy.get(), p.y.get()))
  const boxW = useTransform(() => Math.abs(p.x.get() - p.sx.get()))
  const boxH = useTransform(() => Math.abs(p.y.get() - p.sy.get()))
  // near the right edge the name tag and note flip to the left of the arrow
  const [flip, setFlip] = useState(false)
  useMotionValueEvent(p.x, 'change', (v) => {
    const W = (document.querySelector('.hw-ptrs') as HTMLElement | null)?.clientWidth ?? 1e4
    const f = v > W - 250
    if (f !== flip) setFlip(f)
  })
  const color = `var(--${p.agent})`
  return (
    <>
      <AnimatePresence>
        {ui.selecting && (
          <motion.span className="cursor-box" style={{ x: boxX, y: boxY, width: boxW, height: boxH, borderColor: color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} transition={{ duration: 0.12 }} />
        )}
      </AnimatePresence>
      <motion.div className={`cursor ${flip ? 'flip' : ''}`} style={{ x: p.x, y: p.y }}
        initial={{ opacity: 0, scale: 0.6 }} animate={ready ? { opacity: 1, scale: 1 } : {}} transition={{ delay: 0.9 + i * 0.12, type: 'spring', stiffness: 260, damping: 18 }}>
        <AnimatePresence>
          {ui.clicks > 0 && (
            <motion.span key={ui.clicks} className="cursor-ripple" style={{ borderColor: color }}
              initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: 1, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.55, ease: easeOut }} />
          )}
        </AnimatePresence>
        <motion.svg key={ui.clicks} width="22" height="24" viewBox="0 0 22 24" className="cursor-arrow" style={{ rotate: p.tilt }}
          initial={ui.clicks ? { scale: 0.75 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 700, damping: 18 }}>
          <path d="M2 2l17 8.5-7.2 2.2L8.5 21z" fill={color} stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        </motion.svg>
        <span className="cursor-tag" style={{ background: color }}>{p.agent}</span>
        <AnimatePresence>
          {ui.note && (
            <motion.span key={ui.note} className="cursor-note mono" initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }} transition={{ type: 'spring', stiffness: 380, damping: 26 }}>{ui.note}</motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  )
}
