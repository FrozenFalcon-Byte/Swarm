import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Roll } from '../../components/Roll'
import { easeInOut, easeOut } from '../../lib/motion'
import type { Task } from '../../lib/types'
import { Section, StatePill, timeAgo } from './ui'

/*
 * How the agents hand work to each other. They never message one another: each one reads the shared
 * board, does its job, and moves the card on, so every "handoff" is a card changing hands through the
 * board. The diagram draws those handoffs (thicker = more often) and replays the latest ones in order;
 * picking a task shows its own path, step by step.
 */

type Node = 'triager' | 'coder' | 'tester' | 'reviewer' | 'you'
const NODES: Record<Node, { x: number; y: number; label: string; color: string }> = {
  triager: { x: 300, y: 58, label: 'Triager', color: 'var(--triager)' },
  coder: { x: 540, y: 220, label: 'Coder', color: 'var(--coder)' },
  tester: { x: 300, y: 382, label: 'Tester', color: 'var(--tester)' },
  reviewer: { x: 60, y: 220, label: 'Reviewer', color: 'var(--reviewer)' },
  you: { x: 540, y: 382, label: 'You', color: 'var(--white)' },
}
const CENTER = { x: 300, y: 220 }
const who = (agent: string): Node | null => agent === 'human' ? 'you' : agent in NODES ? (agent as Node) : null

interface Hop { from: Node; to: Node; task: string; title: string; action: string; ts: string }

function hops(tasks: Task[]): Hop[] {
  const out: Hop[] = []
  for (const t of tasks) {
    const h = t.history || []
    for (let i = 1; i < h.length; i++) {
      const a = who(h[i - 1].agent), b = who(h[i].agent)
      if (a && b && a !== b) out.push({ from: a, to: b, task: t.task_id, title: t.title, action: h[i].action, ts: h[i].ts })
    }
  }
  return out.sort((x, y) => x.ts.localeCompare(y.ts))
}

/** A curve from one agent to another that bends through the board in the middle. */
function curve(a: Node, b: Node) {
  const p = NODES[a], q = NODES[b]
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
  // pull toward the board, and offset sideways so A→B and B→A don't overlap
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1
  const side = 26
  const cx = mx + (CENTER.x - mx) * 0.55 + (-dy / len) * side
  const cy = my + (CENTER.y - my) * 0.55 + (dx / len) * side
  return { d: `M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`, lx: 0.25 * p.x + 0.5 * cx + 0.25 * q.x, ly: 0.25 * p.y + 0.5 * cy + 0.25 * q.y }
}

export function Handoffs({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const all = useMemo(() => hops(tasks), [tasks])
  const [picked, pick] = useState<string | null>(null)
  const shown = picked ? all.filter((h) => h.task === picked) : all
  const edges = useMemo(() => {
    const m = new Map<string, { from: Node; to: Node; n: number }>()
    for (const h of shown) {
      const k = `${h.from}>${h.to}`
      m.set(k, { from: h.from, to: h.to, n: (m.get(k)?.n || 0) + 1 })
    }
    return [...m.values()]
  }, [shown])
  const max = Math.max(1, ...edges.map((e) => e.n))

  // replay: walk through the handoffs in time order, one every 1.4s, looping
  const replay = shown.slice(-40)
  const [step, setStep] = useState(0)
  const setPicked = (id: string | null) => { pick(id); setStep(0) }
  useEffect(() => {
    if (!replay.length) return
    const id = window.setInterval(() => setStep((s) => (s + 1) % replay.length), 1400)
    return () => window.clearInterval(id)
  }, [replay.length])
  const now = replay[step % Math.max(1, replay.length)]

  if (!all.length) return <Section><p className="muted pad">No handoffs yet. Once the agents start on an issue, you’ll see who passed what to whom.</p></Section>

  return (
    <div className="handoffs">
      <Section title={picked ? `How ${picked} moved` : 'Who hands work to whom'} action={picked
        ? <button className="btn btn-line btn-sm" onClick={() => setPicked(null)}><Roll>All tasks</Roll></button>
        : <span className="muted">{all.length} handoffs across {tasks.length} tasks</span>}>
        <div className="ho-stage">
          <svg viewBox="0 0 600 440" className="ho-svg" role="img" aria-label="Handoffs between agents">
            {/* the board in the middle: nobody talks directly, everything goes through it */}
            <g>
              <rect x={CENTER.x - 58} y={CENTER.y - 34} width={116} height={68} rx={18} className="ho-board" />
              <text x={CENTER.x} y={CENTER.y - 4} className="ho-board-t">Board</text>
              <text x={CENTER.x} y={CENTER.y + 16} className="ho-board-s">{tasks.length} tasks</text>
            </g>
            {edges.map((e) => {
              const c = curve(e.from, e.to)
              const active = now && now.from === e.from && now.to === e.to
              return (
                <g key={`${e.from}>${e.to}`}>
                  <motion.path d={c.d} className={`ho-edge ${active ? 'on' : ''}`} strokeWidth={1.5 + (e.n / max) * 5}
                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.9, ease: easeInOut }} />
                  <g className="ho-count" transform={`translate(${c.lx},${c.ly})`}>
                    <circle r={12} /><text dy="4">{e.n}</text>
                  </g>
                </g>
              )
            })}
            {now && (
              <motion.circle key={step + (picked || '')} r={9} className="ho-token" style={{ offsetPath: `path("${curve(now.from, now.to).d}")`, fill: NODES[now.to].color }}
                initial={{ offsetDistance: '0%', scale: 0.4 }} animate={{ offsetDistance: '100%', scale: 1 }} transition={{ duration: 1.1, ease: easeInOut }} />
            )}
            {(Object.keys(NODES) as Node[]).map((n) => {
              const p = NODES[n]
              const lit = now && (now.from === n || now.to === n)
              return (
                <g key={n} transform={`translate(${p.x},${p.y})`}>
                  <motion.circle r={30} className="ho-node" style={{ fill: p.color }} animate={{ scale: lit ? 1.12 : 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} />
                  <text y={50} className="ho-label">{p.label}</text>
                </g>
              )
            })}
          </svg>
          <div className="ho-caption" aria-live="polite">
            <AnimatePresence mode="wait">
              {now && (
                <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: easeOut }}>
                  <span className="mono">{now.task}</span>
                  <b><i style={{ background: NODES[now.from].color }} />{NODES[now.from].label} → <i style={{ background: NODES[now.to].color }} />{NODES[now.to].label}</b>
                  <span>{now.action}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Section>

      <Section title="Each task’s path" action={<span className="muted">pick one to trace it above</span>}>
        <ul className="ho-tasks">
          {tasks.slice().sort((a, b) => a.task_id.localeCompare(b.task_id)).map((t) => {
            const path = (t.history || []).map((h) => who(h.agent)).filter((x, i, arr): x is Node => !!x && x !== arr[i - 1])
            return (
              <li key={t.task_id} className={picked === t.task_id ? 'on' : ''}>
                <button className="ho-task" onClick={() => setPicked(picked === t.task_id ? null : t.task_id)}>
                  <span className="mono">{t.task_id}</span>
                  <b>{t.title}</b>
                  <span className="ho-path">
                    {path.map((n, i) => (
                      <motion.i key={i} title={NODES[n].label} style={{ background: NODES[n].color }}
                        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 20 }} />
                    ))}
                  </span>
                  <StatePill state={t.state} />
                  <span className="muted">{timeAgo(t.updated_at)}</span>
                </button>
                <button className="icon-btn" onClick={() => onOpen(t.task_id)} aria-label={`Open ${t.task_id}`} title="Open task">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
