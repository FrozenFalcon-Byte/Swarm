import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { queueRun, useAllTasks } from '../../lib/data'
import type { Repo } from '../../lib/types'

/* ⌘K from anywhere in the dashboard: jump to a page, a repository or any task, or start a run, by typing
   a few letters. Tasks are only loaded while the bar is open. */

interface Cmd { id: string; group: string; label: string; hint?: string; dot?: string; run: () => void; words: string }

export function useCommandBar() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return [open, setOpen] as const
}

export function CommandBar({ open, onClose, repos, pages, onSignOut }: {
  open: boolean; onClose: () => void; repos: Repo[]; pages: { to: string; label: string }[]; onSignOut: () => void
}) {
  return createPortal(<AnimatePresence>{open && <Bar onClose={onClose} repos={repos} pages={pages} onSignOut={onSignOut} />}</AnimatePresence>, document.body)
}

function Bar({ onClose, repos, pages, onSignOut }: { onClose: () => void; repos: Repo[]; pages: { to: string; label: string }[]; onSignOut: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const tasks = useAllTasks(repos.map((r) => r.id))
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const name = (r: Repo) => r.displayName || r.fullName
  const go = (to: string) => () => { onClose(); navigate(to) }

  const cmds = useMemo<Cmd[]>(() => [
    ...pages.map((p) => ({ id: `p:${p.to}`, group: 'Go to', label: p.label, run: go(p.to), words: `${p.label} page` })),
    { id: 'p:profile', group: 'Go to', label: 'Your profile', run: go('/app/profile'), words: 'profile account avatar preferences' },
    ...repos.map((r) => ({ id: `r:${r.id}`, group: 'Repositories', label: name(r), hint: r.stats?.needsYou ? `${r.stats.needsYou} need you` : r.status || 'idle', dot: `s-${r.status || 'idle'}`, run: go(`/app/repos/${r.id}`), words: `${r.fullName} ${r.displayName || ''} repo board` })),
    ...repos.map((r) => ({ id: `run:${r.id}`, group: 'Actions', label: `Run the swarm on ${name(r)}`, hint: 'queue a run', run: () => {
      onClose(); if (!user) return
      queueRun(user.uid, r.id, 'command').then(() => toast.ok('Run queued', `${name(r)} · a worker picks it up next`), (e) => toast.error('Couldn’t queue it', e.message))
    }, words: `run start sync ${r.fullName}` })),
    { id: 'a:playground', group: 'Actions', label: 'Open the playground', hint: 'public page', run: go('/playground'), words: 'playground try test analyse' },
    { id: 'a:home', group: 'Actions', label: 'Swarm home', run: go('/'), words: 'home landing website' },
    { id: 'a:out', group: 'Actions', label: 'Sign out', run: () => { onClose(); onSignOut() }, words: 'sign out log out logout' },
    ...tasks.map((t) => ({ id: `t:${t.repoId}/${t.task_id}`, group: 'Tasks', label: t.title, hint: `${t.task_id} · ${t.state === 'Needs Human' ? 'needs you' : t.state.toLowerCase()}`,
      run: go(`/app/repos/${t.repoId}/tasks/${t.task_id}`), words: `${t.task_id} ${t.source_issue} ${t.state} ${t.labels.join(' ')}` })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [pages, repos, tasks, user])

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return cmds.filter((c) => c.group !== 'Tasks' || /needs you|approved/.test(c.hint || '')).slice(0, 14)
    return cmds.map((c) => {
      const hay = `${c.label} ${c.words}`.toLowerCase()
      if (!terms.every((w) => hay.includes(w))) return null
      const score = (c.label.toLowerCase().startsWith(terms[0]) ? 3 : 0) + (c.label.toLowerCase().includes(terms[0]) ? 1 : 0) + (c.group === 'Go to' ? 1 : 0)
      return { c, score }
    }).filter(Boolean).sort((a, b) => b!.score - a!.score).slice(0, 30).map((x) => x!.c)
  }, [cmds, q])
  useEffect(() => { setAt(0) }, [q])
  useEffect(() => { list.current?.querySelector('.kbar-item.on')?.scrollIntoView({ block: 'nearest' }) }, [at])

  // Esc closes; the page behind doesn't scroll
  useEffect(() => {
    const html = document.documentElement, prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [])
  const key = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); shown[at]?.run() }
  }

  let last = ''
  return (
    <>
      <motion.div className="scrim kbar-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div className="kbar" role="dialog" aria-modal="true" aria-label="Command bar" onKeyDown={key}
        initial={{ opacity: 0, y: -18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}>
        <div className="kbar-input">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, repositories, tasks…" aria-label="Search" />
          <kbd>esc</kbd>
        </div>
        <div className="kbar-list" ref={list} role="listbox">
          {shown.length === 0 && <p className="kbar-none">Nothing matches “{q}”.</p>}
          {shown.map((c, i) => {
            const head = c.group !== last ? (last = c.group) : null
            return (
              <div key={c.id}>
                {head && <p className="kbar-group">{head}</p>}
                <button role="option" aria-selected={i === at} className={`kbar-item ${i === at ? 'on' : ''}`} onMouseMove={() => i !== at && setAt(i)} onClick={c.run}>
                  {i === at && <motion.span layoutId="kbar-on" className="kbar-on" transition={{ type: 'spring', stiffness: 600, damping: 42 }} />}
                  {c.dot ? <span className={`status-dot ${c.dot}`} /> : <span className="kbar-glyph" data-g={c.group} />}
                  <span className="kbar-label">{c.label}</span>
                  {c.hint && <span className="kbar-hint">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="kbar-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd><kbd>K</kbd> toggle</span></div>
      </motion.div>
    </>
  )
}
