import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { useAuth } from '../../lib/auth'
import { queueRun, useAllTasks } from '../../lib/data'
import type { Repo } from '../../lib/types'
import { ICONS } from './nav'

/* ⌘K from anywhere in the dashboard: jump to a page, a repository or any task, or start a run, by typing
   a few letters. Tasks are only loaded while the bar is open. */

interface Cmd { id: string; group: string; label: string; hint?: string; dot?: string; icon?: string; run: () => void; words: string }

const EXTRA: Record<string, string> = {
  profile: 'M12 12a4 4 0 100-8 4 4 0 000 8z M4 21c0-4 4-6 8-6s8 2 8 6',
  run: 'M7 4l12 8-12 8z',
  flask: 'M9 3h6 M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3',
  home: 'M3 11l9-7 9 7 M5 10v10h14V10',
  out: 'M15 17l5-5-5-5M20 12H9M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7',
  task: 'M5 4h14v16H5z M9 9h6 M9 13h6 M9 17h3',
}
// results keep this group order, so the arrow keys walk them in the order you see them
const RANK = ['Go to', 'Repositories', 'Tasks', 'Actions']

const Icon = ({ name }: { name: string }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] ?? EXTRA[name] ?? EXTRA.task} /></svg>
)

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
  open: boolean; onClose: () => void; repos: Repo[]; pages: { to: string; label: string; icon?: string }[]; onSignOut: () => void
}) {
  return createPortal(<AnimatePresence>{open && <Bar onClose={onClose} repos={repos} pages={pages} onSignOut={onSignOut} />}</AnimatePresence>, document.body)
}

/** The results in their groups, each keeping its place in the one list the arrow keys walk. */
function groups(shown: Cmd[]) {
  const out: [string, { c: Cmd; i: number }[]][] = []
  shown.forEach((c, i) => { const g = out.find(([name]) => name === c.group); if (g) g[1].push({ c, i }); else out.push([c.group, [{ c, i }]]) })
  return out
}

function Bar({ onClose, repos, pages, onSignOut }: { onClose: () => void; repos: Repo[]; pages: { to: string; label: string; icon?: string }[]; onSignOut: () => void }) {
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
    ...pages.map((p) => ({ id: `p:${p.to}`, group: 'Go to', label: p.label, icon: p.icon, run: go(p.to), words: `${p.label} page` })),
    { id: 'p:profile', group: 'Go to', label: 'Your profile', icon: 'profile', run: go('/app/profile'), words: 'profile account avatar preferences' },
    ...repos.map((r) => ({ id: `r:${r.id}`, group: 'Repositories', label: name(r), hint: r.stats?.needsYou ? `${r.stats.needsYou} need you` : r.status || 'idle', dot: `s-${r.status || 'idle'}`, run: go(`/app/repos/${r.id}`), words: `${r.fullName} ${r.displayName || ''} repo board` })),
    ...repos.map((r) => ({ id: `run:${r.id}`, group: 'Actions', label: `Run the swarm on ${name(r)}`, hint: 'queue a run', icon: 'run', run: () => {
      onClose(); if (!user) return
      queueRun(user.uid, r.id, 'command').then(() => toast.ok('Run queued', `${name(r)} · a worker picks it up next`), (e) => toast.error('Couldn’t queue it', e.message))
    }, words: `run start sync ${r.fullName}` })),
    { id: 'a:playground', group: 'Actions', label: 'Open the playground', hint: 'public page', icon: 'flask', run: go('/playground'), words: 'playground try test analyse' },
    { id: 'a:home', group: 'Actions', label: 'Swarm home', icon: 'home', run: go('/'), words: 'home landing website' },
    { id: 'a:out', group: 'Actions', label: 'Sign out', icon: 'out', run: () => { onClose(); onSignOut() }, words: 'sign out log out logout' },
    ...tasks.map((t) => ({ id: `t:${t.repoId}/${t.task_id}`, group: 'Tasks', label: t.title, icon: 'task', hint: `${t.task_id} · ${t.state === 'Needs Human' ? 'needs you' : t.state.toLowerCase()}`,
      run: go(`/app/repos/${t.repoId}/tasks/${t.task_id}`), words: `${t.task_id} ${t.source_issue} ${t.state} ${t.labels.join(' ')}` })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [pages, repos, tasks, user])

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return cmds.filter((c) => c.group !== 'Tasks' || /needs you|approved/.test(c.hint || '')).sort((a, b) => RANK.indexOf(a.group) - RANK.indexOf(b.group)).slice(0, 24)
    return cmds.map((c) => {
      const hay = `${c.label} ${c.words}`.toLowerCase()
      if (!terms.every((w) => hay.includes(w))) return null
      const score = (c.label.toLowerCase().startsWith(terms[0]) ? 3 : 0) + (c.label.toLowerCase().includes(terms[0]) ? 1 : 0) + (c.group === 'Go to' ? 1 : 0)
      return { c, score }
    }).filter(Boolean).sort((a, b) => RANK.indexOf(a!.c.group) - RANK.indexOf(b!.c.group) || b!.score - a!.score).slice(0, 30).map((x) => x!.c)
  }, [cmds, q])
  useEffect(() => { setAt(0) }, [q])
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) }, [at])

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
        <div className="kbar-list" ref={list} role="listbox" data-lenis-prevent>
          {shown.length === 0 && <p className="kbar-none">Nothing matches “{q}”.</p>}
          {groups(shown).map(([group, items]) => {
            const tiles = !q && group === 'Go to'
            return (
              <section key={group} className="kbar-sec">
                <p className="kbar-group">{group}</p>
                <div className={tiles ? 'kbar-tiles' : 'kbar-rows'}>
                  {items.map(({ c, i }) => (
                    <button key={c.id} role="option" aria-selected={i === at} className={`${tiles ? 'kbar-tile' : 'kbar-item'} ${i === at ? 'on' : ''}`} onMouseMove={() => i !== at && setAt(i)} onClick={c.run}>
                      {i === at && <motion.span layoutId="kbar-on" className="kbar-on" transition={{ type: 'spring', stiffness: 600, damping: 42 }} />}
                      <span className={`kbar-ico ${c.dot ? 'is-dot' : ''}`} data-g={c.group}>{c.dot ? <span className={`status-dot ${c.dot}`} /> : <Icon name={c.icon || ''} />}</span>
                      <span className="kbar-label">{c.label}</span>
                      {!tiles && c.hint && <span className="kbar-hint">{c.hint}</span>}
                      {!tiles && i === at && <kbd className="kbar-enter">↵</kbd>}
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
        <div className="kbar-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd><kbd>K</kbd> toggle</span></div>
      </motion.div>
    </>
  )
}
