import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Repo } from '../../lib/types'

/* Shared by House rules and Quiet hours: which repository you're editing (remembered between visits),
   and a local copy of its setting that saves itself a moment after you stop changing it. */

export function useRepoChoice(repos: Repo[], key: string) {
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem(key) || '' } catch { return '' } })
  const valid = repos.find((r) => r.id === id) ? id : repos[0]?.id || ''
  const pick = (next: string) => { setId(next); try { localStorage.setItem(key, next) } catch { /* private window */ } }
  return [valid, pick] as const
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useDraft<T>(scope: string | undefined, remote: T, save: (v: T) => Promise<unknown>, delay = 650) {
  const [draft, setDraft] = useState<T>(remote)
  const [state, setState] = useState<SaveState>('idle')
  const dirty = useRef(false)
  const remoteKey = JSON.stringify(remote)
  // a different repository, or a change saved somewhere else while nothing here is pending
  useEffect(() => { dirty.current = false; setDraft(remote); setState('idle') }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dirty.current) setDraft(remote) }, [remoteKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty.current) return
    setState('saving')
    const t = window.setTimeout(() => {
      save(draft).then(() => { dirty.current = false; setState('saved') }, () => setState('error'))
    }, delay)
    return () => window.clearTimeout(t)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: T | ((prev: T) => T)) => { dirty.current = true; setDraft(next) }
  return [draft, update, state] as const
}

export function SaveChip({ state, readOnly }: { state: SaveState; readOnly?: boolean }) {
  const [label, tone] = readOnly ? ['Only the owner can change this', 'mute']
    : state === 'saving' ? ['Saving…', 'work'] : state === 'saved' ? ['Saved', 'ok'] : state === 'error' ? ['Couldn’t save', 'bad'] : ['Saves as you go', 'mute']
  return (
    <span className={`save-chip save-chip--${tone}`} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={label} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }}>
          <i />{label}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function RepoSelect({ repos, value, onChange }: { repos: Repo[]; value: string; onChange: (id: string) => void }) {
  if (repos.length < 2) return null
  return (
    <select className="selectbox" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Repository">
      {repos.map((r) => <option key={r.id} value={r.id}>{r.displayName || r.fullName}</option>)}
    </select>
  )
}

/** How a block arrives on these pages: a short fade and a small rise, one block just after another. */
export function rise(i: number) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const, delay: 0.04 + i * 0.05 },
  }
}
