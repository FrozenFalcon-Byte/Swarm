import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CodeDialog, CodeWindow } from '../../components/CodeWindow'
import { Roll } from '../../components/Roll'
import { useToast } from '../../components/Island'
import { API_URL } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { onlineWorker, setSecondOpinionAgents, useRepos, useWorkers } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { AgentCard, Repo } from '../../lib/types'
import { PageHead } from './Overview'

/*
 * The agents as A2A services. Each one publishes an agent card (who it is, what skills it offers, how to
 * reach it) and they find each other through those cards. The same protocol lets other people's agents
 * talk to Swarm (the gateway) and lets Swarm ask other people's agents for a second opinion.
 */

const ORDER = ['triager', 'coder', 'tester', 'reviewer']
const FALLBACK: Record<string, { does: string; skill: string }> = {
  triager: { does: 'Sorts new issues', skill: 'triage_issue' },
  coder: { does: 'Writes the fix', skill: 'write_fix' },
  tester: { does: 'Proves it works', skill: 'verify_fix' },
  reviewer: { does: 'Looks for reasons to say no', skill: 'review_fix' },
}

function useCards() {
  const { data: workers } = useWorkers()
  const fromWorker = (onlineWorker(workers) || workers.find((w) => w.agents?.length))?.agents
  const [fromServer, setFromServer] = useState<AgentCard[] | null>(null)
  const [gateway, setGateway] = useState<AgentCard | null | 'down'>(null)
  useEffect(() => {
    let live = true
    fetch(`${API_URL}/.well-known/agent-card.json`).then((r) => r.ok ? r.json() : Promise.reject())
      .then((c) => live && setGateway(c)).catch(() => live && setGateway('down'))
    fetch(`${API_URL}/agents`).then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => live && setFromServer(d.agents)).catch(() => live && setFromServer([]))
    return () => { live = false }
  }, [])
  const cards = (fromWorker?.length ? fromWorker : fromServer || []).slice().sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))
  return { cards, gateway, loading: !fromWorker?.length && fromServer === null }
}

const TABS = [
  { id: 'connect', label: 'Connect your agents' },
  { id: 'opinions', label: 'Second opinions' },
  { id: 'local', label: 'Run them locally' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Agents() {
  const { cards, gateway, loading } = useCards()
  const [json, setJson] = useState<AgentCard | null>(null)
  const [tab, setTab] = useState<TabId>('connect')

  return (
    <div className="page ag-page">
      <PageHead title="Agents" sub="Four agents pass each fix along, one to the next. Nobody in the middle decides who works next." />

      <HowItWorks />

      <section className="ag-list" aria-label="The swarm’s agents">
        {loading ? <p className="muted pad">Looking for agent cards…</p> : !cards.length ? (
          <p className="muted pad">No cards yet. They’re published by the worker when it starts (<span className="mono">swarm worker</span>) and by <span className="mono">swarm server</span>.</p>
        ) : cards.map((c, i) => <AgentRow key={c.name} card={c} i={i} onJson={() => setJson(c)} />)}
        {!!cards.length && <p className="ag-source muted">Read live from each agent’s card.</p>}
      </section>

      <section className="ag-more">
        <div className="seg" role="tablist" aria-label="More about the agents">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`seg-btn ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {tab === t.id && <motion.span layoutId="ag-seg" className="seg-pill" transition={{ duration: 0.45, ease: easeOut }} />}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} className="ag-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: easeOut }}>
            {tab === 'connect' && <Gateway card={gateway} />}
            {tab === 'opinions' && <SecondOpinions />}
            {tab === 'local' && <Local />}
          </motion.div>
        </AnimatePresence>
      </section>

      <CodeDialog open={!!json} title={json ? `${json.name}.agent-card.json` : ''} code={json ? JSON.stringify(json, null, 2) : ''} lang="json" onClose={() => setJson(null)} />
    </div>
  )
}

/** The idea in three steps, with the full explanation one click away. */
function HowItWorks() {
  const [open, setOpen] = useState(false)
  const steps = [
    ['var(--triager)', 'Each agent publishes a card', 'what it can do and how to reach it'],
    ['var(--coder)', 'It finishes its part', 'and looks for the peer with the next skill'],
    ['var(--tester)', 'It sends that peer a message', 'over A2A, with the task attached'],
  ]
  return (
    <div className="ag-how">
      <ol className="ag-steps">
        {steps.map(([c, b, s], i) => (
          <motion.li key={b} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.1 + i * 0.08 }}>
            <span className="ag-step-n" style={{ background: c }}>{i + 1}</span>
            <span><b>{b}</b><span className="muted">{s}</span></span>
          </motion.li>
        ))}
      </ol>
      <button className="ag-why" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        What’s A2A?
        <motion.svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" animate={{ rotate: open ? 180 : 0 }}><path d="M6 9l6 6 6-6" /></motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p className="ag-why-text" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
            <span>Each agent is its own <b>A2A</b> service (Agent2Agent, the open protocol for agents to talk to each other). It publishes a card saying what it can do. When one finishes, it finds the peer with the skill the task needs next and sends it a message. Nobody in the middle decides who works next.</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentRow({ card: c, i, onJson }: { card: AgentCard; i: number; onJson: () => void }) {
  const [open, setOpen] = useState(false)
  const name = c.name[0].toUpperCase() + c.name.slice(1)
  const skill = c.skills?.[0]
  return (
    <motion.article className={`ag-row ${open ? 'open' : ''}`} style={{ ['--c' as string]: `var(--${c.name})` }}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.15 + i * 0.06 }}>
      <button className="ag-row-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ag-dot" />
        <span className="ag-name"><b>{name}</b><span className="muted">{FALLBACK[c.name]?.does || c.description}</span></span>
        <span className="ag-skill mono">{skill?.id || FALLBACK[c.name]?.skill}</span>
        <motion.svg className="ag-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.35, ease: easeOut }}><path d="M6 9l6 6 6-6" /></motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="ag-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
            <div className="ag-detail-in">
              <p>{c.description}</p>
              {c.skills?.map((s) => (
                <div key={s.id} className="ag-skill-box"><b className="mono">{s.id}</b><span>{s.description}</span></div>
              ))}
              <div className="ag-detail-foot">
                {c.capabilities?.streaming && <span className="chip">streams progress</span>}
                <span className="chip">JSON-RPC</span>
                <span className="chip mono">v{c.version}</span>
                <button className="btn btn-line btn-sm" onClick={onJson}><Roll>View card</Roll></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

function Gateway({ card }: { card: AgentCard | null | 'down' }) {
  const toast = useToast()
  const url = `${API_URL}/a2a`
  const up = card && card !== 'down'
  const py = `import asyncio, httpx, uuid
from a2a.client import create_client
from a2a.client.client import ClientConfig
from a2a.client.card_resolver import A2ACardResolver
from a2a.types.a2a_pb2 import Message, Part, Role, SendMessageRequest

async def main():
    headers = {"Authorization": "Bearer swm_your_token"}
    async with httpx.AsyncClient(headers=headers, timeout=900) as http:
        card = await A2ACardResolver(http, "${API_URL}").get_agent_card()
        swarm = await create_client(card, client_config=ClientConfig(httpx_client=http))
        ask = Message(message_id=uuid.uuid4().hex, role=Role.ROLE_USER,
                      parts=[Part(text="Run the swarm on owner/repo")])
        async for event in swarm.send_message(SendMessageRequest(message=ask)):
            print(event)

asyncio.run(main())`
  return (
    <div className="ag-gw">
      <div className="ag-gw-text">
        <h3>Talk to Swarm from other agents</h3>
        <p>Swarm is an A2A agent too. Other agents can ask it for the board, look at a task, start a run and follow every hand-off live, or send a fix back. It never merges: that stays with you.</p>
        <div className="ag-gw-url">
          <span className={`status-dot s-${up ? 'idle' : 'error'}`} />
          <span className="mono">{card === null ? 'checking…' : card === 'down' ? `server not reachable at ${API_URL}` : url}</span>
          {up && <button className="btn btn-line btn-sm" onClick={async () => { await navigator.clipboard.writeText(`${API_URL}/.well-known/agent-card.json`); toast.ok('Card URL copied') }}><Roll>Copy card URL</Roll></button>}
        </div>
        {up && (
          <ul className="ag-gw-skills">{card.skills?.map((s) => <li key={s.id}><b className="mono">{s.id}</b><span>{s.description}</span></li>)}</ul>
        )}
        <p className="muted">Uses the same access tokens as MCP: make one in <Link className="link" to="/app/settings">Settings</Link>. Push notifications are supported for long runs.</p>
      </div>
      <CodeWindow title="ask_swarm.py" code={py} lang="python" maxHeight="420px" />
    </div>
  )
}

function Local() {
  return (
    <div className="ag-local">
      <p>The agents talk inside the worker, so no ports are opened. To poke at them with any A2A client on your machine, run this; each card is then at <span className="mono">localhost:9100/agents/&lt;name&gt;/.well-known/agent-card.json</span>.</p>
      <CodeWindow title="Terminal" code={'swarm agents\n# cards: http://localhost:9100/agents/coder/.well-known/agent-card.json'} lang="text" />
    </div>
  )
}

function SecondOpinions() {
  const { user } = useAuth()
  const { data: repos } = useRepos(user?.uid)
  const mine = repos.filter((r) => r.ownerUid === user?.uid)
  return (
    <div className="ag-so">
      <div className="ag-gw-text">
        <h3>Second opinions from other agents</h3>
        <p>Before a fix waits for you, the reviewer can ask outside A2A agents what they think. Their answers are attached to the task as advice; they never approve or block anything. Add up to three agent URLs per repository.</p>
      </div>
      {!mine.length ? <p className="muted pad">Connect a repository first.</p> : (
        <div className="so-list">{mine.map((r) => <RepoAgents key={r.id} repo={r} />)}</div>
      )}
    </div>
  )
}

function RepoAgents({ repo }: { repo: Repo }) {
  const toast = useToast()
  const list = repo.settings?.secondOpinionAgents || []
  const [url, setUrl] = useState('')
  const save = async (next: string[]) => {
    try { await setSecondOpinionAgents(repo.id, next); toast.ok('Saved', 'The reviewer uses it from the next run.') }
    catch (e) { toast.error('Couldn’t save', (e as Error).message) }
  }
  const add = () => {
    const u = url.trim()
    if (!/^https?:\/\/\S+$/.test(u)) { toast.error('That isn’t a URL', 'Paste the agent’s base URL or its agent-card.json link.'); return }
    if (list.includes(u)) return
    setUrl(''); save([...list, u])
  }
  return (
    <div className="so-repo">
      <div className="so-head"><b>{repo.displayName || repo.fullName}</b><span className="muted">{list.length}/3</span></div>
      {list.map((u) => (
        <div key={u} className="so-row"><span className="mono">{u}</span>
          <button className="icon-btn" onClick={() => save(list.filter((x) => x !== u))} aria-label={`Remove ${u}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
      ))}
      {list.length < 3 && (
        <form className="so-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input className="field-input field-input--sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://reviewer.example.com" aria-label="Agent URL" />
          <button className="btn btn-dark btn-sm" type="submit"><Roll>Add</Roll></button>
        </form>
      )}
    </div>
  )
}
