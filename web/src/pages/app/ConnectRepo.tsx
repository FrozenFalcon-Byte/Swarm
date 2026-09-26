import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { connectRepo, useGithubLink } from '../../lib/data'
import { cleanRepoName, listRepos, lookupRepo, type GhRepo } from '../../lib/github'
import { easeOut } from '../../lib/motion'
import { timeAgo } from './ui'
import { Roll } from '../../components/Roll'
import './app.css'

const FULL_NAME = /^[\w.-]+\/[\w.-]+$/

/** `onAdded` replaces the default (open the new repository), e.g. during onboarding. */
export default function ConnectRepo({ onAdded, connected = [] }: { onAdded?: (repoId: string) => void; connected?: string[] } = {}) {
  const { user, connectGitHub } = useAuth()
  const link = useGithubLink(user?.uid)
  const navigate = useNavigate()
  const done = (id: string) => { if (onAdded) { setBusy(null); onAdded(id) } else navigate(`/app/repos/${id}`) }
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
    return repos.filter((r) => !q || r.full_name.toLowerCase().includes(q)).slice(0, 30)
  }, [repos, typed])
  const exact = repos?.some((r) => r.full_name.toLowerCase() === typed.toLowerCase())

  async function add(gh: GhRepo) {
    if (!user) return
    setBusy(gh.full_name); setError('')
    try {
      const id = await connectRepo(user.uid, 'github', gh)
      done(id)
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
    try { done(await connectRepo(user.uid, 'demo')) } catch { setError('Couldn’t set up the demo. Try again.'); setBusy(null) }
  }

  async function connect() {
    setBusy('github-link'); setError('')
    try { await connectGitHub() } catch (err) { setError(friendlyAuthError(err)) } finally { setBusy(null) }
  }

  const taken = new Set(connected.map((c) => c.toLowerCase()))
  return (
    <div className="cx">
      <form className="cx-gh" onSubmit={addTyped}>
        <header>
          <span className="cx-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 00-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 015.8 0C17.3 4.3 18.3 4.6 18.3 4.6c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0012 .5z" /></svg></span>
          <div>
            <h4>From GitHub</h4>
            <p>{link ? <>Signed in as <b>@{link.login}</b>. Pick a repository, or type any owner/name.</> : 'Type a public repository as owner/name, or connect GitHub to pick from yours, private ones too.'}</p>
          </div>
          {!link && link !== undefined && (
            <button type="button" className="btn btn-line btn-sm" onClick={connect} disabled={!!busy}><Roll>{busy === 'github-link' ? 'Opening GitHub…' : 'Connect GitHub'}</Roll></button>
          )}
        </header>
        <label className="cx-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input id="repo-name" placeholder={link ? 'Search your repositories, or type owner/name' : 'owner/name, for example pallets/flask'} value={query}
            onChange={(e) => { setQuery(e.target.value); setError('') }} aria-label="Repository" autoComplete="off" spellCheck={false} />
          <AnimatePresence>
            {FULL_NAME.test(typed) && !exact && (
              <motion.button key="add" type="submit" className="btn btn-dark btn-sm" disabled={!!busy} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <Roll>{busy === typed ? 'Checking…' : 'Add'}</Roll>
              </motion.button>
            )}
          </AnimatePresence>
        </label>
        <AnimatePresence>{error && <motion.p className="form-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}</motion.p>}</AnimatePresence>
        {link ? (
          <div className="cx-list" role="listbox" aria-label="Your repositories" data-lenis-prevent>
            {repos === null && Array.from({ length: 4 }, (_, k) => <span key={k} className="cx-skel" style={{ animationDelay: `${k * 0.1}s` }} />)}
            <AnimatePresence initial={false} mode="popLayout">
              {matches.map((r, i) => {
                const have = taken.has(r.full_name.toLowerCase())
                const [owner, name] = r.full_name.split('/')
                return (
                  <motion.button type="button" layout key={r.full_name} className={`cx-row ${have ? 'have' : ''}`} onClick={() => !have && add(r)} disabled={!!busy || have}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: easeOut, delay: i * 0.03 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                    <img src={r.owner.avatar_url} alt="" width={34} height={34} />
                    <span className="cx-row-main">
                      <b><small>{owner}/</small>{name}</b>
                      <span>{r.description || 'No description'}</span>
                    </span>
                    <span className="cx-row-meta">
                      {r.private && <em>private</em>}
                      <span>{r.open_issues_count} issue{r.open_issues_count === 1 ? '' : 's'} · {timeAgo(r.pushed_at)}</span>
                    </span>
                    <span className={`cx-row-go ${busy === r.full_name ? 'busy' : ''}`}>{have ? 'Connected' : busy === r.full_name ? 'Adding…' : 'Add'}</span>
                  </motion.button>
                )
              })}
            </AnimatePresence>
            {repos && matches.length === 0 && <p className="cx-empty">{FULL_NAME.test(typed) ? <>Not one of yours. Press <b>Add</b> to connect <code>{typed}</code> anyway.</> : 'No repository of yours matches.'}</p>}
          </div>
        ) : (
          <div className="cx-hint">
            <span className="hr-k">Public ones to try</span>
            <div className="cx-try">
              {['pallets/click', 'psf/requests', 'encode/httpx', 'tiangolo/typer'].map((n) => (
                <button type="button" key={n} onClick={() => { setQuery(n); setError('') }}><code>{n}</code></button>
              ))}
            </div>
            <p>Swarm reads the repository’s open issues and runs its tests in a sandbox. It never pushes to your default branch: every fix waits for your OK.</p>
          </div>
        )}
      </form>

      <aside className="cx-side">
        <div className="cx-demo">
          <span className="cx-demo-art" aria-hidden="true">{['triager', 'coder', 'tester', 'reviewer'].map((a, i) => <i key={a} style={{ background: `var(--${a})`, animationDelay: `${i * 0.15}s` }} />)}</span>
          <h4>Or try the demo</h4>
          <p>A small library with seven real issues: three tests that fail at random, a duplicate, a question, a bug and a vague report.</p>
          <button className="btn btn-dark" onClick={demo} disabled={!!busy}><Roll>{busy === 'demo' ? 'Setting it up…' : 'Try the demo repo'}</Roll></button>
        </div>
        <ol className="cx-steps">
          <li><b>1</b><span>Pick a repository. Nothing runs until you do.</span></li>
          <li><b>2</b><span>The triager reads its open issues and picks the ones worth fixing.</span></li>
          <li><b>3</b><span>Fixes are proven in a sandbox, then wait for you to approve.</span></li>
        </ol>
      </aside>
    </div>
  )
}
