import { motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import ConnectRepo from './ConnectRepo'
import { PageHead } from './Overview'
import { EmptyState, Section, timeAgo } from './ui'

export default function Repos() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  const [adding, setAdding] = useState(false)
  return (
    <div className="page">
      <PageHead title="Repositories" sub="Each repository gets its own board, sandbox and tool registry.">
        {repos.length > 0 && <button className="btn btn-dark" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Connect a repository'}</button>}
      </PageHead>
      {(adding || (!loading && repos.length === 0)) && (
        <Section>
          <EmptyState title={repos.length ? 'Connect another repository' : 'No repositories yet'} text="Point Swarm at a GitHub repository, or start with the demo.">
            <ConnectRepo />
          </EmptyState>
        </Section>
      )}
      <div className="repo-grid">
        {repos.map((r, i) => {
          const s = r.stats
          const parts = s ? [
            ['var(--sky-card)', s.open], ['var(--triager)', s.needsYou], ['var(--mint-strong)', s.merged],
            ['var(--grey-6)', (s.counts?.Closed || 0)],
          ] as const : []
          const total = parts.reduce((n, [, v]) => n + v, 0) || 1
          return (
            <motion.div key={r.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5, ease: easeOut }}>
              <Link to={`/app/repos/${r.id}`} className="repo-card">
                <div className="repo-card-top">
                  <div><h3>{r.displayName || r.fullName}</h3><span className="mono">{r.fullName}</span></div>
                  <span className={`pill ${r.status === 'error' ? 'tone-bad' : r.status === 'running' || r.status === 'queued' ? 'tone-warn' : 'tone-ok'}`}>
                    {r.status === 'running' ? 'Working' : r.status === 'queued' ? 'Queued' : r.status === 'error' ? 'Error' : 'Idle'}
                  </span>
                </div>
                <div className="repo-stats">
                  <div><b>{s?.merged ?? 0}</b><span>merged</span></div>
                  <div><b>{s?.needsYou ?? 0}</b><span>need you</span></div>
                  <div><b>{s?.toolsWritten ?? 0}</b><span>tools</span></div>
                </div>
                <div className="stack-bar" aria-label="Board breakdown">{parts.map(([c, v], k) => v ? <span key={k} style={{ width: `${(v / total) * 100}%`, background: c }} /> : null)}</div>
                <span className="muted">{r.source === 'demo' ? 'Demo repository' : 'GitHub'} · last run {timeAgo(r.lastRunAt)}</span>
              </Link>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
