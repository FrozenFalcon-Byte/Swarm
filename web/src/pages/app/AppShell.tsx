import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PageTransition, routeLabel } from '../../components/PageTransition'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/Logo'
import { useAuth } from '../../lib/auth'
import { useAllTasks, useIsAdmin, useProfile, useRepos } from '../../lib/data'
import { Avatar } from '../../components/Avatar'
import { usingEmulators } from '../../lib/firebase'
import { easeOut } from '../../lib/motion'
import { Splash } from '../../components/Splash'
import { useBootHold } from '../../lib/boot'
import { CommandBar, useCommandBar } from './CommandBar'
import './app.css'

const pages = {
  overview: () => import('./Overview'), repos: () => import('./Repos'), repo: () => import('./RepoView'),
  tools: () => import('./ToolsPage'), settings: () => import('./Settings'), profile: () => import('./Profile'),
  help: () => import('./Help'), agents: () => import('./Agents'), lab: () => import('./Lab'),
  tests: () => import('./Tests'), insights: () => import('./Insights'),
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
const Tests = lazy(pages.tests)
const Insights = lazy(pages.insights)

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
  const prefs = useProfile(user?.uid)?.prefs
  useStartPage(prefs?.startPage)
  useNeedsYouAlerts(repos, !!prefs?.notify)
  useEffect(() => { setMenu(false) }, [location.pathname])
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
    <div className={`shell ${prefs?.density === 'compact' ? 'density-compact' : ''}`}>
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
              <NavLink to="/app/profile" className="side-user-link"><Avatar size={38} /><span className="side-user-text"><b>{user?.displayName || 'You'}</b><span>{user?.email}</span></span></NavLink>
              <Link to="/" className="btn btn-line btn-sm">Swarm home</Link>
              <button className="btn btn-dark btn-sm" onClick={signOut}>Sign out</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <aside className="side">
        <Logo to="/app" />
        <button className="side-search" onClick={() => setCmdOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span>Search or jump to…</span><kbd>⌘K</kbd>
        </button>
        <nav className="side-nav" aria-label="Main">
          {nav.map((n) => <SideLink key={n.to} to={n.to} end={n.to === '/app'} icon={n.icon} count={n.to === '/app' ? needsYou : 0}>{n.label}</SideLink>)}
        </nav>
        {repos.length > 0 && (
          <div className="side-repos">
            <p className="side-label">Your repos</p>
            {repos.map((r) => (
              <NavLink key={r.id} to={`/app/repos/${r.id}`} className="side-repo">
                <span className={`status-dot s-${r.status || 'idle'}`} />
                <span className="side-repo-name">{r.displayName || r.fullName}</span>
                {!!r.stats?.needsYou && <span className="side-count">{r.stats.needsYou}</span>}
              </NavLink>
            ))}
          </div>
        )}
        <div className="side-foot">
          <Link to="/" className="side-home">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            <span>Swarm home</span>
          </Link>
          <div className={`side-user ${location.pathname.startsWith('/app/profile') ? 'active' : ''}`}>
            <NavLink to="/app/profile" className="side-user-link" title="Your profile">
              <Avatar size={38} />
              <span className="side-user-text"><b>{user?.displayName || 'You'}</b><span>{user?.email}</span></span>
            </NavLink>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 17l5-5-5-5M20 12H9M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7" /></svg>
            </button>
          </div>
          {usingEmulators && <p className="emu-note mono">local emulators</p>}
        </div>
      </aside>
      <main className="main">
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
                <Route path="tests" element={<Tests />} />
                <Route path="insights" element={<Insights />} />
              </Routes>
            </Suspense>
          </PageTransition>
        </AnimatePresence>
      </main>
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} repos={repos} pages={nav} onSignOut={signOut} />
    </div>
  )
}

const NAV = [
  { to: '/app', label: 'Overview', icon: 'overview' }, { to: '/app/tests', label: 'Tests', icon: 'tests' },
  { to: '/app/repos', label: 'Repositories', icon: 'repos' }, { to: '/app/insights', label: 'Insights', icon: 'insights' },
  { to: '/app/agents', label: 'Agents', icon: 'agents' }, { to: '/app/tools', label: 'Tools', icon: 'tools' },
  { to: '/app/lab', label: 'Test lab', icon: 'lab', admin: true },
  { to: '/app/settings', label: 'Settings', icon: 'settings' }, { to: '/app/help', label: 'Help', icon: 'help' },
]

const ICONS: Record<string, string> = {
  tests: 'M9 11l2 2 4-4 M4 4h16v16H4z',
  insights: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  lab: 'M9 3h6 M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3 M7.5 14h9',
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  repos: 'M4 4h11l5 5v11H4z M15 4v5h5',
  agents: 'M8 12a3 3 0 100-6 3 3 0 000 6z M16 18a3 3 0 100-6 3 3 0 000 6z M10.6 10.5l2.8 2.9 M5 20a3 3 0 016 0',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20z M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3 M12 17h.01',
  tools: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
}

function SideLink({ to, end, icon, count = 0, children }: { to: string; end?: boolean; icon: string; count?: number; children: string }) {
  return (
    <NavLink to={to} end={end} className="side-link">
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
