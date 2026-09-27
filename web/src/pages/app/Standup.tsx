import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { agentColor } from '../../components/AgentDots'
import { easeOut } from '../../lib/motion'
import type { HistoryEntry, Task } from '../../lib/types'

/*
 * The agents' standup. Each one says, in its own words, what it did over the last day (or week), read
 * straight off the tasks' history, so it doubles as a digest of what happened while you were away. The one
 * that did the most wears the crown. Poke an agent and it hops and says something back.
 */

type T = Task & { repoId: string }
type Window = 'day' | 'week'
type Say = { line: string; stat: string; task?: { repoId: string; id: string }; moves: number }

const AGENTS = ['triager', 'coder', 'tester', 'reviewer'] as const
const SPAN: Record<Window, number> = { day: 24 * 3600_000, week: 7 * 24 * 3600_000 }
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

const QUIPS: Record<string, string[]> = {
  triager: ['Every issue gets a label. Even this poke. It’s “question”.', 'I read issues so you don’t have to.', 'Duplicates can smell fear.'],
  coder: ['The best patch is the one line nobody notices.', 'I never add a sleep(). Never.', 'Reading the stack trace. Again.'],
  tester: ['Once is luck. Twenty-four times is proof.', 'One green run proves nothing.', 'I ran that poke 12 times. It failed 0.'],
  reviewer: ['No seeded randomness. No retries. No skips.', 'I’m paid to say no. Politely.', 'Anything touching auth waits for you.'],
}

function tally(tasks: T[], since: number) {
  const out: Record<string, Say> = {}
  const recent = (h: HistoryEntry) => new Date(h.ts).getTime() >= since
  const moves = (agent: string) => tasks.flatMap((t) => t.history.filter((h) => h.agent === agent && recent(h)).map((h) => ({ h, t })))
  const to = (agent: string, ...states: string[]) => moves(agent).filter(({ h }) => h.to_state && states.includes(h.to_state))
  const last = (agent: string) => {
    const m = moves(agent).sort((a, b) => b.h.ts.localeCompare(a.h.ts))[0]
    return m ? { repoId: m.t.repoId, id: m.t.task_id } : undefined
  }

  const read = to('triager', 'Triaged').length, closed = to('triager', 'Closed').length, askedT = to('triager', 'Needs Human').length
  out.triager = {
    moves: moves('triager').length, task: last('triager'), stat: n(read + closed + askedT, 'issue') + ' read',
    line: read + closed + askedT === 0 ? 'No new issues came in. I’m keeping an eye on the tracker.'
      : `I read ${n(read + closed + askedT, 'new issue')}. ${read ? `${read} went to the coder` : 'None needed a fix'}${closed ? `, ${closed} I closed` : ''}${askedT ? `, and ${askedT} I passed to you` : ''}.`,
  }

  const patches = to('coder', 'Awaiting Tests').length
  const bounced = [...to('tester', 'Rejected'), ...to('reviewer', 'Rejected')].length
  out.coder = {
    moves: moves('coder').length, task: last('coder'), stat: n(patches, 'patch', 'patches'),
    line: patches === 0 ? 'No patches this time. Nothing was waiting for a fix.'
      : `I wrote ${n(patches, 'patch', 'patches')}.${bounced ? ` ${n(bounced, 'one', 'ones')} came back for another try, so I’m on it.` : ' All of them held up.'}`,
  }

  const held = to('tester', 'In Review').length, failed = to('tester', 'Rejected').length
  const runs = tasks.filter((t) => t.history.some((h) => h.agent === 'tester' && recent(h)))
    .reduce((s, t) => s + Object.values(t.artifacts.test_summary?.harness?.evidence || {}).reduce((k, e) => k + (e.before?.runs || 0) + (e.after?.runs || 0), 0), 0)
  out.tester = {
    moves: moves('tester').length, task: last('tester'), stat: runs ? n(runs, 'sandboxed run') : n(held + failed, 'patch', 'patches') + ' tested',
    line: held + failed === 0 ? 'Nothing to test yet. The sandbox is warm, though.'
      : `I tested ${n(held + failed, 'patch', 'patches')}${runs ? ` over ${runs} runs` : ''}. ${held ? `${held} held up` : 'None held up'}${failed ? `, ${failed} didn’t` : ''}.`,
  }

  const approved = to('reviewer', 'Approved').length, sent = to('reviewer', 'Rejected').length, askedR = to('reviewer', 'Needs Human').length
  const waiting = tasks.filter((t) => t.state === 'Approved').length
  out.reviewer = {
    moves: moves('reviewer').length, task: last('reviewer'), stat: n(approved, 'approval'),
    line: approved + sent + askedR === 0 ? (waiting ? `Nothing new to review. ${n(waiting, 'fix', 'fixes')} still ${waiting === 1 ? 'waits' : 'wait'} for your merge.` : 'Nothing to review. Enjoy the quiet.')
      : `I approved ${n(approved, 'fix', 'fixes')}${sent ? ` and sent ${sent} back` : ''}${askedR ? `; ${askedR} need${askedR === 1 ? 's' : ''} your call` : ''}.${waiting ? ` ${waiting} ${waiting === 1 ? 'is' : 'are'} ready for you to merge.` : ''}`,
  }
  return out
}

export function Standup({ tasks, className = '', motionProps }: { tasks: T[]; className?: string; motionProps?: object }) {
  const [win, setWin] = useState<Window>('day')
  const [poked, setPoked] = useState<Record<string, number>>({})
  // the window starts when you switch to it (not on every render), so the numbers don't shift as you read
  const [since, setSince] = useState(() => Date.now() - SPAN.day)
  const says = useMemo(() => tally(tasks, since), [tasks, since])
  const mvp = AGENTS.reduce((best, a) => (says[a].moves > says[best].moves ? a : best), AGENTS[0] as string)
  const anyone = AGENTS.some((a) => says[a].moves > 0)
  const pick = (w: Window) => { setWin(w); setSince(Date.now() - SPAN[w]); setPoked({}) }

  return (
    <motion.section className={`ov-card su ${className}`} {...motionProps}>
      <header>
        <div><h2>Standup</h2><span className="muted">What each agent did {win === 'day' ? 'in the last day' : 'this week'}. Poke one.</span></div>
        <div className="seg" role="radiogroup" aria-label="Standup window">
          {(['day', 'week'] as Window[]).map((w) => (
            <button key={w} role="radio" aria-checked={win === w} className={`seg-btn ${win === w ? 'on' : ''}`} onClick={() => pick(w)}>
              {win === w && <motion.span layoutId="su-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <span>{w === 'day' ? 'Today' : 'This week'}</span>
            </button>
          ))}
        </div>
      </header>
      <ul className="su-row">
        {AGENTS.map((a, i) => {
          const s = says[a], k = poked[a] || 0
          const text = k ? QUIPS[a][(k - 1) % QUIPS[a].length] : s.line
          return (
            <motion.li key={a} className={`su-agent ${s.moves ? '' : 'is-idle'}`} style={{ ['--c' as string]: agentColor(a) }}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.1 + i * 0.06 }}>
              <button type="button" className="su-who" onClick={() => setPoked((p) => ({ ...p, [a]: (p[a] || 0) + 1 }))} aria-label={`Poke the ${a}`}>
                <motion.span key={k} className="su-face" initial={k ? { y: 0 } : false} animate={k ? { y: [0, -12, 0], rotate: [0, -10, 0] } : {}} transition={{ duration: 0.45, ease: easeOut }}>
                  <i /><i />
                </motion.span>
                {anyone && a === mvp && <span className="su-crown" data-tip="Busiest">★</span>}
                <b>{a}</b>
              </button>
              <div className="su-bubble" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p key={text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>{text}</motion.p>
                </AnimatePresence>
              </div>
              <div className="su-foot">
                <span>{s.stat}</span>
                {s.task && <Link className="link" to={`/app/repos/${s.task.repoId}/tasks/${s.task.id}`}>Latest: {s.task.id}</Link>}
              </div>
            </motion.li>
          )
        })}
      </ul>
    </motion.section>
  )
}
