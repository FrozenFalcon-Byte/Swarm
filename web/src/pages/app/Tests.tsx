import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useDeferredValue, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { CAUSES, SAMPLES, scan } from '../../lib/flakescan'
import { easeOut } from '../../lib/motion'
import type { Repo, Task } from '../../lib/types'
import { PageHead } from './Overview'
import { EmptyState, StatePill, timeAgo } from './ui'

/* Every test the swarm has looked at, one row each, with where it stands: fixed, a fix ready for you,
   being worked on, or handed to you. Each shows how often it failed before and after, what caused it
   and what proved the fix. From here you can also scan a suspicious test before filing it, and turn
   the whole list into a report for a standup or release notes. */

type Item = Task & { repoId: string }
type Status = 'fixed' | 'ready' | 'working' | 'you' | 'queued' | 'closed'
const STATUS: Record<Status, { label: string; color: string; order: number }> = {
  you: { label: 'Needs you', color: 'var(--triager)', order: 0 },
  ready: { label: 'Fix ready', color: 'var(--green)', order: 1 },
  working: { label: 'Being fixed', color: 'var(--coder)', order: 2 },
  queued: { label: 'Queued', color: 'var(--grey-6)', order: 3 },
  fixed: { label: 'Fixed', color: 'var(--reviewer)', order: 4 },
  closed: { label: 'Closed', color: 'var(--line)', order: 5 },
}
function statusOf(t: Task): Status {
  switch (t.state) {
    case 'Merged': return 'fixed'
    case 'Approved': return 'ready'
    case 'Needs Human': return 'you'
    case 'Closed': return 'closed'
    case 'New Issue': case 'Triaged': return 'queued'
    default: return 'working'
  }
}
interface Row { key: string; test: string; file: string; repoId: string; task: Item; status: Status; before: number | null; after: number | null; runs: number; cause: string; tool?: string; seen: number }

function rowsFrom(tasks: Item[]): Row[] {
  const byKey = new Map<string, Row>()
  for (const t of tasks) {
    const ev = t.artifacts.test_summary?.harness?.evidence || {}
    const ids = new Set([...(t.artifacts.test_ids || []), ...Object.keys(ev)])
    for (const id of ids) {
      const e = ev[id]
      const key = `${t.repoId}::${id}`
      const prev = byKey.get(key)
      const rate = (x?: { failures: number | null; runs: number }) => (x?.runs ? Math.round(((x.failures ?? 0) / x.runs) * 100) : null)
      const row: Row = {
        key, test: id.split('::').pop() || id, file: id.includes('::') ? id.split('::')[0] : '', repoId: t.repoId, task: t, status: statusOf(t),
        before: rate(e?.before), after: t.state === 'Merged' || t.artifacts.review ? rate(e?.after) : null, runs: e?.before?.runs ?? 0,
        cause: t.artifacts.flakiness_source || t.artifacts.root_cause || '', tool: t.artifacts.test_summary?.harness?.tool_id,
        seen: (prev?.seen ?? 0) + 1,
      }
      // the most recently updated task speaks for the test
      if (!prev || t.updated_at > prev.task.updated_at) byKey.set(key, { ...row, before: row.before ?? prev?.before ?? null })
      else prev.seen = row.seen
    }
  }
  return [...byKey.values()]
}

const SORTS = [
  { id: 'attention', label: 'Needs attention first' },
  { id: 'worst', label: 'Worst failure rate' },
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name' },
] as const
type Sort = (typeof SORTS)[number]['id']

export default function Tests() {
  const { user } = useAuth()
  const toast = useToast()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id)) as Item[]
  const rows = useMemo(() => rowsFrom(tasks), [tasks])
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [q, setQ] = useState('')
  const needle = useDeferredValue(q.trim().toLowerCase())
  const [sort, setSort] = useState<Sort>('attention')
  const [repo, setRepo] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const repoName = (id: string) => repos.find((r) => r.id === id)?.displayName || repos.find((r) => r.id === id)?.fullName || 'repo'

  const inRepo = rows.filter((r) => repo === 'all' || r.repoId === repo)
  const counts = Object.fromEntries((Object.keys(STATUS) as Status[]).map((s) => [s, inRepo.filter((r) => r.status === s).length])) as Record<Status, number>
  const shown = useMemo(() => inRepo
    .filter((r) => status === 'all' || r.status === status)
    .filter((r) => !needle || `${r.test} ${r.file} ${r.cause} ${r.task.task_id} ${r.task.title}`.toLowerCase().includes(needle))
    .sort((a, b) => sort === 'name' ? a.test.localeCompare(b.test)
      : sort === 'recent' ? b.task.updated_at.localeCompare(a.task.updated_at)
      : sort === 'worst' ? (b.before ?? -1) - (a.before ?? -1)
      : STATUS[a.status].order - STATUS[b.status].order || (b.before ?? -1) - (a.before ?? -1)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, status, needle, sort, repo])

  const fixedRuns = inRepo.filter((r) => r.status === 'fixed' && r.before !== null)
  const avgBefore = fixedRuns.length ? Math.round(fixedRuns.reduce((n, r) => n + (r.before ?? 0), 0) / fixedRuns.length) : null

  const report = () => {
    const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
    const line = (r: Row) => `- \`${r.test}\` (${repoName(r.repoId)}, ${r.task.task_id})${r.before !== null ? `: ${r.before}% of runs failing${r.after !== null ? ` → ${r.after}%` : ''}` : ''}${r.cause ? `. ${r.cause}` : ''}`
    const part = (s: Status, title: string) => { const xs = inRepo.filter((r) => r.status === s); return xs.length ? [`### ${title} (${xs.length})`, ...xs.map(line), ''] : [] }
    return [`## Tests that fail at random: ${date}`, '', ...part('fixed', 'Fixed'), ...part('ready', 'Fix ready to merge'), ...part('you', 'Needs a decision'), ...part('working', 'Being fixed'), ...part('queued', 'Queued')].join('\n')
  }
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(report()); toast.ok('Report copied', 'Markdown, ready for Slack, a PR or release notes.') }
    catch { toast.error('Couldn’t copy', 'Your browser blocked the clipboard.') }
  }
  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([report()], { type: 'text/markdown' }))
    Object.assign(document.createElement('a'), { href: url, download: `swarm-tests-${new Date().toISOString().slice(0, 10)}.md` }).click()
    URL.revokeObjectURL(url)
  }

  if (!loading && repos.length === 0) {
    return <div className="page"><PageHead title="Tests" /><EmptyState title="No repositories yet" text="Connect one and every test the agents look at is tracked here."><Link to="/app" className="btn btn-dark">Connect a repository</Link></EmptyState></div>
  }

  return (
    <div className="page">
      <PageHead title="Tests" sub="Every test the swarm has looked at, and where it stands.">
        <div className="tst-head-actions">
          <button className="btn btn-dark" onClick={() => setScanning(true)}>Scan a test</button>
          <button className="btn btn-line" onClick={copyReport} disabled={!inRepo.length}>Copy report</button>
          <button className="btn btn-line" onClick={downloadReport} disabled={!inRepo.length} aria-label="Download report as Markdown" title="Download .md">↓ .md</button>
        </div>
      </PageHead>

      {/* health at a glance: one bar, one segment per status, each a filter */}
      <motion.div className="tst-health" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: easeOut }}>
        <div className="tst-health-top">
          <div><b className="tabnum">{inRepo.length}</b><span>tests tracked</span></div>
          <div><b className="tabnum">{counts.fixed}</b><span>fixed for good</span></div>
          <div><b className="tabnum">{avgBefore === null ? '—' : `${avgBefore}%`}</b><span>of runs they used to fail</span></div>
        </div>
        <div className="tst-bar" aria-hidden="true">
          {(Object.keys(STATUS) as Status[]).filter((s) => counts[s]).map((s, k) => (
            <motion.i key={s} style={{ background: STATUS[s].color }} initial={{ flexGrow: 0 }} animate={{ flexGrow: counts[s], opacity: status === 'all' || status === s ? 1 : 0.3 }}
              transition={{ duration: 0.9, ease: easeOut, delay: k * 0.05 }} />
          ))}
        </div>
        <LayoutGroup id="tst-status">
          <div className="tst-chips">
            {(['all', ...Object.keys(STATUS)] as (Status | 'all')[]).filter((s) => s === 'all' || counts[s as Status]).map((s) => (
              <button key={s} className={`tst-chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
                {status === s && <motion.span layoutId="tst-chip-on" className="tst-chip-on" transition={{ type: 'spring', stiffness: 440, damping: 34 }} />}
                {s !== 'all' && <i style={{ background: STATUS[s as Status].color }} />}
                <span>{s === 'all' ? 'All' : STATUS[s as Status].label}</span>
                <small>{s === 'all' ? inRepo.length : counts[s as Status]}</small>
              </button>
            ))}
          </div>
        </LayoutGroup>
      </motion.div>

      <div className="toolbar">
        <label className="tst-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a test, file or cause" aria-label="Search tests" />
        </label>
        <div className="toolbar-side">
          {repos.length > 1 && (
            <select className="selectbox" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository">
              <option value="all">All repositories</option>
              {repos.map((r: Repo) => <option key={r.id} value={r.id}>{r.displayName || r.fullName}</option>)}
            </select>
          )}
          <select className="selectbox" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="tst-none">
          <EmptyState title={rows.length ? 'No tests match' : 'No tests yet'} text={rows.length ? 'Try another word or status.' : 'Tests appear here as soon as the triager links an issue to one.'} />
        </div>
      ) : (
        <ul className="tst-list">
          <AnimatePresence initial={false}>
            {shown.map((r, k) => (
              <motion.li key={r.key} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(k, 10) * 0.025 } }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.35, ease: easeOut }} className={`tst-item ${open === r.key ? 'is-open' : ''}`}>
                <button className="tst-row" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
                  <span className="tst-status" style={{ ['--c' as string]: STATUS[r.status].color }}><i />{STATUS[r.status].label}</span>
                  <span className="tst-name"><b className="mono">{r.test}</b><span>{r.file || repoName(r.repoId)}{r.file && repos.length > 1 ? ` · ${repoName(r.repoId)}` : ''}</span></span>
                  <Rates before={r.before} after={r.after} />
                  <span className="tst-when">{timeAgo(r.task.updated_at)}</span>
                  <motion.span className="tst-chev" animate={{ rotate: open === r.key ? 90 : 0 }} aria-hidden="true">›</motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open === r.key && (
                    <motion.div className="tst-more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: [0.65, 0, 0.35, 1] }}>
                      <div className="tst-more-in">
                        <dl className="kv">
                          <dt>Task</dt><dd><StatePill state={r.task.state} /> <span className="mono">{r.task.task_id}</span> · {r.task.title}</dd>
                          {r.cause && <><dt>Cause</dt><dd>{r.cause}</dd></>}
                          {r.task.artifacts.strategy && <><dt>Fix</dt><dd className="mono">{r.task.artifacts.strategy}</dd></>}
                          {r.tool && <><dt>Proved by</dt><dd className="mono">{r.tool}{r.runs ? ` · ${r.runs} runs` : ''}</dd></>}
                          {r.seen > 1 && <><dt>History</dt><dd>Came up in {r.seen} tasks</dd></>}
                        </dl>
                        <div className="tst-more-actions">
                          <Link to={`/app/repos/${r.repoId}/tasks/${r.task.task_id}`} className="btn btn-dark btn-sm">Open the task</Link>
                          <button className="btn btn-line btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(r.file ? `${r.file}::${r.test}` : r.test); toast.ok('Test id copied') } catch { /* blocked */ } }}>Copy test id</button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {createPortal(<AnimatePresence>{scanning && <ScanDrawer onClose={() => setScanning(false)} />}</AnimatePresence>, document.body)}
    </div>
  )
}

/** Before → after as two small bars with the numbers. */
function Rates({ before, after }: { before: number | null; after: number | null }) {
  if (before === null) return <span className="tst-rates muted">not measured yet</span>
  return (
    <span className="tst-rates" aria-label={`${before}% failing before${after !== null ? `, ${after}% after` : ''}`}>
      <span className="tst-rate"><i style={{ width: `${Math.max(4, before)}%`, background: 'var(--tester)' }} /></span>
      <b className="tabnum">{before}%</b>
      <span className="muted">→</span>
      {after === null ? <span className="muted">…</span> : <b className="tabnum" style={{ color: after ? 'var(--bad)' : 'var(--ok)' }}>{after}%</b>}
    </span>
  )
}

/** The playground's analyser, in a drawer: paste a test, see what makes it fail at random. */
function ScanDrawer({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const deferred = useDeferredValue(code)
  const result = useMemo(() => scan(deferred), [deferred])
  const share = code ? `/playground#c=${btoa(unescape(encodeURIComponent(code)))}` : '/playground'
  return (
    <>
      <motion.div className="scrim scrim--drawer" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
      <motion.aside className="drawer tst-scan" role="dialog" aria-modal="true" aria-label="Scan a test" initial={{ x: '104%' }} animate={{ x: 0 }} exit={{ x: '104%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40, mass: 0.9 }} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <header className="drawer-head">
          <div style={{ flex: 1 }}><span className="mono muted">runs in your browser</span><h2>Scan a test</h2></div>
          <button className="drawer-close" onClick={onClose} aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>
        <div className="drawer-body">
          <p className="muted">Paste a pytest test you suspect. You’ll see the lines that make it pass one run and fail the next, before you file it.</p>
          <textarea className="tst-code mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="def test_…" spellCheck={false} autoFocus rows={12} />
          {!code && <button className="link" onClick={() => setCode(SAMPLES[0].code)}>Try an example</button>}
          {code && (
            <motion.div className="tst-scan-out" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="tst-scan-risk"><b className="tabnum">{Math.round(result.risk * 100)}%</b><span>chance a run fails, from {result.findings.length} {result.findings.length === 1 ? 'cause' : 'causes'}</span></div>
              <ul className="tst-scan-list">
                {result.findings.map((f) => (
                  <li key={`${f.line}-${f.cause}`} style={{ ['--c' as string]: CAUSES[f.cause].color }}>
                    <span className="mono">L{f.line + 1}</span><span><b>{CAUSES[f.cause].label}</b>{f.text}</span>
                  </li>
                ))}
                {!result.findings.length && <li className="tst-scan-ok">Nothing known here. If it still fails at random, let the swarm run it many times.</li>}
              </ul>
              <Link to={share} className="btn btn-line btn-sm">Open in the playground to fix it</Link>
            </motion.div>
          )}
        </div>
      </motion.aside>
    </>
  )
}
