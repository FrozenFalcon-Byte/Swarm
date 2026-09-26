import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Roll } from '../../components/Roll'
import { useAuth } from '../../lib/auth'
import { queueRun, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Repo } from '../../lib/types'
import ConnectRepo from './ConnectRepo'
import { PageHead } from './Overview'
import { timeAgo } from './ui'

/* Every connected repository as one wide row: what it is, how it's doing, and a way to run it now.
   Connecting another opens in place above the list. */

const TINTS = ['var(--coder)', 'var(--triager)', 'var(--tester)', 'var(--reviewer)', 'var(--lab)']
const tint = (s: string) => TINTS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length]
const STATUS: Record<string, [string, string]> = { running: ['Working', 'tone-warn'], queued: ['Queued', 'tone-warn'], error: ['Error', 'tone-bad'], idle: ['Idle', 'tone-ok'] }

export default function Repos() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  const [adding, setAdding] = useState(false)
  const busy = repos.filter((r) => r.status === 'running' || r.status === 'queued').length
  const needs = repos.reduce((n, r) => n + (r.stats?.needsYou || 0), 0)
  const sub = !repos.length ? (loading ? '' : 'Connect your first one and the agents start on its open issues.')
    : [`${repos.length} connected`, busy && `${busy} working now`, needs && `${needs} waiting for you`].filter(Boolean).join(' · ')
  const open = adding || (!loading && repos.length === 0)
  return (
    <div className="page">
      <PageHead title="Repositories" sub={sub}>
        {repos.length > 0 && <button className={`btn ${adding ? 'btn-line' : 'btn-dark'}`} onClick={() => setAdding(!adding)}><Roll>{adding ? 'Close' : 'Connect a repository'}</Roll></button>}
      </PageHead>
      <AnimatePresence initial={false}>
        {open && (
          <motion.section key="connect" className="cx-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.65, 0, 0.35, 1] }}>
            <div className="cx-panel-in"><ConnectRepo connected={repos.map((r) => r.fullName)} /></div>
          </motion.section>
        )}
      </AnimatePresence>
      {repos.length > 0 && (
        <ul className="rp-list">
          {repos.map((r, i) => <Row key={r.id} repo={r} i={i} mine={r.ownerUid === user?.uid} />)}
          {!adding && (
            <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + repos.length * 0.05, duration: 0.5, ease: easeOut }}>
              <button className="rp-add" onClick={() => { setAdding(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                <span>+</span>Connect another repository
              </button>
            </motion.li>
          )}
        </ul>
      )}
    </div>
  )
}

function Row({ repo: r, i, mine }: { repo: Repo; i: number; mine: boolean }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const s = r.stats
  const name = r.displayName || r.fullName
  const [label, tone] = STATUS[r.status || 'idle'] ?? STATUS.idle
  const parts = s ? ([['var(--sky-card)', s.open, 'open'], ['var(--triager)', s.needsYou, 'need you'], ['var(--mint-strong)', s.merged, 'merged'], ['var(--grey-6)', s.counts?.Closed || 0, 'closed']] as const) : []
  const total = parts.reduce((n, [, v]) => n + v, 0)
  const go = () => navigate(`/app/repos/${r.id}`)
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user) return
    try { await queueRun(user.uid, r.id); toast.ok('Run queued', name) } catch (err) { toast.error('Couldn’t queue that', (err as Error).message) }
  }
  const working = r.status === 'running' || r.status === 'queued'
  return (
    <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05, duration: 0.5, ease: easeOut }}>
      <div className="rp-row" role="link" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go() }} aria-label={`Open ${name}`}>
        <span className="rp-icon" style={{ background: r.source === 'demo' ? 'var(--triager)' : tint(r.fullName) }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div className="rp-name">
          <b>{name}</b>
          <span className="mono">{r.fullName}{r.private ? ' · private' : ''}</span>
        </div>
        <span className={`pill ${tone}`}>{label}</span>
        <div className="rp-nums">
          <div><b>{s?.open ?? 0}</b><span>open</span></div>
          <div className={s?.needsYou ? 'hot' : ''}><b>{s?.needsYou ?? 0}</b><span>need you</span></div>
          <div><b>{s?.merged ?? 0}</b><span>merged</span></div>
          <div><b>{s?.toolsWritten ?? 0}</b><span>tools</span></div>
        </div>
        <div className="rp-board" title={total ? parts.map(([, v, l]) => `${v} ${l}`).join(', ') : 'No tasks yet'}>
          <div className="stack-bar">{total ? parts.map(([c, v], k) => v ? <motion.span key={k} style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${(v / total) * 100}%` }} transition={{ duration: 0.9, ease: easeOut, delay: 0.3 + i * 0.05 }} /> : null) : null}</div>
          <span>{total ? `${total} task${total === 1 ? '' : 's'}` : 'No tasks yet'} · {r.lastRunAt ? `ran ${timeAgo(r.lastRunAt)}` : 'never run'}</span>
        </div>
        <div className="rp-act">
          {mine && <button className="btn btn-line btn-sm" onClick={run} disabled={working}><Roll>{r.status === 'running' ? 'Running…' : r.status === 'queued' ? 'Queued' : 'Run now'}</Roll></button>}
          <span className="rp-go" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </div>
      </div>
    </motion.li>
  )
}
