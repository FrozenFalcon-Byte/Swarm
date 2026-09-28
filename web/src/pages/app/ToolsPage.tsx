import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../lib/auth'
import { readToolCode, useRepos, useTools } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Tool } from '../../lib/types'
import { PageHead } from './Overview'
import { Section, timeAgo } from './ui'
import { Roll } from '../../components/Roll'
import { CodeWindow } from '../../components/CodeWindow'

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
          <motion.article key={t.tool_id} className={`tool-card ${open?.tool_id === t.tool_id ? 'is-lifted' : ''}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, ease: easeOut }}>
            <motion.span layoutId={`tool-${repoId}-${t.tool_id}`} className="tool-card-bg" transition={MORPH} />
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
      <ToolDialog tool={open} layoutId={open ? `tool-${repoId}-${open.tool_id}` : ''} code={code} loading={loadingCode} onClose={() => setOpen(null)} />
    </>
  )
}

const MORPH = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 } as const

/** A tool opened up: the card it was grows into the dialog, its details on the left and its code on the right. */
function ToolDialog({ tool, layoutId, code, loading, onClose }: { tool: Tool | null; layoutId: string; code: string; loading: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [tool, onClose])
  return createPortal(
    <AnimatePresence>
      {tool && (
        <motion.div key="td" className="td-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.1 } }} onClick={onClose}>
          <div className="td" role="dialog" aria-modal="true" aria-label={tool.tool_id} onClick={(e) => e.stopPropagation()}>
            <motion.span layoutId={layoutId} className="td-bg" transition={MORPH} />
            <motion.aside className="td-about" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }} transition={{ delay: 0.18, duration: 0.45, ease: easeOut }}>
              <p className="surtitle"><span style={{ background: 'var(--coder)' }} />Tool</p>
              <h2 className="mono">{tool.tool_id}</h2>
              <span className={`pill ${tool.validated ? 'tone-ok' : 'tone-bad'}`}>{tool.validated ? 'validated' : 'not validated'}</span>
              <p className="td-desc">{tool.description}</p>
              <div className="td-uses"><b>{tool.usage_count}</b><span>{tool.usage_count === 1 ? 'task used it' : 'tasks used it'}</span></div>
              <dl className="td-facts">
                <div><dt>Written for</dt><dd><span className="chip">{tool.created_by_task}</span></dd></div>
                <div><dt>Written</dt><dd>{timeAgo(tool.created_at)}</dd></div>
                {tool.used_by_tasks.length > 0 && <div><dt>Used by</dt><dd className="td-chips">{tool.used_by_tasks.map((u, i) => (
                  <motion.span key={u} className="chip" initial={{ scale: 0, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.35 + i * 0.04 }}>{u}</motion.span>
                ))}</dd></div>}
                {tool.tags?.length > 0 && <div><dt>Tags</dt><dd className="td-chips">{tool.tags.map((g) => <span key={g} className="chip">{g}</span>)}</dd></div>}
              </dl>
              <p className="td-how muted">The tester runs it with a test’s node id; it repeats the test in fresh processes and reports how many runs failed.</p>
            </motion.aside>
            <motion.div className="td-code" initial={{ opacity: 0, x: 30, rotate: 1.5 }} animate={{ opacity: 1, x: 0, rotate: 0 }} exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }} transition={{ delay: 0.24, type: 'spring', stiffness: 240, damping: 24 }}>
              <CodeWindow paper title={`${tool.tool_id}.py`} code={code} lang="python" loading={loading} onClose={onClose} maxHeight="min(64svh, 720px)" />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
