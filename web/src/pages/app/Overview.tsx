import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { agentColor } from '../../components/AgentDots'
import { useAuth } from '../../lib/auth'
import { queueRun, useAllTasks, useRepos } from '../../lib/data'
import { useToast } from '../../components/Island'
import { Roll } from '../../components/Roll'
import { easeOut } from '../../lib/motion'
import { AGENTS, type Task } from '../../lib/types'
import ConnectRepo from './ConnectRepo'
import { useBootHold } from '../../lib/boot'
import { CountUp, EmptyState, Section, evidenceRows, timeAgo } from './ui'

export default function Overview() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const first = (user?.displayName || 'there').split(' ')[0]
  const toast = useToast()
  const shows = (_k: string) => true

  const m = useMemo(() => metrics(tasks), [tasks])
  const waiting = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human')
    .sort((a, b) => (a.state === 'Approved' ? -1 : 1) - (b.state === 'Approved' ? -1 : 1))
  const repoName = (id: string) => repos.find((r) => r.id === id)?.displayName || 'repo'

  if (!loading && repos.length === 0) {
    return (
      <div className="page">
        <PageHead title={`Hi ${first}.`} sub="Connect a repository and the agents start on its open issues." />
        <Section><EmptyState title="No repositories yet" text="Point Swarm at a GitHub repository, or try the demo repo. It has real tests that fail at random for the agents to fix."><ConnectRepo /></EmptyState></Section>
      </div>
    )
  }

  const running = repos.some((r) => r.status === 'running' || r.status === 'queued')
  const mineRepos = repos.filter((r) => r.ownerUid === user?.uid)
  const runAll = async () => {
    if (!user) return
    try { await Promise.all(mineRepos.filter((r) => r.status !== 'running' && r.status !== 'queued').map((r) => queueRun(user.uid, r.id))); toast.ok('Runs queued', `${mineRepos.length} repositor${mineRepos.length === 1 ? 'y' : 'ies'}`) }
    catch (e) { toast.error('Couldn’t queue that', (e as Error).message) }
  }
  const hour = new Date().getHours()
  const greet = `${hour < 5 ? 'Up late' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening'}, ${first}.`
  const status = waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'task is' : 'tasks are'} waiting for you.` : running ? 'The agents are working. Updates appear here live.' : 'Nothing needs you right now.'
  const card = (i: number) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: easeOut, delay: 0.04 + i * 0.05 } })

  return (
    <div className="page ov">
      <div className="ov-grid">
        <motion.section className={`ov-hello ${shows('waiting') ? '' : 'wide'}`} {...card(0)}>
          <span className="ov-kicker"><i className={running ? 'live' : ''} />{running ? 'Agents at work' : 'All quiet'}</span>
          <h1>{greet}</h1>
          <p>{status}</p>
          {shows('crew') && <div className="ov-crew">
            {m.workload.map((w, i) => (
              <div key={w.agent} className={`ov-agent ${running ? 'busy' : ''}`} style={{ ['--c' as string]: agentColor(w.agent), ['--i' as string]: i }}>
                <i /><b>{w.agent}</b><span>{w.count} move{w.count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>}
          <div className="ov-actions">
            {mineRepos.length > 0 && <button className="btn btn-dark btn-sm" onClick={runAll} disabled={running}><Roll>{running ? 'Running…' : 'Run all now'}</Roll></button>}
            <Link to="/app/rules" className="btn btn-line btn-sm">House rules</Link>
            <Link to="/app/quiet-hours" className="btn btn-line btn-sm">Quiet hours</Link>
          </div>
        </motion.section>

        {shows('waiting') && <motion.section className="ov-wait" {...card(1)}>
          <header><span className="tile-label">Waiting for you</span><b className="ov-wait-n"><CountUp value={waiting.length} /></b></header>
          {waiting.length === 0 ? (
            <p className="ov-wait-none">All clear. The agents add tasks here when they need a decision.</p>
          ) : (
            <ul className="ov-wait-list">
              {waiting.slice(0, 4).map((t, i) => (
                <motion.li key={`${t.repoId}-${t.task_id}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05, ease: easeOut }}>
                  <Link to={`/app/repos/${t.repoId}/tasks/${t.task_id}`}>
                    <b>{t.title}</b><span>{repoName(t.repoId)} · {t.state === 'Approved' ? 'ready to merge' : 'needs a decision'}</span>
                  </Link>
                </motion.li>
              ))}
              {waiting.length > 4 && <li className="ov-wait-more">and {waiting.length - 4} more</li>}
            </ul>
          )}
        </motion.section>}

        {shows('stats') && <>
        <Stat i={2} tone="coral" label="Failing runs" big={m.before === null ? '—' : <><CountUp value={m.before} suffix="%" /><span className="tile-arrow">→</span><CountUp value={m.after ?? 0} suffix="%" /></>}
          note={m.before === null ? 'Appears once a fix is proven' : `before → after, ${m.runs} sandboxed runs`} />
        <Stat i={3} tone="green" label="Fixes merged" big={<CountUp value={m.merged} />} note={`${m.approved} more approved and ready`} />
        <Stat i={4} tone="sky" label="Tools written" big={<CountUp value={m.tools} />} note={`${m.reuses} reuses on later tasks`} />
        </>}
        {shows('repos') && <motion.section className={`ov-repos ${shows('stats') ? '' : 'wide'}`} {...card(5)}>
          <header><span className="tile-label">Repositories</span><Link to="/app/repos" className="ov-more" aria-label="All repositories">→</Link></header>
          <ul>
            {repos.slice(0, 4).map((r) => (
              <li key={r.id}><Link to={`/app/repos/${r.id}`}><span className={`status-dot s-${r.status || 'idle'}`} /><b>{r.displayName || r.fullName}</b><span>{r.lastRunAt ? timeAgo(r.lastRunAt) : 'never run'}</span></Link></li>
            ))}
          </ul>
        </motion.section>}

        {shows('pipeline') && <motion.section className={`ov-card ov-pipe ${shows('who') ? '' : 'wide'}`} {...card(6)}>
          <header><h2>Pipeline</h2><span className="muted">{tasks.length} issue{tasks.length === 1 ? '' : 's'} so far</span></header>
          <Steps steps={m.funnel} />
        </motion.section>}
        {shows('who') && <motion.section className={`ov-card ov-who ${shows('pipeline') ? '' : 'wide'}`} {...card(7)}>
          <header><h2>Who did what</h2><span className="muted">actions per agent</span></header>
          <Workload rows={m.workload} />
        </motion.section>}

        {m.evidence.length > 0 && shows('evidence') && (
          <motion.section className={`ov-card ov-evidence ${shows('moves') ? '' : 'wide'}`} {...card(8)}>
            <header><h2>Failing runs, before and after</h2><span className="muted">% of runs failing</span></header>
            <div className="chart">
              <ResponsiveContainer width="100%" height={240}>
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
          </motion.section>
        )}
        {shows('moves') && <motion.section className={`ov-card ov-moves ${m.evidence.length && shows('evidence') ? '' : 'wide'}`} {...card(9)}>
          <header><h2>Latest moves</h2><Link to="/app/repos" className="link">All repositories →</Link></header>
          {m.recent.length === 0 ? <p className="muted">Nothing yet. The agents’ moves show up here the moment they make them.</p> : (
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
          )}
        </motion.section>}
      </div>
    </div>
  )
}

function Stat({ i, label, big, note, tone }: { i: number; label: string; big: React.ReactNode; note: string; tone: string }) {
  return (
    <motion.section className={`ov-stat tile-${tone}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.04 + i * 0.05 }} whileHover={{ y: -3 }}>
      <span className="tile-label">{label}</span>
      <span className="ov-stat-big">{big}</span>
      <span className="tile-note">{note}</span>
    </motion.section>
  )
}

/** The pipeline as a row of columns, one per stage, each as tall as the share of issues that got that far. */
function Steps({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  const tones = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--lab)', 'var(--reviewer)', 'var(--ink)']
  return (
    <ol className="ov-steps">
      {steps.map((s, i) => (
        <li key={s.label} style={{ ['--c' as string]: tones[i] }}>
          <b className="tabnum"><CountUp value={s.value} /></b>
          <div className="ov-step-track">
            {s.value > 0 && <motion.i initial={{ height: 0 }} animate={{ height: `${s.value ? Math.max(6, (s.value / max) * 100) : 0}%` }} transition={{ duration: 1, ease: easeOut, delay: 0.3 + i * 0.08 }} />}
          </div>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

function Workload({ rows }: { rows: { agent: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="ov-work">
      {rows.map((r, i) => (
        <li key={r.agent} style={{ ['--c' as string]: agentColor(r.agent) }}>
          <b>{r.agent}</b>
          <div>{r.count > 0 && <motion.i initial={{ width: 0 }} animate={{ width: `${r.count ? Math.max(4, (r.count / max) * 100) : 0}%` }} transition={{ duration: 0.9, ease: easeOut, delay: 0.35 + i * 0.07 }} />}</div>
          <span className="tabnum">{r.count}</span>
        </li>
      ))}
    </ul>
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
