import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PageTransition, routeLabel } from '../../components/PageTransition'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { LiveLogo, Logo } from '../../components/Logo'
import { ModeToggle } from '../../components/ModeToggle'
import { LookFx } from '../../components/LookFx'
import { useAuth } from '../../lib/auth'
import { wakeHub } from '../../lib/api'
import { savePrefs, useAllTasks, useIsAdmin, usePrefs, useRepos } from '../../lib/data'
import { Avatar } from '../../components/Avatar'
import { usingEmulators } from '../../lib/firebase'
import { easeOut } from '../../lib/motion'
import { Splash } from '../../components/Splash'
import { useBootHold } from '../../lib/boot'
import { CommandBar, useCommandBar } from './CommandBar'
import { pop } from '../../lib/sound'
import { ICONS, NAV } from './nav'
import { setTimeStyle } from './ui'
import './app.css'

const pages = {
  overview: () => import('./Overview'), repos: () => import('./Repos'), repo: () => import('./RepoView'),
  tools: () => import('./ToolsPage'), settings: () => import('./Settings'), profile: () => import('./Profile'),
  help: () => import('./Help'), agents: () => import('./Agents'), lab: () => import('./Lab'),
  rules: () => import('./Rules'), quiet: () => import('./QuietHours'), whodunit: () => import('./Whodunit'),
}
const Overview = lazy(pages.overview)
const Repos = lazy(pages.repos)
const RepoView = lazy(pages.repo)
const ToolsPage = lazy(pages.tools)
const Settings = lazy(pages.settings)
const Profile = lazy(pages.profile)
const Help = lazy(pages.help)
const Agents = lazy(pages.agents)
const Lab = lazy(pages.lab)
const Rules = lazy(pages.rules)
const QuietHours = lazy(pages.quiet)
const Whodunit = lazy(pages.whodunit)

let startHandled = false // once per page load: later visits to /app are deliberate

/** Open the dashboard where you asked to (Profile → Preferences), and remember the last repo you opened. */
function useStartPage(start: 'overview' | 'repos' | 'last' | undefined) {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const m = location.pathname.match(/^\/app\/repos\/([^/]+)/)
    if (m) try { localStorage.setItem('swarm:lastRepo', m[1]) } catch { /* private mode */ }
  }, [location.pathname])
  useEffect(() => {
    if (startHandled || start === undefined) return
    startHandled = true
    if (location.pathname !== '/app' && location.pathname !== '/app/') return
    let last: string | null = null
    try { last = localStorage.getItem('swarm:lastRepo') } catch { /* private mode */ }
    if (start === 'repos') navigate('/app/repos', { replace: true })
    else if (start === 'last' && last) navigate(`/app/repos/${last}`, { replace: true })
  }, [start, location.pathname, navigate])
}

/** A browser notification when a task newly needs you, if you turned that on and Swarm isn't the tab you're looking at. */
function useNeedsYouAlerts(repos: { id: string; displayName?: string; fullName?: string }[], on: boolean) {
  const tasks = useAllTasks(on ? repos.map((r) => r.id) : [])
  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!on) { known.current = null; return }
    const waiting = tasks.filter((t) => t.state === 'Approved' || t.state === 'Needs Human')
    const keys = new Set(waiting.map((t) => `${t.repoId}/${t.task_id}/${t.state}`))
    if (known.current === null) { if (tasks.length) known.current = keys; return } // the first snapshot is what was already there
    const fresh = waiting.filter((t) => !known.current!.has(`${t.repoId}/${t.task_id}/${t.state}`))
    known.current = keys
    if (!fresh.length || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return
    const t = fresh[0]
    const repo = repos.find((r) => r.id === t.repoId)
    const n = new Notification(t.state === 'Approved' ? 'A fix is ready to merge' : 'A task needs you', {
      body: `${repo?.displayName || repo?.fullName || 'Swarm'} · ${t.task_id}: ${t.title}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`,
      icon: '/favicon.svg', tag: `${t.repoId}/${t.task_id}`,
    })
    n.onclick = () => { window.focus(); window.location.assign(`/app/repos/${t.repoId}`) }
  }, [tasks, on, repos])
}

export default function AppShell() {
  const { user, logOut } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading) // the boot screen stays until the sidebar has your repos in it
  const location = useLocation()
  const navigate = useNavigate()
  const admin = useIsAdmin(user?.uid)
  const [menu, setMenu] = useState(false)
  const [cmdOpen, setCmdOpen] = useCommandBar()
  const needsYou = repos.reduce((n, r) => n + (r.stats?.needsYou || 0), 0)
  const nav = NAV.filter((n) => !n.admin || admin)
  const prefs = usePrefs(user?.uid)
  // the sidebar folds the moment you ask; the saved preference catches up behind it
  const [rail, setRail] = useState(prefs?.sidebar === 'icons')
  useEffect(() => { setRail(prefs?.sidebar === 'icons') }, [prefs?.sidebar])
  const toggleRail = () => { const next = !rail; setRail(next); if (user) void savePrefs(user.uid, { sidebar: next ? 'icons' : 'full' }).catch(() => setRail(!next)) }
  useStartPage(prefs?.startPage)
  setTimeStyle(prefs?.times ?? 'relative', prefs?.clock ?? '24h') // read by timeAgo everywhere below
  const pins = (prefs?.pins ?? []).map((to) => {
    const repo = to.startsWith('/app/repos/') ? repos.find((r) => `/app/repos/${r.id}` === to) : undefined
    const page = NAV.find((n) => n.to === to)
    return repo ? { to, label: repo.displayName || repo.fullName, repo, icon: '' } : page ? { to, label: page.label, icon: page.icon, repo: undefined } : null
  }).filter((p): p is NonNullable<typeof p> => !!p)
  useNeedsYouAlerts(repos, !!prefs?.notify)
  useEffect(() => { setMenu(false) }, [location.pathname])
  useEffect(() => {
    const d = document.documentElement.dataset
    d.toasts = prefs?.toasts ?? 'br'
  }, [prefs?.toasts])
  // the pointer lives outside the dashboard, so hand it your highlight colour
  const shellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = shellRef.current && getComputedStyle(shellRef.current).getPropertyValue('--accent').trim()
    if (c) document.documentElement.style.setProperty('--cursor-accent', c)
    return () => { document.documentElement.style.removeProperty('--cursor-accent') }
  }, [prefs?.accent, prefs?.accentHex])
  // a soft pop on every press, if you asked for sounds
  useEffect(() => {
    if (prefs?.sounds !== 'pops') return
    const down = (e: PointerEvent) => { const el = (e.target as Element).closest?.('button, a, [role=radio], label'); if (el) pop(el.matches('.btn-dark, .btn-green') ? 0.8 : 1) }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [prefs?.sounds])
  useEffect(() => { wakeHub() }, []) // the server may be asleep on a free host; opening the dashboard wakes it
  // leave first, then sign out, so the dashboard's guard never bounces you to /signin on the way out
  const signOut = () => { navigate('/', { replace: true }); void logOut() }
  // animate between sections, not between a repo's tabs or its task drawer
  const key = location.pathname.split('/').slice(0, 4).join('/')
  // fetch every section's code once the shell is idle, so the bellows never open onto a loading screen
  useEffect(() => {
    const id = window.setTimeout(() => Object.values(pages).forEach((load) => load()), 1200)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div ref={shellRef} className={`shell ${rail ? 'side-rail' : ''} text-${prefs?.textSize ?? 'default'} canvas-${prefs?.canvas ?? 'white'} font-${prefs?.font ?? 'grotesk'} corners-${prefs?.corners ?? 'round'} look-${prefs?.look ?? 'plain'}`}
      data-accent={prefs?.accent ?? 'green'} style={accentStyle(prefs?.accent, prefs?.accentHex)}>
      <LookFx look={prefs?.look ?? 'plain'} />
      <header className="mtop">
        <Logo to="/app" />
        <span className="mtop-where">{routeLabel(key, (id) => repos.find((r) => r.id === id)?.displayName)}</span>
        <button className="mtop-search" onClick={() => setCmdOpen(true)} aria-label="Search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        </button>
        <button className={`mtop-menu ${menu ? 'open' : ''}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={menu ? 'Close menu' : 'Open menu'}>
          <span /><span />
        </button>
      </header>
      <AnimatePresence>
        {menu && (
          <motion.div className="msheet" initial={{ clipPath: 'inset(0 0 100% 0 round 0 0 40px 40px)' }} animate={{ clipPath: 'inset(0 0 0% 0 round 0 0 0px 0px)' }}
            exit={{ clipPath: 'inset(0 0 100% 0 round 0 0 40px 40px)' }} transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}>
            <nav className="msheet-nav" aria-label="Main">
              {nav.map((n, i) => (
                <motion.div key={n.to} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.18 + i * 0.04 }}>
                  <NavLink to={n.to} end={n.to === '/app'} className="msheet-link">{n.label}{n.to === '/app' && needsYou > 0 && <sup className="msheet-count">{needsYou}</sup>}</NavLink>
                </motion.div>
              ))}
            </nav>
            {repos.length > 0 && (
              <motion.div className="msheet-repos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
                <p className="side-label">Your repos</p>
                {repos.map((r) => (
                  <NavLink key={r.id} to={`/app/repos/${r.id}`} className="side-repo">
                    <span className={`status-dot s-${r.status || 'idle'}`} />
                    <span className="side-repo-name">{r.displayName || r.fullName}</span>
                    {!!r.stats?.needsYou && <span className="side-count">{r.stats.needsYou}</span>}
                  </NavLink>
                ))}
              </motion.div>
            )}
            <motion.div className="msheet-foot" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.4 }}>
              <ModeToggle className="msheet-mode" labels />
              <NavLink to="/app/profile" className="side-user-link"><Avatar size={38} /><span className="side-user-text"><b>{user?.displayName || 'You'}</b><span>{user?.email}</span></span></NavLink>
              <Link to="/" className="btn btn-line btn-sm">Swarm home</Link>
              <button className="btn btn-dark btn-sm" onClick={signOut}>Sign out</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <aside className="side">
        <div className="side-top">
          <LiveLogo to="/" busy={repos.some((r) => r.status === 'running')} still={prefs?.logo === 'still'} folded={rail} />
          <button className="side-fold" onClick={toggleRail} data-tip={rail ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={rail ? 'Expand the sidebar' : 'Collapse the sidebar'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15M16 10l-2 2 2 2" /></svg>
          </button>
        </div>
        <button className="side-search" onClick={() => setCmdOpen(true)} title="Search or jump to (⌘K)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span>Search or jump to…</span><kbd>⌘K</kbd>
        </button>
        {pins.length > 0 && (
          <nav className="side-nav" aria-label="Pinned">
            <p className="side-label side-label--top">Pinned</p>
            {pins.map((p) => p.repo
              ? <NavLink key={p.to} to={p.to} className="side-repo" data-tip={p.label}><span className={`status-dot s-${p.repo.status || 'idle'}`} /><span className="side-repo-name">{p.label}</span></NavLink>
              : <SideLink key={p.to} to={p.to} end={p.to === '/app'} icon={p.icon}>{p.label}</SideLink>)}
          </nav>
        )}
        <nav className="side-nav" aria-label="Main">
          {nav.filter((n) => n.group === 'main').map((n) => <SideLink key={n.to} to={n.to} end={n.to === '/app'} icon={n.icon} count={n.to === '/app' ? needsYou : 0}>{n.label}</SideLink>)}
          {<>
            <p className="side-label">Guardrails</p>
            {nav.filter((n) => n.group === 'guard').map((n) => <SideLink key={n.to} to={n.to} icon={n.icon}>{n.label}</SideLink>)}
            <p className="side-label">Just for fun</p>
            {nav.filter((n) => n.group === 'play').map((n) => <SideLink key={n.to} to={n.to} icon={n.icon}>{n.label}</SideLink>)}
          </>}
        </nav>
        {repos.length > 0 && (
          <div className="side-repos">
            <p className="side-label">Your repos</p>
            <div className="side-repos-list" data-lenis-prevent>
            {repos.map((r) => (
              <NavLink key={r.id} to={`/app/repos/${r.id}`} className="side-repo" data-tip={r.displayName || r.fullName}>
                <span className={`status-dot s-${r.status || 'idle'}`} />
                <span className="side-repo-name">{r.displayName || r.fullName}</span>
                {!!r.stats?.needsYou && <span className="side-count">{r.stats.needsYou}</span>}
              </NavLink>
            ))}
            </div>
          </div>
        )}
        <div className="side-foot">
          <nav className="side-nav" aria-label="More">
            {nav.filter((n) => n.group === 'foot').map((n) => <SideLink key={n.to} to={n.to} icon={n.icon}>{n.label}</SideLink>)}
          </nav>
          <div className={`side-user ${location.pathname.startsWith('/app/profile') ? 'active' : ''}`}>
            <NavLink to="/app/profile" className="side-user-link" title="Your profile">
              <span className="side-avatar">
                <Avatar size={36} />
                <span className="side-orbit" aria-hidden="true">{['triager', 'coder', 'tester', 'reviewer'].map((a, k) => <i key={a} style={{ background: `var(--${a})`, ['--k' as string]: k }} />)}</span>
              </span>
              <span className="side-user-text"><b>{user?.displayName || 'You'}</b><span>{user?.email}</span></span>
            </NavLink>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 17l5-5-5-5M20 12H9M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7" /></svg>
            </button>
          </div>
          {usingEmulators && <p className="emu-note mono">local emulators</p>}
        </div>
      </aside>
      <main className="main">
        {/* light and dark: a slim row of its own above every page, so it never sits on top of anything (phones have it in the menu sheet) */}
        <div className="main-bar"><ModeToggle /></div>
        <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
          <PageTransition key={key} scope="pane" label={routeLabel(key, (id) => repos.find((r) => r.id === id)?.displayName)}>
            <Suspense fallback={<Splash />}>
              <Routes location={location}>
                <Route index element={<Overview />} />
                <Route path="repos" element={<Repos />} />
                <Route path="repos/:repoId/*" element={<RepoView />} />
                <Route path="tools" element={<ToolsPage />} />
                <Route path="settings" element={<Settings />} />
                <Route path="profile" element={<Profile />} />
                <Route path="help" element={<Help />} />
                <Route path="agents" element={<Agents />} />
                <Route path="lab" element={admin ? <Lab /> : <Overview />} />
                <Route path="rules" element={<Rules />} />
                <Route path="quiet-hours" element={<QuietHours />} />
                <Route path="whodunit" element={<Whodunit />} />
              </Routes>
            </Suspense>
          </PageTransition>
        </AnimatePresence>
      </main>
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} repos={repos} pages={nav} onSignOut={signOut} />
    </div>
  )
}

/** Your own highlight colour: the accent itself, a pale wash of it, and a middling line. */
function accentStyle(accent?: string, hex?: string): React.CSSProperties | undefined {
  if (accent !== 'custom' || !hex) return undefined
  return { ['--accent' as string]: hex, ['--accent-soft' as string]: `color-mix(in srgb, ${hex} 22%, var(--white))`, ['--accent-line' as string]: `color-mix(in srgb, ${hex} 55%, transparent)` }
}

function SideLink({ to, end, icon, count = 0, children }: { to: string; end?: boolean; icon: string; count?: number; children: string }) {
  return (
    <NavLink to={to} end={end} className="side-link" data-tip={children}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="side-active" className="side-active" transition={{ duration: 0.45, ease: easeOut }} />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d={ICONS[icon]} /></svg>
          <span>{children}</span>
          <AnimatePresence>{count > 0 && <motion.span className="side-count side-link-count" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>{count}</motion.span>}</AnimatePresence>
        </>
      )}
    </NavLink>
  )
}
