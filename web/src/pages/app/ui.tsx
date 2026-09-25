import { animate, motion, useInView } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { easeOut } from '../../lib/motion'
import type { Task, TaskState } from '../../lib/types'

/** Lanes group the ten board states into what a maintainer cares about. */
export const LANES: { id: string; title: string; hint: string; states: TaskState[]; tone: string }[] = [
  { id: 'incoming', title: 'Incoming', hint: 'New and triaged issues', states: ['New Issue', 'Triaged'], tone: 'triager' },
  { id: 'working', title: 'Agents working', hint: 'Patching, testing, reviewing', states: ['In Progress', 'Awaiting Tests', 'In Review', 'Rejected'], tone: 'coder' },
  { id: 'you', title: 'Waiting for you', hint: 'Approve, merge or decide', states: ['Approved', 'Needs Human'], tone: 'tester' },
  { id: 'merged', title: 'Merged', hint: 'Shipped as pull requests', states: ['Merged'], tone: 'reviewer' },
  { id: 'closed', title: 'Closed', hint: 'Duplicates and questions', states: ['Closed'], tone: 'none' },
]

export const PIPELINE: TaskState[] = ['Triaged', 'In Progress', 'Awaiting Tests', 'In Review', 'Approved', 'Merged']

export function stateTone(s: TaskState): string {
  if (s === 'Merged') return 'ok'
  if (s === 'Approved') return 'go'
  if (s === 'Needs Human') return 'warn'
  if (s === 'Rejected') return 'bad'
  if (s === 'Closed') return 'mute'
  return 'work'
}

/** Plain words for the triager's labels. */
export function kindLabel(kind: string) {
  return ({ 'flaky-test': 'random failure', bug: 'bug', feature: 'feature', question: 'question', unknown: 'unclear' } as Record<string, string>)[kind] || kind
}

export function StatePill({ state }: { state: TaskState }) {
  return <span className={`pill tone-${stateTone(state)}`}>{state === 'Needs Human' ? 'Needs you' : state}</span>
}

export function Section({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section className={`card ${className}`} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easeOut }}>
      {(title || action) && <header className="card-head"><h2>{title}</h2>{action}</header>}
      {children}
    </motion.section>
  )
}

export function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!inView) return
    const c = animate(v, value, { duration: 1.2, ease: easeOut, onUpdate: setV })
    return () => c.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value])
  return <span ref={ref} className="tabnum">{v.toFixed(decimals)}{suffix}</span>
}

export function timeAgo(input?: string | Date | { toDate(): Date } | null): string {
  if (!input) return '—'
  const d = typeof input === 'string' ? new Date(input) : input instanceof Date ? input : input.toDate()
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function evidenceRows(tasks: Task[]) {
  const rows: { test: string; before: number; after: number; task: string }[] = []
  for (const t of tasks) {
    const ev = t.artifacts.test_summary?.harness?.evidence
    if (!ev) continue
    for (const [test, e] of Object.entries(ev)) {
      if (!e.before?.runs) continue
      rows.push({ test: test.split('::').pop() || test, before: Math.round(((e.before.failures ?? 0) / e.before.runs) * 100),
        after: Math.round(((e.after.failures ?? 0) / (e.after.runs || 1)) * 100), task: t.task_id })
    }
  }
  return rows
}

export function EmptyState({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        {['triager', 'coder', 'tester', 'reviewer'].map((a, i) => (
          <motion.span key={a} style={{ background: `var(--${a})` }} animate={{ y: [0, -10, 0] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
        ))}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  )
}
