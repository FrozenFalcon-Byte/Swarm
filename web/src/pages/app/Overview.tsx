import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { agentColor } from '../../components/AgentDots'
import { useAuth } from '../../lib/auth'
import { useAllTasks, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import { AGENTS, type Task } from '../../lib/types'
import ConnectRepo from './ConnectRepo'
import { CountUp, EmptyState, Section, StatePill, evidenceRows, timeAgo } from './ui'

export default function Overview() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const first = (user?.displayName || 'there').split(' ')[0]

  const m = useMemo(() => metrics(tasks), [tasks])
  const waiting = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human')
    .sort((a, b) => (a.state === 'Approved' ? -1 : 1) - (b.state === 'Approved' ? -1 : 1))
  const repoName = (id: string) => repos.find((r) => r.id === id)?.displayName || 'repo'

  if (!loading && repos.length === 0) {
    return (
      <div className="page">
        <PageHead title={`Hi ${first}.`} sub="Connect a repository and the agents start on its open issues." />
        <Section><EmptyState title="No repositories yet" text="Point Swarm at a GitHub repository, or try the demo repo. It has real flaky tests for the agents to fix."><ConnectRepo /></EmptyState></Section>
      </div>
    )
  }

  const running = repos.some((r) => r.status === 'running' || r.status === 'queued')
  return (
    <div className="page">
      <PageHead title={`Hi ${first}.`}
        sub={waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'task is' : 'tasks are'} waiting for you.` : running ? 'The agents are working. Updates appear here live.' : 'Nothing needs you right now.'} />

      <div className="tiles">
        <Tile label="Flake rate" tone="coral" pair big={m.before === null ? '—' : <><CountUp value={m.before} suffix="%" /><span className="tile-arrow">→</span><CountUp value={m.after ?? 0} suffix="%" /></>}
          note={m.before === null ? 'Appears once a fix has been proven' : `before → after on proven fixes, ${m.runs} sandboxed runs`} />
        <Tile label="Fixes merged" tone="green" big={<CountUp value={m.merged} />} note={`${m.approved} more approved and ready`} />
        <Tile label="Waiting for you" tone="yellow" big={<CountUp value={waiting.length} />} note={waiting.length ? 'Merge, approve or decide' : 'All clear'} />
        <Tile label="Tools written" tone="sky" big={<CountUp value={m.tools} />} note={`${m.reuses} reuses on later tasks`} />
      </div>

      <div className="grid-2">
        <Section title="Pipeline" action={<span className="muted">{tasks.length} issues so far</span>}>
          <Funnel steps={m.funnel} />
        </Section>
        <Section title="Needs your attention" action={waiting.length > 0 && <span className="pill tone-warn">{waiting.length}</span>}>
          {waiting.length === 0 ? <p className="muted pad">Nothing is waiting. The agents will add tasks here when they need a decision.</p> : (
            <ul className="attention">
              {waiting.slice(0, 6).map((t, i) => (
                <motion.li key={`${t.repoId}-${t.task_id}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, ease: easeOut }}>
                  <Link to={`/app/repos/${t.repoId}/tasks/${t.task_id}`} className="attention-row">
                    <StatePill state={t.state} />
                    <div className="attention-main"><b>{t.title}</b><span>{repoName(t.repoId)} · {t.source_issue} · {t.state === 'Approved' ? 'ready to merge' : t.note}</span></div>
                    <span className="chev" aria-hidden="true">→</span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid-2">
        <Section title="Flakiness, before and after" action={<span className="muted">% of runs failing</span>}>
          {m.evidence.length === 0 ? <p className="muted pad">The tester fills this in after it proves a fix.</p> : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={m.evidence} barGap={4} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                  <XAxis dataKey="test" tick={{ fontSize: 11, fill: 'var(--ink-2)' }} tickLine={false} axisLine={false} interval={0} tickFormatter={(v: string) => v.replace(/^test_/, '')} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip cursor={{ fill: 'var(--grey-8)' }} contentStyle={{ borderRadius: 12, border: '1.5px solid var(--ink)', fontSize: 13 }} formatter={(v, n) => [`${v}%`, String(n)]} />
                  <Bar dataKey="before" name="Before" fill="var(--tester)" stroke="var(--ink)" strokeWidth={1.5} radius={[6, 6, 0, 0]} animationDuration={1100} />
                  <Bar dataKey="after" name="After" fill="var(--reviewer)" stroke="var(--ink)" strokeWidth={1.5} radius={[6, 6, 0, 0]} minPointSize={3} animationDuration={1100} animationBegin={250} />
                </BarChart>
              </ResponsiveContainer>
              <div className="legend"><span><i style={{ background: 'var(--tester)' }} />Before the patch</span><span><i style={{ background: 'var(--reviewer)' }} />After</span></div>
            </div>
          )}
        </Section>
        <Section title="Who did what" action={<span className="muted">actions per agent</span>}>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={m.workload} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="agent" tick={{ fontSize: 13, fill: 'var(--ink)' }} tickLine={false} axisLine={false} width={72} />
                <Tooltip cursor={{ fill: 'var(--grey-8)' }} contentStyle={{ borderRadius: 12, border: '1.5px solid var(--ink)', fontSize: 13 }} />
                <Bar dataKey="count" name="Actions" radius={[0, 8, 8, 0]} stroke="var(--ink)" strokeWidth={1.5} barSize={26} animationDuration={1100}
                  label={{ position: 'right', fontSize: 12, fill: 'var(--ink-2)' }}>
                  {m.workload.map((w) => <Cell key={w.agent} fill={agentColor(w.agent)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      <Section title="Latest moves" action={<Link to="/app/repos" className="link">All repositories →</Link>}>
        <ul className="moves">
          {m.recent.map((h, i) => (
            <li key={i}>
              <span className="move-dot" style={{ background: agentColor(h.agent) }} />
              <span className="move-agent">{h.agent}</span>
              <span className="move-text">{h.action}</span>
              <Link to={`/app/repos/${h.repoId}/tasks/${h.task}`} className="mono move-task">{h.task}</Link>
              <span className="muted move-time">{timeAgo(h.ts)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </header>
  )
}

function Tile({ label, big, note, tone, pair }: { label: string; big: React.ReactNode; note: string; tone: string; pair?: boolean }) {
  return (
    <motion.div className={`tile tile-${tone}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut }} whileHover={{ y: -3 }}>
      <span className="tile-label">{label}</span>
      <span className={`tile-big ${pair ? 'tile-big--pair' : ''}`}>{big}</span>
      <span className="tile-note">{note}</span>
    </motion.div>
  )
}

function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  const tones = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)', 'var(--green)', 'var(--ink)']
  return (
    <div className="funnel">
      {steps.map((s, i) => (
        <div className="funnel-row" key={s.label}>
          <span className="funnel-label">{s.label}</span>
          <div className="funnel-track">
            <motion.div className="funnel-bar" style={{ background: tones[i] }} initial={{ width: 0 }} whileInView={{ width: `${Math.max(s.value ? 4 : 0, (s.value / max) * 100)}%` }}
              viewport={{ once: true }} transition={{ duration: 1, ease: easeOut, delay: i * 0.08 }} />
          </div>
          <span className="funnel-value tabnum">{s.value}</span>
        </div>
      ))}
    </div>
  )
}

function metrics(tasks: (Task & { repoId: string })[]) {
  const reached = (t: Task, s: string) => t.state === s || t.history.some((h) => h.to_state === s)
  const funnel = [
    { label: 'Issues in', value: tasks.length },
    { label: 'Triaged for the swarm', value: tasks.filter((t) => reached(t, 'Triaged')).length },
    { label: 'Patched', value: tasks.filter((t) => reached(t, 'Awaiting Tests')).length },
    { label: 'Proven in sandbox', value: tasks.filter((t) => reached(t, 'In Review')).length },
    { label: 'Approved', value: tasks.filter((t) => reached(t, 'Approved') || (t.state === 'Needs Human' && !!t.artifacts.review)).length },
    { label: 'Merged', value: tasks.filter((t) => t.state === 'Merged').length },
  ]
  const evidence = evidenceRows(tasks.filter((t) => t.artifacts.review || t.state === 'Merged'))
  // only fixes the tester actually proved (the task went on to review); failed attempts don't count
  const proven = tasks.filter((t) => t.artifacts.review || t.state === 'Merged')
  let fb = 0, fa = 0, runs = 0
  for (const t of proven) for (const e of Object.values(t.artifacts.test_summary?.harness?.evidence || {})) {
    if (!e.before?.runs) continue
    fb += e.before.failures ?? 0; fa += e.after.failures ?? 0; runs += e.before.runs
  }
  const tools = new Set<string>(), uses: Record<string, number> = {}
  for (const t of tasks) for (const id of t.artifacts.tools_used || []) { tools.add(`${t.repoId}/${id}`); uses[`${t.repoId}/${id}`] = (uses[`${t.repoId}/${id}`] || 0) + 1 }
  const workload = AGENTS.map((a) => ({ agent: a, count: tasks.reduce((n, t) => n + t.history.filter((h) => h.agent === a).length, 0) }))
  const recent = tasks.flatMap((t) => t.history.map((h) => ({ ...h, task: t.task_id, repoId: t.repoId })))
    .sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8)
  return {
    funnel, evidence, workload, recent,
    before: runs ? Math.round((fb / runs) * 100) : null, after: runs ? Math.round((fa / runs) * 100) : null, runs,
    merged: tasks.filter((t) => t.state === 'Merged').length, approved: tasks.filter((t) => t.state === 'Approved').length,
    tools: tools.size, reuses: Object.values(uses).reduce((n, u) => n + Math.max(0, u - 1), 0),
  }
}
