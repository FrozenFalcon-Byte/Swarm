import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { agentColor } from '../../components/AgentDots'
import { Logo } from '../../components/Logo'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { usingEmulators } from '../../lib/firebase'
import { passkeysSupported, webauthnError } from '../../lib/api'
import { easeInOut, easeOut } from '../../lib/motion'
import './auth.css'
import { Roll } from '../../components/Roll'

type Mode = 'signin' | 'signup'

export default function AuthPage({ mode }: { mode: Mode }) {
  const { user, signIn, signUp, withGitHub, withGoogle, withPasskey, resetPassword, redirectError } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = (location.state as { from?: string } | null)?.from || '/app'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [typedError, setError] = useState('')
  // the installed app signs in by redirect, so a Google or GitHub error arrives after the page reloads
  const error = typedError || (redirectError && !busy ? friendlyAuthError(redirectError) : '')
  const [notice, setNotice] = useState('')

  useEffect(() => { if (user) navigate(next, { replace: true }) }, [user, next, navigate])
  useEffect(() => { setError(''); setNotice('') }, [mode])

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(''); setNotice('')
    try { await fn() } catch (e) { setError(friendlyAuthError(e)) } finally { setBusy(null) }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run('email', () => mode === 'signup' ? signUp(name.trim() || email.split('@')[0], email, password) : signIn(email, password))
  }

  const forgot = () => {
    if (!email) { setError('Type your email above, then choose “Forgot password?” again.'); return }
    run('reset', async () => { await resetPassword(email); setNotice(`We sent a reset link to ${email}.`) })
  }

  return (
    <div className="auth">
      <div className="auth-form-side">
        <Logo />
        <div className="auth-form-wrap">
          <AnimatePresence mode="wait">
            <motion.div key={mode} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: easeOut }}>
              <h1 className="auth-title">{mode === 'signup' ? 'Start with a repo.' : 'Welcome back.'}</h1>
              <p className="auth-sub">{mode === 'signup' ? 'Create an account and point Swarm at your first repository. The demo repo is ready if you want to look around first.' : 'Sign in to see what your agents did while you were away.'}</p>
            </motion.div>
          </AnimatePresence>

          <div className="auth-oauth">
            <button className="btn btn-dark auth-oauth-btn" onClick={() => run('github', withGitHub)} disabled={!!busy}>
              <GitHubIcon /> <Roll>{busy === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}</Roll></button>
            <button className="btn btn-line auth-oauth-btn" onClick={() => run('google', withGoogle)} disabled={!!busy}>
              <GoogleIcon /> <Roll>{busy === 'google' ? 'Opening Google…' : 'Continue with Google'}</Roll></button>
            {mode === 'signin' && passkeysSupported() && (
              <button className="btn btn-ghost auth-oauth-btn" disabled={!!busy} onClick={async () => {
                setBusy('passkey'); setError(''); setNotice('')
                try { await withPasskey() } catch (e) { setError((e as { code?: string }).code ? friendlyAuthError(e) : webauthnError(e)) } finally { setBusy(null) }
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="9" r="4" /><path d="M11 12h9M17 12v3M20 12v2M2 20c0-3 3-5 6-5" /></svg>
                <Roll>{busy === 'passkey' ? 'Waiting for your device…' : 'Sign in with a passkey'}</Roll>
              </button>
            )}
            <p className="auth-hint">GitHub lets Swarm read issues on private repos and open pull requests when you merge.</p>
          </div>

          <div className="auth-divider"><span>or with email</span></div>

          <form className="auth-fields" onSubmit={submit} noValidate>
            <AnimatePresence initial={false}>
              {mode === 'signup' && (
                <motion.label key="name" className="field" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: easeInOut }}>
                  <span>Your name</span>
                  <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
                </motion.label>
              )}
            </AnimatePresence>
            <label className="field">
              <span>Email</span>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </label>
            <label className="field">
              <span className="field-row">Password {mode === 'signin' && <button type="button" className="link-btn" onClick={forgot}>Forgot password?</button>}</span>
              <input id="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'} />
            </label>
            <AnimatePresence>
              {(error || notice) && (
                <motion.p className={error ? 'auth-error' : 'auth-notice'} role={error ? 'alert' : 'status'}
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error || notice}</motion.p>
              )}
            </AnimatePresence>
            <button className="btn btn-green auth-submit" type="submit" disabled={!!busy || !email || password.length < 6}><Roll>{busy === 'email' ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}</Roll></button>
          </form>

          <p className="auth-switch">
            {mode === 'signup' ? <>Already have an account? <Link to="/signin" state={location.state}>Sign in</Link></>
              : <>New to Swarm? <Link to="/signup" state={location.state}>Create an account</Link></>}
          </p>
          {usingEmulators && <p className="auth-emu mono">Local emulators: accounts here are test accounts only.</p>}
        </div>
      </div>
      <AgentsPanel />
    </div>
  )
}

const LOG = [
  { agent: 'triager', text: '#214 random failure · priority high · confidence 0.91' },
  { agent: 'coder', text: 'task-031 patch v1 · sort-set-result · +1 −1' },
  { agent: 'tester', text: 'hashseed_sweep_v1 · 9/12 → 0/12 failing' },
  { agent: 'reviewer', text: 'task-031 approved · 5 checks passed' },
  { agent: 'triager', text: '#215 duplicate of task-031 · closed' },
  { agent: 'coder', text: 'task-032 patch v2 · bound-jitter' },
  { agent: 'reviewer', text: 'task-032 touches auth.py · waiting for you' },
]

function AgentsPanel() {
  const [n, setN] = useState(4)
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 2200); return () => clearInterval(t) }, [])
  // four rows on screen; a new one arrives at the bottom as the oldest leaves the top
  const visible = Array.from({ length: 4 }, (_, i) => ({ ...LOG[(n - 4 + i) % LOG.length], key: n - 4 + i }))
  return (
    <aside className="auth-panel" aria-hidden="true">
      <div className="auth-panel-frame">
        <p className="surtitle"><span style={{ background: 'var(--green)' }} />Live from the swarm</p>
        <p className="auth-panel-kicker">Meanwhile, in your repo</p>
        <div className="auth-log">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((l, i) => (
              <motion.div key={l.key} layout className="auth-log-line"
                initial={{ opacity: 0, y: 40, scale: 0.94, filter: 'blur(4px)' }}
                animate={{ opacity: i === 0 ? 0.55 : 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -24, scale: 0.94, filter: 'blur(4px)', transition: { duration: 0.45, ease: easeInOut } }}
                transition={{ layout: { duration: 0.7, ease: easeInOut }, duration: 0.7, ease: easeOut }}>
                <span className="auth-log-dot" style={{ background: agentColor(l.agent) }} />
                <span className="auth-log-agent">{l.agent}</span>
                <span className="mono auth-log-text">{l.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <p className="auth-panel-foot">Nothing merges without you.</p>
      </div>
    </aside>
  )
}

function GitHubIcon() {
  return <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
}
function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
}
