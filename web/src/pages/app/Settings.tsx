import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { onlineWorker, useGithubLink, useWorkers } from '../../lib/data'
import { firebaseInfo } from '../../lib/firebase'
import { easeOut } from '../../lib/motion'
import { PageHead } from './Overview'
import { Section, timeAgo } from './ui'

export default function Settings() {
  const { user, logOut } = useAuth()
  const { data: workers } = useWorkers()
  const worker = onlineWorker(workers)

  return (
    <div className="page">
      <PageHead title="Settings" sub="Everything Swarm is connected to, and what each connection is for." />
      <div className="settings">
        <Section title="Connections">
          <div className="conn-list">
            <FirebaseRow />
            <GithubRow />
            <Conn name="Worker" tone={worker ? 'ok' : 'bad'} state={worker ? 'online' : 'offline'}
              detail={worker
                ? `${worker.id} · ${worker.sandbox} sandbox · checked in ${timeAgo(worker.lastSeen)}${worker.syncMinutes ? ` · looks for new issues every ${worker.syncMinutes} min` : ''}`
                : 'Runs wait in the queue until a worker picks them up. Start one with: swarm worker (check its setup with: swarm doctor)'} />
            <Conn name="Models" tone={worker?.llm?.active ? 'ok' : 'warn'} state={worker?.llm?.active ? 'ready' : worker ? 'heuristics' : 'unknown'}
              detail={!worker ? 'Shown once a worker is online. Models are configured on the worker, never in the browser.'
                : worker.llm?.active ? `Using ${worker.llm.active}${worker.llm.fallbacks?.length ? `, then ${worker.llm.fallbacks.join(', ')}` : ''}.`
                : 'No model configured, so the agents use built-in heuristics. Add a free Groq or Gemini key to the worker’s .env.'} />
          </div>
        </Section>
        <Section title="Use from Claude" action={<span className="pill tone-work">MCP</span>}>
          <McpSetup />
        </Section>
        <Section title="Account">
          <div className="setting">
            <div><b>{user?.displayName || 'You'}</b><p>{user?.email} · signs in with {user?.providerData.map((p) => PROVIDERS[p.providerId] || p.providerId).join(', ')}</p></div>
            <button className="btn btn-line" onClick={logOut}>Sign out</button>
          </div>
        </Section>
      </div>
    </div>
  )
}

const PROVIDERS: Record<string, string> = { password: 'email', 'google.com': 'Google', 'github.com': 'GitHub' }

function Conn({ name, state, tone, detail, children }: { name: string; state: string; tone: 'ok' | 'warn' | 'bad'; detail: ReactNode; children?: ReactNode }) {
  return (
    <div className="conn">
      <span className={`conn-dot tone-${tone}`} aria-hidden="true" />
      <div className="conn-main">
        <div className="conn-head"><b>{name}</b><span className={`pill tone-${tone}`}>{state}</span></div>
        <p>{detail}</p>
        {children}
      </div>
    </div>
  )
}

function FirebaseRow() {
  const { projectId, usingEmulators } = firebaseInfo
  return (
    <Conn name="Firebase" tone={usingEmulators ? 'warn' : 'ok'} state={usingEmulators ? 'emulators' : 'live'}
      detail={usingEmulators
        ? 'Local emulators. Accounts and data here are for testing and vanish when the emulators stop. Put your project’s web config in web/.env.local to go live.'
        : <>Project <span className="mono">{projectId}</span>: sign-in, and the task board and agent-written tools in Firestore.</>} />
  )
}

function GithubRow() {
  const { user, connectGitHub, saveGithubToken, disconnectGitHub } = useAuth()
  const link = useGithubLink(user?.uid)
  const [busy, setBusy] = useState<'oauth' | 'pat' | 'off' | null>(null)
  const [msg, setMsg] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [pat, setPat] = useState('')

  const run = async (kind: 'oauth' | 'pat' | 'off', fn: () => Promise<unknown>, done: string) => {
    setBusy(kind); setMsg('')
    try { await fn(); setMsg(done); setPat(''); setShowPat(false) } catch (e) { setMsg((e as { code?: string }).code ? friendlyAuthError(e) : (e as Error).message) } finally { setBusy(null) }
  }
  const submitPat = (e: FormEvent) => { e.preventDefault(); run('pat', () => saveGithubToken(pat), 'Token saved.') }
  const classicWithoutRepo = link?.scopes !== undefined && link.scopes !== '' && !link.scopes.split(/,\s*/).includes('repo')

  return (
    <Conn name="GitHub" tone={link ? (classicWithoutRepo ? 'warn' : 'ok') : 'warn'} state={link ? 'connected' : link === undefined ? '…' : 'not connected'}
      detail={link
        ? <>As <b>@{link.login}</b> via {link.source === 'pat' ? 'an access token' : 'GitHub sign-in'}. Swarm reads issues, clones private repos and opens a pull request when you merge.{classicWithoutRepo && ' This token lacks the repo scope, so private repos and pull requests will fail.'}</>
        : 'Needed for private repositories and for Merge to open a pull request. Public repos work without it.'}>
      <div className="conn-actions">
        {link && link.avatarUrl && <img className="conn-avatar" src={link.avatarUrl} alt="" width={28} height={28} />}
        <button className={`btn ${link ? 'btn-line' : 'btn-dark'}`} onClick={() => run('oauth', connectGitHub, 'GitHub connected.')} disabled={!!busy}>
          {busy === 'oauth' ? 'Opening GitHub…' : link ? 'Reconnect' : 'Connect GitHub'}
        </button>
        <button className="btn btn-line" onClick={() => setShowPat((v) => !v)} aria-expanded={showPat}>{showPat ? 'Cancel' : 'Use a token instead'}</button>
        {link && <button className="btn btn-line" onClick={() => run('off', disconnectGitHub, 'GitHub disconnected.')} disabled={!!busy}>{busy === 'off' ? 'Disconnecting…' : 'Disconnect'}</button>}
      </div>
      <AnimatePresence initial={false}>
        {showPat && (
          <motion.form className="conn-pat" onSubmit={submitPat} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
            <p>Create a fine-grained token at <a className="link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com/settings/personal-access-tokens</a> with
              <b> Contents: read and write</b>, <b>Issues: read</b> and <b>Pull requests: read and write</b> on the repos Swarm should work on.</p>
            <div className="conn-pat-row">
              <input className="connect-input" type="password" autoComplete="off" spellCheck={false} placeholder="github_pat_…" value={pat} onChange={(e) => setPat(e.target.value)} aria-label="GitHub access token" />
              <button className="btn btn-dark" type="submit" disabled={!pat.trim() || !!busy}>{busy === 'pat' ? 'Checking…' : 'Save token'}</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      {msg && <p className="conn-msg" role="status">{msg}</p>}
    </Conn>
  )
}

const MCP_CLIENTS = {
  code: {
    label: 'Claude Code',
    note: 'Run once in the Swarm folder on the machine with the worker’s .env:',
    snippet: 'claude mcp add swarm -- "$PWD/.venv/bin/swarm" mcp --cloud',
  },
  desktop: {
    label: 'Claude Desktop',
    note: 'Settings → Developer → Edit config, add this, then restart Claude. Use the full path to your Swarm folder:',
    snippet: JSON.stringify({ mcpServers: { swarm: { command: '/path/to/swarm/.venv/bin/swarm', args: ['mcp', '--cloud'], env: { SWARM_ENV_FILE: '/path/to/swarm/.env' } } } }, null, 2),
  },
} as const

function McpSetup() {
  const [client, setClient] = useState<keyof typeof MCP_CLIENTS>('code')
  const [copied, setCopied] = useState(false)
  const c = MCP_CLIENTS[client]
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.snippet); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked: the text is selectable */ }
  }
  return (
    <div className="mcp">
      <p className="mcp-lede">Ask Claude what the agents did overnight, read a task’s diff or a harness, start a run, or send a patch back with feedback. Approving and merging stay here.</p>
      <div className="mcp-tabs" role="tablist" aria-label="MCP client">
        {(Object.keys(MCP_CLIENTS) as (keyof typeof MCP_CLIENTS)[]).map((k) => (
          <button key={k} role="tab" aria-selected={client === k} className={`mcp-tab ${client === k ? 'on' : ''}`} onClick={() => setClient(k)}>
            {client === k && <motion.span layoutId="mcp-tab" className="mcp-tab-bg" transition={{ duration: 0.35, ease: easeOut }} />}
            <span>{MCP_CLIENTS[k].label}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={client} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: easeOut }}>
          <p className="mcp-note">{c.note}</p>
          <div className="mcp-code">
            <pre className="mono">{c.snippet}</pre>
            <button className="btn btn-line mcp-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </motion.div>
      </AnimatePresence>
      <ul className="mcp-tools">
        {['board_summary', 'list_tasks', 'get_task', 'search_harnesses', 'read_harness', 'run_swarm', 'request_changes', 'list_repos'].map((t) => <li key={t} className="mono">{t}</li>)}
      </ul>
    </div>
  )
}
