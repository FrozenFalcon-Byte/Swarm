import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PageTransition, routeLabel } from './components/PageTransition'
import { SetupNeeded } from './components/SetupNeeded'
import { Splash } from './components/Splash'
import { useAuth } from './lib/auth'
import { missingConfig } from './lib/firebase'
import Landing from './pages/landing/Landing'

const loadAuth = () => import('./pages/auth/AuthPage')
const loadShell = () => import('./pages/app/AppShell')
const AuthPage = lazy(loadAuth)
const AppShell = lazy(loadShell)

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

/** Sign-in and the dashboard need a Firebase project; the landing page doesn't. */
function NeedsFirebase({ children }: { children: ReactNode }) {
  return missingConfig.length ? <SetupNeeded /> : <>{children}</>
}

export default function App() {
  const location = useLocation()
  // top-level section: landing, auth, or the app (the app runs its own pane transitions)
  const section = location.pathname.startsWith('/app') ? 'app' : location.pathname
  // warm the other sections' code so a page change never lands on a loading screen
  useEffect(() => { const id = window.setTimeout(() => { loadAuth(); loadShell() }, 1500); return () => window.clearTimeout(id) }, [])
  const label = routeLabel(section === 'app' ? '/app' : section)

  return (
    // scroll to the top only once the old page has folded away, never while it's still on screen
    <AnimatePresence mode="wait" initial={false} onExitComplete={() => { if (!window.location.hash) window.scrollTo(0, 0) }}>
      <PageTransition key={section} label={label}>
        <Suspense fallback={<Splash />}>
          <Routes location={location}>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<NeedsFirebase><AuthPage mode="signin" /></NeedsFirebase>} />
            <Route path="/signup" element={<NeedsFirebase><AuthPage mode="signup" /></NeedsFirebase>} />
            <Route path="/app/*" element={<NeedsFirebase><RequireAuth><AppShell /></RequireAuth></NeedsFirebase>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </PageTransition>
    </AnimatePresence>
  )
}
