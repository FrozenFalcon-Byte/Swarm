import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Roll } from '../../components/Roll'
import { SplitWords } from '../../components/Reveal'
import { SmoothScroll } from '../../components/SmoothScroll'
import { MCP_URL } from '../../lib/api'
import { MCP_CLIENTS, MCP_TOOLS, TOKEN_PLACEHOLDER } from '../../lib/mcpClients'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import '../app/app.css'
import './docs.css'

const TOC = [
  ['overview', 'Overview'], ['quick-start', 'Quick start'], ['tools', 'Tools'], ['resources', 'Resources and prompts'],
  ['auth', 'Access tokens'], ['self-host', 'Run the server'], ['trouble', 'Troubleshooting'],
] as const
const IDS = TOC.map(([id]) => id)

export default function McpDocs() {
  const active = useScrollSpy(IDS)
  return (
    <div className="landing docs">
      <SmoothScroll />
      <Nav />
      <header className="docs-hero">
        <div className="docs-hero-copy">
          <p className="surtitle"><span style={{ background: 'var(--coder)' }} />Docs · MCP</p>
          <SplitWords as="h1" text="Swarm, from inside Claude." className="docs-title" />
          <motion.p className="docs-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8, ease: easeOut }}>
            Swarm speaks the Model Context Protocol, so Claude, Cursor, VS Code or any MCP client can read your board, open a fix, start a run or send a patch back. Merging stays a human click in the dashboard.
          </motion.p>
          <motion.div className="docs-hero-cta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.8, ease: easeOut }}>
            <Link to="/app/settings" className="btn btn-green"><Roll>Get an access token</Roll></Link>
            <a href="#quick-start" className="btn btn-line"><Roll>Quick start</Roll></a>
          </motion.div>
        </div>
        <ChatDemo />
      </header>

      <div className="docs-body">
        <nav className="docs-toc" aria-label="On this page">
          <LayoutGroup id="toc">
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={active === id ? 'on' : ''}>
                {active === id && <motion.span layoutId="toc-on" className="docs-toc-on" transition={{ duration: 0.4, ease: easeOut }} />}
                <span>{label}</span>
              </a>
            ))}
          </LayoutGroup>
        </nav>

        <main className="docs-main">
          <Doc id="overview" title="Overview">
            <p>Swarm’s MCP server is the same board you see in the dashboard, exposed as tools an AI assistant can call. Ask things like:</p>
            <div className="docs-asks">
              {['What did the agents fix overnight?', 'Show me the diff for task-003 and why it was approved.', 'Run the swarm on my API repo.', 'Send task-002 back: seed the RNG in the fixture, not the test.'].map((q, i) => (
                <motion.span key={q} className="docs-ask" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.6, ease: easeOut }}>“{q}”</motion.span>
              ))}
            </div>
            <div className="docs-cols">
              <div className="docs-note docs-note--ok"><b>What a client can do</b><p>Read repositories, tasks, diffs, test evidence and harnesses. Queue a run. Send a patch back to the coder with feedback.</p></div>
              <div className="docs-note docs-note--no"><b>What it can’t</b><p>Approve or merge. There is no tool for it, on purpose: a person clicks Merge in the dashboard, every time.</p></div>
            </div>
          </Doc>

          <Doc id="quick-start" title="Quick start">
            <ol className="docs-steps">
              <li><b>Sign in to Swarm</b> and connect a repository, if you haven’t.</li>
              <li><b>Create an access token</b> in <Link className="link" to="/app/settings">Settings → Use from Claude</Link>. It’s shown once; copy it.</li>
              <li><b>Add Swarm to your client</b> with one of these, replacing <code>{TOKEN_PLACEHOLDER}</code>:</li>
            </ol>
            <ClientTabs />
            <p>Then ask your client “what’s waiting for me in Swarm?”. It should call <code>board_summary</code>.</p>
          </Doc>

          <Doc id="tools" title="Tools">
            <p>Every tool that takes <code>repo</code> accepts its id or its full name, like <code>octo/api</code>. With a single connected repository you can leave it out.</p>
            <div className="docs-tools">
              {MCP_TOOLS.map((t, i) => (
                <motion.div key={t.name} className="docs-tool" initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 2) * 0.06, duration: 0.6, ease: easeOut }}>
                  <div className="docs-tool-head"><code>{t.name}</code><span className={`chip ${t.kind === 'act' ? 'warn' : 'ok'}`}>{t.kind === 'act' ? 'acts' : 'reads'}</span></div>
                  <p>{t.text}</p>
                  {t.args && <span className="mono docs-args">({t.args})</span>}
                </motion.div>
              ))}
            </div>
          </Doc>

          <Doc id="resources" title="Resources and prompts">
            <div className="docs-cols">
              <div className="docs-note"><b><code>swarm://board</code></b><p>The whole board as JSON, for clients that attach resources to the conversation.</p></div>
              <div className="docs-note"><b><code>standup</code> prompt</b><p>Summarises what the agents fixed, with evidence, what’s waiting for you, and the one decision to make first.</p></div>
            </div>
          </Doc>

          <Doc id="auth" title="Access tokens">
            <ul className="docs-list">
              <li>Tokens start with <code>swm_</code> and go in the <code>Authorization: Bearer</code> header.</li>
              <li>A token acts as the person who made it and only sees repositories they’re a member of.</li>
              <li>Only a SHA-256 hash is stored. The token itself is shown once, in your browser, and never saved.</li>
              <li>Make one per device or tool. Revoking one in Settings cuts it off within a minute; the others keep working.</li>
              <li>Any number of clients can connect at once, with the same token or different ones.</li>
            </ul>
          </Doc>

          <Doc id="self-host" title="Run the server">
            <p>The MCP server is part of <code>swarm server</code>, which also handles passkey sign-in. It runs next to the worker, with the same <code>.env</code>:</p>
            <CodeBlock code={`pip install -e ".[server]"\nswarm server --host 0.0.0.0 --port 8787`} />
            <table className="docs-table">
              <tbody>
                <tr><td><code>SWARM_PUBLIC_URL</code></td><td>The address clients use, like <code>https://swarm.example.com</code>. The MCP endpoint is this plus <code>/mcp</code>.</td></tr>
                <tr><td><code>SWARM_WEB_ORIGINS</code></td><td>Comma-separated sites allowed to use passkeys, like <code>https://your-project.web.app</code>.</td></tr>
                <tr><td><code>PORT</code>, <code>HOST</code></td><td>Where to listen. Hosting platforms usually set <code>PORT</code> for you.</td></tr>
              </tbody>
            </table>
            <p>Just for yourself, on the machine with the worker? <code>swarm mcp --cloud</code> serves the same tools over stdio with no token, acting as the operator.</p>
            <p className="muted">This site expects the server at <code>{MCP_URL}</code>.</p>
          </Doc>

          <Doc id="trouble" title="Troubleshooting">
            <div className="docs-faq">
              {[
                ['401 Unauthorized', 'The token is missing, mistyped or revoked. Check the header is exactly “Authorization: Bearer swm_…”, or make a new token.'],
                ['“several repositories are connected”', 'Pass repo, for example repo: "octo/api". list_repos shows the names.'],
                ['The client can’t connect', 'Open the server’s /healthz address in a browser. If that fails, the server isn’t running or isn’t reachable from where the client is.'],
                ['A run never starts', 'Runs are picked up by the worker. Check Settings → Connections → Worker, or run swarm doctor on the worker’s machine.'],
              ].map(([q, a]) => <Faq key={q} q={q} a={a} />)}
            </div>
          </Doc>
        </main>
      </div>
      <Footer />
    </div>
  )
}

function Doc({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="doc">
      <motion.h2 initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.7, ease: easeOut }}>{title}</motion.h2>
      {children}
    </section>
  )
}

function CodeBlock({ code }: { code: string }) {
  const toast = useToast()
  return (
    <div className="mcp-code docs-code">
      <pre className="mono">{code}</pre>
      <button className="btn btn-line mcp-copy" onClick={async () => { try { await navigator.clipboard.writeText(code); toast.ok('Copied') } catch { toast.error('The browser blocked the clipboard') } }}><Roll>Copy</Roll></button>
    </div>
  )
}

function ClientTabs() {
  const [id, setId] = useState(MCP_CLIENTS[0].id)
  const c = MCP_CLIENTS.find((x) => x.id === id)!
  return (
    <div className="docs-clients">
      <LayoutGroup id="docs-clients">
        <div className="mcp-tabs" role="tablist">
          {MCP_CLIENTS.map((k) => (
            <button key={k.id} role="tab" aria-selected={id === k.id} className={`mcp-tab ${id === k.id ? 'on' : ''}`} onClick={() => setId(k.id)}>
              {id === k.id && <motion.span layoutId="docs-tab" className="mcp-tab-bg" transition={{ duration: 0.35, ease: easeOut }} />}
              <span>{k.label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: easeOut }}>
          <p className="mcp-note">{c.where}</p>
          <CodeBlock code={c.snippet(TOKEN_PLACEHOLDER)} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`faq-item ${open ? 'is-open' : ''}`}>
      <button className="faq-q" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{q}</span>
        <motion.span className="faq-btn" animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.4, ease: easeOut }} aria-hidden="true">+</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.5 }}><p>{a}</p></motion.div>}
      </AnimatePresence>
    </div>
  )
}

/** A looping mock conversation: a question, the tool call, the answer. */
function ChatDemo() {
  const [step, setStep] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setStep((s) => (s + 1) % 5), 1700); return () => window.clearInterval(id) }, [])
  return (
    <motion.div className="app-frame docs-chat" initial={{ opacity: 0, y: 30, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.3, duration: 1, ease: easeOut }} aria-hidden="true">
      <div className="docs-chat-top"><span /><span /><span /><b>Claude</b></div>
      <div className="docs-chat-body">
        <motion.div className="bubble me" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>What did the swarm fix overnight?</motion.div>
        <AnimatePresence>
          {step >= 1 && <motion.div key="call" className="bubble tool" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <span className="mono">swarm · board_summary</span><i className={step === 1 ? 'spin' : 'done'} />
          </motion.div>}
          {step >= 2 && <motion.div key="a1" className="bubble ai" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            Two fixes are approved and waiting for you:
          </motion.div>}
          {step >= 3 && <motion.div key="a2" className="bubble card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span><i style={{ background: 'var(--reviewer)' }} />task-001 · sort a set before returning it</span>
            <span><i style={{ background: 'var(--reviewer)' }} />task-002 · bound the retry jitter</span>
            <em>10/12 → 0/12 failing runs</em>
          </motion.div>}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.isIntersecting))
      const first = ids.find((id) => seen.get(id))
      if (first) setActive(first)
    }, { rootMargin: '-20% 0px -60% 0px' })
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [ids])
  return active
}
