import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { agentColor } from '../../components/AgentDots'
import { useToast } from '../../components/Island'
import { useActionStatus } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Run, RunError } from '../../lib/types'
import { CountUp } from './ui'

/*
 * A run while it goes: the worker writes what phase it's in, how far along the tasks are and what each agent
 * is doing onto the run (swarm/cloud/worker.py, RunProgress) every second or two, and this reads it back.
 * It stays a few seconds after the run ends so the finish is seen, then folds away.
 */

const AGENTS = ['triager', 'coder', 'tester', 'reviewer']
const LINGER_MS = 6000

const say = (e: RunError) => `${e.agent}${e.task ? ` on ${e.task}` : ''}: ${e.error}`

export function RunProgressPanel({ runs }: { runs: Run[] }) {
  const run = runs[0]
  const live = run && (run.status === 'queued' || run.status === 'running')
  // a run that just finished lingers; one that finished before you opened the page doesn't show at all
  const [lingering, setLingering] = useState<string | null>(null)
  const seen = useRef<Record<string, Run['status']>>({})
  useEffect(() => {
    if (!run) return
    const before = seen.current[run.id]
    seen.current[run.id] = run.status
    if ((before === 'queued' || before === 'running') && !live) {
      setLingering(run.id)
      const id = window.setTimeout(() => setLingering(null), LINGER_MS)
      return () => window.clearTimeout(id)
    }
  }, [run?.id, run?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const show = run && (live || lingering === run.id)
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.section key="run" className="rp" aria-live="polite" aria-label="Run progress"
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.5, ease: easeOut }}>
          <Panel run={run} />
        </motion.section>
      )}
    </AnimatePresence>
  )
}

function Panel({ run }: { run: Run }) {
  const p = run.progress
  const failed = run.status === 'failed'
  const done = run.status === 'done'
  const percent = done ? 100 : p?.percent ?? 0
  const label = failed ? 'The run stopped' : done ? 'All done' : run.status === 'queued' && !p ? 'Waiting for the worker' : p?.label || 'Starting'
  const errors = p?.errors || run.summary?.errors || []
  return (
    <div className={`rp-in ${failed ? 'is-bad' : ''}`}>
      <div className="rp-top">
        <div className="rp-title">
          <b>{label}</b>
          <span className="muted">
            {failed ? run.error || 'The worker hit a problem.' : p?.tasks ? `${p.settled} of ${p.tasks} tasks settled` : run.status === 'queued' ? 'The worker picks it up in a few seconds.' : 'Getting ready…'}
          </span>
        </div>
        <span className="rp-pct"><CountUp value={percent} suffix="%" /></span>
      </div>
      <div className="rp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
        <motion.i className={done || failed ? '' : 'is-live'} initial={false} animate={{ width: `${Math.max(3, percent)}%` }} transition={{ duration: 0.9, ease: easeOut }} />
      </div>
      <ul className="rp-agents">
        {AGENTS.map((name) => {
          const a = p?.agents?.[name]
          return (
            <li key={name} className={`rp-agent ${a?.busy ? 'is-busy' : ''}`}>
              <span className="rp-dot" style={{ background: agentColor(name) }} />
              <span className="rp-agent-t">
                <b>{name}{a?.task && <span className="mono muted"> · {a.task}</span>}</b>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={a?.text || 'idle'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                    {a?.text || (a ? 'Done for now' : 'Waiting for work')}
                  </motion.span>
                </AnimatePresence>
              </span>
            </li>
          )
        })}
      </ul>
      {errors.length > 0 && (
        <ul className="rp-errors">
          {errors.map((e, i) => <li key={i}><span className="chip bad">{e.agent} hit an error</span><span>{e.task ? `${e.task}: ` : ''}{e.error}</span></li>)}
        </ul>
      )}
    </div>
  )
}

/** Toasts for what goes wrong (or right) while you're on the page: a run failing or finishing, an agent
 *  hitting an error mid-run, an action the worker couldn't carry out. Only changes are announced; whatever
 *  had already happened before you arrived stays quiet. */
export function useRunToasts(repoId: string, runs: Run[], loaded: boolean) {
  const toast = useToast()
  const { data: actions, loading: actionsLoading } = useActionStatus(repoId)
  const runSeen = useRef<Map<string, { status: string; errors: number }> | null>(null)
  const actSeen = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    if (!loaded) return
    const first = !runSeen.current
    const prev = runSeen.current || new Map()
    const next = new Map<string, { status: string; errors: number }>()
    for (const r of runs) {
      const errs = r.progress?.errors || r.summary?.errors || []
      next.set(r.id, { status: r.status, errors: errs.length })
      const was = prev.get(r.id)
      if (first || !was) continue
      if (errs.length > was.errors && r.status === 'running') toast.error('An agent hit an error', say(errs[errs.length - 1]))
      if (was.status === r.status) continue
      if (r.status === 'failed') toast.error('The run failed', r.error || 'The worker stopped partway. Its log has the details.')
      else if (r.status === 'done') {
        const s = r.summary
        if (s?.errors?.length) toast.error(`Done, with ${s.errors.length} ${s.errors.length === 1 ? 'error' : 'errors'}`, say(s.errors[0]))
        else toast.ok('Run finished', s ? `${s.tasksMoved} ${s.tasksMoved === 1 ? 'task' : 'tasks'} moved${s.toolsWritten ? ` · ${s.toolsWritten} new ${s.toolsWritten === 1 ? 'tool' : 'tools'}` : ''}` : undefined)
      }
    }
    runSeen.current = next
  }, [runs, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (actionsLoading) return
    const first = !actSeen.current
    const prev = actSeen.current || new Map()
    for (const a of actions) {
      if (!first && prev.get(a.id) !== a.status && a.status === 'failed') toast.error(`Couldn’t ${a.type} ${a.taskId}`, a.error || 'The worker couldn’t carry it out.')
    }
    actSeen.current = new Map(actions.map((a) => [a.id, a.status]))
  }, [actions, actionsLoading]) // eslint-disable-line react-hooks/exhaustive-deps
}
