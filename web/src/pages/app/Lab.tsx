import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CodeDialog } from '../../components/CodeWindow'
import { useToast } from '../../components/Island'
import { Roll } from '../../components/Roll'
import { useAuth } from '../../lib/auth'
import { addLabWave, createLabProject, newLabSpec, onlineWorker, removeRepo, useLabWaves, useRepos, useTasks, useWorkers } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { LabKind, LabSize, LabWave, Repo, Task } from '../../lib/types'
import { PageHead } from './Overview'
import { StatePill } from './ui'

/*
 * Test lab (admins only). Makes up a project full of bugs and the issues people would file about them, so
 * the whole swarm can be exercised on something new every time. Each wave comes with its answer key, so
 * you can check what the agents did against what was really wrong.
 */

const KINDS: { id: LabKind; label: string; hint: string; colour: string }[] = [
  { id: 'hash-order', label: 'Order from a set', hint: 'results come back in a different order between runs', colour: 'var(--triager)' },
  { id: 'jitter', label: 'Randomness', hint: 'a random draw breaks something now and then', colour: 'var(--coder)' },
  { id: 'clock', label: 'The clock', hint: 'calls close together collide or go wrong', colour: 'var(--tester)' },
  { id: 'shared-state', label: 'Leftover state', hint: 'a test fails when another one ran first', colour: 'var(--reviewer)' },
]
const SIZES: { id: LabSize; label: string; n: string }[] = [
  { id: 'small', label: 'Small', n: '3 bugs · 5 issues' },
  { id: 'medium', label: 'Medium', n: '5 bugs · 8 issues' },
  { id: 'large', label: 'Large', n: '8 bugs · 13 issues' },
]
// what a good triager does with each kind of made-up issue
const EXPECT: Record<string, { want: string[]; say: string }> = {
  bug: { want: ['Approved', 'Merged'], say: 'fixed and approved' },
  question: { want: ['Closed'], say: 'closed as a question' },
  duplicate: { want: ['Closed'], say: 'closed as a duplicate' },
  vague: { want: ['Needs Human'], say: 'sent to you' },
  feature: { want: ['Needs Human'], say: 'sent to you' },
  plain: { want: ['Needs Human'], say: 'sent to you (not a random failure)' },
}

export default function Lab() {
  const { user } = useAuth()
  const { data: repos } = useRepos(user?.uid)
  const { data: workers } = useWorkers()
  const worker = onlineWorker(workers)
  const labs = repos.filter((r) => r.source === 'lab' || !!r.lab?.waves?.length).sort((a, b) => (b.createdAt?.toDate().getTime() || 0) - (a.createdAt?.toDate().getTime() || 0))

  return (
    <div className="page lab-page">
      <PageHead title="Test lab" sub="Make up a project full of bugs, then watch the swarm find and fix them. Only admins see this page." />
      {!worker && (
        <p className="lab-warn"><span className="status-dot s-error" />No worker is online, so nothing will be made up yet. Start one with <span className="mono">swarm worker</span>.</p>
      )}
      <Maker uid={user?.uid} />
      <section className="lab-list">
        <h2 className="lab-h2">Your test projects</h2>
        {!labs.length ? <p className="muted pad">Nothing made up yet. Pick a size above and press the button.</p>
          : labs.map((r, i) => <LabProject key={r.id} repo={r} i={i} />)}
      </section>
    </div>
  )
}

function Choices({ size, setSize, kinds, setKinds }: { size: LabSize; setSize: (s: LabSize) => void; kinds: LabKind[]; setKinds: (k: LabKind[]) => void }) {
  const flip = (k: LabKind) => setKinds(kinds.includes(k) ? (kinds.length > 1 ? kinds.filter((x) => x !== k) : kinds) : [...kinds, k])
  return (
    <div className="lab-choices">
      <div className="lab-field">
        <span className="lab-label">How big</span>
        <div className="seg" role="radiogroup" aria-label="How big">
          {SIZES.map((s) => (
            <button key={s.id} role="radio" aria-checked={size === s.id} className={`seg-btn ${size === s.id ? 'on' : ''}`} onClick={() => setSize(s.id)}>
              {size === s.id && <motion.span layoutId="lab-size" className="seg-pill" transition={{ duration: 0.45, ease: easeOut }} />}
              <span>{s.label}<i className="lab-n">{s.n}</i></span>
            </button>
          ))}
        </div>
      </div>
      <div className="lab-field">
        <span className="lab-label">Kinds of random failure</span>
        <div className="lab-kinds">
          {KINDS.map((k) => (
            <button key={k.id} className={`lab-kind ${kinds.includes(k.id) ? 'on' : ''}`} style={{ ['--k' as string]: k.colour }} onClick={() => flip(k.id)} aria-pressed={kinds.includes(k.id)}>
              <span className="lab-kind-dot" />
              <span><b>{k.label}</b><span>{k.hint}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Maker({ uid }: { uid?: string }) {
  const toast = useToast()
  const [size, setSize] = useState<LabSize>('medium')
  const [kinds, setKinds] = useState<LabKind[]>(KINDS.map((k) => k.id))
  const [busy, setBusy] = useState(false)
  const make = async () => {
    if (!uid) return
    setBusy(true)
    try {
      await createLabProject(uid, newLabSpec(size, kinds.length === KINDS.length ? null : kinds))
      toast.ok('On its way', 'The worker is making up a new project. It shows up below in a minute or two.')
    } catch (e) { toast.error('Couldn’t start it', (e as Error).message) }
    setBusy(false)
  }
  const sized = SIZES.find((s) => s.id === size)!
  const picked = KINDS.filter((k) => kinds.includes(k.id))
  const flip = (k: LabKind) => setKinds(kinds.includes(k) ? (kinds.length > 1 ? kinds.filter((x) => x !== k) : kinds) : [...kinds, k])
  const step = (n: number) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, ease: easeOut, delay: 0.08 * n } })
  return (
    <section className="lab-maker" aria-labelledby="lab-make-h">
      <div className="lab-maker-head">
        <h2 id="lab-make-h">Make up a new project</h2>
        <p>A model invents the library, the bug hidden in each module and the issues people file about them. Every bug is proven in the sandbox first; built-in makers fill in if no model answers.</p>
      </div>
      <div className="lab-steps">
        <motion.div className="lab-step" style={{ ['--soft' as string]: 'var(--sky-soft)' }} {...step(0)}>
          <span className="lab-step-n">1</span>
          <h3>How big</h3>
          <div className="lab-sizes" role="radiogroup" aria-label="How big">
            {SIZES.map((s) => (
              <button key={s.id} role="radio" aria-checked={size === s.id} className={`lab-size ${size === s.id ? 'on' : ''}`} onClick={() => setSize(s.id)}>
                {size === s.id && <motion.span layoutId="lab-size-card" className="lab-size-pill" transition={{ duration: 0.45, ease: easeOut }} />}
                <b>{s.label}</b><span>{s.n}</span>
              </button>
            ))}
          </div>
        </motion.div>
        <motion.div className="lab-step lab-step--wide" style={{ ['--soft' as string]: 'var(--yellow-soft)' }} {...step(1)}>
          <span className="lab-step-n">2</span>
          <h3>Kinds of random failure <small>{picked.length} of {KINDS.length}</small></h3>
          <div className="lab-kinds">
            {KINDS.map((k) => (
              <button key={k.id} className={`lab-kind ${kinds.includes(k.id) ? 'on' : ''}`} style={{ ['--k' as string]: k.colour }} onClick={() => flip(k.id)} aria-pressed={kinds.includes(k.id)}>
                <span className="lab-kind-dot" />
                <span><b>{k.label}</b><span>{k.hint}</span></span>
              </button>
            ))}
          </div>
        </motion.div>
        <motion.div className="lab-step lab-step--go" style={{ ['--soft' as string]: 'var(--mint)' }} {...step(2)}>
          <span className="lab-step-n">3</span>
          <h3>Make it up</h3>
          <p className="lab-recap"><b>{sized.label}</b> project, {sized.n}, failing through {picked.length === KINDS.length ? 'every kind' : picked.map((k) => k.label.toLowerCase()).join(', ')}.</p>
          <ul className="lab-proof">
            <li>Each bug’s test fails at random</li>
            <li>Each known fix passes every run</li>
            <li>Questions, duplicates and vague reports mixed in</li>
          </ul>
          <button className="btn btn-dark lab-go" onClick={make} disabled={busy || !uid}><Roll>{busy ? 'Starting…' : 'Make it up'}</Roll></button>
        </motion.div>
      </div>
    </section>
  )
}

function LabProject({ repo, i }: { repo: Repo; i: number }) {
  const { user } = useAuth()
  const toast = useToast()
  const { data: waves } = useLabWaves(repo.id)
  const { data: tasks } = useTasks(repo.id)
  const [open, setOpen] = useState(i === 0)
  const [adding, setAdding] = useState(false)
  const [size, setSize] = useState<LabSize>('small')
  const [kinds, setKinds] = useState<LabKind[]>(KINDS.map((k) => k.id))
  const asked = repo.lab?.waves.length || 0
  const pending = asked > waves.length
  const issues = waves.reduce((n, w) => n + w.issues.length, 0)
  const score = scoreOf(waves, tasks)
  const addWave = async () => {
    if (!user) return
    try {
      await addLabWave(user.uid, repo, newLabSpec(size, kinds.length === KINDS.length ? null : kinds))
      setAdding(false); toast.ok('Another wave is coming', 'New bugs and issues land on the same board.')
    } catch (e) { toast.error('Couldn’t add a wave', (e as Error).message) }
  }
  return (
    <motion.article className="lab-proj" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut, delay: i * 0.05 }}>
      <header className="lab-proj-head">
        <button className="lab-proj-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`status-dot s-${pending ? 'running' : repo.status || 'idle'}`} />
          <span className="lab-proj-name"><b>{repo.displayName}</b><span className="muted">{repo.labStatus || (pending ? 'waiting for the worker…' : repo.description || '')}</span></span>
        </button>
        <div className="lab-proj-stats">
          <span className="chip">{waves.length} {waves.length === 1 ? 'wave' : 'waves'}</span>
          <span className="chip">{issues} issues</span>
          {score.total > 0 && <span className={`chip ${score.right === score.total ? 'ok' : ''}`}>{score.right}/{score.total} as expected</span>}
        </div>
        {score.total > 0 && (
          <span className="lab-score" aria-hidden="true">
            <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: score.right / score.total }} transition={{ duration: 0.9, ease: easeOut }} />
          </span>
        )}
        <div className="lab-proj-actions">
          <Link className="btn btn-line btn-sm" to={`/app/repos/${repo.id}`}><Roll>Open board</Roll></Link>
          <button className="btn btn-line btn-sm" onClick={() => setAdding((a) => !a)} disabled={pending || asked >= 20}><Roll>Add a wave</Roll></button>
        </div>
      </header>
      <AnimatePresence initial={false}>
        {adding && (
          <motion.div className="lab-add" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
            <div className="lab-add-in">
              <Choices size={size} setSize={setSize} kinds={kinds} setKinds={setKinds} />
              <div className="lab-add-foot">
                <button className="btn btn-line btn-sm" onClick={() => setAdding(false)}><Roll>Cancel</Roll></button>
                <button className="btn btn-dark btn-sm" onClick={addWave}><Roll>Make up another wave</Roll></button>
              </div>
            </div>
          </motion.div>
        )}
        {open && (
          <motion.div className="lab-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: easeOut }}>
            <div className="lab-body-in">
              {!waves.length ? <p className="muted pad">{pending ? 'The worker is inventing the first wave. Its progress shows in the repository’s activity.' : 'No waves yet.'}</p>
                : waves.map((w) => <Wave key={w.index} wave={w} tasks={tasks} />)}
              <div className="lab-proj-foot">
                <button className="link lab-remove" onClick={async () => {
                  if (!window.confirm(`Remove ${repo.displayName}? Its board, tools and answer key go with it.`)) return
                  try { await removeRepo(repo.id); toast.info('Removed', repo.displayName || '') } catch (e) { toast.error('Couldn’t remove it', (e as Error).message) }
                }}>Remove this project</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

type Row = { n: number; what: string; kind: string; title: string; detail?: LabWave['bugs'][number]; task?: Task; expect: (typeof EXPECT)[string] }

function rowsOf(w: LabWave, tasks: Task[]): Row[] {
  const byIssue = new Map(tasks.map((t) => [t.source_issue, t]))
  const rows: Row[] = w.bugs.map((b) => ({ n: b.issue, what: 'bug', kind: b.kind, title: b.title, detail: b, task: byIssue.get(`#${b.issue}`), expect: EXPECT.bug }))
  for (const n of w.noise) {
    const issue = w.issues.find((i) => i.number === n.issue)
    const key = n.type === 'bug' ? 'plain' : n.type
    rows.push({ n: n.issue, what: n.type, kind: n.type === 'bug' ? 'plain bug' : n.type, title: issue?.title || '', task: byIssue.get(`#${n.issue}`), expect: EXPECT[key] })
  }
  return rows.sort((a, b) => a.n - b.n)
}

function scoreOf(waves: LabWave[], tasks: Task[]) {
  const rows = waves.flatMap((w) => rowsOf(w, tasks)).filter((r) => r.task && !['New Issue', 'Triaged', 'In Progress', 'Awaiting Tests', 'In Review', 'Rejected'].includes(r.task.state))
  return { total: rows.length, right: rows.filter((r) => r.expect.want.includes(r.task!.state)).length }
}

function Wave({ wave, tasks }: { wave: LabWave; tasks: Task[] }) {
  const [fix, setFix] = useState<{ title: string; code: string } | null>(null)
  const rows = rowsOf(wave, tasks)
  return (
    <div className="lab-wave">
      <div className="lab-wave-head">
        <b>Wave {wave.index + 1}</b>
        <span className="muted">made by {wave.via === 'built-in' ? 'the built-in makers' : wave.via} · seed {wave.seed}</span>
      </div>
      <div className="lab-rows" role="table" aria-label={`Wave ${wave.index + 1} answer key`}>
        {rows.map((r) => {
          const kind = KINDS.find((k) => k.id === r.kind)
          const done = r.task && !['New Issue', 'Triaged', 'In Progress', 'Awaiting Tests', 'In Review', 'Rejected'].includes(r.task.state)
          const right = done && r.expect.want.includes(r.task!.state)
          return (
            <div key={r.n} className="lab-row" role="row">
              <span className="lab-row-n mono">#{r.n}</span>
              <span className="lab-row-main">
                <span className="lab-row-title">{r.title}</span>
                <span className="lab-row-meta">
                  <span className="lab-tag" style={kind ? { ['--k' as string]: kind.colour } : undefined}>{kind?.label || r.kind}</span>
                  {r.detail && <span className="mono muted">{r.detail.test}</span>}
                  {r.detail?.verified && <span className="muted">failed {r.detail.verified.buggy.failures}/{r.detail.verified.buggy.runs} runs · fix {r.detail.verified.fixed.failures}/{r.detail.verified.fixed.runs}</span>}
                </span>
                {r.detail?.root_cause && <span className="lab-cause">{r.detail.root_cause}</span>}
              </span>
              <span className="lab-row-end">
                {r.task ? <StatePill state={r.task.state} /> : <span className="pill tone-mute">not on the board yet</span>}
                <span className={`lab-verdict ${done ? (right ? 'ok' : 'miss') : ''}`}>{done ? (right ? '✓ ' : '✗ expected: ') + r.expect.say : 'expected: ' + r.expect.say}</span>
                {r.detail?.fix && <button className="link" onClick={() => setFix({ title: `${r.detail!.module}.py (the known fix)`, code: r.detail!.fix! })}>Known fix</button>}
              </span>
            </div>
          )
        })}
      </div>
      <CodeDialog open={!!fix} title={fix?.title || ''} code={fix?.code || ''} lang="python" onClose={() => setFix(null)} />
    </div>
  )
}

/** For admins on a lab or demo repository: make up another wave of bugs and issues on its board. */
export function MoreIssues({ repo }: { repo: Repo }) {
  const { user } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState<LabSize>('small')
  const [kinds, setKinds] = useState<LabKind[]>(KINDS.map((k) => k.id))
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!user) return
    setBusy(true)
    try {
      await addLabWave(user.uid, repo, newLabSpec(size, kinds.length === KINDS.length ? null : kinds))
      toast.ok('New issues are on the way', 'The worker is making them up. They land on this board in a minute or two.')
      setOpen(false)
    } catch (e) { toast.error('Couldn’t add issues', (e as Error).message) }
    setBusy(false)
  }
  return (
    <>
      <button className="btn btn-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Roll>Make up issues</Roll></button>
      <AnimatePresence>
        {open && (
          <motion.div className="more-issues" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.3, ease: easeOut }}>
            <p className="more-issues-t"><b>Make up more issues</b><span className="muted">A new wave of bugs and issues, invented fresh and proven in the sandbox first. {repo.lab?.waves.length ? `${repo.lab.waves.length} so far.` : ''}</span></p>
            <Choices size={size} setSize={setSize} kinds={kinds} setKinds={setKinds} />
            <div className="lab-add-foot">
              <button className="btn btn-line btn-sm" onClick={() => setOpen(false)}><Roll>Cancel</Roll></button>
              <button className="btn btn-dark btn-sm" onClick={go} disabled={busy || (repo.lab?.waves.length || 0) >= 20}><Roll>{busy ? 'Starting…' : 'Make them up'}</Roll></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
