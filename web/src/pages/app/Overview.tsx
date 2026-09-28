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
import { Standup } from './Standup'
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
  const evidence = m.evidence.slice(-EVIDENCE_MAX)
  const crowded = evidence.length > 5
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
        <Stat i={2} tone="coral" label="Still open" to="/app/repos" big={<CountUp value={m.open.total} />}
          viz={<StageBar stages={m.open.stages} />}
          note={m.open.oldest ? <>Oldest: <Link to={`/app/repos/${m.open.oldest.repoId}/tasks/${m.open.oldest.task_id}`} className="ov-stat-link">{m.open.oldest.task_id}</Link>, {m.open.oldest.where} for {since(m.open.oldest.at)}</> : 'Nothing open. Every issue is fixed or closed.'} />
        <Stat i={3} tone="green" label="Time to a fix" big={m.speed.median === null ? '—' : duration(m.speed.median)}
          viz={<Spark values={m.speed.recent} tone="var(--ink)" title="Each of the latest fixes, issue to approval" />}
          note={m.speed.median === null ? 'Appears after the first approved fix' : `median, issue to approval · ${m.speed.firstTry} of ${m.speed.count} passed on the first try`} />
        <Stat i={4} tone="sky" label="Last 7 days" big={<CountUp value={m.week.fixed} />}
          viz={<Spark values={m.week.days} tone="var(--ink)" bars labels={m.week.labels} title="Agent moves per day" />}
          note={`fix${m.week.fixed === 1 ? '' : 'es'} approved · ${m.week.moves} agent moves${m.week.delta === null ? '' : `, ${m.week.delta >= 0 ? '+' : ''}${m.week.delta}% on the week before`}`} />
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
            <header><h2>Failing runs, before and after</h2><span className="muted">% of runs failing{m.evidence.length > EVIDENCE_MAX ? ` · latest ${EVIDENCE_MAX} tests` : ''}</span></header>
            <div className="chart">
              <ResponsiveContainer width="100%" height={crowded ? 290 : 240}>
                <BarChart data={evidence} barGap={crowded ? 2 : 4} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                  {/* a few tests get their names flat; more than that, short names on a slant so they never overlap */}
                  <XAxis dataKey="test" tick={{ fontSize: 11, fill: 'var(--ink-2)' }} tickLine={false} axisLine={false} interval={0}
                    angle={crowded ? -40 : 0} textAnchor={crowded ? 'end' : 'middle'} height={crowded ? 72 : 30}
                    tickFormatter={(v: string) => clip(v.replace(/^test_/, ''), crowded ? 12 : 16)} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip cursor={{ fill: 'var(--grey-8)' }} labelFormatter={(v) => String(v)} contentStyle={{ borderRadius: 12, border: '1.5px solid var(--ink)', fontSize: 13 }} formatter={(v, n) => [`${v}%`, String(n)]} />
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

        {shows('standup') && <Standup tasks={tasks} className="wide" motionProps={card(10)} />}
      </div>
    </div>
  )
}

const EVIDENCE_MAX = 12
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function Stat({ i, label, big, note, tone, viz, to }: { i: number; label: string; big: React.ReactNode; note: React.ReactNode; tone: string; viz?: React.ReactNode; to?: string }) {
  return (
    <motion.section className={`ov-stat tile-${tone}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.04 + i * 0.05 }} whileHover={{ y: -3 }}>
      <header className="ov-stat-head"><span className="tile-label">{label}</span>{to && <Link to={to} className="ov-more" aria-label={`Open ${label.toLowerCase()}`}>→</Link>}</header>
      <div className="ov-stat-mid"><span className="ov-stat-big">{big}</span>{viz}</div>
      <span className="tile-note">{note}</span>
    </motion.section>
  )
}

const STAGE_TONE: Record<string, string> = { 'Needs you': 'var(--white)', Triage: 'var(--triager)', Patching: 'var(--coder)', Testing: 'var(--tester)', Review: 'var(--reviewer)' }

/** Where the open issues are sitting, as one bar split by stage, with a legend that counts each. */
function StageBar({ stages }: { stages: { label: string; n: number }[] }) {
  const total = stages.reduce((s, x) => s + x.n, 0)
  const shown = stages.filter((s) => s.n)
  if (!total) return null
  return (
    <div className="ov-stagebar">
      <div className="ov-stagebar-track">
        {shown.map((s, k) => (
          <motion.i key={s.label} style={{ background: STAGE_TONE[s.label] }} data-tip={`${s.label}: ${s.n}`}
            initial={{ flexGrow: 0 }} animate={{ flexGrow: s.n }} transition={{ duration: 0.9, ease: easeOut, delay: 0.35 + k * 0.06 }} />
        ))}
      </div>
      <ul>{shown.map((s) => <li key={s.label}><i style={{ background: STAGE_TONE[s.label] }} />{s.label} <b>{s.n}</b></li>)}</ul>
    </div>
  )
}

/** A tiny chart: bars for counts per day, or a line for a run of values. Grows in from the baseline. */
function Spark({ values, tone, bars, labels, title }: { values: number[]; tone: string; bars?: boolean; labels?: string[]; title: string }) {
  if (values.length < 2 && !bars) return null
  const max = Math.max(1, ...values), W = 120, H = 40
  if (bars) {
    const w = W / values.length
    return (
      <svg className="ov-spark" viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label={title}>
        {values.map((v, k) => {
          const h = v ? Math.max(3, (v / max) * H) : 1.5
          return (
            <g key={k}>
              <motion.rect x={k * w + 2} width={w - 4} rx={2.5} fill={k === values.length - 1 ? tone : 'rgba(15,15,15,0.35)'}
                initial={{ height: 0, y: H }} animate={{ height: h, y: H - h }} transition={{ duration: 0.7, ease: easeOut, delay: 0.35 + k * 0.05 }}>
                <title>{`${labels?.[k] ?? ''}: ${v}`}</title>
              </motion.rect>
              {labels && <text x={k * w + w / 2} y={H + 10} textAnchor="middle" className="ov-spark-lab">{labels[k]}</text>}
            </g>
          )
        })}
      </svg>
    )
  }
  const pts = values.map((v, k) => `${(k / (values.length - 1)) * W},${H - (v / max) * (H - 4) - 2}`).join(' ')
  return (
    <svg className="ov-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      <motion.polyline points={pts} fill="none" stroke={tone} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: easeOut, delay: 0.35 }} />
      {values.map((v, k) => <circle key={k} cx={(k / (values.length - 1)) * W} cy={H - (v / max) * (H - 4) - 2} r={k === values.length - 1 ? 3.5 : 0} fill={tone}><title>{duration(v)}</title></circle>)}
    </svg>
  )
}

const HOUR = 3600_000
function duration(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${Math.max(1, m)}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${m % 60 && h < 10 ? ` ${m % 60}m` : ''}`
  return `${Math.round(h / 24)}d`
}
const since = (ts: string) => duration(Date.now() - new Date(ts).getTime())

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
  const workload = AGENTS.map((a) => ({ agent: a, count: tasks.reduce((n, t) => n + t.history.filter((h) => h.agent === a).length, 0) }))
  const recent = tasks.flatMap((t) => t.history.map((h) => ({ ...h, task: t.task_id, repoId: t.repoId })))
    .sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8)
  // what's still open, split by where it's sitting, and the one that's been sitting longest
  const STAGE: Partial<Record<string, [string, string]>> = {
    'Needs Human': ['Needs you', 'waiting for you'], 'New Issue': ['Triage', 'waiting for triage'], Triaged: ['Patching', 'waiting for a patch'],
    'In Progress': ['Patching', 'being patched'], Rejected: ['Patching', 'back with the coder'], 'Awaiting Tests': ['Testing', 'in testing'], 'In Review': ['Review', 'in review'],
  }
  const entered = (t: Task) => [...t.history].reverse().find((h) => h.to_state === t.state)?.ts || t.updated_at || t.created_at
  const openTasks = tasks.filter((t) => STAGE[t.state])
  const stages = ['Needs you', 'Triage', 'Patching', 'Testing', 'Review'].map((label) => ({ label, n: openTasks.filter((t) => STAGE[t.state]![0] === label).length }))
  const stuck = openTasks.map((t) => ({ ...t, at: entered(t), where: STAGE[t.state]![1] })).sort((a, b) => a.at.localeCompare(b.at))[0]

  // how long an issue takes to reach an approved fix, and how often the first patch was the one
  const fixes = tasks.map((t) => {
    const ok = t.history.find((h) => h.to_state === 'Approved')
    return ok && t.created_at ? { ms: new Date(ok.ts).getTime() - new Date(t.created_at).getTime(), at: ok.ts, first: !t.history.some((h) => h.to_state === 'Rejected') } : null
  }).filter((f): f is { ms: number; at: string; first: boolean } => !!f && f.ms >= 0).sort((a, b) => a.at.localeCompare(b.at))
  const sorted = fixes.map((f) => f.ms).sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null

  // the last seven days, one bar per day, against the seven before
  const day0 = new Date(); day0.setHours(0, 0, 0, 0)
  const start = day0.getTime() - 6 * 24 * HOUR
  const days = Array(7).fill(0), labels = Array.from({ length: 7 }, (_, k) => new Date(start + k * 24 * HOUR).toLocaleDateString(undefined, { weekday: 'narrow' }))
  let prev = 0, fixedWeek = 0
  for (const t of tasks) for (const h of t.history) {
    const at = new Date(h.ts).getTime()
    if (at >= start) { days[Math.min(6, Math.floor((at - start) / (24 * HOUR)))]++; if (h.to_state === 'Approved') fixedWeek++ }
    else if (at >= start - 7 * 24 * HOUR) prev++
  }
  const movesWeek = days.reduce((s, n) => s + n, 0)

  return {
    funnel, evidence, workload, recent,
    open: { total: openTasks.length, stages, oldest: stuck ? { repoId: stuck.repoId, task_id: stuck.task_id, at: stuck.at, where: stuck.where } : null },
    speed: { median, count: fixes.length, firstTry: fixes.filter((f) => f.first).length, recent: fixes.slice(-8).map((f) => f.ms) },
    week: { days, labels, moves: movesWeek, fixed: fixedWeek, delta: prev ? Math.round(((movesWeek - prev) / prev) * 100) : null },
  }
}
