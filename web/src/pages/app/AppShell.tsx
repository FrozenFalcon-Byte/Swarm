import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect } from 'react'
import { PageTransition, routeLabel } from '../../components/PageTransition'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/Logo'
import { useAuth } from '../../lib/auth'
import { onlineWorker, useRepos, useWorkers } from '../../lib/data'
import { usingEmulators } from '../../lib/firebase'
import { easeOut } from '../../lib/motion'
import { Splash } from '../../components/Splash'
import './app.css'

const pages = {
  overview: () => import('./Overview'), repos: () => import('./Repos'), repo: () => import('./RepoView'),
  tools: () => import('./ToolsPage'), settings: () => import('./Settings'),
}
const Overview = lazy(pages.overview)
const Repos = lazy(pages.repos)
const RepoView = lazy(pages.repo)
const ToolsPage = lazy(pages.tools)
const Settings = lazy(pages.settings)

export default function AppShell() {
  const { user, logOut } = useAuth()
  const { data: repos } = useRepos(user?.uid)
  const { data: workers } = useWorkers()
  const worker = onlineWorker(workers)
  const location = useLocation()
  const navigate = useNavigate()
  // animate between sections, not between a repo's tabs or its task drawer
  const key = location.pathname.split('/').slice(0, 4).join('/')
  // fetch every section's code once the shell is idle, so the bellows never open onto a loading screen
  useEffect(() => {
    const id = window.setTimeout(() => Object.values(pages).forEach((load) => load()), 1200)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="shell">
      <aside className="side">
        <Logo to="/app" />
        <nav className="side-nav" aria-label="Main">
          <SideLink to="/app" end icon="overview">Overview</SideLink>
          <SideLink to="/app/repos" icon="repos">Repositories</SideLink>
          <SideLink to="/app/tools" icon="tools">Tools</SideLink>
          <SideLink to="/app/settings" icon="settings">Settings</SideLink>
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
          <div className={`worker-chip ${worker ? 'on' : 'off'}`} title={worker ? `Worker ${worker.id}` : 'Start one with: swarm worker'}>
            <span className="status-dot" />
            <div>
              <b>{worker ? 'Agents online' : 'Agents offline'}</b>
              <span className="mono">{worker ? (worker.llm?.active || 'heuristics') : 'run `swarm worker`'}</span>
            </div>
          </div>
          <div className="side-user">
            <span className="avatar">{(user?.displayName || user?.email || '?').slice(0, 1).toUpperCase()}</span>
            <div className="side-user-text"><b>{user?.displayName || 'You'}</b><span>{user?.email}</span></div>
            <button className="icon-btn" onClick={async () => { await logOut(); navigate('/') }} aria-label="Sign out" title="Sign out">
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
              </Routes>
            </Suspense>
          </PageTransition>
        </AnimatePresence>
      </main>
    </div>
  )
}

const ICONS: Record<string, string> = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  repos: 'M4 4h11l5 5v11H4z M15 4v5h5',
  tools: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
}

function SideLink({ to, end, icon, children }: { to: string; end?: boolean; icon: string; children: string }) {
  return (
    <NavLink to={to} end={end} className="side-link">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="side-active" className="side-active" transition={{ duration: 0.45, ease: easeOut }} />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d={ICONS[icon]} /></svg>
          <span>{children}</span>
        </>
      )}
    </NavLink>
  )
}
