import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AvatarCropper } from '../../components/AvatarCropper'
import { createPortal } from 'react-dom'
import { Roll } from '../../components/Roll'
import { passkeysSupported, webauthnError } from '../../lib/api'
import { friendlyAuthError, useAuth } from '../../lib/auth'
import { removePasskey, renamePasskey, setAvatar, useAllTasks, usePasskeys, useProfile, useRepos } from '../../lib/data'
import { Activity, Preferences, Workspace, YourData } from './ProfileExtras'
import { IdentityCard, PhotoSwap } from './IdentityCard'
import { PanelLayout, usePanel, type PanelItem } from '../../components/PanelLayout'
import { easeInOut, easeOut } from '../../lib/motion'
import { Section, timeAgo } from './ui'
import { useToast } from '../../components/Island'

type Op = () => Promise<unknown>

export default function Profile() {
  const { user, logOut, version } = useAuth()
  const profile = useProfile(user?.uid)
  const { data: repos } = useRepos(user?.uid)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [reauth, setReauth] = useState<{ op: Op; done: string; after?: Report } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = usePanel(SECTIONS, 'account')
  if (!user) return null

  const providers = user.providerData.map((p) => p.providerId)
  const since = user.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString([], { month: 'long', year: 'numeric' }) : ''

  /** Run a sensitive change; if Firebase wants a fresh sign-in, ask for it and then try again. */
  const guarded = async (op: Op, done: string, report: Report) => {
    try { await op(); report(done, true) } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'auth/requires-recent-login' || code === 'auth/user-token-expired') setReauth({ op, done, after: report })
      else report(friendlyAuthError(e), false)
    }
  }

  const pick = (f?: File | null) => { if (f && f.type.startsWith('image/')) setFile(f) }

  const fixed = tasks.filter((t) => t.state === 'Merged' || t.state === 'Approved').length
  const waiting = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human').length
  const drop = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true) },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) },
  }
  const signOut = () => { navigate('/', { replace: true }); void logOut() }
  return (
    <div className="page page--wide" data-v={version}>
      <IdentityCard uid={user.uid} name={user.displayName || user.email?.split('@')[0] || 'You'}
        sub={<>{user.email}{since && <> · with Swarm since {since}</>}</>}
        chips={providers.map((p) => <span key={p} className="chip">{PROVIDER[p]?.label || p}</span>)}
        photo={<PhotoSwap src={profile?.avatar ?? null} initial={(user.displayName || user.email || '?').slice(0, 1).toUpperCase()} size={116} />}
        onPhoto={() => input.current?.click()} dragging={dragging} dropProps={drop}
        onRemove={profile?.avatar ? async () => { await setAvatar(user.uid, null); toast.info('Photo removed') } : undefined}
        stats={[['repositories', repos.length], ['tests fixed', fixed], ['waiting for you', waiting]]} />
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />

      <AvatarCropper file={file} onCancel={() => setFile(null)} onSave={async (data) => { setFile(null); await setAvatar(user.uid, data); toast.ok('Photo updated', 'Looking sharp.') }} />

      <PanelLayout items={SECTIONS} active={tab} onPick={setTab}
        foot={<button className="pl-signout" onClick={signOut}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 17l5-5-5-5M20 12H9M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7" /></svg>Sign out</button>}>
        {tab === 'account' && <div className="pl-grid"><Details guarded={guarded} /><Workspace prefs={profile?.prefs ?? {}} /></div>}
        {tab === 'security' && <div className="pl-grid"><SignInMethods guarded={guarded} /><Passkeys /></div>}
        {tab === 'preferences' && <Preferences prefs={profile?.prefs ?? {}} />}
        {tab === 'activity' && <Activity repos={repos} tasks={tasks} />}
        {tab === 'data' && (
          <div className="pl-grid">
            <YourData profile={profile} repos={repos} tasks={tasks} />
            <Section title="Leave Swarm" className="card-danger"><DeleteAccount guarded={guarded} onDone={() => navigate('/')} /></Section>
          </div>
        )}
      </PanelLayout>

      <Reauth state={reauth} onClose={() => setReauth(null)} />
    </div>
  )
}

const SECTIONS: PanelItem[] = [
  { id: 'account', label: 'Account', hint: 'Name, email, your workspace', color: 'var(--coder)' },
  { id: 'security', label: 'Sign-in & security', hint: 'Methods and passkeys', color: 'var(--reviewer)' },
  { id: 'preferences', label: 'Preferences', hint: 'Notifications, motion, start page', color: 'var(--triager)' },
  { id: 'activity', label: 'Activity', hint: 'What the agents did for you', color: 'var(--tester)' },
  { id: 'data', label: 'Your data', hint: 'Export, account ID, leave', color: 'var(--lab)' },
]

type Report = (msg: string, ok: boolean) => void
type Guarded = (op: Op, done: string, report: Report) => Promise<void>
const PROVIDER: Record<string, { label: string; icon: ReactNode }> = {
  password: { label: 'Email and password', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 8l9 6 9-6" /></svg> },
  'google.com': { label: 'Google', icon: <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" /></svg> },
  'github.com': { label: 'GitHub', icon: <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg> },
}

/* ------------------------------------------------------------------ name and email */

function Details({ guarded }: { guarded: Guarded }) {
  const { user, updateName, changeEmail } = useAuth()
  return (
    <Section title="Your details">
      <EditRow label="Name" value={user?.displayName || ''} placeholder="Your name" onSave={(v, report) => guarded(() => updateName(v.trim()), 'Name saved.', report)} />
      <EditRow label="Email" type="email" value={user?.email || ''} placeholder="you@company.com"
        hint="We send a link to the new address. The change applies once you click it."
        onSave={(v, report) => guarded(() => changeEmail(v.trim()), `Check ${v.trim()} for a confirmation link.`, report)} />
    </Section>
  )
}

function EditRow({ label, value, placeholder, type = 'text', hint, onSave }: {
  label: string; value: string; placeholder: string; type?: string; hint?: string
  onSave: (v: string, report: Report) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!v.trim() || v.trim() === value) { setEditing(false); return }
    setBusy(true)
    await onSave(v, (m, ok) => { setMsg(m); if (ok) setEditing(false) })
    setBusy(false)
  }
  return (
    <div className="erow">
      <span className="erow-label">{label}</span>
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.form key="edit" className="erow-edit" onSubmit={submit} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: easeOut }}>
            <input className="field-input" type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} autoFocus aria-label={label} />
            <button className="btn btn-dark btn-sm" type="submit" disabled={busy}><Roll>{busy ? 'Saving…' : 'Save'}</Roll></button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEditing(false); setV(value); setMsg('') }}><Roll>Cancel</Roll></button>
          </motion.form>
        ) : (
          <motion.div key="view" className="erow-view" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: easeOut }}>
            <b>{value || <span className="muted">Not set</span>}</b>
            <button className="btn btn-line btn-sm" onClick={() => { setV(value); setEditing(true); setMsg('') }}><Roll>Edit</Roll></button>
          </motion.div>
        )}
      </AnimatePresence>
      {(hint && editing) && <p className="erow-hint">{hint}</p>}
      <AnimatePresence>{msg && <motion.p className="erow-msg" role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{msg}</motion.p>}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ sign-in methods */

function SignInMethods({ guarded }: { guarded: Guarded }) {
  const { user, linkProvider, unlinkProvider, setPassword } = useAuth()
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [pw, setPw] = useState(false)
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const have = new Set(user?.providerData.map((p) => p.providerId))
  const only = have.size <= 1
  const report = (id: string): Report => (m) => setMsg((s) => ({ ...s, [id]: m }))
  const run = async (id: string, op: Op, done: string) => { setBusy(id); await guarded(op, done, report(id)); setBusy(null) }

  return (
    <Section title="Sign-in methods" action={<span className="muted">{have.size} connected</span>}>
      <LayoutGroup>
        <div className="methods">
          {(['password', 'google.com', 'github.com'] as const).map((id) => {
            const on = have.has(id)
            return (
              <motion.div layout key={id} className={`method ${on ? 'on' : ''}`} transition={{ duration: 0.45, ease: easeInOut }}>
                <span className="method-ic">{PROVIDER[id].icon}</span>
                <div className="method-main">
                  <b>{PROVIDER[id].label}</b>
                  <span>{id === 'password' ? (on ? 'Sign in with your email and a password.' : 'Add a password to sign in without Google or GitHub.')
                    : id === 'github.com' ? (on ? 'Also gives the worker access to your repositories.' : 'Sign in with GitHub and let Swarm open pull requests.')
                    : (on ? 'Sign in with your Google account.' : 'Sign in with one click from Google.')}</span>
                  {msg[id] && <em className="method-msg">{msg[id]}</em>}
                </div>
                <div className="method-act">
                  {id === 'password'
                    ? <button className="btn btn-line btn-sm" onClick={() => { setPw((v) => !v); setNext('') }} aria-expanded={pw}><Roll>{pw ? 'Cancel' : on ? 'Change password' : 'Add password'}</Roll></button>
                    : on
                      ? <button className="btn btn-line btn-sm" disabled={only || !!busy} title={only ? 'Keep at least one way to sign in' : undefined}
                          onClick={() => run(id, () => unlinkProvider(id), `${PROVIDER[id].label} disconnected.`)}><Roll>{busy === id ? 'Working…' : 'Disconnect'}</Roll></button>
                      : <button className="btn btn-dark btn-sm" disabled={!!busy} onClick={() => run(id, () => linkProvider(id), `${PROVIDER[id].label} connected.`)}><Roll>{busy === id ? 'Opening…' : 'Connect'}</Roll></button>}
                </div>
                <AnimatePresence initial={false}>
                  {id === 'password' && pw && (
                    <motion.form className="method-pw" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: easeInOut }}
                      onSubmit={async (e) => { e.preventDefault(); await run('password', () => setPassword(next), on ? 'Password changed.' : 'Password added. You can now sign in with your email.'); setPw(false) }}>
                      <input className="field-input" type="password" autoComplete="new-password" minLength={6} value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password, at least 6 characters" aria-label="New password" />
                      <button className="btn btn-dark btn-sm" type="submit" disabled={next.length < 6 || !!busy}><Roll>{busy === 'password' ? 'Saving…' : 'Save password'}</Roll></button>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </Section>
  )
}

/* ------------------------------------------------------------------ passkeys */

function Passkeys() {
  const { user, addPasskey } = useAuth()
  const toast = useToast()
  const { data: keys, loading } = usePasskeys(user?.uid)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const supported = passkeysSupported()
  const add = async () => {
    setBusy(true); setMsg('')
    try { await addPasskey(); setMsg(''); toast.ok('Passkey added', 'Next time, choose “Sign in with a passkey”.') } catch (e) { setMsg(webauthnError(e)) } finally { setBusy(false) }
  }
  return (
    <Section title="Passkeys" action={<span className="pill tone-work">No password needed</span>}>
      <p className="muted-p">A passkey signs you in with your fingerprint, face or device PIN. It’s stored on your device or password manager and can’t be phished.</p>
      <ul className="keys">
        <AnimatePresence initial={false}>
          {keys.map((k) => <KeyRow key={k.id} id={k.id} name={k.name} synced={!!k.backedUp} created={k.createdAt} used={k.lastUsedAt} />)}
        </AnimatePresence>
        {!loading && !keys.length && <li className="keys-empty">No passkeys yet.</li>}
      </ul>
      <div className="keys-foot">
        <button className="btn btn-dark" onClick={add} disabled={busy || !supported}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="9" r="4" /><path d="M11 12l9 0M17 12v3M20 12v2M2 20c0-3 3-5 6-5" /></svg>
          <Roll>{busy ? 'Waiting for your device…' : 'Add a passkey'}</Roll>
        </button>
        {!supported && <span className="muted">This browser doesn’t support passkeys.</span>}
        {msg && <span className="conn-msg" role="status">{msg}</span>}
      </div>
    </Section>
  )
}

function KeyRow({ id, name, synced, created, used }: { id: string; name: string; synced: boolean; created?: { toDate(): Date } | null; used?: { toDate(): Date } | null }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  return (
    <motion.li layout className="key" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.25 } }} transition={{ duration: 0.45, ease: easeOut }}>
      <span className="key-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="9" r="4" /><path d="M11 12l9 0M17 12v3M20 12v2" /></svg></span>
      <div className="key-main">
        {editing ? (
          <form onSubmit={async (e) => { e.preventDefault(); if (v.trim()) await renamePasskey(id, v.trim().slice(0, 60)); setEditing(false) }}>
            <input className="field-input field-input--sm" value={v} onChange={(e) => setV(e.target.value)} autoFocus onBlur={() => setEditing(false)} aria-label="Passkey name" />
          </form>
        ) : <b onDoubleClick={() => setEditing(true)} title="Double-click to rename">{name}</b>}
        <span>{synced ? 'Synced across your devices' : 'This device only'} · added {timeAgo(created)}{used ? ` · last used ${timeAgo(used)}` : ''}</span>
      </div>
      <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Rename" title="Rename"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg></button>
      <button className="icon-btn" onClick={() => { if (window.confirm(`Remove “${name}”? You won’t be able to sign in with it any more.`)) removePasskey(id) }} aria-label="Remove" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg>
      </button>
    </motion.li>
  )
}

/* ------------------------------------------------------------------ delete, re-authenticate */

function DeleteAccount({ guarded, onDone }: { guarded: Guarded; onDone: () => void }) {
  const { user, deleteAccount } = useAuth()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const confirmWord = user?.email || 'delete'
  return (
    <div className="danger">
      <p className="muted-p">Deletes your account, your repositories’ boards, your passkeys and access tokens. Nothing changes on GitHub.</p>
      <AnimatePresence mode="wait" initial={false}>
        {!open ? (
          <motion.div key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="btn btn-danger" onClick={() => setOpen(true)}><Roll>Delete my account</Roll></button>
          </motion.div>
        ) : (
          <motion.form key="b" className="danger-confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: easeOut }}
            onSubmit={async (e) => { e.preventDefault(); setBusy(true); await guarded(deleteAccount, 'deleted', (m, ok) => { if (ok) onDone(); else setMsg(m) }); setBusy(false) }}>
            <label>Type <b>{confirmWord}</b> to confirm</label>
            <input className="field-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="Confirm" />
            <div className="danger-actions">
              <button className="btn btn-ghost" type="button" onClick={() => { setOpen(false); setTyped('') }}><Roll>Keep my account</Roll></button>
              <button className="btn btn-danger" type="submit" disabled={typed !== confirmWord || busy}><Roll>{busy ? 'Deleting…' : 'Delete forever'}</Roll></button>
            </div>
            {msg && <p className="form-error">{msg}</p>}
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}

function Reauth({ state, onClose }: { state: { op: Op; done: string; after?: Report } | null; onClose: () => void }) {
  const { user, reauthenticate } = useAuth()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const hasPassword = !!user?.providerData.some((p) => p.providerId === 'password')
  const confirm = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!state) return
    setBusy(true); setErr('')
    try {
      await reauthenticate(hasPassword ? pw : undefined)
      await state.op()
      state.after?.(state.done, true)
      setPw(''); onClose()
    } catch (x) { setErr(friendlyAuthError(x)) } finally { setBusy(false) }
  }
  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div className="modal" role="dialog" aria-label="Confirm it’s you" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="scrim" onClick={onClose} />
          <motion.form className="crop reauth" onSubmit={confirm} initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.97, opacity: 0 }} transition={{ type: 'spring', stiffness: 280, damping: 26 }}>
            <header className="crop-head"><h3>Confirm it’s you</h3><p>You signed in a while ago. {hasPassword ? 'Enter your password' : 'Sign in again'} to make this change.</p></header>
            {hasPassword && <input className="field-input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus aria-label="Password" />}
            {err && <p className="form-error">{err}</p>}
            <footer className="crop-foot">
              <button type="button" className="btn btn-line" onClick={onClose}><Roll>Cancel</Roll></button>
              <button type="submit" className="btn btn-dark" disabled={busy || (hasPassword && !pw)}><Roll>{busy ? 'Checking…' : hasPassword ? 'Confirm' : 'Sign in again'}</Roll></button>
            </footer>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
