import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Roll } from '../../components/Roll'
import { useToast } from '../../components/Island'
import { API_URL, MCP_URL } from '../../lib/api'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { createMcpToken, onlineWorker, revokeMcpToken, useGithubLink, useMcpTokens, useWorkers } from '../../lib/data'
import { firebaseInfo } from '../../lib/firebase'
import { MCP_CLIENTS, MCP_TOOLS, TOKEN_PLACEHOLDER } from '../../lib/mcpClients'
import { easeInOut, easeOut } from '../../lib/motion'
import { PageHead } from './Overview'
import { Section, timeAgo } from './ui'

export default function Settings() {
  const { data: workers } = useWorkers()
  const worker = onlineWorker(workers)
  const scheduled = worker?.mode === 'scheduled'

  return (
    <div className="page">
      <PageHead title="Settings" sub="What Swarm is connected to, and how other tools reach it. Your name, sign-in and passkeys live in your profile." />
      <div className="settings">
        <Section title="Connections">
          <div className="conn-list">
            <FirebaseRow />
            <GithubRow />
            <Conn name="Worker" tone={worker ? 'ok' : 'bad'} state={worker ? (scheduled ? 'scheduled' : 'online') : 'offline'}
              detail={worker
                ? `${worker.id} · ${worker.sandbox} sandbox · ${scheduled ? `last pass ${timeAgo(worker.lastSeen)}, runs on a schedule` : `checked in ${timeAgo(worker.lastSeen)}`}${worker.syncMinutes && !scheduled ? ` · looks for new issues every ${worker.syncMinutes} min` : ''}`
                : 'Runs wait in the queue until a worker picks them up. Start one with: swarm worker (check its setup with: swarm doctor)'} />
            <Conn name="Models" tone={worker?.llm?.active ? 'ok' : 'warn'} state={worker?.llm?.active ? 'ready' : worker ? 'heuristics' : 'unknown'}
              detail={!worker ? 'Shown once a worker is online. Models are configured on the worker, never in the browser.'
                : worker.llm?.active ? `Using ${worker.llm.active}${worker.llm.fallbacks?.length ? `, then ${worker.llm.fallbacks.join(', ')}` : ''}.`
                : 'No model configured, so the agents use built-in heuristics. Add a free Groq or Gemini key to the worker’s .env.'} />
          </div>
        </Section>
        <Section title="Use from Claude and other AI tools" action={<span className="pill tone-work">MCP</span>}>
          <McpSetup />
        </Section>
        <Link to="/app/profile" className="settings-profile">
          <div><b>Your profile</b><span>Name, email, profile picture, sign-in methods and passkeys</span></div>
          <span className="chev" aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  )
}

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
              <button className="btn btn-dark" type="submit" disabled={!pat.trim() || !!busy}><Roll>{busy === 'pat' ? 'Checking…' : 'Save token'}</Roll></button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      {msg && <p className="conn-msg" role="status">{msg}</p>}
    </Conn>
  )
}

function McpSetup() {
  const { user } = useAuth()
  const toast = useToast()
  const { data: tokens } = useMcpTokens(user?.uid)
  const [client, setClient] = useState(MCP_CLIENTS[0].id)
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const c = MCP_CLIENTS.find((x) => x.id === client)!
  const snippet = c.snippet(fresh || TOKEN_PLACEHOLDER)

  const make = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    try {
      setFresh(await createMcpToken(user.uid, name || c.label))
      setName('')
      toast.ok('Token created', 'Copy it now. It won’t be shown again.')
    } catch (err) { toast.error('Couldn’t create the token', (err as Error).message) } finally { setBusy(false) }
  }
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.ok(`${what} copied`) } catch { toast.error('The browser blocked the clipboard', 'Select the text and copy it instead.') }
  }

  return (
    <div className="mcp">
      <p className="mcp-lede">Swarm runs an MCP server, so Claude, Cursor, VS Code or any MCP client can read your board, open a task’s diff, start a run or send a patch back with feedback. Approving and merging stay here. <Link className="link" to="/docs/mcp">Read the docs</Link></p>

      <div className="mcp-step"><span className="mcp-n">1</span><div>
        <b>Create an access token</b>
        <p>Each token acts as you and sees only your repositories. Make one per device or tool so you can revoke them separately.</p>
        <form className="mcp-new" onSubmit={make}>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Name, e.g. “${c.label} on my laptop”`} maxLength={60} aria-label="Token name" />
          <button className="btn btn-dark" type="submit" disabled={busy}><Roll>{busy ? 'Creating…' : 'Create token'}</Roll></button>
        </form>
        <AnimatePresence>
          {fresh && (
            <motion.div className="mcp-fresh" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.45, ease: easeInOut }}>
              <div className="mcp-fresh-in">
                <span className="mono">{fresh}</span>
                <button className="btn btn-green btn-sm" onClick={() => copy(fresh, 'Token')}><Roll>Copy</Roll></button>
                <button className="icon-btn" onClick={() => setFresh(null)} aria-label="Hide token" title="Hide">✕</button>
              </div>
              <p>Shown once. It’s already filled into the setup below.</p>
            </motion.div>
          )}
        </AnimatePresence>
        <ul className="tokens">
          <AnimatePresence initial={false}>
            {tokens.map((t) => (
              <motion.li key={t.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: easeOut }}>
                <span className="token-dot" aria-hidden="true" />
                <div><b>{t.name}</b><span className="mono">{t.prefix}…</span></div>
                <span className="muted">{t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : 'never used'}</span>
                <button className="btn btn-line btn-sm" onClick={async () => { if (window.confirm(`Revoke “${t.name}”? Clients using it lose access within a minute.`)) { await revokeMcpToken(t.id); toast.info('Token revoked', t.name) } }}><Roll>Revoke</Roll></button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div></div>

      <div className="mcp-step"><span className="mcp-n">2</span><div>
        <b>Add Swarm to your client</b>
        <LayoutGroup id="mcp-tabs">
          <div className="mcp-tabs" role="tablist" aria-label="MCP client">
            {MCP_CLIENTS.map((k) => (
              <button key={k.id} role="tab" aria-selected={client === k.id} className={`mcp-tab ${client === k.id ? 'on' : ''}`} onClick={() => setClient(k.id)}>
                {client === k.id && <motion.span layoutId="mcp-tab" className="mcp-tab-bg" transition={{ duration: 0.35, ease: easeOut }} />}
                <span>{k.label}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={client} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: easeOut }}>
            <p className="mcp-note">{c.where}</p>
            <div className="mcp-code">
              <pre className="mono">{snippet}</pre>
              <button className="btn btn-line mcp-copy" onClick={() => copy(snippet, 'Setup')}><Roll>Copy</Roll></button>
            </div>
          </motion.div>
        </AnimatePresence>
        <p className="mcp-server">Server: <span className="mono">{MCP_URL}</span>{API_URL.includes('localhost') && ' · runs on this machine with: swarm server'}</p>
      </div></div>

      <ul className="mcp-tools">{MCP_TOOLS.map((t) => <li key={t.name} className="mono" title={t.text}>{t.name}</li>)}</ul>
    </div>
  )
}
