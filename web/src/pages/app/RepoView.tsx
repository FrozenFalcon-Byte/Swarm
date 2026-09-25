import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { agentColor } from '../../components/AgentDots'
import { useAuth } from '../../lib/auth'
import { queueRun, removeRepo, requestAction, setAutoSync, useActionStatus, useActivity, useRepo, useRuns, useTasks } from '../../lib/data'
import { easeInOut, easeOut } from '../../lib/motion'
import type { Task } from '../../lib/types'
import { ToolCards } from './ToolsPage'
import { LANES, PIPELINE, Section, StatePill, timeAgo } from './ui'

export default function RepoView() {
  const params = useParams()
  const repoId = params.repoId!
  const rest = (params['*'] || '').split('/')
  const tab = rest[0] === 'tasks' ? 'board' : rest[0] || 'board'
  const openTask = rest[0] === 'tasks' ? rest[1] : null
  const { user } = useAuth()
  const { repo, loading } = useRepo(repoId)
  const { data: tasks } = useTasks(repoId)
  const navigate = useNavigate()
  const [queued, setQueued] = useState(false)

  if (loading) return null
  if (!repo) return <div className="page"><Section title="Repository not found"><p className="muted">It may have been removed, or you aren’t a member. <Link className="link" to="/app/repos">Back to repositories</Link></p></Section></div>

  const needsYou = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human').length
  const busy = repo.status === 'running' || repo.status === 'queued' || queued
  const runNow = async () => { if (!user) return; setQueued(true); await queueRun(user.uid, repoId); setTimeout(() => setQueued(false), 4000) }

  return (
    <div className="page">
      <header className="repo-head">
        <div>
          <p className="surtitle"><span style={{ background: busy ? 'var(--triager)' : 'var(--green)' }} />{repo.source === 'demo' ? 'Demo repository' : 'GitHub repository'}</p>
          <h1 style={{ marginTop: 14 }}>{repo.displayName || repo.fullName}</h1>
          <div className="repo-meta">
            {repo.htmlUrl ? <a className="mono link" href={repo.htmlUrl} target="_blank" rel="noreferrer">{repo.fullName}</a> : <span className="mono">{repo.fullName}</span>}
            {repo.private && <span className="gh-lock">private</span>}
            {repo.defaultBranch && <><span>·</span><span className="mono">{repo.defaultBranch}</span></>}
            <span>·</span><span>last run {timeAgo(repo.lastRunAt)}</span>
          </div>
        </div>
        <div className="repo-actions">
          {repo.source === 'github' && repo.ownerUid === user?.uid && (
            <label className="toggle" title="The worker checks GitHub for new or edited issues and runs the swarm when it finds some">
              <input type="checkbox" checked={repo.settings?.autoSync !== false} onChange={(e) => setAutoSync(repoId, e.target.checked)} />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span>Watch for new issues</span>
            </label>
          )}
          {repo.ownerUid === user?.uid && (
            <button className="btn btn-line" onClick={async () => {
              if (!window.confirm(`Remove ${repo.displayName || repo.fullName} from Swarm? The agents stop working on it. Nothing changes on GitHub.`)) return
              await removeRepo(repoId); navigate('/app/repos')
            }}>Remove</button>
          )}
          <button className="btn btn-green" onClick={runNow} disabled={busy}>
            {busy ? <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }} style={{ display: 'inline-block' }}>◐</motion.span> Agents working</> : 'Run the swarm'}
          </button>
        </div>
      </header>

      {repo.status === 'error' && <div className="banner banner-bad">The last run failed: {repo.lastError}{/GitHub|token|rate limit/i.test(repo.lastError || '') ? <> <Link className="link" to="/app/settings">Open settings</Link></> : ' Check the worker’s log, then run again.'}</div>}

      <LayoutGroup id="tabs">
        <nav className="tabs" aria-label="Repository sections">
          {[['board', 'Board', needsYou], ['activity', 'Activity', 0], ['tools', 'Tools', 0], ['runs', 'Runs', 0]].map(([id, label, n]) => (
            <NavLink key={id as string} to={`/app/repos/${repoId}${id === 'board' ? '' : `/${id}`}`} end className={`tab ${tab === id ? 'on' : ''}`}>
              {tab === id && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ duration: 0.4, ease: easeOut }} />}
              <span>{label}</span>{!!n && <span className="tab-count">{n}</span>}
            </NavLink>
          ))}
        </nav>
      </LayoutGroup>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: easeOut }}>
          {tab === 'board' && <Lanes tasks={tasks} onOpen={(id) => navigate(`/app/repos/${repoId}/tasks/${id}`)} />}
          {tab === 'activity' && <ActivityFeed repoId={repoId} />}
          {tab === 'tools' && <ToolCards repoId={repoId} />}
          {tab === 'runs' && <Runs repoId={repoId} />}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {openTask && <TaskDrawer key={openTask} repoId={repoId} task={tasks.find((t) => t.task_id === openTask)} onClose={() => navigate(`/app/repos/${repoId}`)} />}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ board */

function Lanes({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const byLane = useMemo(() => LANES.map((l) => ({ ...l, tasks: tasks.filter((t) => l.states.includes(t.state)).sort((a, b) => a.task_id.localeCompare(b.task_id)) })), [tasks])
  if (!tasks.length) return <Section><p className="muted pad">No tasks yet. When the worker picks up the first run, issues appear here and move across the lanes live.</p></Section>
  return (
    <LayoutGroup id="lanes">
      <div className="lanes">
        {byLane.map((lane) => (
          <div key={lane.id} className="lane">
            <div className="lane-head"><span className="lane-swatch" style={{ background: lane.tone === 'none' ? 'var(--grey-6)' : `var(--${lane.tone})` }} /><b>{lane.title}</b><span className="lane-n">{lane.tasks.length}</span></div>
            <p className="lane-hint">{lane.hint}</p>
            <AnimatePresence>
              {lane.tasks.map((t) => (
                <motion.div key={t.task_id} layoutId={t.task_id} className="task-card" role="button" tabIndex={0}
                  onClick={() => onOpen(t.task_id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(t.task_id)}
                  initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ layout: { duration: 0.7, ease: easeInOut }, duration: 0.4 }}>
                  <div className="task-card-top mono"><span>{t.task_id}</span><span>{t.source_issue}</span></div>
                  <b>{t.title}</b>
                  <div className="task-card-tags">
                    <StatePill state={t.state} />
                    {t.priority !== 'unset' && <span className={`chip ${t.priority === 'high' || t.priority === 'critical' ? 'hot' : ''}`}>{t.priority}</span>}
                    {t.attempts > 1 && <span className="chip">attempt {t.attempts}</span>}
                  </div>
                  {t.assigned_agent && <span className="working"><span className="move-dot" style={{ background: agentColor(t.assigned_agent), width: 10, height: 10 }} />{t.assigned_agent} is on it</span>}
                </motion.div>
              ))}
            </AnimatePresence>
            {!lane.tasks.length && <div className="lane-empty">Nothing here</div>}
          </div>
        ))}
      </div>
    </LayoutGroup>
  )
}

/* ------------------------------------------------------------------ activity + runs */

function ActivityFeed({ repoId }: { repoId: string }) {
  const { data } = useActivity(repoId, 60)
  return (
    <Section title="Activity" action={<span className="muted">newest first · live</span>}>
      {!data.length ? <p className="muted pad">Nothing yet.</p> : (
        <ul className="feed">
          <AnimatePresence initial={false}>
            {data.map((e) => (
              <motion.li key={e.id} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
                <span className="feed-dot" style={{ background: agentColor(e.agent) }}>{e.agent.slice(0, 1)}</span>
                <div className="feed-main"><b>{e.agent}{e.task_id ? ` · ${e.task_id}` : ''}</b><span>{e.message}</span></div>
                <span className="muted">{timeAgo(e.ts)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Section>
  )
}

function Runs({ repoId }: { repoId: string }) {
  const { data } = useRuns(repoId)
  return (
    <Section title="Runs" action={<span className="muted">each run ingests new issues and works until idle</span>}>
      {!data.length ? <p className="muted pad">No runs yet.</p> : (
        <div className="runs">
          {data.map((r) => (
            <div key={r.id} className="run">
              <span className={`pill ${r.status === 'done' ? 'tone-ok' : r.status === 'failed' ? 'tone-bad' : 'tone-warn'}`}>{r.status}</span>
              <div className="run-main">
                <b>{r.trigger === 'connect' ? 'First run after connecting' : r.trigger?.startsWith('action:') ? `After you chose “${r.trigger.slice(7)}”` : 'Manual run'}</b>
                <span>{r.error ? r.error : r.summary ? `${r.summary.ingested} new issues · ${r.summary.tasksMoved} tasks moved · ${r.summary.llm || 'heuristics'} · ${r.summary.sandbox} sandbox` : 'Waiting for a worker…'}</span>
              </div>
              <span className="muted">{timeAgo(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ task drawer */

function TaskDrawer({ repoId, task, onClose }: { repoId: string; task?: Task; onClose: () => void }) {
  const { user } = useAuth()
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const { data: actions } = useActionStatus(repoId)
  const last = actions.find((a) => task && a.taskId === task.task_id)

  const act = async (type: 'merge' | 'approve' | 'reject' | 'reopen' | 'close') => {
    if (!user || !task) return
    if (type === 'reject' && !comment.trim()) { setSent('Say what should change so the coder can act on it.'); return }
    await requestAction(user.uid, user.displayName || user.email || 'maintainer', repoId, type, task.task_id, comment)
    setSent(null); setComment('')
  }

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside className="drawer" role="dialog" aria-label={task?.title || 'Task'} initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ duration: 0.6, ease: easeInOut }}>
        {!task ? <div className="drawer-body"><p className="muted">Loading task…</p></div> : (
          <>
            <header className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="mono muted">{task.task_id} · issue {task.source_issue}</span>
                <h2>{task.title}</h2>
                <div className="task-card-tags"><StatePill state={task.state} /><span className="chip">{task.kind}</span>{task.priority !== 'unset' && <span className="chip">{task.priority}</span>}</div>
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
            </header>
            <div className="drawer-body">
              <Stepper task={task} />
              {task.note && task.state !== 'Merged' && <div className={`banner ${task.state === 'Needs Human' ? 'banner-warn' : task.state === 'Rejected' ? 'banner-bad' : 'banner-info'}`}>{task.note}</div>}
              <div className="dsec"><h4>The issue</h4><p style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{task.body}</p></div>
              <dl className="kv">
                <dt>Triage</dt><dd>{task.artifacts.triage ? `${task.artifacts.triage.rationale} (confidence ${task.artifacts.triage.confidence})` : '—'}</dd>
                {task.artifacts.root_cause && <><dt>Root cause</dt><dd>{task.artifacts.root_cause}</dd></>}
                {task.artifacts.strategy && <><dt>Fix</dt><dd className="mono">{task.artifacts.strategy} · attempt {task.attempts}</dd></>}
                {!!task.artifacts.rejected_strategies?.length && <><dt>Rejected before</dt><dd className="mono">{task.artifacts.rejected_strategies.join(', ')}</dd></>}
                {task.artifacts.delivery && <><dt>Delivered</dt><dd>{linkify(task.artifacts.delivery)}</dd></>}
              </dl>
              {task.artifacts.diff_text && <div className="dsec"><h4>Patch</h4><Diff text={task.artifacts.diff_text} /></div>}
              <Evidence task={task} />
              {task.artifacts.review && (
                <div className="dsec"><h4>Review {task.artifacts.review.sensitive && '· security-sensitive'}</h4>
                  <div className="checks">{task.artifacts.review.checks.map((c) => (
                    <div key={c.name} className={`check ${c.ok ? 'ok' : 'no'}`}><span className="check-ic">{c.ok ? '✓' : '✕'}</span><span className="mono">{c.name}</span><span className="check-detail">{c.detail}</span></div>
                  ))}</div>
                </div>
              )}
              <div className="dsec"><h4>History</h4>
                <ul className="hist">{task.history.slice().reverse().map((h, k) => (
                  <li key={k}><span className="move-dot" style={{ background: agentColor(h.agent) }} /><span><span className="who">{h.agent}</span>{h.action}</span><span className="muted">{timeAgo(h.ts)}</span></li>
                ))}</ul>
              </div>
            </div>
            <Actions task={task} comment={comment} setComment={setComment} act={act} last={last} note={sent} />
          </>
        )}
      </motion.aside>
    </>
  )
}

function Actions({ task, comment, setComment, act, last, note }: {
  task: Task; comment: string; setComment: (s: string) => void; act: (t: 'merge' | 'approve' | 'reject' | 'reopen' | 'close') => void
  last?: { status: string; type: string; error?: string; result?: string }; note: string | null
}) {
  const pending = last && (last.status === 'pending' || last.status === 'processing')
  const status = pending ? <span className="action-status">Sent to the worker: {last!.type}…</span>
    : last?.status === 'failed' ? <span className="action-status" style={{ color: '#b3261e' }}>{last.type} failed: {last.error}</span>
    : last?.status === 'done' ? <span className="action-status">{last.type}: {last.result}</span> : null
  const body = (() => {
    switch (task.state) {
      case 'Approved': return <><button className="btn btn-green" onClick={() => act('merge')} disabled={!!pending}>Merge</button><input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should change? (to request changes)" /><button className="btn btn-line" onClick={() => act('reject')} disabled={!!pending}>Request changes</button></>
      case 'Needs Human': return <><input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (needed to request changes)" />
        {task.artifacts.diff_text && <><button className="btn btn-green" onClick={() => act('approve')} disabled={!!pending}>Approve patch</button><button className="btn btn-line" onClick={() => act('reject')} disabled={!!pending}>Request changes</button></>}
        {!task.artifacts.diff_text && <button className="btn btn-dark" onClick={() => act('reopen')} disabled={!!pending}>Send to the swarm</button>}
        <button className="btn btn-ghost" onClick={() => act('close')} disabled={!!pending}>Close</button></>
      case 'Closed': return <button className="btn btn-dark" onClick={() => act('reopen')} disabled={!!pending}>Reopen for the swarm</button>
      default: return null
    }
  })()
  if (!body && !status && !note) return null
  return <footer className="drawer-foot">{body}{note && <span className="form-error">{note}</span>}{status}</footer>
}

function Stepper({ task }: { task: Task }) {
  const reached = (s: string) => task.history.some((h) => h.to_state === s) || task.state === s
  if (task.state === 'Closed' || (task.state === 'Needs Human' && !task.artifacts.diff_text)) return null
  return (
    <div className="stepper" aria-label="Progress">
      {PIPELINE.map((s) => <div key={s} className={task.state === s ? 'now' : reached(s) ? 'done' : ''}><span />{s}</div>)}
    </div>
  )
}

function Evidence({ task }: { task: Task }) {
  const h = task.artifacts.test_summary?.harness
  if (!h) return null
  return (
    <div className="dsec"><h4>Proof · {h.tool_id} {h.reused ? '(reused)' : '(written for this task)'}</h4>
      <div className="evid">
        {Object.entries(h.evidence).map(([test, e]) => (
          <div key={test} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="mono muted">{test}</span>
            {([['Before', e.before, 'var(--tester)'], ['After', e.after, 'var(--reviewer)']] as const).map(([l, r, c]) => (
              <div className="evid-row" key={l}><b>{l}</b>
                <div className="evid-track"><motion.div style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, ((r.failures ?? 0) / (r.runs || 1)) * 100)}%` }} transition={{ duration: 1, ease: easeOut, delay: l === 'After' ? 0.3 : 0.1 }} /></div>
                <span className="mono">{r.failures ?? '?'}/{r.runs} fail</span>
              </div>
            ))}
          </div>
        ))}
        {!!task.artifacts.test_summary?.preexisting_failures?.length && <p className="muted">Known flaky tests tracked by other tasks: {task.artifacts.test_summary.preexisting_failures.join(', ')}</p>}
      </div>
    </div>
  )
}

function Diff({ text }: { text: string }) {
  return (
    <div className="diff">
      {text.split('\n').map((l, k) => (
        <div key={k} className={l.startsWith('+++') || l.startsWith('---') ? 'file' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l || ' '}</div>
      ))}
    </div>
  )
}

function linkify(text: string) {
  const m = text.match(/https:\/\/github\.com\/\S+/)
  if (!m) return text
  return <>{text.slice(0, m.index)}<a className="link" href={m[0]} target="_blank" rel="noreferrer">{m[0]}</a></>
}
