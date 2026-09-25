import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { connectRepo, useGithubLink } from '../../lib/data'
import { cleanRepoName, listRepos, lookupRepo, type GhRepo } from '../../lib/github'
import { easeOut } from '../../lib/motion'
import { timeAgo } from './ui'
import { Roll } from '../../components/Roll'

const FULL_NAME = /^[\w.-]+\/[\w.-]+$/

export default function ConnectRepo() {
  const { user, connectGitHub } = useAuth()
  const link = useGithubLink(user?.uid)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<GhRepo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!link?.token) { setRepos(null); return }
    let alive = true
    listRepos(link.token).then((r) => alive && setRepos(r)).catch((e) => alive && (setRepos([]), setError(e.message)))
    return () => { alive = false }
  }, [link?.token])

  const typed = cleanRepoName(query)
  const matches = useMemo(() => {
    if (!repos) return []
    const q = typed.toLowerCase()
    return repos.filter((r) => !q || r.full_name.toLowerCase().includes(q)).slice(0, 8)
  }, [repos, typed])
  const exact = repos?.some((r) => r.full_name.toLowerCase() === typed.toLowerCase())

  async function add(gh: GhRepo) {
    if (!user) return
    setBusy(gh.full_name); setError('')
    try {
      const id = await connectRepo(user.uid, 'github', gh)
      navigate(`/app/repos/${id}`)
    } catch (err) {
      setError((err as Error).message.includes('permission') ? 'Your account can’t add repositories yet. Try signing out and in again.' : 'Couldn’t add the repository. Try again.')
      setBusy(null)
    }
  }

  async function addTyped(e?: FormEvent) {
    e?.preventDefault()
    if (!FULL_NAME.test(typed)) { setError('Use the owner/name form, for example facebook/react.'); return }
    setBusy(typed); setError('')
    try {
      await add(await lookupRepo(typed, link?.token))
    } catch (err) {
      setError((err as Error).message + (link ? '' : ' Private repositories need GitHub connected.'))
      setBusy(null)
    }
  }

  async function demo() {
    if (!user) return
    setBusy('demo'); setError('')
    try { navigate(`/app/repos/${await connectRepo(user.uid, 'demo')}`) } catch { setError('Couldn’t set up the demo. Try again.'); setBusy(null) }
  }

  async function connect() {
    setBusy('github-link'); setError('')
    try { await connectGitHub() } catch (err) { setError(friendlyAuthError(err)) } finally { setBusy(null) }
  }

  return (
    <div className="connect">
      <form className="connect-card connect-gh" onSubmit={addTyped}>
        <h4>A GitHub repository</h4>
        <p>{link ? <>Pick one of <b>@{link.login}</b>’s repositories, or type any owner/name.</> : 'Type a public repository, or connect GitHub to pick from yours (private ones too).'}</p>
        <input id="repo-name" className="connect-input" placeholder={link ? 'Search your repositories' : 'owner/name'} value={query}
          onChange={(e) => { setQuery(e.target.value); setError('') }} aria-label="Repository" autoComplete="off" />
        {link && (
          <div className="gh-list" role="listbox" aria-label="Your repositories">
            {repos === null && <p className="gh-empty">Loading your repositories…</p>}
            <AnimatePresence initial={false}>
              {matches.map((r) => (
                <motion.button type="button" layout key={r.full_name} className="gh-row" onClick={() => add(r)} disabled={!!busy}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: easeOut }}>
                  <img src={r.owner.avatar_url} alt="" width={22} height={22} />
                  <span className="gh-row-name">{r.full_name}</span>
                  {r.private && <span className="gh-lock" title="Private">private</span>}
                  <span className="gh-row-meta">{busy === r.full_name ? 'Adding…' : timeAgo(r.pushed_at)}</span>
                </motion.button>
              ))}
            </AnimatePresence>
            {repos && matches.length === 0 && <p className="gh-empty">No repository of yours matches.</p>}
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="connect-actions">
          {(!link || (FULL_NAME.test(typed) && !exact)) && (
            <button className="btn btn-dark" type="submit" disabled={!!busy || !typed}><Roll>{busy === typed ? 'Checking…' : link ? `Add ${typed}` : 'Connect repository'}</Roll></button>
          )}
          {!link && link !== undefined && (
            <button type="button" className="btn btn-line" onClick={connect} disabled={!!busy}><Roll>{busy === 'github-link' ? 'Opening GitHub…' : 'Connect GitHub'}</Roll></button>
          )}
        </div>
      </form>
      <div className="connect-card connect-demo">
        <h4>The demo repository</h4>
        <p>A small library with seven real issues: three tests that fail at random, a duplicate, a question, a bug and a vague report.</p>
        <div style={{ flex: 1 }} />
        <button className="btn btn-green" onClick={demo} disabled={!!busy}><Roll>{busy === 'demo' ? 'Setting it up…' : 'Try the demo repo'}</Roll></button>
      </div>
    </div>
  )
}
