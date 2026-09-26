import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Logo } from '../../components/Logo'
import { PageTransition } from '../../components/PageTransition'
import { Roll } from '../../components/Roll'
import { Splash } from '../../components/Splash'
import { useAuth } from '../../lib/auth'
import { ONB_GOALS, ONB_ROLES } from '../../lib/types'
import { finishOnboarding, saveOnboarding, useIsAdmin, useProfile, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Onboarding as Saved } from '../../lib/types'
import ConnectRepo from '../app/ConnectRepo'
import './onboarding.css'

/*
 * First-time setup. It runs once: until it is finished, every visit to the dashboard lands back here, at the
 * step you left (the step and your answers are saved on your profile as you go). Steps change with the same
 * bellows as the rest of the app.
 */

const STEPS = [
  { title: 'Your name', colour: 'var(--triager)' },
  { title: 'What you need', colour: 'var(--coder)' },
  { title: 'Meet the agents', colour: 'var(--tester)' },
  { title: 'A repository', colour: 'var(--reviewer)' },
  { title: 'How you review', colour: 'var(--lab)' },
]
const ROLES = ONB_ROLES
const GOALS = ONB_GOALS

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
  const [role, setRole] = useState(saved.role || '')
  const [goals, setGoals] = useState<string[]>(saved.goals || [])
  const [repoId, setRepoId] = useState<string | null>(saved.repoId || null)
  const [review, setReview] = useState<'every' | 'batch'>(saved.review || 'every')
  const [saving, setSaving] = useState(false)
  const hasRepo = !!repoId || repos.length > 0

  const can = [name.trim().length > 0, !!role && goals.length > 0, true, hasRepo, true][step]
  const go = async (to: number) => {
    setSaving(true)
    try {
      await saveOnboarding(uid, { step: to, role, goals, repoId, review }, name.trim())
      if (step === 0 && name.trim() !== user?.displayName) await updateName(name.trim())
      setStep(to)
    } catch (e) { toast.error('Couldn’t save that', (e as Error).message) }
    setSaving(false)
  }
  const finish = async () => {
    setSaving(true)
    try {
      await saveOnboarding(uid, { step: STEPS.length - 1, role, goals, repoId, review }, name.trim())
      await finishOnboarding(uid)
      toast.ok(`Welcome, ${name.trim().split(' ')[0]}`, 'Your dashboard is ready.')
      navigate(repoId ? `/app/repos/${repoId}` : '/app', { replace: true })
    } catch (e) { toast.error('Couldn’t finish', (e as Error).message); setSaving(false) }
  }

  return (
    <div className="onb">
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
        <div className="onb-progress" aria-hidden="true">
          <motion.span animate={{ scaleX: (step + 1) / STEPS.length }} transition={{ duration: 0.8, ease: easeOut }} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={step} scope="pane" label={STEPS[step].title}>
            <section className="onb-card">
              <p className="onb-count mono">Step {step + 1} of {STEPS.length}</p>
              {step === 0 && <StepName name={name} setName={setName} onEnter={() => can && go(1)} />}
              {step === 1 && <StepNeeds role={role} setRole={setRole} goals={goals} setGoals={setGoals} />}
              {step === 2 && <StepAgents />}
              {step === 3 && <StepRepo repos={repos.length} loading={reposLoading} repoId={repoId} admin={!!admin}
                onAdded={async (id) => { setRepoId(id); await saveOnboarding(uid, { step: 3, repoId: id }); toast.ok('Repository added', 'The agents start on it as soon as you finish.') }} />}
              {step === 4 && <StepReview review={review} setReview={setReview} />}

              <div className="onb-nav">
                {step > 0 && <button className="btn btn-line" onClick={() => go(step - 1)} disabled={saving}><Roll>Back</Roll></button>}
                {step < STEPS.length - 1
                  ? <button className="btn btn-dark onb-next" onClick={() => go(step + 1)} disabled={!can || saving}><Roll>{saving ? 'Saving…' : 'Continue'}</Roll></button>
                  : <button className="btn btn-dark onb-next" onClick={finish} disabled={saving}><Roll>{saving ? 'Opening your dashboard…' : 'Open my dashboard'}</Roll></button>}
                {!can && step === 3 && <span className="muted">Add a repository, or try the demo, to go on.</span>}
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

function StepNeeds({ role, setRole, goals, setGoals }: { role: string; setRole: (s: string) => void; goals: string[]; setGoals: (g: string[]) => void }) {
  return (
    <>
      <Heading title="What brings you here?" sub="So the dashboard shows what matters to you first. Pick one, then as many goals as fit." />
      <Rise className="onb-group">
        <span className="onb-label">You</span>
        <div className="onb-options">
          {ROLES.map((r) => (
            <button key={r} className={`onb-option ${role === r ? 'on' : ''}`} onClick={() => setRole(r)} aria-pressed={role === r}>
              <span className="onb-radio" />{r}
            </button>
          ))}
        </div>
      </Rise>
      <Rise className="onb-group" i={1}>
        <span className="onb-label">Goals</span>
        <div className="onb-options">
          {GOALS.map((g) => (
            <button key={g} className={`onb-option ${goals.includes(g) ? 'on' : ''}`} onClick={() => setGoals(goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g])} aria-pressed={goals.includes(g)}>
              <span className="onb-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>{g}
            </button>
          ))}
        </div>
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

function StepReview({ review, setReview }: { review: 'every' | 'batch'; setReview: (r: 'every' | 'batch') => void }) {
  const opts = [
    { id: 'every' as const, t: 'Show me each fix as it’s ready', d: 'Fixes appear under “Waiting for you” one by one, with the evidence.' },
    { id: 'batch' as const, t: 'I’ll go through them in batches', d: 'The overview groups everything waiting for you in one place.' },
  ]
  return (
    <>
      <Heading title="How do you review?" sub="The agents never merge on their own. A fix waits for you with its diff, the test evidence and the reviewer’s checks." />
      <Rise className="onb-options onb-options--big">
        {opts.map((o) => (
          <button key={o.id} className={`onb-option ${review === o.id ? 'on' : ''}`} onClick={() => setReview(o.id)} aria-pressed={review === o.id}>
            <span className="onb-radio" /><span><b>{o.t}</b><span className="muted">{o.d}</span></span>
          </button>
        ))}
      </Rise>
      <Rise i={1}><p className="muted onb-note">That’s everything. You can change any of this later in Settings.</p></Rise>
    </>
  )
}
