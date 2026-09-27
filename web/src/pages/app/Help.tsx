import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mark } from '../../components/Logo'
import { Roll } from '../../components/Roll'
import { easeInOut, easeOut } from '../../lib/motion'

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
  { to: '/app/rules', name: 'House rules', text: 'What the agents may never touch, and what always needs you.' },
  { to: '/app/quiet-hours', name: 'Quiet hours', text: 'When the agents leave a repository alone.' },
  { to: '/app/settings', name: 'Settings', text: 'GitHub, the worker, models, access tokens, and how everything looks.' },
  { to: '/app/profile', name: 'Your profile', text: 'Your name, photo, sign-in methods and passkeys.' },
] as const

// what changed lately, newest first
const NEW = [
  { tag: 'Look', c: 'var(--lab)', title: 'Themes and a lot more to tune', text: 'Six one-click themes, your own highlight colour, typeface and corners, plus handy touches: a second click before merging, exact or relative times, Swarm’s own pointer and click sounds.', to: '/app/settings?tab=appearance', cta: 'Open Appearance' },
  { tag: 'Layout', c: 'var(--coder)', title: 'Pins and a foldable sidebar', text: 'Pin pages and repositories to the top. Fold the sidebar to icons with the button next to the logo; hover the logo to open it again.', to: '/app/settings?tab=appearance', cta: 'Pin something' },
  { tag: 'Guardrails', c: 'var(--triager)', title: 'House rules', text: 'Write the rules the agents live by in one line: never touch, always ask, or keep fixes small. Try any path against them.', to: '/app/rules', cta: 'Write a rule' },
  { tag: 'Guardrails', c: 'var(--reviewer)', title: 'Quiet hours', text: 'Pick a preset or paint your own week. The agents only work inside the windows you leave open.', to: '/app/quiet-hours', cta: 'Set quiet hours' },
  { tag: 'Speed', c: 'var(--tester)', title: 'Work starts in seconds', text: 'The hub now wakes the worker the moment you press Run now or approve a fix, instead of waiting for its schedule.', to: '/app/repos', cta: 'Run a repository' },
  { tag: 'Fun', c: 'var(--mint-strong)', title: 'Play Whodunit', text: 'A test failed at random: read the case file and pick the culprit, then see what the agents found. Cases come from your own fixes.', to: '/app/whodunit', cta: 'Open Whodunit' },
] as const

const GUARDS = [
  { to: '/app/rules', c: 'var(--triager)', name: 'House rules', points: ['Never touch: files the agents may not change at all', 'Always ask: paths where every fix waits for you', 'Keep it small: a cap on how many lines a fix may change'] },
  { to: '/app/quiet-hours', c: 'var(--coder)', name: 'Quiet hours', points: ['Presets for nights, work hours and dawn', 'Or paint your own week, hour by hour', 'Work that arrives in quiet time waits, it isn’t lost'] },
] as const

const TUNE = [
  ['Themes', 'Six whole looks in one click'], ['Highlight colour', 'Six pastels or any colour you pick'], ['Canvas', 'White, warm paper or cool mist'],
  ['Typeface', 'Grotesk, system, rounded or mono'], ['Corners and text size', 'Round, soft or sharp; smaller or larger'], ['Sidebar and pins', 'Full or icons, your pages first'],
  ['Confirm before merging', 'A second click for Merge and Close'], ['Times', '“5m ago” or the time itself'], ['Pointer', 'Swarm’s sticker arrow, or your system’s'],
  ['Click sounds', 'A soft pop on every press'], ['Notifications', 'Right, left or top'], ['Logo, motion, time', 'A lively logo, calmer motion, 12 or 24 hours'],
] as const

const KEYS: [string[], string][] = [
  [['⌘', 'K'], 'Search, jump anywhere, run commands'], [['↑', '↓'], 'Move through results'], [['↵'], 'Open the highlighted result'], [['Esc'], 'Close whatever is open'],
]

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
  ['House rule', 'A line the agents may not cross in a repository: files they must never touch, paths that always need your approval, or a cap on how big a fix may be.'],
  ['Quiet hours', 'The times the worker leaves a repository alone, painted on a weekly grid. Anything that arrives meanwhile waits for the next window.'],
  ['Pin', 'A page or repository you put at the top of the sidebar, from Settings → Appearance.'],
  ['Hub', 'Swarm’s own server. It answers MCP and A2A, and wakes the worker the moment you queue something. It runs free on Render.'],
  ['Passkey', 'A way to sign in with your fingerprint, face or device PIN instead of a password. It can’t be phished or leaked.'],
]

const TOC = [
  ['new', 'What’s new'], ['agents', 'The four agents'], ['flow', 'How a task moves'], ['guardrails', 'Guardrails'],
  ['tune', 'Make it yours'], ['places', 'Where things are'], ['keys', 'Keyboard'], ['words', 'Words we use'],
] as const

export default function Help() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [at, setAt] = useState<string>('new')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? WORDS.filter(([w, d]) => (w + ' ' + d).toLowerCase().includes(s)) : WORDS
  }, [q])
  // the contents follow you down the page
  useEffect(() => {
    const els = TOC.map(([id]) => document.getElementById(`help-${id}`)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)
      if (vis[0]) setAt(vis[0].target.id.slice(5))
    }, { rootMargin: '-15% 0px -70% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  const go = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const search = (v: string) => { setQ(v); if (v.trim()) { setOpen(null); go('words') } }

  return (
    <div className="page help">
      <motion.header className="help-hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: easeOut }}>
        <div className="help-hero-copy">
          <p className="surtitle"><span style={{ background: 'var(--triager)' }} />Help</p>
          <h1>How Swarm works, and what’s new.</h1>
          <p>Four small agents, each with one job, pass a failing test from a new issue to a fix you only have to approve. Everything they do, and everything you can change, is on this page.</p>
          <label className="help-ask">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={q} onChange={(e) => search(e.target.value)} placeholder="Look up a word: board, sandbox, quiet hours…" aria-label="Search the glossary" />
            {q && <button onClick={() => setQ('')} aria-label="Clear">×</button>}
          </label>
        </div>
        <HiveArt />
      </motion.header>

      <div className="help-body">
        <nav className="help-toc" aria-label="On this page">
          <p>On this page</p>
          {TOC.map(([id, label]) => (
            <button key={id} className={at === id ? 'on' : ''} onClick={() => go(id)}>
              {at === id && <motion.span layoutId="help-toc" className="help-toc-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="help-main">
          <section id="help-new" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--lab)' }} />What’s new</h2>
            <div className="help-new">
              {NEW.map((n, i) => (
                <motion.div key={n.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.55, ease: easeOut, delay: (i % 3) * 0.06 }}>
                  <Link to={n.to} className="help-new-card">
                    <span className="help-tag" style={{ background: n.c }}>{n.tag}</span>
                    <b>{n.title}</b>
                    <p>{n.text}</p>
                    <span className="help-new-go">{n.cta} <span aria-hidden="true">→</span></span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>

          <section id="help-agents" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--triager)' }} />The four agents</h2>
            <div className="help-agents">
              {AGENTS.map((a, i) => (
                <motion.article key={a.id} className="help-agent" style={{ background: `var(--${a.id})` }}
                  initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easeOut, delay: i * 0.07 }}
                  whileHover={{ y: -4 }}>
                  <span className="help-agent-n">{i + 1}</span>
                  <h3>{a.name}</h3>
                  <b>{a.job}</b>
                  <p>{a.text}</p>
                </motion.article>
              ))}
            </div>
          </section>

          <section id="help-flow" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--coder)' }} />How a task moves</h2>
            <ol className="help-steps">
              {FLOW.map((f, i) => (
                <motion.li key={f.state} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5, ease: easeOut }}>
                  <span className="help-step-n" style={{ background: `var(--${f.who})` }}>{i + 1}</span>
                  <b>{f.state}</b><span>{f.text}</span>
                </motion.li>
              ))}
            </ol>
          </section>

          <section id="help-guardrails" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--reviewer)' }} />Guardrails</h2>
            <p className="help-lede">Two ways to decide where and when the agents may work. Both apply per repository.</p>
            <div className="help-guards">
              {GUARDS.map((g) => (
                <Link key={g.to} to={g.to} className="help-guard">
                  <span className="help-guard-dot" style={{ background: g.c }} />
                  <b>{g.name}</b>
                  <ul>{g.points.map((p) => <li key={p}>{p}</li>)}</ul>
                  <span className="help-new-go">Open {g.name.toLowerCase()} <span aria-hidden="true">→</span></span>
                </Link>
              ))}
            </div>
          </section>

          <section id="help-tune" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--lab)' }} />Make it yours</h2>
            <p className="help-lede">All of this lives in <Link to="/app/settings?tab=appearance" className="link">Settings → Appearance</Link>, applies the moment you pick it, and follows you to every device.</p>
            <div className="help-tune">
              {TUNE.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>)}
            </div>
          </section>

          <section id="help-places" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--tester)' }} />Where things are</h2>
            <ul className="help-places">
              {PLACES.map((p) => (
                <li key={p.to}><Link to={p.to} className="help-place"><div><b>{p.name}</b><span>{p.text}</span></div><span className="chev" aria-hidden="true">→</span></Link></li>
              ))}
            </ul>
          </section>

          <section id="help-keys" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--grey-6)' }} />Keyboard</h2>
            <div className="help-keys">
              {KEYS.map(([ks, what]) => <div key={what}><span>{ks.map((k) => <kbd key={k}>{k}</kbd>)}</span>{what}</div>)}
            </div>
          </section>

          <section id="help-words" className="help-sec">
            <h2 className="help-h"><i style={{ background: 'var(--sky-card)' }} />Words we use{q && <small>{shown.length} for “{q}”</small>}</h2>
            <div className="help-words">
              <AnimatePresence initial={false}>
                {shown.map(([w, d]) => (
                  <motion.div key={w} layout className={`help-word ${open === w || q ? 'on' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: easeInOut }}>
                    <button onClick={() => setOpen(open === w ? null : w)} aria-expanded={open === w || !!q}>
                      <span>{w}</span>
                      <motion.span className="help-plus" animate={{ rotate: open === w || q ? 45 : 0 }} transition={{ duration: 0.4, ease: easeOut }}>+</motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {(open === w || !!q) && (
                        <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: easeInOut }}>{d}</motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
              {!shown.length && <p className="muted pad">Nothing matches “{q}”.</p>}
            </div>
          </section>

          <div className="help-more">
            <div><b>Still stuck?</b><p>The MCP docs cover connecting Claude and other AI tools. Everything else about setup is in SETUP.md in the project.</p></div>
            <Link to="/docs/mcp" className="btn btn-dark"><Roll>MCP docs</Roll></Link>
          </div>
        </div>
      </div>
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
