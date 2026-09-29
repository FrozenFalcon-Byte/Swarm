import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Roll } from '../../components/Roll'
import { useToast } from '../../components/Island'
import { API_URL, MCP_URL } from '../../lib/api'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { createMcpToken, onCallWorker, onlineWorker, queueRun, removeRepo, revokeMcpToken, setAutoSync, useGithubLink, useMcpTokens, useRepos, useWorkers } from '../../lib/data'
import type { Repo } from '../../lib/types'
import { PanelLayout, usePanel, type PanelItem } from '../../components/PanelLayout'
import { firebaseInfo } from '../../lib/firebase'
import { MCP_CLIENTS, MCP_TOOLS, TOKEN_PLACEHOLDER } from '../../lib/mcpClients'
import { easeInOut, easeOut } from '../../lib/motion'
import { Appearance } from './Appearance'
import { Notifications } from './Notifications'
import { RewindSettings } from './RewindSettings'
import { PageHead } from './Overview'
import { Section, timeAgo } from './ui'

const SECTIONS: PanelItem[] = [
  { id: 'appearance', label: 'Appearance', hint: 'Colour, type, layout, pins', color: 'var(--lab)' },
  { id: 'connections', label: 'Connections', hint: 'Firebase, GitHub, worker, models', color: 'var(--coder)' },
  { id: 'repos', label: 'Repositories', hint: 'Watching, runs, removal', color: 'var(--reviewer)' },
  { id: 'ai', label: 'Claude & AI tools', hint: 'MCP server and access tokens', color: 'var(--tester)' },
  { id: 'alerts', label: 'Notifications', hint: 'What alerts you, and how', color: 'var(--triager)' },
  { id: 'rewind', label: 'Weekly Rewind', hint: 'When your week pops up', color: 'var(--mint)' },
]

export default function Settings() {
  const { user } = useAuth()
  const { data: workers } = useWorkers()
  const { data: repos } = useRepos(user?.uid)
  const link = useGithubLink(user?.uid)
  const { data: tokens } = useMcpTokens(user?.uid)
  const live = onlineWorker(workers)
  const onCall = live ? undefined : onCallWorker(workers)
  const worker = live || onCall
  const wState = live ? (live.mode === 'scheduled' ? 'scheduled' : 'online') : onCall ? 'on call' : 'offline'
  const [tab, setTab] = usePanel(SECTIONS, 'connections')
  const status: { label: string; value: string; tone: 'ok' | 'warn' | 'bad'; to: string }[] = [
    { label: 'Firebase', value: firebaseInfo.usingEmulators ? 'emulators' : 'live', tone: firebaseInfo.usingEmulators ? 'warn' : 'ok', to: 'connections' },
    { label: 'GitHub', value: link ? `@${link.login}` : link === undefined ? '…' : 'not connected', tone: link ? 'ok' : 'warn', to: 'connections' },
    { label: 'Worker', value: wState, tone: worker ? 'ok' : 'bad', to: 'connections' },
    { label: 'Models', value: worker?.llm?.active || (worker ? 'heuristics' : 'unknown'), tone: worker?.llm?.active ? 'ok' : 'warn', to: 'connections' },
  ]
  const items = SECTIONS.map((s) => ({ ...s, badge: s.id === 'repos' ? <span className="pl-badge">{repos.length}</span> : s.id === 'ai' && tokens.length ? <span className="pl-badge">{tokens.length}</span> : undefined }))

  return (
    <div className="page page--wide">
      <PageHead title="Settings" sub="What Swarm is connected to, how it reaches you, and how other tools reach it." />
      <div className="sstatus">
        {status.map((s, k) => (
          <motion.button key={s.label} className={`sstat tone-${s.tone}`} onClick={() => setTab(s.to)} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: easeOut, delay: 0.05 + k * 0.07 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
            <span className="sstat-dot" aria-hidden="true" />
            <span className="sstat-label">{s.label}</span>
            <b>{s.value}</b>
          </motion.button>
        ))}
      </div>
      <PanelLayout items={items} active={tab} onPick={setTab}
        foot={<Link to="/app/profile" className="pl-signout"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>Your profile</Link>}>
        {tab === 'connections' && (
          <Section title="Connections">
            <div className="conn-list">
              <FirebaseRow />
              <GithubRow />
              <Conn name="Worker" tone={worker ? 'ok' : 'bad'} state={wState}
                detail={onCall
                  ? `Starts when there's work: queue a run or merge a fix and a pass begins within a minute or two. Last pass ${timeAgo(onCall.lastSeen)} (${onCall.id} · ${onCall.sandbox} sandbox).`
                  : worker
                  ? `${worker.id} · ${worker.sandbox} sandbox · ${worker.mode === 'scheduled' ? `last pass ${timeAgo(worker.lastSeen)}, runs on a schedule` : `checked in ${timeAgo(worker.lastSeen)}`}${worker.syncMinutes && worker.mode !== 'scheduled' ? ` · looks for new issues every ${worker.syncMinutes} min` : ''}`
                  : <>Runs wait in the queue until a worker picks them up. Start one with <code>swarm worker</code>, or see <Link className="link" to="/app/help">Help</Link> for Render and GitHub Actions.</>} />
              <Conn name="Models" tone={worker?.llm?.active ? 'ok' : 'warn'} state={worker?.llm?.active ? 'ready' : worker ? 'heuristics' : 'unknown'}
                detail={!worker ? 'Shown once a worker is online. Models are configured on the worker, never in the browser.'
                  : worker.llm?.active ? `Using ${worker.llm.active}${worker.llm.fallbacks?.length ? `, then ${worker.llm.fallbacks.join(', ')}` : ''}.`
                  : 'No model configured, so the agents use built-in heuristics. Add a free Groq or Gemini key to the worker’s .env.'} />
            </div>
          </Section>
        )}
        {tab === 'appearance' && <Appearance />}
        {tab === 'repos' && <RepoSettings repos={repos} />}
        {tab === 'ai' && <Section title="Use from Claude and other AI tools" action={<span className="pill tone-work">MCP</span>}><McpSetup /></Section>}
        {tab === 'alerts' && <Notifications />}
        {tab === 'rewind' && <RewindSettings />}
      </PanelLayout>
    </div>
  )
}

/* ------------------------------------------------------------------ repositories */

function RepoSettings({ repos }: { repos: Repo[] }) {
  const { user } = useAuth()
  const toast = useToast()
  const [confirm, setConfirm] = useState<string | null>(null)
  if (!repos.length) return <Section title="Repositories"><p className="muted-p">No repositories yet. <Link className="link" to="/app/repos">Connect one</Link> and its settings appear here.</p></Section>
  const run = async (r: Repo) => { if (!user) return; await queueRun(user.uid, r.id); toast.ok('Run queued', r.displayName || r.fullName) }
  return (
    <Section title="Repositories" action={<span className="muted">{repos.length} connected</span>}>
      <ul className="rset">
        <AnimatePresence initial={false}>
          {repos.map((r, k) => {
            const mine = r.ownerUid === user?.uid
            return (
              <motion.li key={r.id} layout className="rset-row" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30, transition: { duration: 0.3 } }}
                transition={{ duration: 0.45, ease: easeOut, delay: k * 0.05 }}>
                <span className={`status-dot s-${r.status || 'idle'}`} />
                <div className="rset-main">
                  <Link to={`/app/repos/${r.id}`} className="rset-name">{r.displayName || r.fullName}</Link>
                  <span className="mono">{r.fullName} · {r.source}{r.private ? ' · private' : ''} · {r.lastRunAt ? `last run ${timeAgo(r.lastRunAt)}` : 'never run'}</span>
                </div>
                {r.source === 'github' && (
                  <label className="toggle" title="The worker checks GitHub for new or edited issues and runs the swarm when it finds some">
                    <input type="checkbox" checked={r.settings?.autoSync !== false} disabled={!mine}
                      onChange={async (e) => { await setAutoSync(r.id, e.target.checked); toast.ok(e.target.checked ? 'Watching for new issues' : 'Stopped watching', r.displayName || r.fullName) }} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span>Watch</span>
                  </label>
                )}
                <button className="btn btn-line btn-sm" onClick={() => run(r)} disabled={r.status === 'queued' || r.status === 'running'}>
                  <Roll>{r.status === 'running' ? 'Running…' : r.status === 'queued' ? 'Queued' : 'Run now'}</Roll>
                </button>
                {mine && (confirm === r.id
                  ? <span className="rset-confirm">
                      <button className="btn btn-danger btn-sm" onClick={async () => { await removeRepo(r.id); setConfirm(null); toast.info('Repository removed', r.displayName || r.fullName) }}><Roll>Remove</Roll></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}><Roll>Keep</Roll></button>
                    </span>
                  : <button className="icon-btn" onClick={() => setConfirm(r.id)} aria-label="Remove repository" title="Remove from Swarm">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg>
                    </button>)}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
      <p className="muted-p">Removing a repository deletes its board here. Nothing changes on GitHub.</p>
    </Section>
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
