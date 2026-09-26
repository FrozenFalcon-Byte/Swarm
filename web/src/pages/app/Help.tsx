import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mark } from '../../components/Logo'
import { Roll } from '../../components/Roll'
import { easeInOut, easeOut } from '../../lib/motion'
import { Section } from './ui'

const AGENTS = [
  { id: 'triager', name: 'Triager', job: 'Reads every new issue', text: 'Decides what kind of issue it is and how urgent, spots duplicates, and hands anything unclear to you instead of guessing.' },
  { id: 'coder', name: 'Coder', job: 'Writes the fix', text: 'Finds the code behind the failing test and writes the smallest change that removes the cause, not one that hides it.' },
  { id: 'tester', name: 'Tester', job: 'Proves it works', text: 'Runs the test many times before and after the fix in a sealed sandbox. One green run proves nothing; a dozen do.' },
  { id: 'reviewer', name: 'Reviewer', job: 'Looks for reasons to say no', text: 'Checks the fix without seeing the coder’s reasoning. Shortcuts get sent back; anything touching security waits for you.' },
] as const

const FLOW = [
  { state: 'Incoming', who: 'triager', text: 'A new GitHub issue arrives and gets sorted.' },
  { state: 'Agents working', who: 'coder', text: 'A fix is written, tested and reviewed. Rejected fixes go back to the coder.' },
  { state: 'Waiting for you', who: 'tester', text: 'Approved fixes and anything the agents weren’t sure about.' },
  { state: 'Merged', who: 'reviewer', text: 'You clicked Merge, and Swarm opened a pull request on GitHub.' },
] as const

const PLACES = [
  { to: '/app', name: 'Overview', text: 'How your repos are doing, and everything waiting for you.' },
  { to: '/app/repos', name: 'Repositories', text: 'Connect a repo. Each one has a board, an activity feed, its tools and its runs.' },
  { to: '/app/agents', name: 'Agents', text: 'The agents’ cards, how other agents can talk to Swarm, and second opinions.' },
  { to: '/app/tools', name: 'Tools', text: 'Test harnesses the tester wrote and saved for reuse.' },
  { to: '/app/settings', name: 'Settings', text: 'GitHub, the worker, models, and access tokens for Claude and other AI tools.' },
  { to: '/app/profile', name: 'Your profile', text: 'Your name, photo, sign-in methods and passkeys.' },
] as const

const WORDS: [string, string][] = [
  ['Random test failure', 'A test that passes on one run and fails on the next without any code changing. Engineers often call these “flaky tests”. They waste hours because nobody can tell a real bug from noise.'],
  ['Swarm', 'A group of small, focused agents working together, like a swarm of bees. Each agent does one job well; together they take an issue all the way to a reviewed fix.'],
  ['Board', 'The shared record of every task. Each agent writes what it did here, so you, Claude and the agents all see the same state.'],
  ['A2A', 'Agent2Agent, an open protocol for agents to talk to each other. Each Swarm agent is an A2A service: when it finishes, it sends the next agent a message directly. You can watch those messages under a repository’s Agent traffic tab.'],
  ['Agent card', 'A small JSON file an A2A agent publishes: its name, what skills it offers and how to reach it. Agents find each other by reading cards.'],
  ['Second opinion', 'An outside A2A agent the reviewer can ask about a fix before it waits for you. Its answer is advice only.'],
  ['Task', 'One GitHub issue as the agents see it, with its fix, test results, review and full history.'],
  ['Run', 'One working session: the worker fetches new issues and the agents work until nothing more can move.'],
  ['Worker', 'The program that runs the agents. It lives on a computer or server you control, never in your browser.'],
  ['Sandbox', 'A throwaway copy of your repository where tests run with no network access and strict limits, so nothing can touch your real code or machine.'],
  ['Harness', 'A small program the tester writes to run a test many times under different conditions, proving a fix works. Good ones are saved and reused.'],
  ['Needs you', 'The agents stopped and want a decision: merge an approved fix, approve a sensitive one, or answer something they couldn’t.'],
  ['Merge', 'Your click that turns an approved fix into a pull request on GitHub. Swarm never merges on its own.'],
  ['MCP', 'Model Context Protocol, the standard way AI tools like Claude connect to other apps. With it, you can ask Claude about your board.'],
  ['Passkey', 'A way to sign in with your fingerprint, face or device PIN instead of a password. It can’t be phished or leaked.'],
]

export default function Help() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(WORDS[0][0])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? WORDS.filter(([w, d]) => (w + ' ' + d).toLowerCase().includes(s)) : WORDS
  }, [q])

  return (
    <div className="page help">
      <motion.header className="help-hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: easeOut }}>
        <div className="help-hero-copy">
          <p className="surtitle"><span style={{ background: 'var(--triager)' }} />Help</p>
          <h1>Why “Swarm”?</h1>
          <p>Because it’s not one big AI. It’s four small ones, each with one job, passing work to each other like a swarm of bees. Together they take a failing test from a new issue to a fix you only have to approve.</p>
        </div>
        <HiveArt />
      </motion.header>

      <Section title="Meet the four agents">
        <div className="help-agents">
          {AGENTS.map((a, i) => (
            <motion.article key={a.id} className="help-agent" style={{ background: `var(--${a.id})` }}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easeOut, delay: i * 0.07 }}
              whileHover={{ y: -6, rotate: i % 2 ? 0.8 : -0.8 }}>
              <span className="help-agent-n">{i + 1}</span>
              <h3>{a.name}</h3>
              <b>{a.job}</b>
              <p>{a.text}</p>
            </motion.article>
          ))}
        </div>
      </Section>

      <div className="grid-2">
        <Section title="How a task moves">
          <ol className="help-flow">
            {FLOW.map((f, i) => (
              <motion.li key={f.state} initial={{ opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1, duration: 0.5, ease: easeOut }}>
                <span className="help-flow-dot" style={{ background: `var(--${f.who})` }} />
                <div><b>{f.state}</b><span>{f.text}</span></div>
              </motion.li>
            ))}
          </ol>
        </Section>
        <Section title="Where things are">
          <ul className="help-places">
            {PLACES.map((p) => (
              <li key={p.to}><Link to={p.to} className="help-place"><div><b>{p.name}</b><span>{p.text}</span></div><span className="chev" aria-hidden="true">→</span></Link></li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Words we use" action={<input className="field-input field-input--sm help-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search the glossary" />}>
        <div className="help-words">
          <AnimatePresence initial={false}>
            {shown.map(([w, d]) => (
              <motion.div key={w} layout className={`help-word ${open === w ? 'on' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: easeInOut }}>
                <button onClick={() => setOpen(open === w ? null : w)} aria-expanded={open === w}>
                  <span>{w}</span>
                  <motion.span className="help-plus" animate={{ rotate: open === w ? 45 : 0 }} transition={{ duration: 0.4, ease: easeOut }}>+</motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open === w && (
                    <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: easeInOut }}>{d}</motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
          {!shown.length && <p className="muted pad">Nothing matches “{q}”.</p>}
        </div>
      </Section>

      <Section>
        <div className="help-more">
          <div><b>Still stuck?</b><p>The MCP docs cover connecting Claude and other AI tools. Everything else about setup is in SETUP.md in the project.</p></div>
          <Link to="/docs/mcp" className="btn btn-dark"><Roll>MCP docs</Roll></Link>
        </div>
      </Section>
    </div>
  )
}

/** Four agents orbiting the mark: the swarm in one picture. */
function HiveArt() {
  return (
    <div className="hive" aria-hidden="true">
      <motion.div className="hive-core" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 160, damping: 14, delay: 0.2 }}>
        <Mark size={84} animated />
      </motion.div>
      {AGENTS.map((a, i) => (
        <motion.span key={a.id} className="hive-orbit" style={{ rotate: i * 90 }} animate={{ rotate: i * 90 + 360 }} transition={{ repeat: Infinity, duration: 16, ease: 'linear' }}>
          <motion.span className="hive-bee" style={{ background: `var(--${a.id})` }} animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.3, ease: 'easeInOut' }} />
        </motion.span>
      ))}
    </div>
  )
}
