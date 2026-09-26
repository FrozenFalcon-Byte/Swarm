import { motion } from 'motion/react'
import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { readToolCode, useRepos, useTools } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Tool } from '../../lib/types'
import { PageHead } from './Overview'
import { Section, timeAgo } from './ui'
import { Roll } from '../../components/Roll'
import { CodeDialog } from '../../components/CodeWindow'

export default function ToolsPage() {
  const { user } = useAuth()
  const { data: repos } = useRepos(user?.uid)
  return (
    <div className="page">
      <PageHead title="Tools" sub="Harnesses the tester wrote when existing tests couldn’t prove a fix. Each one is validated before it is saved." />
      {!repos.length && <Section><p className="muted pad">Connect a repository first. Tools are written per repository.</p></Section>}
      {repos.map((r) => (
        <div key={r.id} className="dsec">
          <p className="surtitle" style={{ marginBottom: 14 }}><span style={{ background: 'var(--coder)' }} />{r.displayName || r.fullName}</p>
          <ToolCards repoId={r.id} />
        </div>
      ))}
    </div>
  )
}

export function ToolCards({ repoId }: { repoId: string }) {
  const { data: tools, loading } = useTools(repoId)
  const [open, setOpen] = useState<Tool | null>(null)
  const [code, setCode] = useState<string>('')
  const [loadingCode, setLoadingCode] = useState(false)
  const show = async (t: Tool) => {
    setOpen(t); setCode(''); setLoadingCode(true)
    try { setCode(await readToolCode(repoId, t.tool_id)) } catch { setCode('# The code couldn’t be loaded from storage.') }
    setLoadingCode(false)
  }
  if (!loading && !tools.length) return <Section><p className="muted pad">No tools yet. The tester writes one the first time a single green run can’t prove a fix.</p></Section>
  return (
    <>
      <div className="tool-grid">
        {tools.map((t, i) => (
          <motion.article key={t.tool_id} className="tool-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, ease: easeOut }}>
            <div className="card-head"><h3>{t.tool_id}</h3><span className={`pill ${t.validated ? 'tone-ok' : 'tone-bad'}`}>{t.validated ? 'validated' : 'not validated'}</span></div>
            <p>{t.description}</p>
            <div className="tool-uses"><b>{t.usage_count}</b><span className="muted">{t.usage_count === 1 ? 'use' : 'uses'} · written for {t.created_by_task} · {timeAgo(t.created_at)}</span></div>
            <div className="tool-card-foot">
              {t.used_by_tasks.map((u) => <span key={u} className="chip">{u}</span>)}
              <button className="btn btn-line btn-sm" style={{ marginLeft: 'auto' }} onClick={() => show(t)}><Roll>View code</Roll></button>
            </div>
          </motion.article>
        ))}
      </div>
      <CodeDialog open={!!open} title={open ? `${open.tool_id}.py` : ''} code={code} lang="python" loading={loadingCode} onClose={() => setOpen(null)} />
    </>
  )
}
