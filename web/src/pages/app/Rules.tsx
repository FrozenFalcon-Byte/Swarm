import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { setHouseRules, useRepos, useTasks } from '../../lib/data'
import { RULE_KINDS, diffShape, judge, matches, type Outcome } from '../../lib/houserules'
import { easeOut } from '../../lib/motion'
import type { HouseRule, Task } from '../../lib/types'
import { PageHead } from './Overview'
import { RepoSelect, SaveChip, rise, useDraft, useRepoChoice } from './repoDraft'
import { EmptyState } from './ui'

/* House rules: the lines the agents shouldn't cross in your repository. "Never touch" sends a fix back to
   the coder, "Ask me first" makes it wait for you however good it looks, and a size limit keeps fixes
   small. The reviewer enforces them on the worker (swarm/houserules.py); this page replays them over
   every fix so far, so you see what a rule would have caught before you rely on it. */

type Kind = HouseRule['kind']
const SUGGESTIONS: Omit<HouseRule, 'id' | 'on'>[] = [
  { kind: 'never', glob: 'migrations/', why: 'schema changes need a plan' },
  { kind: 'ask', glob: '*.lock', why: 'dependency changes' },
  { kind: 'never', glob: '.github/', why: 'CI is ours' },
  { kind: 'ask', glob: 'pyproject.toml', why: 'packaging' },
  { kind: 'size', max: 20, why: 'small fixes are easier to review' },
  { kind: 'ask', glob: '**/conftest.py', why: 'shared fixtures affect every test' },
]
const OUTCOME: Record<Outcome, { label: string; color: string }> = {
  pass: { label: 'would reach you as usual', color: 'var(--green)' },
  ask: { label: 'would wait for you', color: 'var(--triager)' },
  stop: { label: 'would go back to the coder', color: 'var(--tester)' },
}
const newId = () => Math.random().toString(36).slice(2, 10)
const same = (a: Omit<HouseRule, 'id' | 'on'>, b: HouseRule) => a.kind === b.kind && (a.kind === 'size' ? a.max === b.max : a.glob === b.glob)

export default function Rules() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const [repoId, setRepoId] = useRepoChoice(repos, 'swarm.rules.repo')
  const repo = repos.find((r) => r.id === repoId)
  const mine = !!repo && repo.ownerUid === user?.uid
  const { data: tasks } = useTasks(repoId || undefined)
  const [rules, setRules, saveState] = useDraft<HouseRule[]>(repoId, repo?.settings?.rules ?? [], (v) => setHouseRules(repoId, v))

  // every fix the coder has written in this repository, newest last, with what it touched
  const fixes = useMemo(() => tasks.filter((t) => t.artifacts?.diff_text)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((t) => ({ task: t, ...diffShape(t.artifacts.diff_text!) })), [tasks])
  const verdicts = useMemo(() => fixes.map((f) => ({ ...f, j: judge(rules, f.files, f.lines) })), [fixes, rules])
  const caught = (r: HouseRule) => verdicts.filter((v) => v.j.by.some((b) => b.rule.id === r.id)).length
  const touched = useMemo(() => {
    const n = new Map<string, number>()
    for (const f of fixes) for (const p of f.files) n.set(p, (n.get(p) || 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p)
  }, [fixes])

  const add = (r: Omit<HouseRule, 'id' | 'on'>, id = newId()) => { if (mine && !rules.some((x) => same(r, x))) setRules((rs) => [{ ...r, id, on: true }, ...rs].slice(0, 30)) }
  const change = (id: string, patch: Partial<HouseRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => setRules((rs) => rs.filter((r) => r.id !== id))

  if (!loading && repos.length === 0) {
    return <div className="page"><PageHead title="House rules" /><EmptyState title="No repository yet" text="Connect one and you can tell the agents what’s off limits in it."><Link to="/app" className="btn btn-dark">Connect a repository</Link></EmptyState></div>
  }

  return (
    <div className="page fit">
      <PageHead title="House rules" sub="What the agents may not touch. The reviewer holds every fix to these.">
        <div className="toolbar-side"><RepoSelect repos={repos} value={repoId} onChange={setRepoId} /><SaveChip state={saveState} readOnly={!mine} /></div>
      </PageHead>

      <div className="hr-grid">
        <div className="hr-col">
          <Composer disabled={!mine} onAdd={add} paths={touched} />
          <motion.div className="hr-suggest" {...rise(2)}>
            <span className="hr-k">Common ones</span>
            <div>
              {SUGGESTIONS.map((s) => {
                const have = rules.some((r) => same(s, r))
                return (
                  <motion.button key={`${s.kind}${s.glob ?? s.max}`} className={`hr-sug ${have ? 'have' : ''}`} disabled={!mine || have} onClick={() => add(s)}
                    style={{ ['--c' as string]: RULE_KINDS[s.kind].color }} whileTap={{ scale: 0.94 }}>
                    <i />{s.kind === 'size' ? `Under ${s.max} lines` : <><span>{RULE_KINDS[s.kind].label}</span> <code>{s.glob}</code></>}
                    {have && <b aria-hidden="true">✓</b>}
                  </motion.button>
                )
              })}
            </div>
          </motion.div>

          <motion.section className="hr-book" aria-label="Rules" {...rise(3)}>
            <header><h2>The rulebook</h2><span className="hr-k">{rules.filter((r) => r.on).length} on</span></header>
            <ul>
              <AnimatePresence mode="popLayout" initial={false}>
                {rules.map((r) => <RuleCard key={r.id} rule={r} caught={caught(r)} total={fixes.length} disabled={!mine} onChange={(p) => change(r.id, p)} onRemove={() => remove(r.id)} />)}
                {rules.length === 0 && (
                  <motion.li key="none" className="hr-none" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}>
                    <span className="hr-none-art" aria-hidden="true">{(['never', 'ask', 'size'] as Kind[]).map((k, i) => <motion.i key={k} style={{ background: RULE_KINDS[k].color }} animate={{ rotate: [0, -8, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }} />)}</span>
                    <b>No rules yet</b>
                    <p>Right now a fix may touch any file it needs, and the usual checks decide. Add a rule above, or start from a common one.</p>
                  </motion.li>
                )}
              </AnimatePresence>
            </ul>
          </motion.section>
        </div>

        <div className="hr-col">
          <Replay verdicts={verdicts} repoId={repoId} sig={JSON.stringify(rules)} />
          <PathTester rules={rules} paths={touched} />
        </div>
      </div>
    </div>
  )
}

function Composer({ disabled, onAdd, paths }: { disabled: boolean; onAdd: (r: Omit<HouseRule, 'id' | 'on'>, id: string) => void; paths: string[] }) {
  const [pending, setPending] = useState(newId) // the id the next rule will have: its ticket here becomes its card below
  const [kind, setKind] = useState<Kind>('never')
  const [glob, setGlob] = useState('')
  const [max, setMax] = useState(20)
  const [why, setWhy] = useState('')
  const hits = kind === 'size' || !glob.trim() ? null : paths.filter((p) => matches(glob, p))
  const ready = kind === 'size' ? max > 0 : !!glob.trim()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || disabled) return
    onAdd(kind === 'size' ? { kind, max, why: why.trim() } : { kind, glob: glob.trim(), why: why.trim() }, pending)
    setPending(newId()); setGlob(''); setWhy('')
  }
  return (
    <motion.form className="hr-compose" onSubmit={submit} {...rise(0)} style={{ ['--c' as string]: RULE_KINDS[kind].color, ['--soft' as string]: RULE_KINDS[kind].soft }}>
      <LayoutGroup id="hr-kind">
        <div className="hr-kinds" role="radiogroup" aria-label="Kind of rule">
          {(Object.keys(RULE_KINDS) as Kind[]).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} style={{ ['--k' as string]: RULE_KINDS[k].color }}>
              {kind === k && <motion.span layoutId="hr-kind-on" className="hr-kind-on" transition={{ type: 'spring', stiffness: 460, damping: 36 }} />}
              <span><i />{RULE_KINDS[k].label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
      <div className="hr-sentence">
        <AnimatePresence mode="popLayout" initial={false}>
          {kind === 'size' ? (
            <motion.label key="size" className="hr-size" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <input type="range" min={5} max={100} step={5} value={max} onChange={(e) => setMax(Number(e.target.value))} disabled={disabled} aria-label="Most lines a fix may change"
                style={{ ['--p' as string]: `${((max - 5) / 95) * 100}%` }} />
              <b>{max} lines</b>
            </motion.label>
          ) : (
            <motion.input key="glob" className="hr-glob" value={glob} onChange={(e) => setGlob(e.target.value)} disabled={disabled}
              placeholder={kind === 'never' ? 'Files to never touch: migrations/' : 'Files to ask about: *.lock'}
              aria-label="Files, as a pattern" spellCheck={false} autoCapitalize="off" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
          )}
        </AnimatePresence>
        <input className="hr-why" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why? (optional)" disabled={disabled} aria-label="Reason" maxLength={200} />
      </div>
      <div className="hr-compose-foot">
        {/* what you're typing, as the card it will become; on Add this same ticket moves into the rulebook */}
        <div className="hr-ticket-slot">
          <AnimatePresence mode="popLayout" initial={false}>
            {ready && !disabled ? (
              <motion.div key="ticket" layoutId={`rule-${pending}`} className="hr-ticket" style={{ ['--c' as string]: RULE_KINDS[kind].color, ['--soft' as string]: RULE_KINDS[kind].soft }}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
                <span className="hr-rule-kind">{RULE_KINDS[kind].label}</span>
                {kind === 'size' ? <b>{max} changed lines</b> : <code>{glob.trim()}</code>}
                {hits && <em title="Files the agents have touched that this matches">{hits.length} match{hits.length === 1 ? '' : 'es'}</em>}
              </motion.div>
            ) : (
              <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{RULE_KINDS[kind].says}</motion.p>
            )}
          </AnimatePresence>
        </div>
        <motion.button type="submit" className="btn btn-dark" disabled={!ready || disabled} whileTap={{ scale: 0.96 }}>Add rule</motion.button>
      </div>
    </motion.form>
  )
}

function RuleCard({ rule, caught, total, disabled, onChange, onRemove }: {
  rule: HouseRule; caught: number; total: number; disabled: boolean; onChange: (p: Partial<HouseRule>) => void; onRemove: () => void
}) {
  const k = RULE_KINDS[rule.kind]
  const flip = () => rule.kind !== 'size' && onChange({ kind: rule.kind === 'never' ? 'ask' : 'never' })
  return (
    <motion.li layout layoutId={`rule-${rule.id}`} className={`hr-rule ${rule.on ? '' : 'off'}`} style={{ ['--c' as string]: k.color, ['--soft' as string]: k.soft }}
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
      <button className="hr-rule-kind" onClick={flip} disabled={disabled || rule.kind === 'size'} title={rule.kind === 'size' ? undefined : 'Switch between never touch and ask me first'}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={rule.kind} initial={{ rotateX: -90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} exit={{ rotateX: 90, opacity: 0 }} transition={{ duration: 0.28 }}>{k.label}</motion.span>
        </AnimatePresence>
      </button>
      <div className="hr-rule-body">
        {rule.kind === 'size' ? <b>{rule.max} changed lines</b> : <code>{rule.glob}</code>}
        {rule.why && <span>{rule.why}</span>}
      </div>
      <span className={`hr-caught ${caught ? 'hot' : ''}`} title={`Caught ${caught} of ${total} past fixes`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.b key={caught} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}>{caught}</motion.b>
        </AnimatePresence>
        <small>caught</small>
      </span>
      <label className="toggle hr-toggle" title={rule.on ? 'Switch off' : 'Switch on'}>
        <input type="checkbox" checked={rule.on} disabled={disabled} onChange={(e) => onChange({ on: e.target.checked })} />
        <span className="toggle-track"><span className="toggle-thumb" /></span>
        <span className="sr-only">Rule on</span>
      </label>
      <button className="hr-x" onClick={onRemove} disabled={disabled} aria-label="Remove rule">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </motion.li>
  )
}

type Verdict = { task: Task; files: string[]; lines: number; j: ReturnType<typeof judge> }

function Replay({ verdicts, repoId, sig }: { verdicts: Verdict[]; repoId: string; sig: string }) {
  const [at, setAt] = useState<number | null>(null)
  const n = verdicts.length
  const count = (o: Outcome) => verdicts.filter((v) => v.j.outcome === o).length
  const shown = at !== null ? verdicts[at] : null
  return (
    <motion.section className="hr-replay" {...rise(1)}>
      <header>
        <div><h2>Replay every fix so far</h2><p>Each square is a fix the coder wrote here, judged again under the rules on the left as you change them.</p></div>
      </header>
      {n === 0 ? (
        <p className="hr-empty">No fixes in this repository yet. Once the coder writes some, you’ll see here which of them your rules would have caught.</p>
      ) : (
        <>
          <div className="hr-bar" aria-hidden="true">
            {(['pass', 'ask', 'stop'] as Outcome[]).map((o) => <motion.i key={o} style={{ background: OUTCOME[o].color }} animate={{ flexGrow: count(o) }} initial={false} transition={{ type: 'spring', stiffness: 160, damping: 24 }} />)}
          </div>
          <ul className="hr-tally">
            {(['pass', 'ask', 'stop'] as Outcome[]).map((o) => (
              <li key={o}><i style={{ background: OUTCOME[o].color }} />
                <AnimatePresence mode="popLayout" initial={false}><motion.b key={count(o)} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>{count(o)}</motion.b></AnimatePresence>
                <span>{OUTCOME[o].label}</span></li>
            ))}
          </ul>
          <div className="hr-tiles" onMouseLeave={() => setAt(null)}>
            {/* a scanner sweeps the fixes whenever the rules change */}
            <motion.i key={sig} className="hr-scan" aria-hidden="true" initial={{ x: '-110%', opacity: 1 }} animate={{ x: '360%', opacity: [1, 1, 0] }} transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }} />
            {verdicts.map((v, i) => (
              <Link key={v.task.task_id} to={`/app/repos/${repoId}/tasks/${v.task.task_id}`} className={`hr-tile ${at === i ? 'on' : ''}`}
                onMouseEnter={() => setAt(i)} onFocus={() => setAt(i)} aria-label={`${v.task.title}: ${OUTCOME[v.j.outcome].label}`}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.i key={v.j.outcome} style={{ background: OUTCOME[v.j.outcome].color }}
                    initial={{ rotateY: -180, scale: 0.6 }} animate={{ rotateY: 0, scale: 1 }} exit={{ rotateY: 180, scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 22, delay: (i % 24) * 0.012 }} />
                </AnimatePresence>
              </Link>
            ))}
          </div>
          <div className="hr-detail" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {shown ? (
                <motion.div key={shown.task.task_id + shown.j.outcome} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16, ease: easeOut }}>
                  <b>{shown.task.source_issue} · {shown.task.title}</b>
                  <span>{shown.files.join(', ')} · {shown.lines} lines · <em style={{ ['--c' as string]: OUTCOME[shown.j.outcome].color }}>{OUTCOME[shown.j.outcome].label}</em></span>
                  {shown.j.by.map((b) => <span key={b.rule.id} className="hr-why-line">{RULE_KINDS[b.rule.kind].label} {b.rule.kind === 'size' ? `${b.rule.max} lines` : <code>{b.rule.glob}</code>}{b.files.length ? ` → ${b.files.join(', ')}` : ''}</span>)}
                </motion.div>
              ) : (
                <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Point at a square to see the fix and which rule caught it; click to open it.</motion.p>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.section>
  )
}

function PathTester({ rules, paths }: { rules: HouseRule[]; paths: string[] }) {
  const [q, setQ] = useState('')
  const typed = q.trim()
  const list = [...(typed && !paths.includes(typed) ? [typed] : []), ...paths.filter((p) => !typed || p.includes(typed) || p === typed)].slice(0, 14)
  return (
    <motion.section className="hr-paths" {...rise(4)}>
      <header><h2>Try a path</h2><p>See which rules catch a file. Listed: files the agents have touched here.</p></header>
      <div className="hr-try">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h6l2 2h8v10H4z" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="src/billing/invoice.py" spellCheck={false} autoCapitalize="off" aria-label="File path" />
      </div>
      <ul>
        <AnimatePresence initial={false}>
          {list.map((p) => {
            const j = judge(rules, [p], 0)
            return (
              <motion.li key={p} layout className={p === typed && !paths.includes(p) ? 'typed' : ''}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease: easeOut }}>
                <code>{p}</code>
                <span className="hr-path-tags">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {j.by.length === 0
                      ? <motion.em key="free" className="free" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>free to change</motion.em>
                      : j.by.map((b) => <motion.em key={b.rule.id} style={{ ['--c' as string]: RULE_KINDS[b.rule.kind].color }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>{RULE_KINDS[b.rule.kind].label}</motion.em>)}
                  </AnimatePresence>
                </span>
              </motion.li>
            )
          })}
        </AnimatePresence>
        {list.length === 0 && <li className="hr-muted">Nothing touched yet. Type a path above to try your rules.</li>}
      </ul>
    </motion.section>
  )
}
