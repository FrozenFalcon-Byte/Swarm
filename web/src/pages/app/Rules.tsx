import { AnimatePresence, motion } from 'motion/react'
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

  const add = (r: Omit<HouseRule, 'id' | 'on'>) => { if (mine && !rules.some((x) => same(r, x))) setRules((rs) => [{ ...r, id: newId(), on: true }, ...rs].slice(0, 30)) }
  const change = (id: string, patch: Partial<HouseRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => setRules((rs) => rs.filter((r) => r.id !== id))
  // what the map lights up: the rule you're pointing at, or the pattern you're typing
  const [hot, setHot] = useState<string | null>(null)
  const [aim, setAim] = useState<{ kind: Kind; glob: string } | null>(null)

  if (!loading && repos.length === 0) {
    return <div className="page"><PageHead title="House rules" /><EmptyState title="No repository yet" text="Connect one and you can tell the agents what’s off limits in it."><Link to="/app" className="btn btn-dark">Connect a repository</Link></EmptyState></div>
  }

  const on = rules.filter((r) => r.on).length
  const count = (o: Outcome) => verdicts.filter((v) => v.j.outcome === o).length
  const hotRule = rules.find((r) => r.id === hot) || null

  return (
    <div className="page hr-page">
      <PageHead title="House rules" sub="Fence off what the agents may not touch. The reviewer holds every fix to these.">
        <div className="toolbar-side"><RepoSelect repos={repos} value={repoId} onChange={setRepoId} /><SaveChip state={saveState} readOnly={!mine} /></div>
      </PageHead>

      <motion.div className="hr-sum" {...rise(0)}>
        <span><b>{on}</b> {on === 1 ? 'rule' : 'rules'} on</span>
        {fixes.length > 0 ? <>
          <span className="hr-sum-dot" style={{ ['--c' as string]: OUTCOME.stop.color }}><b>{count('stop')}</b> of {fixes.length} past fixes would go back</span>
          <span className="hr-sum-dot" style={{ ['--c' as string]: OUTCOME.ask.color }}><b>{count('ask')}</b> would wait for you</span>
        </> : <span className="muted">No fixes here yet to replay them against</span>}
      </motion.div>

      <div className="hr-zones">
        {(['never', 'ask'] as const).map((k, i) => (
          <Zone key={k} kind={k} i={i}>
            <ul className="hr-chips">
              <AnimatePresence mode="popLayout" initial={false}>
                {rules.filter((r) => r.kind === k).map((r) => (
                  <RuleChip key={r.id} rule={r} caught={caught(r)} total={fixes.length} disabled={!mine} hot={hot === r.id}
                    onHot={(h) => setHot(h ? r.id : null)} onChange={(p) => change(r.id, p)} onRemove={() => remove(r.id)} />
                ))}
              </AnimatePresence>
            </ul>
            <ZoneAdd kind={k} disabled={!mine} touched={touched} have={(x) => rules.some((r) => same(x, r))}
              onAim={(glob) => setAim(glob ? { kind: k, glob } : null)} onAdd={(glob, why) => add({ kind: k, glob, why })} />
          </Zone>
        ))}
        <Zone kind="size" i={2}>
          <SizeRule rule={rules.find((r) => r.kind === 'size')} caught={caught} total={fixes.length} disabled={!mine}
            onAdd={(max) => add({ kind: 'size', max, why: '' })} onChange={change} onRemove={remove} />
        </Zone>
      </div>

      <div className="hr-grid">
        <RepoMap rules={rules} paths={touched} hot={hotRule} aim={aim} />
        <Replay verdicts={verdicts} repoId={repoId} sig={JSON.stringify(rules)} />
      </div>
    </div>
  )
}

const ICON: Record<Kind, string> = {
  never: 'M7 11V8a5 5 0 0110 0v3M5.5 11h13a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1v-8a1 1 0 011-1zM12 15v2',
  ask: 'M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H10l-4.5 4V16h0A1.5 1.5 0 014 14.5zM10 8.5a2 2 0 113 1.7c-.6.4-1 .8-1 1.5M12 13.3v.01',
  size: 'M3.5 16.5l13-13 4 4-13 13zM7.5 12.5l2 2M10.5 9.5l1.5 1.5M13.5 6.5l2 2',
}

/** One kind of rule as a pastel zone: what it does, the rules in it, and a way to add one right there. */
function Zone({ kind, i, children }: { kind: Kind; i: number; children: React.ReactNode }) {
  const k = RULE_KINDS[kind]
  return (
    <motion.section className={`hr-zone hr-zone--${kind}`} style={{ ['--c' as string]: k.color, ['--soft' as string]: k.soft }} {...rise(1 + i)}>
      <header>
        <span className="hr-zone-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[kind]} /></svg></span>
        <div><h2>{k.label}</h2><p>{k.says}</p></div>
      </header>
      {children}
    </motion.section>
  )
}

function RuleChip({ rule, caught, total, disabled, hot, onHot, onChange, onRemove }: {
  rule: HouseRule; caught: number; total: number; disabled: boolean; hot: boolean; onHot: (h: boolean) => void; onChange: (p: Partial<HouseRule>) => void; onRemove: () => void
}) {
  const other = rule.kind === 'never' ? 'ask' : 'never'
  return (
    <motion.li layout className={`hr-chip ${rule.on ? '' : 'off'} ${hot ? 'hot' : ''}`} onMouseEnter={() => onHot(true)} onMouseLeave={() => onHot(false)}
      initial={{ opacity: 0, scale: 0.6, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
      <button className="hr-chip-main" onClick={() => onChange({ on: !rule.on })} disabled={disabled} onFocus={() => onHot(true)} onBlur={() => onHot(false)}
        title={`${rule.why ? rule.why + ' · ' : ''}${rule.on ? 'On' : 'Off'}: click to switch ${rule.on ? 'off' : 'on'}. Caught ${caught} of ${total} past fixes.`}>
        <i className="hr-chip-led" />
        <code>{rule.glob}</code>
        {caught > 0 && <b className="hr-chip-n">{caught}</b>}
      </button>
      {!disabled && <>
        <button className="hr-chip-act" onClick={() => onChange({ kind: other })} aria-label={`Move to ${RULE_KINDS[other].label}`} title={`Move to ${RULE_KINDS[other].label}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={other === 'ask' ? 'M5 12h14M13 6l6 6-6 6' : 'M19 12H5M11 6l-6 6 6 6'} /></svg>
        </button>
        <button className="hr-chip-act" onClick={onRemove} aria-label="Remove rule" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </>}
    </motion.li>
  )
}

/** Type a pattern straight into a zone. While you type, the map lights up what it would fence off. */
function ZoneAdd({ kind, disabled, touched, have, onAim, onAdd }: {
  kind: Kind; disabled: boolean; touched: string[]; have: (r: Omit<HouseRule, 'id' | 'on'>) => boolean; onAim: (glob: string) => void; onAdd: (glob: string, why: string) => void
}) {
  const [v, setV] = useState('')
  const glob = v.trim()
  const hits = glob ? touched.filter((p) => matches(glob, p)).length : null
  const ideas = SUGGESTIONS.filter((x) => x.kind === kind && !have(x))
  const submit = (e: FormEvent) => { e.preventDefault(); if (!glob || disabled) return; onAdd(glob, ''); setV(''); onAim('') }
  return (
    <form className="hr-add" onSubmit={submit}>
      <div className="hr-add-field">
        <span aria-hidden="true">+</span>
        <input value={v} onChange={(e) => { setV(e.target.value); onAim(e.target.value.trim()) }} onBlur={() => onAim('')} onFocus={() => glob && onAim(glob)}
          placeholder={kind === 'never' ? 'migrations/' : '*.lock'} disabled={disabled} spellCheck={false} autoCapitalize="off" aria-label={`Add a ${RULE_KINDS[kind].label} pattern`} />
        <AnimatePresence>{hits !== null && <motion.em initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} title="Files the agents have touched that this matches">{hits} file{hits === 1 ? '' : 's'}</motion.em>}</AnimatePresence>
        <motion.button type="submit" className="hr-add-go" disabled={!glob || disabled} whileTap={{ scale: 0.9 }} aria-label="Add rule">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </motion.button>
      </div>
      {ideas.length > 0 && (
        <div className="hr-ideas">
          {ideas.map((x) => (
            <motion.button type="button" key={x.glob} className="hr-idea" disabled={disabled} onClick={() => onAdd(x.glob!, x.why || '')} title={x.why} whileTap={{ scale: 0.92 }}
              onMouseEnter={() => onAim(x.glob!)} onMouseLeave={() => onAim(glob)}>
              + <code>{x.glob}</code>
            </motion.button>
          ))}
        </div>
      )}
    </form>
  )
}

/** The size limit: one big number you drag. */
function SizeRule({ rule, caught, total, disabled, onAdd, onChange, onRemove }: {
  rule?: HouseRule; caught: (r: HouseRule) => number; total: number; disabled: boolean; onAdd: (max: number) => void; onChange: (id: string, p: Partial<HouseRule>) => void; onRemove: (id: string) => void
}) {
  if (!rule) return (
    <div className="hr-size-none">
      <p>No limit on how big a fix may be.</p>
      <div className="hr-ideas">{[10, 20, 50].map((n) => <motion.button key={n} className="hr-idea" disabled={disabled} onClick={() => onAdd(n)} whileTap={{ scale: 0.92 }}>+ {n} lines</motion.button>)}</div>
    </div>
  )
  const max = rule.max || 20
  return (
    <div className={`hr-size ${rule.on ? '' : 'off'}`}>
      <div className="hr-size-n">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.b key={max} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }}>{max}</motion.b>
        </AnimatePresence>
        <span>changed lines, at most</span>
      </div>
      <input type="range" min={5} max={100} step={5} value={max} disabled={disabled} onChange={(e) => onChange(rule.id, { max: Number(e.target.value) })} aria-label="Most lines a fix may change"
        style={{ ['--p' as string]: `${((max - 5) / 95) * 100}%` }} />
      <div className="hr-size-foot">
        <span className="muted">{total ? `${caught(rule)} of ${total} past fixes were bigger` : 'Nothing to measure yet'}</span>
        <label className="toggle" title={rule.on ? 'Switch off' : 'Switch on'}>
          <input type="checkbox" checked={rule.on} disabled={disabled} onChange={(e) => onChange(rule.id, { on: e.target.checked })} />
          <span className="toggle-track"><span className="toggle-thumb" /></span><span className="sr-only">Limit on</span>
        </label>
        {!disabled && <button className="hr-chip-act" onClick={() => onRemove(rule.id)} aria-label="Remove the limit" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>}
      </div>
    </div>
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

type Row = { path: string; name: string; depth: number; folder: boolean; files: string[] }

/** Every file the agents have touched, as a tree fenced by your rules: what's locked, what waits for you, and
 *  what's free. Point at a rule (or type a pattern) and what it covers lights up; type a path to try one. */
function RepoMap({ rules, paths, hot, aim }: { rules: HouseRule[]; paths: string[]; hot: HouseRule | null; aim: { kind: Kind; glob: string } | null }) {
  const [q, setQ] = useState('')
  const typed = q.trim().replace(/^\/+/, '')
  const rows = useMemo(() => {
    const all = [...new Set([...(typed ? [typed] : []), ...paths])].sort()
    const out: Row[] = []
    const seen = new Map<string, Row>()
    for (const p of all) {
      const parts = p.split('/')
      parts.forEach((name, d) => {
        const key = parts.slice(0, d + 1).join('/')
        const folder = d < parts.length - 1
        let r = seen.get(key + (folder ? '/' : ''))
        if (!r) { r = { path: key, name, depth: d, folder, files: [] }; seen.set(key + (folder ? '/' : ''), r); out.push(r) }
        r.files.push(p)
      })
    }
    return out.slice(0, 60)
  }, [paths, typed])
  const rank: Record<Outcome, number> = { pass: 0, ask: 1, stop: 2 }
  const verdict = (files: string[]) => files.map((f) => judge(rules, [f], 0).outcome).reduce<Outcome>((a, b) => (rank[b] > rank[a] ? b : a), 'pass')
  const lit = (files: string[]) => (hot && hot.kind !== 'size' && files.some((f) => matches(hot.glob || '', f))) || (aim && files.some((f) => matches(aim.glob, f)))
  return (
    <motion.section className="hr-map" {...rise(4)}>
      <header><h2>Your repository, fenced</h2><p>Files the agents have touched. Point at a rule to see what it covers, or try any path.</p></header>
      <div className="hr-try">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h6l2 2h8v10H4z" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try a path: src/billing/invoice.py" spellCheck={false} autoCapitalize="off" aria-label="Try a file path" />
      </div>
      {rows.length === 0 ? <p className="hr-empty">Nothing touched yet. Type a path above to try your rules on it.</p> : (
        <ul className="hr-tree" data-lenis-prevent>
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const o = verdict(r.files)
              const on = lit(r.files)
              return (
                <motion.li key={r.path + (r.folder ? '/' : '')} layout="position" className={`hr-node s-${o} ${r.folder ? 'dir' : ''} ${on ? 'lit' : ''} ${r.path === typed ? 'typed' : ''}`}
                  style={{ ['--d' as string]: r.depth, ['--c' as string]: OUTCOME[o].color }}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2, ease: easeOut }}>
                  <span className="hr-node-ic" aria-hidden="true">{r.folder
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3.5 6.5h6l2 2h9v10h-17z" /></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4" /></svg>}</span>
                  <code>{r.name}{r.folder ? '/' : ''}</code>
                  {o !== 'pass' && <em className="hr-node-tag">{o === 'stop' ? 'locked' : 'asks you'}</em>}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </motion.section>
  )
}
