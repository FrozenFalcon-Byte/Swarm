import { LayoutGroup, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Repo, Task, TaskState } from '../../lib/types'
import { PageHead } from './Overview'
import { CountUp, EmptyState, Section } from './ui'

/* How the swarm is doing over time: how much comes in and gets merged, how long a fix takes, what the
   causes turn out to be, and where tasks spend their time. Everything is computed from the task
   histories in your repositories, for the range you pick, and can be exported as a CSV. */

type Item = Task & { repoId: string }
const RANGES = [{ id: 7, label: '7 days' }, { id: 30, label: '30 days' }, { id: 90, label: '90 days' }, { id: 0, label: 'All time' }]
const DAY = 86_400_000
const STAGES: { state: TaskState; label: string; color: string }[] = [
  { state: 'Triaged', label: 'Waiting for a coder', color: 'var(--triager)' },
  { state: 'In Progress', label: 'Being patched', color: 'var(--coder)' },
  { state: 'Awaiting Tests', label: 'Being proven', color: 'var(--tester)' },
  { state: 'In Review', label: 'In review', color: 'var(--reviewer)' },
  { state: 'Approved', label: 'Waiting for you', color: 'var(--lab)' },
]

export default function Insights() {
  const { user } = useAuth()
  const toast = useToast()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const all = useAllTasks(repos.map((r) => r.id)) as Item[]
  const [range, setRange] = useState(30)
  const [repo, setRepo] = useState('all')
  const tasks = useMemo(() => {
    const since = range ? Date.now() - range * DAY : 0
    return all.filter((t) => (repo === 'all' || t.repoId === repo) && Date.parse(t.created_at) >= since)
  }, [all, range, repo])
  const m = useMemo(() => measure(tasks, range), [tasks, range])

  const exportCsv = () => {
    const head = ['repo', 'task', 'issue', 'title', 'state', 'kind', 'priority', 'cause', 'attempts', 'created', 'updated', 'hours_to_approved']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = tasks.map((t) => [repos.find((r) => r.id === t.repoId)?.fullName, t.task_id, t.source_issue, t.title, t.state, t.kind, t.priority,
      causeOf(t), t.attempts, t.created_at, t.updated_at, hoursTo(t, 'Approved')?.toFixed(1)].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `swarm-insights-${new Date().toISOString().slice(0, 10)}.csv` })
    a.click(); URL.revokeObjectURL(url)
    toast.ok('CSV exported', `${tasks.length} tasks`)
  }

  if (!loading && repos.length === 0) {
    return <div className="page"><PageHead title="Insights" /><EmptyState title="Nothing to measure yet" text="Connect a repository and the numbers fill in as the agents work."><Link to="/app" className="btn btn-dark">Connect a repository</Link></EmptyState></div>
  }

  return (
    <div className="page">
      <PageHead title="Insights" sub="How the swarm is doing, worked out from every task’s history.">
        <button className="btn btn-line" onClick={exportCsv} disabled={!tasks.length}>Export CSV</button>
      </PageHead>

      <div className="toolbar">
        <LayoutGroup id="ins-range">
          <div className="seg" role="tablist">
            {RANGES.map((r) => (
              <button key={r.id} role="tab" aria-selected={range === r.id} className={`seg-btn ${range === r.id ? 'on' : ''}`} onClick={() => setRange(r.id)}>
                {range === r.id && <motion.span layoutId="ins-range-on" className="seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        {repos.length > 1 && (
          <select className="selectbox" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository">
            <option value="all">All repositories</option>
            {repos.map((r) => <option key={r.id} value={r.id}>{r.displayName || r.fullName}</option>)}
          </select>
        )}
      </div>

      <div className="tiles ins-kpis" key={`${range}-${repo}`}>
        <Kpi k={0} tone="sky" label="Issues in" value={m.total} note={`${m.forSwarm} were for the swarm`} />
        <Kpi k={1} tone="green" label="Fixes merged" value={m.merged} note={`${m.approved} more approved`} />
        <Kpi k={2} tone="yellow" label="Time to a proven fix" value={m.medianHours ?? 0} decimals={m.medianHours !== null && m.medianHours < 10 ? 1 : 0} suffix="h"
          note={m.medianHours === null ? 'No approved fixes yet' : 'median, issue in → approved'} empty={m.medianHours === null} />
        <Kpi k={3} tone="coral" label="Right first time" value={m.firstTry ?? 0} suffix="%" note={m.firstTry === null ? 'No reviews yet' : 'approved without a rejection'} empty={m.firstTry === null} />
      </div>

      <Section title="Coming in, going out" action={<span className="muted">issues opened and fixes merged, per {m.bucket}</span>}>
        {m.flow.every((d) => !d.opened && !d.merged) ? <p className="muted pad">Nothing happened in this range.</p> : (
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={m.flow} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="ins-in" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--coder)" stopOpacity={0.7} /><stop offset="100%" stopColor="var(--coder)" stopOpacity={0.05} /></linearGradient>
                  <linearGradient id="ins-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--reviewer)" stopOpacity={0.8} /><stop offset="100%" stopColor="var(--reviewer)" stopOpacity={0.05} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-2)' }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1.5px solid var(--ink)', fontSize: 13 }} />
                <Area type="monotone" dataKey="opened" name="Issues in" stroke="var(--ink)" strokeWidth={2} fill="url(#ins-in)" animationDuration={1100} />
                <Area type="monotone" dataKey="merged" name="Merged" stroke="var(--green-deep)" strokeWidth={2} fill="url(#ins-out)" animationDuration={1100} animationBegin={200} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="legend"><span><i style={{ background: 'var(--coder)' }} />Issues in</span><span><i style={{ background: 'var(--reviewer)' }} />Merged</span></div>
          </div>
        )}
      </Section>

      <div className="grid-2">
        <Section title="What the causes were" action={<span className="muted">{m.causes.reduce((n, c) => n + c.n, 0)} diagnosed</span>}>
          {m.causes.length === 0 ? <p className="muted pad">Causes appear once the coder has diagnosed a task.</p> : (
            <ul className="ins-bars">
              {m.causes.map((c, k) => (
                <li key={c.label}>
                  <span className="ins-bar-label">{c.label}</span>
                  <span className="ins-bar-track"><motion.i style={{ background: ['var(--coder)', 'var(--triager)', 'var(--tester)', 'var(--reviewer)', 'var(--lab)', 'var(--sky-card)'][k % 6] }}
                    initial={{ width: 0 }} whileInView={{ width: `${(c.n / m.causes[0].n) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: easeOut, delay: k * 0.06 }} /></span>
                  <b className="tabnum">{c.n}</b>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Where the time goes" action={<span className="muted">average hours per stage</span>}>
          {m.stages.every((s) => s.hours === null) ? <p className="muted pad">Appears once tasks have moved through a few stages.</p> : (
            <>
              <div className="ins-stack" aria-hidden="true">
                {m.stages.filter((s) => s.hours).map((s, k) => (
                  <motion.i key={s.state} style={{ background: s.color }} initial={{ flexGrow: 0 }} whileInView={{ flexGrow: s.hours! }} viewport={{ once: true }} transition={{ duration: 1, ease: easeOut, delay: k * 0.05 }} />
                ))}
              </div>
              <ul className="ins-stages">
                {m.stages.map((s) => (
                  <li key={s.state}><i style={{ background: s.color }} /><span>{s.label}</span><b className="tabnum">{s.hours === null ? '—' : fmtH(s.hours)}</b></li>
                ))}
              </ul>
              {m.slowest && <p className="ins-tip">Most of the wait is <b>{m.slowest.label.toLowerCase()}</b>.{m.slowest.state === 'Approved' ? ' The Tests page lists every fix ready for you.' : ''}</p>}
            </>
          )}
        </Section>
      </div>

      <Section title="By repository" action={<span className="muted">since each was connected</span>}>
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead><tr><th>Repository</th><th>Open</th><th>Needs you</th><th>Merged</th><th>Failing runs</th><th>Tools</th></tr></thead>
            <tbody>
              {repos.map((r, k) => <RepoRow key={r.id} r={r} k={k} />)}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function RepoRow({ r, k }: { r: Repo; k: number }) {
  const s = r.stats
  return (
    <motion.tr initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + k * 0.05, duration: 0.4, ease: easeOut }}>
      <td><Link to={`/app/repos/${r.id}`} className="ins-repo"><span className={`status-dot s-${r.status || 'idle'}`} />{r.displayName || r.fullName}</Link></td>
      <td className="tabnum">{s?.open ?? '—'}</td>
      <td className="tabnum">{s?.needsYou ? <Link to={`/app/repos/${r.id}`} className="pill tone-warn">{s.needsYou}</Link> : 0}</td>
      <td className="tabnum">{s?.merged ?? '—'}</td>
      <td className="tabnum">{s?.flakeRateBefore == null ? '—' : <>{Math.round(s.flakeRateBefore * 100)}% <span className="muted">→</span> <b style={{ color: 'var(--ok)' }}>{Math.round((s.flakeRateAfter ?? 0) * 100)}%</b></>}</td>
      <td className="tabnum">{s ? `${s.toolsWritten} · ${s.toolReuses} reused` : '—'}</td>
    </motion.tr>
  )
}

function Kpi({ k, label, value, note, tone, suffix = '', decimals = 0, empty }: { k: number; label: string; value: number; note: string; tone: string; suffix?: string; decimals?: number; empty?: boolean }) {
  return (
    <motion.div className={`tile tile-${tone}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: easeOut, delay: k * 0.06 }} whileHover={{ y: -3 }}>
      <span className="tile-label">{label}</span>
      <span className="tile-big">{empty ? '—' : <CountUp value={value} decimals={decimals} suffix={suffix} />}</span>
      <span className="tile-note">{note}</span>
    </motion.div>
  )
}

/* ---------------------------------------------------------------- the arithmetic */

const causeOf = (t: Task) => t.artifacts.flakiness_source || t.artifacts.strategy?.split(/[:(]/)[0] || ''
/** When the task first entered `state`, from its history. */
const enteredAt = (t: Task, state: TaskState) => { const h = t.history.find((x) => x.to_state === state); return h ? Date.parse(h.ts) : null }
function hoursTo(t: Task, state: TaskState) { const at = enteredAt(t, state); return at === null ? null : (at - Date.parse(t.created_at)) / 3_600_000 }
const fmtH = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)}h` : `${(h / 24).toFixed(1)}d`)
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pretty = (s: string) => s.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function measure(tasks: Item[], range: number) {
  const approvedAt = tasks.map((t) => hoursTo(t, 'Approved')).filter((h): h is number => h !== null && h >= 0)
  const reviewed = tasks.filter((t) => t.history.some((h) => h.to_state === 'Approved' || h.to_state === 'Rejected'))
  const clean = reviewed.filter((t) => !t.history.some((h) => h.to_state === 'Rejected') && t.history.some((h) => h.to_state === 'Approved'))

  // flow: bucket by day for short ranges, by week otherwise
  const days = range || Math.max(7, Math.ceil((Date.now() - Math.min(Date.now(), ...tasks.map((t) => Date.parse(t.created_at)))) / DAY))
  const step = days <= 31 ? DAY : 7 * DAY
  const n = Math.max(1, Math.ceil(days * DAY / step))
  const start = Date.now() - n * step
  const flow = Array.from({ length: n }, (_, i) => {
    const d = new Date(start + (i + 1) * step)
    return { label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), opened: 0, merged: 0 }
  })
  const slot = (ts: number) => Math.min(n - 1, Math.floor((ts - start) / step))
  for (const t of tasks) {
    const c = Date.parse(t.created_at); if (c >= start) flow[slot(c)].opened++
    const mAt = enteredAt(t, 'Merged'); if (mAt !== null && mAt >= start) flow[slot(mAt)].merged++
  }

  const causeCount: Record<string, number> = {}
  for (const t of tasks) { const c = causeOf(t); if (c) causeCount[pretty(c)] = (causeCount[pretty(c)] || 0) + 1 }
  const causes = Object.entries(causeCount).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 7)

  // time in each stage: from entering it to entering whatever came next
  const stages = STAGES.map((s) => {
    const spans: number[] = []
    for (const t of tasks) {
      const i = t.history.findIndex((h) => h.to_state === s.state)
      if (i < 0) continue
      const nextH = t.history.slice(i + 1).find((h) => h.to_state && h.to_state !== s.state)
      const end = nextH ? Date.parse(nextH.ts) : t.state === s.state ? Date.now() : null
      if (end !== null) spans.push((end - Date.parse(t.history[i].ts)) / 3_600_000)
    }
    return { ...s, hours: spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : null }
  })
  const slowest = stages.filter((s) => s.hours).sort((a, b) => b.hours! - a.hours!)[0]

  return {
    total: tasks.length, forSwarm: tasks.filter((t) => t.kind === 'flaky-test').length,
    merged: tasks.filter((t) => t.state === 'Merged').length, approved: tasks.filter((t) => t.state === 'Approved').length,
    medianHours: median(approvedAt), firstTry: reviewed.length ? Math.round((clean.length / reviewed.length) * 100) : null,
    flow, bucket: step === DAY ? 'day' : 'week', causes, stages, slowest,
  }
}
