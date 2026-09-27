import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Logo } from '../../components/Logo'
import { PageTransition } from '../../components/PageTransition'
import { Roll } from '../../components/Roll'
import { Splash } from '../../components/Splash'
import { useAuth } from '../../lib/auth'
import { LookFx } from '../../components/LookFx'
import { finishOnboarding, saveOnboarding, savePrefs, useIsAdmin, usePrefs, useProfile, useRepos } from '../../lib/data'
import { THEMES } from '../../lib/looks'
import { morph, setMode, useMode, type Mode } from '../../lib/theme'
import type { Prefs } from '../../lib/types'
import { easeOut } from '../../lib/motion'
import type { Onboarding as Saved } from '../../lib/types'
import ConnectRepo from '../app/ConnectRepo'
import './onboarding.css'

/*
 * First-time setup. It runs once: until it is finished, every visit to the dashboard lands back here, at the
 * step you left (the step and your answers are saved on your profile as you go). Steps change with the same
 * bellows as the rest of the app. Every question maps to something real: your name, a repository, and the
 * settings you'd otherwise hunt for later (theme, light or dark, where the dashboard opens, alerts, merging).
 */

const STEPS = [
  { title: 'Your name', colour: 'var(--triager)' },
  { title: 'Meet the agents', colour: 'var(--coder)' },
  { title: 'A repository', colour: 'var(--tester)' },
  { title: 'Make it yours', colour: 'var(--reviewer)' },
]

export default function Onboarding() {
  const { user } = useAuth()
  const profile = useProfile(user?.uid)
  if (!user || profile === undefined) return <Splash />
  if (profile?.onboardedAt) return <Navigate to="/app" replace />
  return <Flow uid={user.uid} initialName={profile?.displayName || user.displayName || ''} saved={profile?.onboarding || {}} />
}

function Flow({ uid, initialName, saved }: { uid: string; initialName: string; saved: Saved }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { logOut, user, updateName } = useAuth()
  const { data: repos, loading: reposLoading } = useRepos(uid)
  const admin = useIsAdmin(uid)
  const [step, setStep] = useState(Math.min(saved.step ?? 0, STEPS.length - 1))
  const [name, setName] = useState(initialName)
  const [repoId, setRepoId] = useState<string | null>(saved.repoId || null)
  const prefs = usePrefs(uid) ?? {}
  const [saving, setSaving] = useState(false)
  const hasRepo = !!repoId || repos.length > 0

  const can = [name.trim().length > 0, true, hasRepo, true][step]
  const go = async (to: number) => {
    setSaving(true)
    try {
      await saveOnboarding(uid, { step: to, repoId }, name.trim())
      if (step === 0 && name.trim() !== user?.displayName) await updateName(name.trim())
      setStep(to)
    } catch (e) { toast.error('Couldn’t save that', (e as Error).message) }
    setSaving(false)
  }
  const finish = async () => {
    setSaving(true)
    try {
      await saveOnboarding(uid, { step: STEPS.length - 1, repoId }, name.trim())
      await finishOnboarding(uid)
      toast.ok(`Welcome, ${name.trim().split(' ')[0]}`, 'Your dashboard is ready.')
      navigate(repoId ? `/app/repos/${repoId}` : '/app', { replace: true })
    } catch (e) { toast.error('Couldn’t finish', (e as Error).message); setSaving(false) }
  }

  return (
    <div className="onb" style={{ ['--font-sans' as string]: prefs.font && prefs.font !== 'mono' ? `var(--ff-${prefs.font})` : undefined }}>
      <aside className="onb-rail">
        <Logo to="/" />
        <div className="onb-rail-mid">
          <p className="onb-kicker">Setting up Swarm</p>
          <ol className="onb-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className={i === step ? 'now' : i < step ? 'done' : ''}>
                <span className="onb-step-dot" style={{ ['--c' as string]: s.colour }}>
                  {i < step ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : i + 1}
                </span>
                <span>{s.title}</span>
                {i === step && <motion.span layoutId="onb-now" className="onb-step-now" transition={{ duration: 0.5, ease: easeOut }} />}
              </li>
            ))}
          </ol>
        </div>
        <div className="onb-rail-foot">
          <span className="muted">{user?.email}</span>
          <button className="link-btn" onClick={() => { navigate('/', { replace: true }); void logOut() }}>Sign out</button>
        </div>
      </aside>

      <main className="onb-main">
        <LookFx look={prefs.look ?? 'plain'} />
        <div className="onb-progress" aria-hidden="true">
          <motion.span animate={{ scaleX: (step + 1) / STEPS.length }} transition={{ duration: 0.8, ease: easeOut }} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={step} scope="pane" label={STEPS[step].title}>
            <section className="onb-card">
              <p className="onb-count mono">Step {step + 1} of {STEPS.length}</p>
              {step === 0 && <StepName name={name} setName={setName} onEnter={() => can && go(1)} />}
              {step === 1 && <StepAgents />}
              {step === 2 && <StepRepo repos={repos.length} loading={reposLoading} repoId={repoId} admin={!!admin}
                onAdded={async (id) => { setRepoId(id); await saveOnboarding(uid, { step: 2, repoId: id }); toast.ok('Repository added', 'The agents start on it as soon as you finish.') }} />}
              {step === 3 && <StepYours uid={uid} prefs={prefs} />}

              <div className="onb-nav">
                {step > 0 && <button className="btn btn-line" onClick={() => go(step - 1)} disabled={saving}><Roll>Back</Roll></button>}
                {step < STEPS.length - 1
                  ? <button className="btn btn-dark onb-next" onClick={() => go(step + 1)} disabled={!can || saving}><Roll>{saving ? 'Saving…' : 'Continue'}</Roll></button>
                  : <button className="btn btn-dark onb-next" onClick={finish} disabled={saving}><Roll>{saving ? 'Opening your dashboard…' : 'Open my dashboard'}</Roll></button>}
                {!can && step === 2 && <span className="muted">Add a repository, or try the demo, to go on.</span>}
              </div>
            </section>
          </PageTransition>
        </AnimatePresence>
      </main>
    </div>
  )
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="onb-head">
      <h1>{title.split(' ').map((w, i) => (
        <span key={i} className="word-mask"><motion.span className="word" initial={{ y: '110%' }} animate={{ y: '0%' }} transition={{ duration: 0.7, ease: easeOut, delay: 0.45 + i * 0.05 }}>{w}&nbsp;</motion.span></span>
      ))}</h1>
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.7 }}>{sub}</motion.p>
    </header>
  )
}

function Rise({ children, i = 0, className }: { children: React.ReactNode; i?: number; className?: string }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.8 + i * 0.06 }}>{children}</motion.div>
}

function StepName({ name, setName, onEnter }: { name: string; setName: (s: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { const id = window.setTimeout(() => ref.current?.focus(), 900); return () => window.clearTimeout(id) }, [])
  return (
    <>
      <Heading title="Welcome to Swarm" sub="Four agents that fix tests which fail at random. Setup takes about a minute, once. What should they call you?" />
      <Rise className="onb-field">
        <label htmlFor="onb-name">Your name</label>
        <input id="onb-name" ref={ref} value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }} placeholder="Ada Lovelace" autoComplete="name" />
      </Rise>
    </>
  )
}

const AGENTS = [
  { name: 'Triager', c: 'var(--triager)', does: 'Reads each new issue, decides what it is and how urgent, and spots duplicates. Unsure means you decide.' },
  { name: 'Coder', c: 'var(--coder)', does: 'Finds the code behind a failing test and writes the smallest change that removes the cause.' },
  { name: 'Tester', c: 'var(--tester)', does: 'Runs the test many times before and after the fix in a sealed sandbox, writing its own tool when it needs one.' },
  { name: 'Reviewer', c: 'var(--reviewer)', does: 'Checks the fix without seeing the coder’s reasoning, and looks for reasons to say no.' },
]

function StepAgents() {
  const [on, setOn] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setOn((i) => (i + 1) % (AGENTS.length + 1)), 1500); return () => window.clearInterval(id) }, [])
  return (
    <>
      <Heading title="Meet the agents" sub="Each one does one job, then hands the task to the next over A2A. Nothing merges until you say so." />
      <Rise className="onb-chain">
        {AGENTS.map((a, i) => (
          <div key={a.name} className={`onb-agent ${on === i ? 'on' : ''} ${on > i ? 'past' : ''}`} style={{ ['--c' as string]: a.c }}>
            <span className="onb-agent-dot" />
            <div><b>{a.name}</b><p>{a.does}</p></div>
          </div>
        ))}
        <div className={`onb-agent onb-you ${on === AGENTS.length ? 'on' : ''}`} style={{ ['--c' as string]: 'var(--white)' }}>
          <span className="onb-agent-dot" />
          <div><b>You</b><p>Approve and merge, send a fix back with a comment, or answer when an agent asks.</p></div>
        </div>
      </Rise>
    </>
  )
}

function StepRepo({ repos, loading, repoId, admin, onAdded }: { repos: number; loading: boolean; repoId: string | null; admin: boolean; onAdded: (id: string) => void }) {
  return (
    <>
      <Heading title="Point it at a repository" sub="Connect one of your GitHub repositories, or start with the demo: it has real tests that fail at random for the agents to fix." />
      <Rise>
        {repoId || (!loading && repos > 0) ? (
          <div className="onb-added">
            <span className="onb-added-tick"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
            <div><b>{repoId ? 'Repository added' : `You already have ${repos} ${repos === 1 ? 'repository' : 'repositories'}`}</b><p className="muted">You can add more any time from Repositories.</p></div>
          </div>
        ) : <div className="onb-connect"><ConnectRepo onAdded={onAdded} /></div>}
        {admin && <p className="muted onb-note">You have test-lab access: after setup, the Test lab can make up whole projects full of bugs.</p>}
      </Rise>
    </>
  )
}

const SUN = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" />{[0, 45, 90, 135, 180, 225, 270, 315].map((r) => <path key={r} d="M12 2.6v2.2" transform={`rotate(${r} 12 12)`} />)}</svg>
const MOON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z" /></svg>
const AUTO = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></svg>

/** The settings people otherwise go looking for, asked once. Each applies the moment you pick it. */
function StepYours({ uid, prefs }: { uid: string; prefs: Prefs }) {
  const toast = useToast()
  const { mode } = useMode()
  const save = (p: Prefs) => savePrefs(uid, p).catch(() => toast.error('Couldn’t save that', 'Check your connection and try again.'))
  const look = prefs.look ?? 'plain'
  const start = prefs.startPage ?? 'overview'
  const notify = async () => {
    if (prefs.notify) return save({ notify: false })
    if (!('Notification' in window)) return toast.error('Not available here', 'This browser can’t show notifications.')
    const p = await Notification.requestPermission()
    if (p !== 'granted') return toast.error('Notifications are blocked', 'Allow them for this site in your browser settings.')
    save({ notify: true })
  }
  return (
    <>
      <Heading title="Make it yours" sub="A few choices that take effect right away. Every one of them is in Settings later." />
      <Rise className="onb-group">
        <span className="onb-label">Theme</span>
        <div className="onb-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={look === t.id} className={`onb-theme canvas-${t.look.canvas} ${look === t.id ? 'on' : ''}`} data-accent={t.look.accent}
              onClick={(e) => look !== t.id && morph(() => flushSync(() => { void save(t.look) }), { x: e.clientX, y: e.clientY })}>
              <span className="onb-theme-face"><LookFx look={t.id} mini /><b style={{ fontFamily: `var(--ff-${t.look.font})` }}>Aa</b></span>
              <span className="onb-theme-name">{t.name}</span>
            </button>
          ))}
        </div>
      </Rise>
      <Rise className="onb-group" i={1}>
        <span className="onb-label">Light or dark</span>
        <div className="onb-options onb-options--three">
          {([['light', 'Light', SUN], ['dark', 'Dark', MOON], ['system', 'Match my device', AUTO]] as const).map(([id, label, icon]) => (
            <button key={id} className={`onb-option ${mode === id ? 'on' : ''}`} aria-pressed={mode === id}
              onClick={(e) => setMode(id as Mode, { x: e.clientX, y: e.clientY })}><span className="onb-ic">{icon}</span>{label}</button>
          ))}
        </div>
      </Rise>
      <Rise className="onb-group" i={2}>
        <span className="onb-label">When you sign in, open</span>
        <div className="onb-options onb-options--three">
          {([['overview', 'Overview', 'Everything waiting for you'], ['repos', 'Repositories', 'All your repos at once'], ['last', 'My last repo', 'Back where you were']] as const).map(([id, label, hint]) => (
            <button key={id} className={`onb-option ${start === id ? 'on' : ''}`} aria-pressed={start === id} onClick={() => save({ startPage: id })}>
              <span className="onb-radio" /><span><b>{label}</b><span className="muted">{hint}</span></span>
            </button>
          ))}
        </div>
      </Rise>
      <Rise className="onb-group" i={3}>
        <span className="onb-label">When a fix is ready</span>
        <div className="onb-options">
          <button className={`onb-option ${prefs.notify ? 'on' : ''}`} aria-pressed={!!prefs.notify} onClick={() => void notify()}>
            <span className="onb-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
            <span><b>Notify me</b><span className="muted">A browser notification when a fix waits for you</span></span>
          </button>
          <button className={`onb-option ${(prefs.confirm ?? 'ask') === 'ask' ? 'on' : ''}`} aria-pressed={(prefs.confirm ?? 'ask') === 'ask'} onClick={() => save({ confirm: (prefs.confirm ?? 'ask') === 'ask' ? 'off' : 'ask' })}>
            <span className="onb-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
            <span><b>Ask before merging</b><span className="muted">One more check before a fix goes in</span></span>
          </button>
        </div>
      </Rise>
    </>
  )
}
