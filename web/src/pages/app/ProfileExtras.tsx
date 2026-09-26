import { AnimatePresence, motion, useInView } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/Island'
import { Roll } from '../../components/Roll'
import { useAuth } from '../../lib/auth'
import { savePrefs } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import { AGENTS, type Prefs, type Profile, type Repo, type Task } from '../../lib/types'
import { CountUp, Section } from './ui'

type RepoTask = Task & { repoId: string }

/* ------------------------------------------------------------------ activity */

const DAY = 86400000
const WEEKS = 16

export function Activity({ repos, tasks }: { repos: Repo[]; tasks: RepoTask[] }) {
  const s = useMemo(() => {
    const fixed = tasks.filter((t) => t.state === 'Merged' || t.state === 'Approved')
    const waiting = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human').length
    const firstTry = fixed.length ? Math.round((fixed.filter((t) => (t.attempts || 1) <= 1).length / fixed.length) * 100) : 0
    const tools = new Set(tasks.flatMap((t) => t.artifacts?.tools_used ?? [])).size
    const byAgent: Record<string, number> = Object.fromEntries(AGENTS.map((a) => [a, 0]))
    const byDay = new Map<number, number>()
    const today = new Date(); today.setHours(0, 0, 0, 0)
    for (const t of tasks) for (const h of t.history ?? []) {
      if (h.agent in byAgent) byAgent[h.agent]++
      const d = new Date(h.ts); if (isNaN(+d)) continue
      d.setHours(0, 0, 0, 0)
      byDay.set(+d, (byDay.get(+d) ?? 0) + 1)
    }
    // the grid ends on today's column; weeks run top (Sunday) to bottom (Saturday)
    const end = +today + (6 - today.getDay()) * DAY
    const start = end - (WEEKS * 7 - 1) * DAY
    const cells = Array.from({ length: WEEKS * 7 }, (_, k) => { const day = start + k * DAY; return { day, n: byDay.get(day) ?? 0, future: day > +today } })
    const max = Math.max(1, ...cells.map((c) => c.n))
    const total = Object.values(byAgent).reduce((a, b) => a + b, 0)
    const streak = (() => { let n = 0; for (let d = +today; (byDay.get(d) ?? 0) > 0; d -= DAY) n++; return n })()
    return { fixed: fixed.length, waiting, firstTry, tools, byAgent, cells, max, total, streak }
  }, [tasks])
  const [hover, setHover] = useState<{ day: number; n: number } | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const inView = useInView(grid, { once: true, margin: '-10% 0px' })

  const tiles: [string, number, string, string][] = [
    ['Repositories', repos.length, '', 'var(--sky-card)'],
    ['Tests fixed', s.fixed, '', 'var(--mint)'],
    ['Waiting for you', s.waiting, '', 'var(--yellow-card)'],
    ['Fixed first try', s.firstTry, '%', 'var(--pink-card)'],
  ]
  return (
    <div className="pact">
      <div className="pact-tiles">
        {tiles.map(([label, v, suffix, bg], k) => (
          <motion.div key={label} className="pact-tile" style={{ background: bg }} initial={{ opacity: 0, y: 18, scale: 0.97 }} whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }} transition={{ duration: 0.6, ease: easeOut, delay: k * 0.07 }} whileHover={{ y: -4 }}>
            <span>{label}</span>
            <b><CountUp value={v} suffix={suffix} /></b>
          </motion.div>
        ))}
      </div>
      <Section title="What the agents did for you" action={<span className="muted">{s.total} actions{s.streak > 1 ? ` · ${s.streak}-day streak` : ''}</span>}>
        <div className="heat-wrap">
          <div className="heat" ref={grid} style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
            {s.cells.map((c, k) => {
              const lvl = c.n === 0 ? 0 : Math.min(4, Math.ceil((c.n / s.max) * 4))
              return (
                <i key={c.day} className={`heat-cell l${lvl} ${c.future ? 'future' : ''} ${inView ? 'in' : ''}`}
                  style={{ gridRow: (k % 7) + 1, gridColumn: Math.floor(k / 7) + 1, animationDelay: `${Math.floor(k / 7) * 28 + (k % 7) * 12}ms` }}
                  onMouseEnter={() => setHover(c)} />
              )
            })}
          </div>
          <div className="heat-foot">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={hover ? hover.day : 'none'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                {hover
                  ? <><b>{hover.n || 'No'} agent action{hover.n === 1 ? '' : 's'}</b> on {new Date(hover.day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</>
                  : `The last ${WEEKS} weeks. Hover a day for details.`}
              </motion.span>
            </AnimatePresence>
            <span className="heat-key">less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat-cell in l${l}`} />)} more</span>
          </div>
        </div>
        <div className="share">
          <div className="share-bar">
            {AGENTS.map((a, k) => (
              <motion.span key={a} style={{ background: `var(--${a})` }} initial={{ flexGrow: 0 }} whileInView={{ flexGrow: s.total ? s.byAgent[a] : 1 }}
                viewport={{ once: true }} transition={{ duration: 1, ease: easeOut, delay: 0.2 + k * 0.08 }} />
            ))}
          </div>
          <div className="share-key">
            {AGENTS.map((a) => (
              <span key={a}><i style={{ background: `var(--${a})` }} />{a}<b>{s.total ? Math.round((s.byAgent[a] / s.total) * 100) : 0}%</b></span>
            ))}
          </div>
        </div>
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ your workspace: how the dashboard looks and opens */

export function Workspace({ prefs }: { prefs: Prefs }) {
  const { user } = useAuth()
  const toast = useToast()
  const save = async (patch: Prefs) => {
    if (!user) return
    try { await savePrefs(user.uid, patch); toast.ok('Saved', 'Your dashboard follows this everywhere you sign in.') } catch { toast.error('Couldn’t save that', 'Check your connection and try again.') }
  }
  return (
    <Section title="Your workspace" action={<span className="muted">how the dashboard works for you</span>}>
      <div className="prefs">
        <PrefRow title="Open a repository on" text="The tab you land on when you open a repository from the sidebar or a link.">
          <Seg id="ws-tab" value={prefs.repoTab ?? 'board'} onPick={(v) => save({ repoTab: v })}
            options={[['board', 'Board'], ['handoffs', 'Agent traffic'], ['activity', 'Activity']]} />
        </PrefRow>
        <PrefRow title="Board lanes" text="Focus folds empty lanes and Closed into slim strips. All keeps every lane open.">
          <Seg id="ws-lanes" value={prefs.lanes ?? 'focus'} onPick={(v) => save({ lanes: v })} options={[['focus', 'Focus'], ['all', 'All open']]} />
        </PrefRow>
        <PrefRow title="Density" text="Compact fits more task cards and sections on screen.">
          <Seg id="ws-density" value={prefs.density ?? 'comfortable'} onPick={(v) => save({ density: v })} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} />
        </PrefRow>
      </div>
    </Section>
  )
}

function Seg<T extends string>({ id, value, onPick, options }: { id: string; value: T; onPick: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={`seg-btn ${value === v ? 'on' : ''}`} onClick={() => value !== v && onPick(v)}>
          {value === v && <motion.span layoutId={id} className="seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ preferences */

export function Preferences({ prefs }: { prefs: Prefs }) {
  const { user } = useAuth()
  const toast = useToast()
  const [perm, setPerm] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))
  const save = async (patch: Prefs, msg = 'Saved') => {
    if (!user) return
    try { await savePrefs(user.uid, patch); toast.ok(msg) } catch { toast.error('Couldn’t save that', 'Check your connection and try again.') }
  }
  const toggleNotify = async (on: boolean) => {
    if (on && perm !== 'granted') {
      if (perm === 'unsupported') return toast.error('Not available here', 'This browser can’t show notifications.')
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p !== 'granted') return toast.error('Notifications are blocked', 'Allow them for this site in your browser settings.')
    }
    await save({ notify: on }, on ? 'Notifications on' : 'Notifications off')
    if (on) new Notification('Swarm', { body: 'You’ll hear from us when a fix is waiting for you.', icon: '/favicon.svg' })
  }
  const motionPref = prefs.motion ?? 'system'
  const start = prefs.startPage ?? 'overview'
  return (
    <Section title="Preferences" action={<span className="muted">saved to your account</span>}>
      <div className="prefs">
        <PrefRow title="Notify me when something needs me" text="A browser notification when a fix is approved or a task asks for you, while Swarm is open in a background tab.">
          <label className="toggle">
            <input type="checkbox" checked={!!prefs.notify && perm === 'granted'} onChange={(e) => void toggleNotify(e.target.checked)} />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
          </label>
        </PrefRow>
        <PrefRow title="Motion" text="How much the interface animates. “Match my device” follows your system’s reduce-motion setting.">
          <div className="seg">
            {([['system', 'Match my device'], ['less', 'Less'], ['full', 'Full']] as const).map(([id, label]) => (
              <button key={id} className={`seg-btn ${motionPref === id ? 'on' : ''}`} onClick={() => save({ motion: id })}>
                {motionPref === id && <motion.span layoutId="motion-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </PrefRow>
        <PrefRow title="Open on" text="Where the dashboard takes you when you sign in.">
          <div className="seg">
            {([['overview', 'Overview'], ['repos', 'Repositories'], ['last', 'Last repo I opened']] as const).map(([id, label]) => (
              <button key={id} className={`seg-btn ${start === id ? 'on' : ''}`} onClick={() => save({ startPage: id })}>
                {start === id && <motion.span layoutId="start-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </PrefRow>
      </div>
    </Section>
  )
}

function PrefRow({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="pref">
      <div className="pref-copy"><b>{title}</b><span>{text}</span></div>
      <div className="pref-act">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ your data */

export function YourData({ profile, repos, tasks }: { profile: Profile | null | undefined; repos: Repo[]; tasks: RepoTask[] }) {
  const { user } = useAuth()
  const toast = useToast()
  const [state, setState] = useState<'idle' | 'packing' | 'done'>('idle')
  const [copied, setCopied] = useState(false)
  if (!user) return null
  const exportAll = async () => {
    setState('packing')
    const { avatar: _avatar, ...rest } = profile ?? {}
    void _avatar
    const data = {
      exportedAt: new Date().toISOString(),
      account: { uid: user.uid, email: user.email, name: user.displayName, createdAt: user.metadata.creationTime, lastSignIn: user.metadata.lastSignInTime },
      profile: rest, repositories: repos, tasks,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `swarm-export-${new Date().toISOString().slice(0, 10)}.json` })
    await new Promise((r) => setTimeout(r, 700)) // long enough to see it happen
    a.click(); URL.revokeObjectURL(url)
    setState('done')
    toast.ok('Export downloaded', `${repos.length} repositories, ${tasks.length} tasks.`)
    window.setTimeout(() => setState('idle'), 2600)
  }
  const copy = async () => { await navigator.clipboard.writeText(user.uid); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  const last = user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  return (
    <Section title="Your data">
      <div className="pdata">
        <div className="pdata-row"><span>Account ID</span>
          <button className="pdata-id mono" onClick={copy} title="Copy">
            <span>{user.uid}</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.em key={copied ? 'y' : 'n'} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.18 }}>{copied ? 'Copied' : 'Copy'}</motion.em>
            </AnimatePresence>
          </button>
        </div>
        <div className="pdata-row"><span>Last signed in</span><b>{last}</b></div>
        <div className="pdata-row"><span>Stored with Swarm</span><b>{repos.length} repositories · {tasks.length} tasks</b></div>
        <p className="muted-p">Download everything Swarm keeps about you and your repositories as one JSON file: your profile, preferences, boards and every task’s history.</p>
        <button className={`btn btn-dark pdata-export ${state}`} onClick={exportAll} disabled={state === 'packing'}>
          <span className="pdata-ic" aria-hidden="true">
            <AnimatePresence mode="wait" initial={false}>
              {state === 'done'
                ? <motion.svg key="ok" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" initial={{ scale: 0.4 }} animate={{ scale: 1 }} exit={{ scale: 0.4 }}><motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} /></motion.svg>
                : <motion.svg key="dl" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ y: -6, opacity: 0 }} animate={state === 'packing' ? { y: [0, 3, 0], opacity: 1 } : { y: 0, opacity: 1 }}
                    transition={state === 'packing' ? { repeat: Infinity, duration: 0.6 } : { duration: 0.2 }} exit={{ y: 6, opacity: 0 }}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></motion.svg>}
            </AnimatePresence>
          </span>
          <Roll>{state === 'packing' ? 'Packing your data…' : state === 'done' ? 'Downloaded' : 'Export my data'}</Roll>
        </button>
      </div>
    </Section>
  )
}
