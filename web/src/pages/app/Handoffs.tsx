import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Roll } from '../../components/Roll'
import { CodeDialog } from '../../components/CodeWindow'
import { useA2A } from '../../lib/data'
import { easeInOut, easeOut } from '../../lib/motion'
import type { A2AEvent, Run, Task } from '../../lib/types'
import { EmptyState, Section, StatePill, timeAgo } from './ui'

/*
 * The agents talk to each other over A2A (Agent2Agent). When one finishes with a task it looks up which
 * peer offers the skill the task needs next and sends it a message; the peer streams back what it's doing,
 * its result, and how it ended. This view is that traffic: the network on top (thicker = more messages),
 * replayed in order, and below it every conversation about one task, down to the JSON on the wire.
 * While a run is going it's live instead: it follows each message as it's sent and marks the agents at work;
 * once the run ends it goes back to replaying.
 */

interface Spot { x: number; y: number; label: string; color: string; r: number; order: number }
// the pipeline, in the order work flows through it
const ORDER = ['intake', 'triager', 'coder', 'tester', 'reviewer', 'human']
const LOOK: Record<string, { label: string; color: string }> = {
  intake: { label: 'GitHub', color: 'var(--grey-7)' }, triager: { label: 'Triager', color: 'var(--triager)' },
  coder: { label: 'Coder', color: 'var(--coder)' }, tester: { label: 'Tester', color: 'var(--tester)' },
  reviewer: { label: 'Reviewer', color: 'var(--reviewer)' }, human: { label: 'You', color: 'var(--white)' },
}
type Layout = { w: number; h: number; vertical: boolean; nodes: Record<string, Spot> }

/** Wide screens: a row, left to right. Phones: a column, top to bottom. Outside agents sit beside the reviewer. */
function layout(vertical: boolean, outside: string[]): Layout {
  const nodes: Record<string, Spot> = {}
  const gap = vertical ? 92 : 128, r = vertical ? 22 : 26
  ORDER.forEach((id, i) => {
    const along = (vertical ? 50 : 64) + i * gap
    nodes[id] = { ...LOOK[id], r: id === 'intake' || id === 'human' ? r - 3 : r, order: i, x: vertical ? 110 : along, y: vertical ? along : 150 }
  })
  const rv = nodes.reviewer
  outside.slice(0, 3).forEach((id, i) => {
    nodes[id] = { label: id, color: 'var(--grey-8)', r: r - 4, order: 4.5,
      x: vertical ? rv.x + 250 : rv.x - 70 + i * 70, y: vertical ? rv.y - 60 + i * 60 : rv.y + 200 }
  })
  const w = vertical ? (outside.length ? 400 : 330) : 64 * 2 + gap * (ORDER.length - 1)
  const h = vertical ? 100 + gap * (ORDER.length - 1) : outside.length ? 400 : 310
  return { w, h, vertical, nodes }
}

const TERMINAL: Record<string, string> = {
  completed: 'Done', 'input-required': 'Needs you', rejected: 'Refused', failed: 'Failed', canceled: 'Cancelled', 'auth-required': 'Needs sign-in',
}

interface Hop { from: string; to: string; task: string; text: string; ts: string; kind: 'message' | 'needs-you' | 'outside' }

function hopsOf(events: A2AEvent[]): Hop[] {
  const out: Hop[] = []
  for (const e of events) {
    if (e.kind === 'message') out.push({ from: e.from, to: e.to, task: e.taskId, text: e.text || '', ts: e.ts, kind: 'message' })
    else if (e.kind === 'external') out.push({ from: e.from, to: e.to, task: e.taskId, text: `asked for a second opinion: ${e.text || ''}`, ts: e.ts, kind: 'outside' })
    else if (e.kind === 'status' && e.state === 'input-required') out.push({ from: e.from, to: 'human', task: e.taskId, text: e.text || 'waiting for you', ts: e.ts, kind: 'needs-you' })
  }
  return out
}

/** Group a task's events into conversations: one message and everything its recipient sent back. */
interface Exchange { msg: A2AEvent; replies: A2AEvent[]; final?: string; a2aTask?: string }
function exchangesOf(events: A2AEvent[]): Exchange[] {
  const out: Exchange[] = []
  const byTask = new Map<string, Exchange>()
  for (const e of events) {
    if (e.kind === 'message' || e.kind === 'external') {
      out.push({ msg: e, replies: [], final: e.kind === 'external' ? e.state : undefined })
      continue
    }
    let x = e.a2aTask ? byTask.get(e.a2aTask) : undefined
    if (!x) {
      // the first answer to a message names the A2A task it opened; pair it with the oldest unanswered one
      x = out.find((o) => o.msg.kind === 'message' && !o.a2aTask && o.msg.to === e.from && o.msg.from === e.to)
      if (x && e.a2aTask) { x.a2aTask = e.a2aTask; byTask.set(e.a2aTask, x) }
    }
    if (!x) continue
    if (e.kind !== 'task') x.replies.push(e)
    if (e.state && TERMINAL[e.state]) x.final = e.state
  }
  return out
}

export function Handoffs({ repoId, tasks, onOpen, events: given, run }: { repoId?: string; tasks: Task[]; onOpen: (id: string) => void; events?: A2AEvent[]; run?: Run }) {
  const live = useA2A(given ? undefined : repoId)
  const events = given || live.data
  const loading = !given && live.loading
  const all = useMemo(() => hopsOf(events), [events])
  const vertical = useNarrow()
  const outside = useMemo(() => [...new Set(all.filter((h) => h.kind === 'outside').map((h) => h.to))], [all])
  const L = useMemo(() => layout(vertical, outside), [vertical, outside])
  const nodes = L.nodes
  const [paused, setPaused] = useState(false)
  const [picked, pick] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [inspect, setInspect] = useState<A2AEvent | null>(null)
  const setPicked = (id: string | null) => { pick(id); setStep(0) }
  const shown = (picked ? all.filter((h) => h.task === picked) : all).filter((h) => nodes[h.from] && nodes[h.to])
  const edges = useMemo(() => {
    const m = new Map<string, { from: string; to: string; n: number; kind: Hop['kind'] }>()
    for (const h of shown) {
      const k = `${h.from}>${h.to}`
      m.set(k, { from: h.from, to: h.to, kind: h.kind, n: (m.get(k)?.n || 0) + 1 })
    }
    return [...m.values()]
  }, [shown])
  const max = Math.max(1, ...edges.map((e) => e.n))

  const replay = shown.slice(-40)
  // live: sit on the newest message and move on as each new one arrives; otherwise loop through them
  const following = !!run && !paused
  const newest = replay[replay.length - 1]
  const newestKey = newest ? `${newest.ts}|${newest.from}|${newest.to}|${newest.task}` : ''
  useEffect(() => {
    if (following && replay.length) setStep(replay.length - 1)
  }, [following, newestKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!replay.length || paused || run) return
    const id = window.setInterval(() => setStep((s) => (s + 1) % replay.length), 2600)
    return () => window.clearInterval(id)
  }, [replay.length, paused, run])
  // the run ending hands over to the replay, from the start
  const wasLive = useRef(!!run)
  useEffect(() => {
    if (wasLive.current && !run) { setStep(0); setPaused(false) }
    wasLive.current = !!run
  }, [run])
  const now = replay[step % Math.max(1, replay.length)]
  const beat = `${step}|${now?.ts}|${now?.from}|${picked || ''}` // a new message (or step) plays its animation again
  const busy = new Set(Object.entries(run?.progress?.agents || {}).filter(([, a]) => a.busy).map(([n]) => n))

  const withTraffic = useMemo(() => {
    const last = new Map<string, string>()
    for (const e of events) last.set(e.taskId, e.ts)
    return tasks.filter((t) => last.has(t.task_id)).sort((a, b) => (last.get(b.task_id) || '').localeCompare(last.get(a.task_id) || ''))
  }, [events, tasks])
  const focus = picked || withTraffic[0]?.task_id || null
  const convo = useMemo(() => exchangesOf(events.filter((e) => e.taskId === focus)), [events, focus])
  const curve = (a: string, b: string) => bend(nodes[a], nodes[b], L.vertical)

  if (loading) return null
  if (!events.length && run) return (
    <Section>
      <div className="ho-waiting">
        <span className="ho-live"><i />Live</span>
        <b>{run.progress?.label || 'Starting'}</b>
        <span className="muted">The agents haven’t sent each other anything yet. Their messages show up here the moment they do.</span>
      </div>
    </Section>
  )
  if (!events.length) return (
    <EmptyState title="No agent traffic yet"
      text="Each agent is an A2A service. When they start on an issue, every message they send each other shows up here: who asked whom, what they said while working, what they handed back." />
  )

  return (
    <div className="handoffs">
      <Section title={picked ? `How ${picked} moved` : run ? 'Who’s talking now' : 'Who talks to whom'} action={
        <span className="ho-head-act">
          {run && (following
            ? <span className="ho-live"><i />Live{run.progress ? ` · ${run.progress.percent}%` : ''}</span>
            : <button className="btn btn-line btn-sm" onClick={() => setPaused(false)}><Roll>Back to live</Roll></button>)}
          {picked
            ? <button className="btn btn-line btn-sm" onClick={() => setPicked(null)}><Roll>All tasks</Roll></button>
            : <span className="muted">{all.filter((h) => h.kind === 'message').length} A2A messages about {withTraffic.length} tasks</span>}
        </span>}>
        <div className="ho-stage">
          <div className="ho-canvas" style={{ aspectRatio: `${L.w} / ${L.h}`, maxWidth: L.vertical ? 340 : undefined }}>
            <svg viewBox={`0 0 ${L.w} ${L.h}`} className={`ho-svg ${L.vertical ? 'ho-svg--v' : ''}`} role="img" aria-label="Messages between agents">
              {edges.map((e, i) => {
                const c = curve(e.from, e.to)
                const active = now && now.from === e.from && now.to === e.to
                return (
                  <g key={`${e.from}>${e.to}`} className={`ho-e ho-${e.kind} ${active ? 'on' : ''}`} style={{ ['--c' as string]: nodes[e.from].color }}>
                    <motion.path d={c.d} className="ho-lane" strokeWidth={5 + (e.n / max) * 7}
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeInOut, delay: 0.2 + i * 0.05 }} />
                    <path d={c.d} className="ho-flow" />
                    <g className="ho-count" transform={`translate(${c.lx},${c.ly})`}>
                      <circle r={11} /><text dy="4">{e.n}</text>
                    </g>
                  </g>
                )
              })}
              {Object.entries(nodes).map(([id, p], i) => {
                const lit = !!now && (now.from === id || now.to === id)
                const used = all.some((h) => h.from === id || h.to === id)
                const label = p.label.length > 14 ? p.label.slice(0, 13) + '…' : p.label
                const lw = label.length * 7.6 + 22
                return (
                  <g key={id} transform={`translate(${p.x},${p.y})`}>
                    <motion.g className={`ho-n ${used || busy.has(id) ? '' : 'idle'} ${lit ? 'lit' : ''} ${now?.to === id ? 'gets' : ''} ${busy.has(id) ? 'busy' : ''}`}
                      initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.1 + i * 0.06 }}>
                      {lit && <circle key={beat} r={p.r} className="ho-pulse" style={{ stroke: p.color }} />}
                      {busy.has(id) && <circle r={p.r + 6} className="ho-busy" style={{ stroke: p.color }} />}
                      <circle r={p.r} cx={3} cy={3} className="ho-shadow" />
                      <g className="ho-body">
                        <circle r={p.r} className={`ho-node ${id === 'human' ? 'ho-you' : ''}`} style={{ fill: p.color }} />
                        {id === 'intake' && <g transform="translate(-9,-9) scale(0.75)"><path className="ho-gh" d={GITHUB} /></g>}
                        {id === 'human' && <g className="ho-glyph"><circle cy={-4} r={4.2} /><path d="M-8,9 a8,7 0 0,1 16,0" /></g>}
                        {id !== 'intake' && id !== 'human' && <g className="ho-eyes"><circle cx={-5} cy={-2} r={2.2} /><circle cx={5} cy={-2} r={2.2} /></g>}
                      </g>
                    </motion.g>
                    {L.vertical
                      ? <text x={-p.r - 14} y={5} className="ho-label" textAnchor="end">{label}</text>
                      : <g className={`ho-tag ${lit ? 'lit' : ''}`} transform={`translate(0,${p.r + 22})`}><rect x={-lw / 2} y={-12} width={lw} height={24} rx={12} /><text dy="4.5">{label}</text></g>}
                  </g>
                )
              })}
              {now && (
                <motion.g key={beat} style={{ offsetPath: `path("${curve(now.from, now.to).d}")`, offsetRotate: '0deg' }}
                  initial={{ offsetDistance: '0%', scale: 0.3 }} animate={{ offsetDistance: '100%', scale: [0.3, 1.1, 1, 0.5] }}
                  transition={{ duration: 1.2, ease: easeInOut, scale: { duration: 1.2, times: [0, 0.25, 0.8, 1] } }}>
                  <rect x={-noteW(now.task) / 2} y={-11} width={noteW(now.task)} height={22} rx={11} className="ho-note" style={{ fill: nodes[now.from].color }} />
                  <text dy="4" className="ho-note-t">{short(now.task)}</text>
                </motion.g>
              )}
            </svg>
            {!L.vertical && (
              <AnimatePresence mode="popLayout">
                {now && (
                  <motion.div key={beat} className="ho-bubble" style={{ left: `clamp(150px, ${(nodes[now.to].x / L.w) * 100}%, calc(100% - 150px))`, bottom: `${(1 - (nodes[now.to].y - nodes[now.to].r - 14) / L.h) * 100}%` }}
                    initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ duration: 0.35, ease: easeOut, delay: 0.75 }}>
                    <b><i style={{ background: nodes[now.from].color }} />{nodes[now.from].label}<span className="ho-to">to</span>{nodes[now.to].label}<span className="mono">{timeAgo(now.ts)}</span></b>
                    <span>{now.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
          {L.vertical && now && (
            <div className="ho-now-msg">
              <b><i style={{ background: nodes[now.from].color }} />{nodes[now.from].label}<span className="ho-to">to</span><i style={{ background: nodes[now.to].color }} />{nodes[now.to].label}</b>
              <span>{now.text}</span>
            </div>
          )}
        </div>
        <div className="ho-tape-row" aria-live="polite">
          <button className="ho-play" onClick={() => setPaused((x) => !x)} aria-label={paused ? 'Play' : 'Pause'}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.svg key={paused ? 'play' : 'pause'} width="14" height="14" viewBox="0 0 24 24" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 90 }} transition={{ duration: 0.2 }}>
                {paused ? <path d="M7 4l13 8-13 8z" fill="currentColor" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />}
              </motion.svg>
            </AnimatePresence>
          </button>
          <Tape hops={replay} at={step % Math.max(1, replay.length)} nodes={nodes} onPick={(i) => { setStep(i); setPaused(true) }} />
          <span className="mono muted ho-now-n">{replay.length ? (step % replay.length) + 1 : 0}/{replay.length}</span>
        </div>
      </Section>

      <div className="a2a-split">
        <Section title="Tasks" action={<span className="muted">pick one</span>}>
          <ul className="ho-tasks">
            {withTraffic.map((t) => {
              const path = all.filter((h) => h.task === t.task_id).flatMap((h, i) => i === 0 ? [h.from, h.to] : [h.to])
              return (
                <li key={t.task_id} className={focus === t.task_id ? 'on' : ''}>
                  <button className="ho-task" onClick={() => setPicked(picked === t.task_id ? null : t.task_id)}>
                    <span className="mono">{t.task_id}</span>
                    <b>{t.title}</b>
                    <span className="ho-path">
                      {path.map((n, i) => (
                        <motion.i key={i} title={nodes[n]?.label || n} style={{ background: nodes[n]?.color || 'var(--grey-8)' }}
                          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 20 }} />
                      ))}
                    </span>
                    <StatePill state={t.state} />
                  </button>
                  <button className="icon-btn" onClick={() => onOpen(t.task_id)} aria-label={`Open ${t.task_id}`} title="Open task">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section title={focus ? `Conversation · ${focus}` : 'Conversation'} action={<span className="muted mono">context swarm-{focus}</span>}>
          <ol className="a2a-thread">
            {convo.map((x, i) => (
              <motion.li key={x.msg.id} className="a2a-x" style={{ ['--c' as string]: nodes[x.msg.from]?.color || 'var(--grey-7)' }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut, delay: Math.min(i, 8) * 0.04 }}>
                <header>
                  <Who id={x.msg.from} nodes={nodes} /><span className="a2a-arrow">→</span><Who id={x.msg.to} nodes={nodes} />
                  <span className="muted mono a2a-ts">{x.msg.ts?.slice(11, 19)}</span>
                  <button className="a2a-json" onClick={() => setInspect(x.msg)} title="The message as JSON">{'{ }'}</button>
                </header>
                <p className="a2a-text">{x.msg.text}</p>
                {!!x.replies.length && (
                  <ul className="a2a-replies">
                    {x.replies.map((r) => (
                      <li key={r.id} className={`a2a-r a2a-${r.kind} ${r.state && TERMINAL[r.state] ? 'final' : ''}`}>
                        {r.kind === 'artifact'
                          ? <button className="a2a-artifact" onClick={() => setInspect(r)}><span className="mono">{r.name}</span><span>{summarise(r.data)}</span></button>
                          : r.kind === 'error' ? <span className="a2a-err">{r.text}</span>
                            : <button className="a2a-line" onClick={() => setInspect(r)}>{r.text || r.state}</button>}
                      </li>
                    ))}
                  </ul>
                )}
                <footer>
                  <span className={`a2a-state s-${x.final || 'working'}`}>{x.final ? TERMINAL[x.final] || x.final : 'Working…'}</span>
                  {x.a2aTask && <span className="muted mono">task {x.a2aTask.slice(0, 8)}</span>}
                </footer>
              </motion.li>
            ))}
          </ol>
        </Section>
      </div>

      <Inspector event={inspect} onClose={() => setInspect(null)} />
    </div>
  )
}

/** Every message in the replay as a strip of little chips (who sent it, to whom): the playing one is marked, and
 *  the strip keeps it in view. Click any chip to jump there. */
function Tape({ hops, at, nodes, onPick }: { hops: Hop[]; at: number; nodes: Record<string, Spot>; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current, chip = el?.children[at] as HTMLElement | undefined
    if (el && chip) el.scrollTo({ left: chip.offsetLeft - el.clientWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' })
  }, [at])
  return (
    <div className="ho-tape" ref={ref} data-lenis-prevent>
      {hops.map((h, i) => (
        <button key={i} className={`ho-chip ${i === at ? 'on' : ''} ${i < at ? 'past' : ''}`} onClick={() => onPick(i)} title={`${nodes[h.from]?.label} to ${nodes[h.to]?.label}: ${h.text}`}>
          {i === at && <motion.span layoutId="ho-chip-on" className="ho-chip-on" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
          <i style={{ background: nodes[h.from]?.color }} /><i style={{ background: nodes[h.to]?.color }} />
        </button>
      ))}
    </div>
  )
}

const short = (task: string) => (task.length > 8 ? task.slice(0, 7) + '…' : task)
const noteW = (task: string) => short(task).length * 7 + 20

function Who({ id, nodes }: { id: string; nodes: Record<string, Spot> }) {
  const n = nodes[id]
  return <span className="a2a-who"><i style={{ background: n?.color || 'var(--grey-8)' }} />{n?.label || id}</span>
}

function summarise(d?: Record<string, unknown> | null) {
  if (!d) return ''
  const bits: string[] = []
  if (d.state) bits.push(String(d.state))
  if (d.strategy) bits.push(String(d.strategy))
  if (d.harness) bits.push(`harness ${d.harness}`)
  if (d.kind) bits.push(`${d.kind}${d.priority ? `, ${d.priority}` : ''}`)
  if (Array.isArray(d.files) && d.files.length) bits.push(d.files.join(', '))
  return bits.join(' · ')
}

/** A curve between two nodes. Work moving forward arcs over the row (right of the column on phones); work
 *  sent back arcs under it (and further out), so the two directions never share a line. */
function bend(p: Spot, q: Spot, vertical: boolean) {
  const dist = Math.abs(q.order - p.order)
  const back = q.order < p.order
  const outside = p.order % 1 !== 0 || q.order % 1 !== 0
  const lift = outside ? 0.12 : back ? (vertical ? 70 : 62) + Math.max(0, dist - 1) * (vertical ? 16 : 22) : 26 + Math.max(0, dist - 1) * (vertical ? 16 : 26)
  // the side the curve bows to: above/below the row, or to the right of the column
  const nx = vertical ? 1 : 0, ny = vertical ? 0 : back ? 1 : -1
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
  const cx = outside ? mx + (q.y - p.y) * lift : mx + nx * lift * 2
  const cy = outside ? my - (q.x - p.x) * lift : my + ny * lift * 2
  const start = toward(p, cx, cy, p.r + 5), end = toward(q, cx, cy, q.r + 9)
  return { d: `M${start.x},${start.y} Q${cx},${cy} ${end.x},${end.y}`, lx: 0.25 * start.x + 0.5 * cx + 0.25 * end.x, ly: 0.25 * start.y + 0.5 * cy + 0.25 * end.y }
}

/** The point on a node's edge facing (x, y), `d` out from its centre. */
function toward(n: Spot, x: number, y: number, d: number) {
  const dx = x - n.x, dy = y - n.y, len = Math.hypot(dx, dy) || 1
  return { x: n.x + (dx / len) * d, y: n.y + (dy / len) * d }
}

function useNarrow() {
  const q = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

const GITHUB = 'M12 .5a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 016 0C17.3 4.6 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .5z'

function Inspector({ event, onClose }: { event: A2AEvent | null; onClose: () => void }) {
  const json = event ? JSON.stringify(event.wire ?? event.data ?? event, null, 2) : ''
  const kind = event ? (event.kind === 'message' ? 'Message' : event.kind === 'artifact' ? 'TaskArtifactUpdateEvent' : event.kind === 'status' ? 'TaskStatusUpdateEvent' : event.kind) : ''
  return <CodeDialog open={!!event} title={event ? `${kind} · ${event.from} → ${event.to}.json` : ''} code={json} lang="json" onClose={onClose} />
}
